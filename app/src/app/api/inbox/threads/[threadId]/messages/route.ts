// apps/crm/src/app/api/inbox/threads/[threadId]/messages/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@engravida/lib/supabase/client";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ threadId: string }> }
) {
    const { threadId } = await params;
    const body = await request.json();

    const text = String(body.text ?? "").trim();

    if (!text) {
        return NextResponse.json(
            { ok: false, error: "Message text is required" },
            { status: 400 }
        );
    }

    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select("id, client_id, latest_conversation_id")
        .eq("id", threadId)
        .single();

    if (threadError) {
        return NextResponse.json(
            { ok: false, error: threadError.message },
            { status: 500 }
        );
    }

    const { data: lastMessage } = await supabase
        .from("messages")
        .select("sequence_index")
        .eq("thread_id", threadId)
        .order("sequence_index", { ascending: false })
        .limit(1)
        .maybeSingle();

    const sequenceIndex =
        typeof lastMessage?.sequence_index === "number"
            ? lastMessage.sequence_index + 1
            : 0;

    const sentAt = new Date().toISOString();

    const { data: message, error: messageError } = await supabase
        .from("messages")
        .insert({
            client_id: thread.client_id,
            conversation_id: thread.latest_conversation_id,
            thread_id: thread.id,
            sender_type: "attendant",
            text,
            sent_at: sentAt,
            sequence_index: sequenceIndex,
        })
        .select("*")
        .single();

    if (messageError) {
        return NextResponse.json(
            { ok: false, error: messageError.message },
            { status: 500 }
        );
    }

    await supabase
        .from("thread")
        .update({
            last_message_text: text,
            last_message_at: sentAt,
            updated_at: sentAt,
        })
        .eq("id", threadId);

    return NextResponse.json({
        ok: true,
        message,
    });
}