// app/api/(webhooks)/blip/messages/route.ts
import { randomUUID } from "crypto";
import { isIP } from "net";
import { NextResponse } from "next/server";

import { createAttendantFromParsedMessage } from "@/lib/attendants/createAttendant";
import { createClientFromParsedMessage } from "@/lib/clients/createClient";
import { queueThreadForMessage } from "@/lib/inbox/queueThreadForMessage";
import {
    parseBlipMessage,
    type ParsedBlipMedia,
} from "@/lib/importers/blip/parseBlipMessage";
import { supabase } from "@/lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTACHMENT_BUCKET = "inbox-attachments";
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 20_000;
const ALLOWED_ATTACHMENT_MIME_TYPES = [
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
];

let attachmentBucketReady: Promise<void> | null = null;

export async function POST(request: Request) {
    const webhookRequestId = randomUUID();
    const startedAt = Date.now();

    console.info(`[blip-webhook:${webhookRequestId}] Incoming request`, {
        method: request.method,
        url: request.url,
        content_type: request.headers.get("content-type"),
    });

    try {
        const body = await request.json();

        console.info(`[blip-webhook:${webhookRequestId}] Raw Blip envelope`, body);

        const parsedMessage = parseBlipMessage(body);

        console.info(`[blip-webhook:${webhookRequestId}] Parsed envelope`, {
            parsed: parsedMessage,
            duration_ms: Date.now() - startedAt,
        });

        if (!parsedMessage) {
            console.warn(
                `[blip-webhook:${webhookRequestId}] Envelope skipped: unsupported or empty content`,
            );

            return NextResponse.json({
                ok: true,
                received: true,
                skipped: true,
                reason: "unsupported_or_empty_content",
                request_id: webhookRequestId,
            });
        }

        if (!parsedMessage.external_contact_id) {
            console.warn(
                `[blip-webhook:${webhookRequestId}] Envelope skipped: missing external contact ID`,
                parsedMessage,
            );

            return NextResponse.json({
                ok: true,
                received: true,
                skipped: true,
                reason: "missing_external_contact_id",
                request_id: webhookRequestId,
            });
        }

        // Outbound messages sent by this Inbox may be echoed to the webhook by Blip.
        // Check before touching clients or threads so the echo does not create duplicates.
        if (
            parsedMessage.external_id &&
            (await messageAlreadyExists(parsedMessage.external_id, webhookRequestId))
        ) {
            console.info(
                `[blip-webhook:${webhookRequestId}] Duplicate/outbound echo ignored`,
                { external_id: parsedMessage.external_id },
            );

            return NextResponse.json({
                ok: true,
                received: true,
                duplicate: true,
                external_id: parsedMessage.external_id,
                request_id: webhookRequestId,
            });
        }

        console.info(`[blip-webhook:${webhookRequestId}] Creating/updating client`, {
            external_contact_id: parsedMessage.external_contact_id,
        });
        const client = await createClientFromParsedMessage(parsedMessage);

        console.info(`[blip-webhook:${webhookRequestId}] Client resolved`, {
            client_id: client.id,
        });

        await createAttendantFromParsedMessage(parsedMessage);

        console.info(`[blip-webhook:${webhookRequestId}] Updating Inbox thread`, {
            client_id: client.id,
            sender_type: parsedMessage.sender_type,
            sent_at: parsedMessage.sent_at,
            updates_24h_window: parsedMessage.sender_type === "client",
        });

        const thread = await queueThreadForMessage({
            clientId: client.id,
            source: "blip",
            channel: "WhatsApp",
            senderType: parsedMessage.sender_type,
            sentAt: parsedMessage.sent_at,
        });

        const sequenceIndex = await getNextSequenceIndex(
            thread.id,
            webhookRequestId,
        );

        let persistedText = parsedMessage.text;

        if (parsedMessage.media) {
            persistedText = await persistIncomingMedia({
                media: parsedMessage.media,
                threadId: thread.id,
                externalMessageId: parsedMessage.external_id,
                sentAt: parsedMessage.sent_at,
                webhookRequestId,
            });
        }

        console.info(`[blip-webhook:${webhookRequestId}] Saving message`, {
            thread_id: thread.id,
            client_id: client.id,
            sequence_index: sequenceIndex,
            external_id: parsedMessage.external_id,
            sender_type: parsedMessage.sender_type,
            sent_at: parsedMessage.sent_at,
            has_media: Boolean(parsedMessage.media),
        });

        const { error: messageError } = await supabase.from("messages").insert({
            id: randomUUID(),
            client_id: client.id,
            conversation_id: null,
            thread_id: thread.id,
            sender_type: parsedMessage.sender_type,
            sender_name: parsedMessage.sender_name,
            text: persistedText,
            sent_at: parsedMessage.sent_at,
            sequence_index: sequenceIndex,
            external_id: parsedMessage.external_id,
            external_contact_id: parsedMessage.external_contact_id,
            external_thread_id: parsedMessage.external_thread_id,
            external_attendant_id:
                parsedMessage.external_attendant_id || parsedMessage.sender_name,
            interactive_option_id: parsedMessage.interactive_option_id,
        });

        if (messageError) {
            if (messageError.code === "23505") {
                console.info(
                    `[blip-webhook:${webhookRequestId}] Duplicate database message ignored`,
                    { external_id: parsedMessage.external_id },
                );

                return NextResponse.json({
                    ok: true,
                    received: true,
                    duplicate: true,
                    request_id: webhookRequestId,
                });
            }

            throw messageError;
        }

        console.info(`[blip-webhook:${webhookRequestId}] Completed successfully`, {
            thread_id: thread.id,
            client_id: client.id,
            last_client_message_at:
                parsedMessage.sender_type === "client"
                    ? parsedMessage.sent_at
                    : "unchanged",
            duration_ms: Date.now() - startedAt,
        });

        return NextResponse.json({
            ok: true,
            received: true,
            saved: true,
            thread_id: thread.id,
            client_id: client.id,
            request_id: webhookRequestId,
            duration_ms: Date.now() - startedAt,
        });
    } catch (error) {
        console.error(
            `[blip-webhook:${webhookRequestId}] Failed to process payload`,
            error,
        );

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to receive Blip message",
                request_id: webhookRequestId,
                duration_ms: Date.now() - startedAt,
            },
            { status: 500 },
        );
    }
}

async function persistIncomingMedia({
    media,
    threadId,
    externalMessageId,
    sentAt,
    webhookRequestId,
}: {
    media: ParsedBlipMedia;
    threadId: string;
    externalMessageId: string | null;
    sentAt: string;
    webhookRequestId: string;
}) {
    const sourceUrl = parseRemoteMediaUrl(media.uri);

    console.info(`[blip-webhook:${webhookRequestId}] Downloading incoming media`, {
        host: sourceUrl.host,
        mime_type: media.mime_type,
        declared_size: media.size,
    });

    const response = await fetch(sourceUrl, {
        method: "GET",
        headers: {
            Accept: "*/*",
        },
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
        throw new Error(
            `Não foi possível baixar o arquivo recebido da Blip (HTTP ${response.status}).`,
        );
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);

    if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES) {
        throw new Error("O arquivo recebido ultrapassa o limite de 16 MB.");
    }

    const fileBuffer = await response.arrayBuffer();
    const size = fileBuffer.byteLength;

    if (size <= 0) {
        throw new Error("O arquivo recebido está vazio.");
    }

    if (size > MAX_ATTACHMENT_BYTES) {
        throw new Error("O arquivo recebido ultrapassa o limite de 16 MB.");
    }

    const responseMimeType = normalizeAttachmentMimeType(
        response.headers.get("content-type") ?? "",
    );
    const declaredMimeType = normalizeAttachmentMimeType(media.mime_type);
    const mimeType = ALLOWED_ATTACHMENT_MIME_TYPES.includes(responseMimeType)
        ? responseMimeType
        : declaredMimeType;

    if (!mimeType || !ALLOWED_ATTACHMENT_MIME_TYPES.includes(mimeType)) {
        throw new Error(`Formato de arquivo recebido não compatível: ${media.mime_type}.`);
    }

    await ensureAttachmentBucket();

    const extension = extensionForMimeType(mimeType);
    const preferredName = sanitizeFileName(media.name ?? "");
    const mediaKind = mediaKindForMimeType(mimeType);
    const fileName = preferredName
        ? ensureFileExtension(preferredName, extension)
        : `${mediaKind}-${safeTimestamp(sentAt)}.${extension}`;
    const stableMessageId = sanitizeFileName(externalMessageId ?? "") || randomUUID();
    const path = `${threadId}/incoming/${stableMessageId}-${fileName}`;

    const { error: uploadError } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, fileBuffer, {
            contentType: mimeType,
            upsert: true,
        });

    if (uploadError) {
        throw uploadError;
    }

    console.info(`[blip-webhook:${webhookRequestId}] Incoming media stored`, {
        path,
        mime_type: mimeType,
        size,
    });

    return attachmentHistoryText({
        path,
        name: fileName,
        mimeType,
        size,
    });
}

function parseRemoteMediaUrl(value: string) {
    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw new Error("A Blip enviou uma URL de mídia inválida.");
    }

    if (url.protocol !== "https:") {
        throw new Error("A URL da mídia recebida precisa usar HTTPS.");
    }

    const hostname = url.hostname.toLowerCase();

    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        isPrivateIpAddress(hostname)
    ) {
        throw new Error("A URL da mídia recebida não é permitida.");
    }

    return url;
}

function isPrivateIpAddress(hostname: string) {
    const version = isIP(hostname);
    if (!version) return false;

    if (version === 4) {
        const octets = hostname.split(".").map(Number);
        const [first, second] = octets;

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

async function ensureAttachmentBucket() {
    if (!attachmentBucketReady) {
        attachmentBucketReady = (async () => {
            const { data: existing, error: getError } =
                await supabase.storage.getBucket(ATTACHMENT_BUCKET);

            if (existing) return;

            if (getError && !/not found/i.test(getError.message)) {
                throw getError;
            }

            const { error: createError } = await supabase.storage.createBucket(
                ATTACHMENT_BUCKET,
                {
                    public: false,
                    fileSizeLimit: MAX_ATTACHMENT_BYTES,
                    allowedMimeTypes: ALLOWED_ATTACHMENT_MIME_TYPES,
                },
            );

            if (createError && !/already exists/i.test(createError.message)) {
                throw createError;
            }
        })().catch((error) => {
            attachmentBucketReady = null;
            throw error;
        });
    }

    return attachmentBucketReady;
}

function attachmentHistoryText(attachment: {
    path: string;
    name: string;
    mimeType: string;
    size: number;
}) {
    const metadata = new URLSearchParams({
        path: attachment.path,
        name: attachment.name,
        mime_type: attachment.mimeType,
        size: String(attachment.size),
    });

    return `${attachmentLabel(attachment.mimeType)}${encodeInvisibleAttachmentMetadata(metadata.toString())}`;
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

function normalizeAttachmentMimeType(value: string) {
    const normalized = value
        .trim()
        .toLowerCase()
        .split(";", 1)[0]
        .trim();

    if (!normalized || normalized === "application/octet-stream") return "";
    if (normalized === "image/jpg") return "image/jpeg";
    if (normalized === "audio/mp3" || normalized === "voice/mp3") {
        return "audio/mpeg";
    }
    if (normalized === "audio/x-m4a" || normalized === "voice/mp4") {
        return "audio/mp4";
    }
    if (normalized === "voice/ogg" || normalized === "audio/opus") {
        return "audio/ogg";
    }
    if (normalized.startsWith("voice/")) {
        return `audio/${normalized.slice("voice/".length)}`;
    }

    return normalized;
}

function extensionForMimeType(mimeType: string) {
    switch (mimeType) {
        case "image/jpeg":
            return "jpg";
        case "image/png":
            return "png";
        case "image/webp":
            return "webp";
        case "image/gif":
            return "gif";
        case "video/mp4":
            return "mp4";
        case "video/3gpp":
            return "3gp";
        case "audio/aac":
            return "aac";
        case "audio/amr":
            return "amr";
        case "audio/mpeg":
            return "mp3";
        case "audio/mp4":
            return "m4a";
        case "audio/ogg":
            return "ogg";
        case "application/pdf":
            return "pdf";
        case "application/msword":
            return "doc";
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return "docx";
        case "application/vnd.ms-excel":
            return "xls";
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            return "xlsx";
        case "application/vnd.ms-powerpoint":
            return "ppt";
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            return "pptx";
        case "text/csv":
            return "csv";
        case "text/plain":
        default:
            return "txt";
    }
}

function mediaKindForMimeType(mimeType: string) {
    if (mimeType.startsWith("image/")) return "imagem";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "arquivo";
}

function attachmentLabel(mimeType: string) {
    if (mimeType.startsWith("image/")) return "📷 Imagem";
    if (mimeType.startsWith("video/")) return "🎬 Vídeo";
    if (mimeType.startsWith("audio/")) return "🎵 Áudio";
    return "📎 Arquivo";
}

function ensureFileExtension(fileName: string, extension: string) {
    return fileName.toLowerCase().endsWith(`.${extension}`)
        ? fileName
        : `${fileName}.${extension}`;
}

function sanitizeFileName(value: string) {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 120);
}

function safeTimestamp(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
}

async function messageAlreadyExists(
    externalId: string,
    webhookRequestId: string,
) {
    const { data, error } = await supabase
        .from("messages")
        .select("id")
        .eq("external_id", externalId)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error(
            `[blip-webhook:${webhookRequestId}] Duplicate lookup failed`,
            error,
        );
        throw error;
    }

    return Boolean(data);
}

async function getNextSequenceIndex(
    threadId: string,
    webhookRequestId: string,
) {
    const { data, error } = await supabase
        .from("messages")
        .select("sequence_index")
        .eq("thread_id", threadId)
        .order("sequence_index", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error(
            `[blip-webhook:${webhookRequestId}] Sequence index lookup failed`,
            error,
        );
        throw error;
    }

    return (data?.sequence_index ?? 0) + 1;
}
