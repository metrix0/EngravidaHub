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

    const fileName = safeHeaderFileName(path.split("/").at(-1) ?? "anexo");

    return new Response(await file.arrayBuffer(), {
        status: 200,
        headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Content-Disposition": `inline; filename="${fileName}"`,
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    });
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
