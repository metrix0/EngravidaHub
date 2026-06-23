// app/api/inbox/threads/[threadId]/messages/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import type { InboxItemType } from "@/types/inbox";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(
    request: Request,
    { params }: { params: Promise<{ threadId: string }> },
) {
    const { threadId: itemId } = await params;
    const body = await request.json();
    const text = String(body.text ?? "").trim();
    const itemType = normalizeItemType(body.item_type);

    if (!text) {
        return NextResponse.json(
            { ok: false, error: "Message text is required" },
            { status: 400 },
        );
    }

    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.active || !attendant.is_online) {
        return NextResponse.json(
            { ok: false, error: "Not allowed" },
            { status: 403 },
        );
    }

    const threadResult = await resolveThread({
        itemId,
        itemType,
        attendantId: attendant.id,
    });

    if (!threadResult.ok) {
        return threadResult.response;
    }

    const thread = threadResult.thread;
    const lastClientMessageAt = thread.last_client_message_at
        ? new Date(thread.last_client_message_at).getTime()
        : 0;

    if (
        !lastClientMessageAt ||
        Date.now() - lastClientMessageAt > WHATSAPP_WINDOW_MS
    ) {
        return NextResponse.json(
            {
                ok: false,
                error: "The 24-hour response window has expired",
            },
            { status: 409 },
        );
    }

    let reopened = false;

    if (thread.status === "closed") {
        const { data: reopenedThread, error: reopenError } = await supabase
            .from("thread")
            .update({
                status: "open",
                assigned_attendant_id: attendant.id,
            })
            .eq("id", thread.id)
            .eq("status", "closed")
            .eq("assigned_attendant_id", attendant.id)
            .select("id")
            .maybeSingle();

        if (reopenError) {
            return NextResponse.json(
                { ok: false, error: reopenError.message },
                { status: 500 },
            );
        }

        if (!reopenedThread) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Conversation is no longer available for this attendant",
                },
                { status: 409 },
            );
        }

        reopened = true;
    }

    const { data: lastMessage, error: lastMessageError } = await supabase
        .from("messages")
        .select("sequence_index")
        .eq("thread_id", thread.id)
        .order("sequence_index", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (lastMessageError) {
        return NextResponse.json(
            { ok: false, error: lastMessageError.message },
            { status: 500 },
        );
    }

    const sequenceIndex =
        typeof lastMessage?.sequence_index === "number"
            ? lastMessage.sequence_index + 1
            : 0;
    const sentAt = new Date().toISOString();

    const { data: message, error: messageError } = await supabase
        .from("messages")
        .insert({
            client_id: thread.client_id,
            conversation_id: null,
            thread_id: thread.id,
            sender_type: "attendant",
            sender_name: attendant.name,
            text,
            sent_at: sentAt,
            sequence_index: sequenceIndex,
        })
        .select("*")
        .single();

    if (messageError) {
        return NextResponse.json(
            { ok: false, error: messageError.message },
            { status: 500 },
        );
    }

    return NextResponse.json({
        ok: true,
        message,
        thread_id: thread.id,
        reopened,
    });
}

async function resolveThread({
    itemId,
    itemType,
    attendantId,
}: {
    itemId: string;
    itemType: InboxItemType;
    attendantId: string;
}) {
    if (itemType === "thread") {
        const { data: thread, error } = await supabase
            .from("thread")
            .select(`
                id,
                client_id,
                status,
                assigned_attendant_id,
                last_client_message_at
            `)
            .eq("id", itemId)
            .eq("assigned_attendant_id", attendantId)
            .maybeSingle();

        if (error) {
            return {
                ok: false as const,
                response: NextResponse.json(
                    { ok: false, error: error.message },
                    { status: 500 },
                ),
            };
        }

        if (!thread || thread.status !== "open") {
            return {
                ok: false as const,
                response: NextResponse.json(
                    { ok: false, error: "Thread not found" },
                    { status: 404 },
                ),
            };
        }

        return {
            ok: true as const,
            thread,
        };
    }

    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("id, client_id, thread_id")
        .eq("id", itemId)
        .eq("attendant_id", attendantId)
        .maybeSingle();

    if (conversationError) {
        return {
            ok: false as const,
            response: NextResponse.json(
                { ok: false, error: conversationError.message },
                { status: 500 },
            ),
        };
    }

    if (!conversation) {
        return {
            ok: false as const,
            response: NextResponse.json(
                { ok: false, error: "Conversation not found" },
                { status: 404 },
            ),
        };
    }

    let query = supabase
        .from("thread")
        .select(`
            id,
            client_id,
            status,
            assigned_attendant_id,
            last_client_message_at
        `)
        .limit(1);

    query = conversation.thread_id
        ? query.eq("id", conversation.thread_id)
        : query.eq("client_id", conversation.client_id);

    const { data: thread, error: threadError } = await query.maybeSingle();

    if (threadError) {
        return {
            ok: false as const,
            response: NextResponse.json(
                { ok: false, error: threadError.message },
                { status: 500 },
            ),
        };
    }

    if (!thread || thread.assigned_attendant_id !== attendantId) {
        return {
            ok: false as const,
            response: NextResponse.json(
                {
                    ok: false,
                    error: "Conversation is not assigned to this attendant",
                },
                { status: 409 },
            ),
        };
    }

    return {
        ok: true as const,
        thread,
    };
}

function normalizeItemType(value: unknown): InboxItemType {
    return value === "conversation" ? "conversation" : "thread";
}
