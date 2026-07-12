// app/api/conversations/media/route.ts
import { randomUUID } from "crypto";
import { isIP } from "net";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_TIMEOUT_MS = 20_000;
const ATTACHMENT_BUCKET = "inbox-attachments";
const MESSAGE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const THREAD_ID_PATTERN = MESSAGE_ID_PATTERN;
const LEGACY_MEDIA_PATTERN = /^\[(Imagem|Vídeo|Áudio|Arquivo) enviado\]/i;

type BlipThreadMessage = {
    id?: unknown;
    type?: unknown;
    content?: unknown;
    metadata?: unknown;
};

export async function GET(request: Request) {
    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.active) {
        return new Response("Not allowed", { status: 403 });
    }

    const searchParams = new URL(request.url).searchParams;
    const path = searchParams.get("path")?.trim() ?? "";

    if (path) {
        return serveStoredMedia(request, path);
    }

    const messageId = searchParams.get("message_id")?.trim() ?? "";

    if (!MESSAGE_ID_PATTERN.test(messageId)) {
        return new Response("Invalid message ID", { status: 400 });
    }

    const { data: message, error } = await supabase
        .from("messages")
        .select("external_id, external_contact_id, text")
        .eq("id", messageId)
        .maybeSingle();

    if (error) {
        console.error("[conversation-media] failed to load message", error);
        return new Response("Could not load media", { status: 500 });
    }

    if (
        !message?.external_id ||
        !message.external_contact_id ||
        !LEGACY_MEDIA_PATTERN.test(message.text)
    ) {
        return new Response("Media not found", { status: 404 });
    }

    try {
        const remoteMedia = await findRemoteMedia(
            message.external_contact_id,
            message.external_id,
        );

        if (!remoteMedia) {
            return new Response("Media not found", { status: 404 });
        }

        const sourceUrl = parseRemoteMediaUrl(remoteMedia.uri);
        const range = request.headers.get("range");
        const upstream = await fetch(sourceUrl, {
            headers: {
                Accept: "*/*",
                ...(range ? { Range: range } : {}),
            },
            cache: "no-store",
            redirect: "follow",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!upstream.ok || !upstream.body) {
            return new Response("Media not found", { status: 404 });
        }

        const contentType =
            normalizeMimeType(upstream.headers.get("content-type") ?? "") ||
            normalizeMimeType(remoteMedia.mimeType) ||
            "application/octet-stream";
        const fileName = safeHeaderFileName(
            remoteMedia.name || defaultFileName(contentType),
        );
        const headers = new Headers({
            "Content-Type": contentType,
            "Content-Disposition": `inline; filename="${fileName}"`,
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        });

        copyHeader(upstream.headers, headers, "accept-ranges");
        copyHeader(upstream.headers, headers, "content-length");
        copyHeader(upstream.headers, headers, "content-range");

        return new Response(upstream.body, {
            status: upstream.status,
            headers,
        });
    } catch (mediaError) {
        console.error("[conversation-media] failed to recover Blip media", {
            message_id: messageId,
            error: mediaError,
        });
        return new Response("Could not load media", { status: 502 });
    }
}

async function serveStoredMedia(request: Request, path: string) {
    if (!isValidAttachmentPath(path)) {
        return new Response("Invalid attachment path", { status: 400 });
    }

    const { data: file, error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .download(path);

    if (error || !file) {
        return new Response("Media not found", { status: 404 });
    }

    const fileBuffer = await file.arrayBuffer();
    const totalSize = fileBuffer.byteLength;
    const fileName = safeHeaderFileName(path.split("/").at(-1) ?? "anexo");
    const contentType = file.type || "application/octet-stream";
    const baseHeaders = {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
    };
    const range = parseByteRange(request.headers.get("range"), totalSize);

    if (range === "invalid") {
        return new Response(null, {
            status: 416,
            headers: {
                ...baseHeaders,
                "Content-Range": `bytes */${totalSize}`,
            },
        });
    }

    if (range) {
        const body = fileBuffer.slice(range.start, range.end + 1);
        return new Response(body, {
            status: 206,
            headers: {
                ...baseHeaders,
                "Content-Length": String(body.byteLength),
                "Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
            },
        });
    }

    return new Response(fileBuffer, {
        headers: {
            ...baseHeaders,
            "Content-Length": String(totalSize),
        },
    });
}

async function findRemoteMedia(
    externalContactId: string,
    externalMessageId: string,
) {
    for (const direction of ["desc", "asc"] as const) {
        const messages = await fetchBlipThreadMessages(
            externalContactId,
            direction,
        );
        const match = messages.find((message) =>
            messageIds(message).some((id) => idsMatch(id, externalMessageId)),
        );

        if (match) {
            return parseRemoteMedia(match);
        }
    }

    return null;
}

async function fetchBlipThreadMessages(
    externalContactId: string,
    direction: "asc" | "desc",
) {
    const contractId = process.env.BLIP_CONTRACT_ID?.trim() || "engravida";
    const response = await fetch(
        `https://${contractId}.http.msging.net/commands`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Key ${getBlipAuthKey()}`,
            },
            body: JSON.stringify({
                id: randomUUID(),
                method: "get",
                uri: `/threads-merged/${encodeURIComponent(
                    externalContactId,
                )}?$take=100&direction=${direction}`,
                type: "application/vnd.iris.thread-message+json",
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
    );
    const body = (await response.json().catch(() => null)) as Record<
        string,
        unknown
    > | null;

    if (!response.ok || !body || body.status === "failure") {
        throw new Error(`Blip history request failed with HTTP ${response.status}`);
    }

    const resource = asRecord(body.resource);
    return Array.isArray(resource?.items)
        ? (resource.items as BlipThreadMessage[])
        : [];
}

function parseRemoteMedia(message: BlipThreadMessage) {
    if (message.type !== "application/vnd.lime.media-link+json") return null;

    const content = asRecord(message.content);
    const uri = typeof content?.uri === "string" ? content.uri.trim() : "";

    if (!uri) return null;

    return {
        uri,
        mimeType:
            typeof content?.type === "string" ? content.type.trim() : "",
        name:
            typeof content?.title === "string" && content.title.trim()
                ? content.title.trim()
                : null,
    };
}

function messageIds(message: BlipThreadMessage) {
    const metadata = asRecord(message.metadata);
    return [
        message.id,
        metadata?.["#uniqueId"],
        metadata?.["$internalId"],
        metadata?.["#wa.message.id"],
    ].filter((value): value is string => typeof value === "string");
}

function idsMatch(left: string, right: string) {
    return normalizeMessageId(left) === normalizeMessageId(right);
}

function normalizeMessageId(value: string) {
    return value.trim().replace(/^(?:fwd:)+/i, "");
}

function getBlipAuthKey() {
    const values = [
        process.env.BLIP_KEY,
        process.env.BLIP_ROUTER_AUTH_KEY,
        process.env.BLIP_AUTH_KEY,
    ];

    for (const value of values) {
        const key = value?.trim().replace(/^Key\s+/i, "").trim();
        if (key) return key;
    }

    throw new Error("Blip authentication is not configured");
}

function parseRemoteMediaUrl(value: string) {
    const url = new URL(value);

    if (url.protocol !== "https:") {
        throw new Error("Blip media URL must use HTTPS");
    }

    const hostname = url.hostname.toLowerCase();
    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        isPrivateIpAddress(hostname)
    ) {
        throw new Error("Blip media URL is not allowed");
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

function normalizeMimeType(value: string) {
    return value.trim().toLowerCase().split(";", 1)[0].trim();
}

function defaultFileName(mimeType: string) {
    if (mimeType.startsWith("image/")) return "imagem";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "arquivo";
}

function safeHeaderFileName(value: string) {
    return value.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
}

function isValidAttachmentPath(path: string) {
    if (!path || path.startsWith("/") || path.includes("\\") || path.includes("..")) {
        return false;
    }

    const [threadId, ...rest] = path.split("/");
    return THREAD_ID_PATTERN.test(threadId) && rest.length > 0 && rest.every(Boolean);
}

function parseByteRange(value: string | null, totalSize: number) {
    if (!value) return null;

    const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
    if (!match || totalSize <= 0) return "invalid" as const;

    const [, rawStart, rawEnd] = match;
    if (!rawStart && !rawEnd) return "invalid" as const;

    if (!rawStart) {
        const suffixLength = Number(rawEnd);
        if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
            return "invalid" as const;
        }
        return {
            start: Math.max(0, totalSize - suffixLength),
            end: totalSize - 1,
        };
    }

    const start = Number(rawStart);
    const requestedEnd = rawEnd ? Number(rawEnd) : totalSize - 1;
    if (
        !Number.isInteger(start) ||
        !Number.isInteger(requestedEnd) ||
        start < 0 ||
        requestedEnd < start ||
        start >= totalSize
    ) {
        return "invalid" as const;
    }

    return {
        start,
        end: Math.min(requestedEnd, totalSize - 1),
    };
}

function copyHeader(source: Headers, destination: Headers, name: string) {
    const value = source.get(name);
    if (value) destination.set(name, value);
}

function asRecord(value: unknown) {
    return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null;
}
