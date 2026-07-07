// app/api/inbox/attachments/route.ts
import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTACHMENT_BUCKET = "inbox-attachments";
const THREAD_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.active || !attendant.is_online) {
        return new Response("Not allowed", { status: 403 });
    }

    const path = new URL(request.url).searchParams.get("path")?.trim() ?? "";

    if (!isValidAttachmentPath(path)) {
        return new Response("Invalid attachment path", { status: 400 });
    }

    const threadId = path.slice(0, path.indexOf("/"));
    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select("id")
        .eq("id", threadId)
        .eq("assigned_attendant_id", attendant.id)
        .maybeSingle();

    if (threadError) {
        console.error("[inbox-attachment] failed to authorize attachment", threadError);
        return new Response("Could not load attachment", { status: 500 });
    }

    if (!thread) {
        return new Response("Attachment not found", { status: 404 });
    }

    const { data: file, error: downloadError } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .download(path);

    if (downloadError || !file) {
        console.error("[inbox-attachment] failed to download attachment", downloadError);
        return new Response("Attachment not found", { status: 404 });
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
        status: 200,
        headers: {
            ...baseHeaders,
            "Content-Length": String(totalSize),
        },
    });
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

        const start = Math.max(0, totalSize - suffixLength);
        return { start, end: totalSize - 1 };
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

function isValidAttachmentPath(path: string) {
    if (!path || path.startsWith("/") || path.includes("\\") || path.includes("..")) {
        return false;
    }

    const [threadId, ...rest] = path.split("/");

    return THREAD_ID_PATTERN.test(threadId) && rest.length > 0 && rest.every(Boolean);
}

function safeHeaderFileName(value: string) {
    return value.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
}
