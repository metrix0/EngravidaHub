// app/api/(webhooks)/zernio/route.ts
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { isIP } from "net";
import { after, NextResponse } from "next/server";

import {
    parseZernioMessageWebhook,
    type ParsedZernioAttachment,
    type ParsedZernioMessage,
} from "@/lib/importers/zernio/parseZernioWebhook";
import { supabase } from "@/lib/supabase/client";
import { getZernioWebhookSigningKey } from "@/lib/zernio/client";
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
        if (parsedMessage.edit) {
            const signature = request.headers.get("x-zernio-signature") ??
                request.headers.get("x-late-signature");
            const expected = createHmac("sha256", getZernioWebhookSigningKey())
                .update(rawBody)
                .digest();
            if (
                !signature ||
                !/^[a-f0-9]{64}$/i.test(signature) ||
                !timingSafeEqual(expected, Buffer.from(signature, "hex"))
            ) {
                return NextResponse.json(
                    { ok: false, error: "Invalid Zernio webhook signature" },
                    { status: 401 },
                );
            }
        }

        const { data, error } = await supabase.rpc("persist_zernio_message", {
            p_message: parsedMessage,
        });
        if (error) throw error;
        if (parsedMessage.edit) {
            const status = (data as { edit_status: string }).edit_status;
            return NextResponse.json(
                { ok: status !== "missing", edit_status: status, request_id: requestId },
                { status: status === "missing" ? 503 : 200 },
            );
        }
        const saved = data as {
            duplicate: boolean;
            message: { id: string };
            thread_id: string;
            instagram_user_id: string;
        };
        if (saved.duplicate) {
            return NextResponse.json({
                ok: true,
                received: true,
                duplicate: true,
                external_id: parsedMessage.external_id,
                request_id: requestId,
            });
        }
        const thread = { id: saved.thread_id };
        const instagramUser = { id: saved.instagram_user_id };
        const messageId = saved.message.id;

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
                message_age_ms: Date.now() - new Date(parsedMessage.sent_at).getTime(),
                event_age_ms: webhookEventAge(payload),
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
function webhookEventAge(payload: unknown) {
    const timestamp = asRecord(payload)?.timestamp;
    const at = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
    return Number.isFinite(at) ? Date.now() - at : null;
}
