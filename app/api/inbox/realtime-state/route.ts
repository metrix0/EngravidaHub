// app/api/inbox/realtime-state/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type ThreadStateRow = {
    id: string;
    status: string;
    last_message_at: string | null;
    updated_at: string | null;
    unread_count: number | null;
    latest_conversation_id: string | null;
};

type LatestMessageRow = {
    id: string;
    sent_at: string;
    conversation_id: string | null;
    sequence_index: number | null;
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get("thread_id")?.trim() ?? "";

    if (!threadId) {
        return NextResponse.json(
            {
                ok: false,
                error: "thread_id is required",
            },
            { status: 400 },
        );
    }

    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.active || !attendant.is_online) {
        return NextResponse.json(
            {
                ok: false,
                error: "Not allowed",
            },
            { status: 403 },
        );
    }

    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select(
            "id, status, last_message_at, updated_at, unread_count, latest_conversation_id",
        )
        .eq("id", threadId)
        .eq("assigned_attendant_id", attendant.id)
        .maybeSingle();

    if (threadError) {
        return NextResponse.json(
            {
                ok: false,
                error: threadError.message,
            },
            { status: 500 },
        );
    }

    if (!thread) {
        return NextResponse.json(
            {
                ok: false,
                error: "Thread not found",
            },
            { status: 404 },
        );
    }

    const { data: latestMessage, error: latestMessageError } =
        await supabase
            .from("messages")
            .select(
                "id, sent_at, conversation_id, sequence_index",
            )
            .eq("thread_id", threadId)
            .order("sent_at", {
                ascending: false,
                nullsFirst: false,
            })
            .order("sequence_index", {
                ascending: false,
                nullsFirst: false,
            })
            .limit(1)
            .maybeSingle();

    if (latestMessageError) {
        return NextResponse.json(
            {
                ok: false,
                error: latestMessageError.message,
            },
            { status: 500 },
        );
    }

    const typedThread = thread as ThreadStateRow;
    const typedLatestMessage =
        (latestMessage ?? null) as LatestMessageRow | null;

    const version = [
        typedThread.status,
        typedThread.last_message_at ?? "",
        typedThread.updated_at ?? "",
        typedThread.unread_count ?? 0,
        typedThread.latest_conversation_id ?? "",
        typedLatestMessage?.id ?? "",
        typedLatestMessage?.sent_at ?? "",
        typedLatestMessage?.conversation_id ?? "",
        typedLatestMessage?.sequence_index ?? "",
    ].join("|");

    return NextResponse.json(
        {
            ok: true,
            thread_id: threadId,
            version,
            unread_count: typedThread.unread_count ?? 0,
        },
        {
            headers: {
                "Cache-Control": "no-store, max-age=0",
            },
        },
    );
}
