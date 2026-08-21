// app/api/(webhooks)/zernio/route.ts
import { randomUUID } from "crypto";
import { isIP } from "net";
import { after, NextResponse } from "next/server";

import {
    parseZernioMessageWebhook,
    type ParsedZernioAttachment,
    type ParsedZernioMessage,
} from "@/lib/importers/zernio/parseZernioWebhook";
import { queueThreadForMessage } from "@/lib/inbox/queueThreadForMessage";
import { supabase } from "@/lib/supabase/client";
import { persistConversationAdAttribution } from "@/lib/zernio/conversationAdAttribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ATTACHMENT_BUCKET = "inbox-attachments";
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 20_000;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/3gpp",
    "audio/aac",
    "audio/amr",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
]);

type ExistingInstagramUser = {
    id: string;
    username: string | null;
    display_name: string | null;
    profile_picture_url: string | null;
    first_seen_at: string;
    last_interaction_at: string;
};

export async function POST(request: Request) {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const rawBody = await request.text();

    let payload: unknown;

    try {
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json(
            { ok: false, error: "Invalid JSON payload" },
            { status: 400 },
        );
    }

    const event = stringValue(asRecord(payload)?.event);

    if (event === "webhook.test") {
        return NextResponse.json({
            ok: true,
            received: true,
            event,
            request_id: requestId,
        });
    }

    const parsedMessage = parseZernioMessageWebhook(payload);

    if (!parsedMessage) {
        return NextResponse.json({
            ok: true,
            received: true,
            skipped: true,
            reason: "unsupported_event_or_platform",
            event,
            request_id: requestId,
        });
    }

    try {
        if (await messageAlreadyExists(parsedMessage.external_id)) {
            return NextResponse.json({
                ok: true,
                received: true,
                duplicate: true,
                external_id: parsedMessage.external_id,
                request_id: requestId,
            });
        }

        const instagramUser = await resolveInstagramUser(parsedMessage);
        const thread = await queueThreadForMessage({
            instagramUserId: instagramUser.id,
            source: "zernio",
            channel: parsedMessage.channel,
            senderType: parsedMessage.sender_type,
            sentAt: parsedMessage.sent_at,
            externalThreadId: parsedMessage.external_thread_id,
            externalAccountId: parsedMessage.external_account_id,
        });
        const sequenceIndex = await getNextSequenceIndex(thread.id);
        const messageId = randomUUID();
        const { error: messageError } = await supabase.from("messages").insert({
            id: messageId,
            client_id: null,
            instagram_user_id: instagramUser.id,
            conversation_id: null,
            thread_id: thread.id,
            sender_type: parsedMessage.sender_type,
            sender_name: parsedMessage.sender_name,
            text: parsedMessage.text,
            sent_at: parsedMessage.sent_at,
            sequence_index: sequenceIndex,
            external_id: parsedMessage.external_id,
            external_contact_id: null,
            external_thread_id: parsedMessage.external_thread_id,
            external_attendant_id:
                parsedMessage.sender_type === "attendant"
                    ? parsedMessage.sender_id
                    : null,
            interactive_option_id: null,
        });

        if (messageError) {
            if (messageError.code === "23505") {
                return NextResponse.json({
                    ok: true,
                    received: true,
                    duplicate: true,
                    external_id: parsedMessage.external_id,
                    request_id: requestId,
                });
            }

            throw messageError;
        }

        if (parsedMessage.attachment) {
            after(() =>
                persistAttachmentAfterResponse({
                    messageId,
                    message: parsedMessage,
                    threadId: thread.id,
                    requestId,
                }),
            );
        }

        if (parsedMessage.referral?.ad_id) {
            after(() =>
                persistConversationAdAttribution({
                    message: parsedMessage,
                    messageId,
                    threadId: thread.id,
                    instagramUserId: instagramUser.id,
                    requestId,
                }),
            );
        }

        console.info(
            `[zernio-webhook:${requestId}] ${parsedMessage.channel} message saved`,
            {
                event,
                thread_id: thread.id,
                instagram_user_id: instagramUser.id,
                sender_type: parsedMessage.sender_type,
                has_attachment: Boolean(parsedMessage.attachment),
                attachment_queued: Boolean(parsedMessage.attachment),
                ad_referral_queued: Boolean(parsedMessage.referral?.ad_id),
                duration_ms: Date.now() - startedAt,
            },
        );

        return NextResponse.json({
            ok: true,
            received: true,
            saved: true,
            channel: parsedMessage.channel,
            thread_id: thread.id,
            instagram_user_id: instagramUser.id,
            attachment_queued: Boolean(parsedMessage.attachment),
            ad_referral_queued: Boolean(parsedMessage.referral?.ad_id),
            request_id: requestId,
            duration_ms: Date.now() - startedAt,
        });
    } catch (error) {
        console.error(`[zernio-webhook:${requestId}] Processing failed`, {
            event,
            error,
            duration_ms: Date.now() - startedAt,
        });

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to receive Zernio message",
                request_id: requestId,
                duration_ms: Date.now() - startedAt,
            },
            { status: 500 },
        );
    }
}

async function persistAttachmentAfterResponse({
    messageId,
    message,
    threadId,
    requestId,
}: {
    messageId: string;
    message: ParsedZernioMessage;
    threadId: string;
    requestId: string;
}) {
    if (!message.attachment) return;

    try {
        const text = await persistIncomingAttachment({
            attachment: message.attachment,
            caption: message.text,
            threadId,
            externalMessageId: message.external_id,
            channel: message.channel,
        });
        const { error } = await supabase
            .from("messages")
            .update({ text })
            .eq("id", messageId)
            .eq("external_id", message.external_id);

        if (error) throw error;

        const { error: threadError } = await supabase
            .from("thread")
            .update({ last_message_text: text })
            .eq("id", threadId)
            .eq("last_message_at", message.sent_at);

        if (threadError) throw threadError;

        console.info(
            `[zernio-webhook:${requestId}] ${message.channel} attachment saved`,
            {
                message_id: messageId,
                thread_id: threadId,
            },
        );
    } catch (error) {
        console.error(
            `[zernio-webhook:${requestId}] ${message.channel} attachment persistence failed`,
            {
                message_id: messageId,
                thread_id: threadId,
                error,
            },
        );
    }
}

async function resolveInstagramUser(
    message: ParsedZernioMessage,
): Promise<{ id: string }> {
    const existing = await findInstagramUser(message);

    if (existing) {
        return updateInstagramUser(existing, message);
    }

    const now = new Date().toISOString();
    const instagramUserId = randomUUID();
    const { error } = await supabase.from("instagram_users").insert({
        id: instagramUserId,
        zernio_account_id: message.external_account_id,
        zernio_participant_id: message.participant_id,
        username: message.participant_username,
        display_name: message.participant_name,
        profile_picture_url: message.participant_picture_url,
        first_seen_at: message.sent_at,
        last_interaction_at: message.sent_at,
        created_at: now,
        updated_at: now,
    });

    if (!error) return { id: instagramUserId };
    if (error.code !== "23505") throw error;

    const winner = await findInstagramUser(message);
    if (!winner) throw error;
    return updateInstagramUser(winner, message);
}

async function findInstagramUser(message: ParsedZernioMessage) {
    const { data, error } = await supabase
        .from("instagram_users")
        .select(
            "id, username, display_name, profile_picture_url, first_seen_at, last_interaction_at",
        )
        .eq("zernio_account_id", message.external_account_id)
        .eq("zernio_participant_id", message.participant_id)
        .maybeSingle();

    if (error) throw error;
    return data as ExistingInstagramUser | null;
}

async function updateInstagramUser(
    instagramUser: ExistingInstagramUser,
    message: ParsedZernioMessage,
) {
    const interactionAt = new Date(message.sent_at).getTime();
    const firstSeenAt = new Date(instagramUser.first_seen_at).getTime();
    const lastInteractionAt = new Date(
        instagramUser.last_interaction_at,
    ).getTime();
    const updates: Record<string, string> = {
        updated_at: new Date().toISOString(),
    };

    if (Number.isFinite(interactionAt) && interactionAt < firstSeenAt) {
        updates.first_seen_at = message.sent_at;
    }
    if (Number.isFinite(interactionAt) && interactionAt > lastInteractionAt) {
        updates.last_interaction_at = message.sent_at;
    }
    if (
        message.participant_username &&
        message.participant_username !== instagramUser.username
    ) {
        updates.username = message.participant_username;
    }
    if (
        message.participant_name &&
        message.participant_name !== instagramUser.display_name
    ) {
        updates.display_name = message.participant_name;
    }
    if (
        message.participant_picture_url &&
        message.participant_picture_url !==
            instagramUser.profile_picture_url
    ) {
        updates.profile_picture_url = message.participant_picture_url;
    }

    const { data, error } = await supabase
        .from("instagram_users")
        .update(updates)
        .eq("id", instagramUser.id)
        .select("id")
        .single();

    if (error) throw error;
    return data;
}

async function messageAlreadyExists(externalId: string) {
    const { data, error } = await supabase
        .from("messages")
        .select("id")
        .eq("external_id", externalId)
        .maybeSingle();

    if (error) throw error;
    return Boolean(data);
}

async function getNextSequenceIndex(threadId: string) {
    const { data, error } = await supabase
        .from("messages")
        .select("sequence_index")
        .eq("thread_id", threadId)
        .order("sequence_index", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return typeof data?.sequence_index === "number"
        ? data.sequence_index + 1
        : 0;
}

async function persistIncomingAttachment({
    attachment,
    caption,
    threadId,
    externalMessageId,
    channel,
}: {
    attachment: ParsedZernioAttachment;
    caption: string;
    threadId: string;
    externalMessageId: string;
    channel: ParsedZernioMessage["channel"];
}) {
    const sourceUrl = parseRemoteMediaUrl(attachment.url);
    const response = await fetch(sourceUrl, {
        headers: { Accept: "*/*" },
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS),
    });

    parseRemoteMediaUrl(response.url);

    if (!response.ok) {
        throw new Error(
            `Zernio media download failed with HTTP ${response.status}`,
        );
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_ATTACHMENT_BYTES
    ) {
        throw new Error(`O anexo do ${channel} excede 16 MB.`);
    }

    const file = await response.arrayBuffer();
    if (file.byteLength <= 0 || file.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error(
            `O anexo do ${channel} está vazio ou excede 16 MB.`,
        );
    }

    const mimeType = resolveMimeType({
        responseMime: response.headers.get("content-type"),
        attachment,
        channel,
    });
    const name = sanitizeFileName(
        attachment.name ?? defaultFileName(attachment.type, mimeType),
    );
    const messageFragment = externalMessageId
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .slice(-96);
    const path = `${threadId}/zernio-${messageFragment}-${name}`;
    const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, file, {
            contentType: mimeType,
            upsert: true,
        });

    if (error) throw error;

    return attachmentHistoryText({
        path,
        name,
        mimeType,
        size: file.byteLength,
        type: attachment.type,
        caption,
    });
}

function attachmentHistoryText({
    path,
    name,
    mimeType,
    size,
    type,
    caption,
}: {
    path: string;
    name: string;
    mimeType: string;
    size: number;
    type: ParsedZernioAttachment["type"];
    caption: string;
}) {
    const label =
        type === "image"
            ? "📷 Imagem"
            : type === "video"
              ? "🎥 Vídeo"
              : type === "audio"
                ? "🎵 Áudio"
                : `📎 ${name}`;
    const metadata = new URLSearchParams({
        path,
        name,
        mime_type: mimeType,
        size: String(size),
    });
    const visibleText =
        caption && !caption.startsWith("[") ? caption : label;

    return `${visibleText}${encodeInvisibleAttachmentMetadata(
        metadata.toString(),
    )}`;
}

function encodeInvisibleAttachmentMetadata(value: string) {
    const payload = `engravida-attachment:${value}`;
    const tagCharacters = [...payload]
        .map((character) =>
            String.fromCodePoint(0xe0000 + character.charCodeAt(0)),
        )
        .join("");

    return `${tagCharacters}${String.fromCodePoint(0xe007f)}`;
}

function resolveMimeType({
    responseMime,
    attachment,
    channel,
}: {
    responseMime: string | null;
    attachment: ParsedZernioAttachment;
    channel: ParsedZernioMessage["channel"];
}) {
    const normalizedResponseMime = normalizeMimeType(responseMime ?? "");
    if (ALLOWED_ATTACHMENT_MIME_TYPES.has(normalizedResponseMime)) {
        return normalizedResponseMime;
    }

    const inferred = inferMimeType(attachment);
    if (ALLOWED_ATTACHMENT_MIME_TYPES.has(inferred)) return inferred;

    throw new Error(
        `Tipo de anexo do ${channel} não permitido: ${
            normalizedResponseMime || inferred || "desconhecido"
        }`,
    );
}

function inferMimeType(attachment: ParsedZernioAttachment) {
    const extension = attachment.name?.split(".").at(-1)?.toLowerCase();

    if (extension === "png") return "image/png";
    if (extension === "webp") return "image/webp";
    if (extension === "gif") return "image/gif";
    if (extension === "mp4") {
        return attachment.type === "audio" ? "audio/mp4" : "video/mp4";
    }
    if (extension === "ogg") return "audio/ogg";
    if (extension === "mp3") return "audio/mpeg";
    if (extension === "pdf") return "application/pdf";
    if (extension === "csv") return "text/csv";
    if (extension === "txt") return "text/plain";

    if (attachment.type === "image") return "image/jpeg";
    if (attachment.type === "video") return "video/mp4";
    if (attachment.type === "audio") return "audio/mpeg";
    return "";
}

function defaultFileName(
    type: ParsedZernioAttachment["type"],
    mimeType: string,
) {
    if (type === "image") return `imagem.${extensionForMime(mimeType)}`;
    if (type === "video") return `video.${extensionForMime(mimeType)}`;
    if (type === "audio") return `audio.${extensionForMime(mimeType)}`;
    return `arquivo.${extensionForMime(mimeType)}`;
}

function extensionForMime(mimeType: string) {
    if (mimeType === "image/jpeg") return "jpg";
    if (mimeType === "audio/mpeg") return "mp3";
    if (mimeType === "application/pdf") return "pdf";
    return mimeType.split("/")[1]?.replace(/^x-/, "") || "bin";
}

function sanitizeFileName(value: string) {
    const normalized = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    return normalized.slice(0, 120) || "anexo";
}

function normalizeMimeType(value: string) {
    return value.trim().toLowerCase().split(";", 1)[0].trim();
}

function parseRemoteMediaUrl(value: string) {
    const url = new URL(value);

    if (url.protocol !== "https:") {
        throw new Error("Zernio media URL must use HTTPS");
    }

    const hostname = url.hostname.toLowerCase();
    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        isPrivateIpAddress(hostname)
    ) {
        throw new Error("Zernio media URL is not allowed");
    }

    return url;
}

function isPrivateIpAddress(hostname: string) {
    const version = isIP(hostname);
    if (!version) return false;

    if (version === 4) {
        const [first, second] = hostname.split(".").map(Number);
        return (
            first === 10 ||
            first === 127 ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168) ||
            first === 0
        );
    }

    const normalized = hostname.toLowerCase();
    return (
        normalized === "::1" ||
        normalized === "::" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb")
    );
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}