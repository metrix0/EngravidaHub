// app/api/inbox/threads/[threadId]/finalize/route.ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ threadId: string }> },
) {
    const requestId = randomUUID();
    const { threadId } = await params;

    console.info(`[inbox-finalize:${requestId}] Starting`, {
        threadId,
    });

    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.active || !attendant.is_online) {
        console.warn(`[inbox-finalize:${requestId}] Not allowed`, {
            hasAttendant: Boolean(attendant),
            active: attendant?.active ?? null,
            online: attendant?.is_online ?? null,
        });

        return NextResponse.json(
            { ok: false, error: "Not allowed", request_id: requestId },
            { status: 403 },
        );
    }

    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select("id, status, assigned_attendant_id")
        .eq("id", threadId)
        .eq("assigned_attendant_id", attendant.id)
        .maybeSingle();

    if (threadError) {
        console.error(`[inbox-finalize:${requestId}] Failed to verify thread`, {
            error: threadError.message,
        });

        return NextResponse.json(
            {
                ok: false,
                error: threadError.message,
                request_id: requestId,
            },
            { status: 500 },
        );
    }

    if (!thread) {
        console.warn(`[inbox-finalize:${requestId}] Thread unavailable`, {
            threadId,
            attendantId: attendant.id,
        });

        return NextResponse.json(
            {
                ok: false,
                error: "Thread not found or not assigned to this attendant",
                request_id: requestId,
            },
            { status: 404 },
        );
    }

    /*
     * Pending messages may contain duplicate sequence_index values because inbound
     * webhooks can arrive concurrently. That is allowed while conversation_id is
     * NULL, but finalize_inbox_thread assigns one conversation_id to all messages,
     * activating messages_conversation_sequence_unique.
     *
     * Normalize the pending messages first so finalization can safely attach them
     * to the new conversation. This also repairs existing affected threads.
     */
    const normalizeResult = await normalizePendingMessageSequence({
        threadId,
        requestId,
    });

    if (!normalizeResult.ok) {
        return NextResponse.json(
            {
                ok: false,
                error: normalizeResult.error,
                request_id: requestId,
            },
            { status: 500 },
        );
    }

    console.info(`[inbox-finalize:${requestId}] Calling finalize RPC`, {
        threadId,
        attendantId: attendant.id,
        normalizedMessages: normalizeResult.messageCount,
        repairedDuplicateIndexes: normalizeResult.duplicateIndexCount,
    });

    const { data: conversationId, error } = await supabase.rpc(
        "finalize_inbox_thread",
        {
            p_thread_id: threadId,
            p_attendant_id: attendant.id,
        },
    );

    if (error) {
        console.error(`[inbox-finalize:${requestId}] Finalize RPC failed`, {
            code: error.code ?? null,
            message: error.message,
            details: error.details ?? null,
            hint: error.hint ?? null,
        });

        return NextResponse.json(
            {
                ok: false,
                error: error.message,
                request_id: requestId,
            },
            { status: 500 },
        );
    }

    console.info(`[inbox-finalize:${requestId}] Finalized successfully`, {
        threadId,
        conversationId,
    });

    return NextResponse.json({
        ok: true,
        conversation_id:
            typeof conversationId === "string" ? conversationId : null,
        request_id: requestId,
        normalized_messages: normalizeResult.messageCount,
        repaired_duplicate_indexes: normalizeResult.duplicateIndexCount,
    });
}

async function normalizePendingMessageSequence({
    threadId,
    requestId,
}: {
    threadId: string;
    requestId: string;
}) {
    const { data: messages, error } = await supabase
        .from("messages")
        .select("id, sent_at, sequence_index")
        .eq("thread_id", threadId)
        .is("conversation_id", null)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true })
        .order("id", { ascending: true });

    if (error) {
        console.error(
            `[inbox-finalize:${requestId}] Failed to load pending messages`,
            { error: error.message },
        );

        return {
            ok: false as const,
            error: error.message,
        };
    }

    const pendingMessages = messages ?? [];
    const indexCounts = new Map<number | null, number>();

    for (const message of pendingMessages) {
        const key =
            typeof message.sequence_index === "number"
                ? message.sequence_index
                : null;

        indexCounts.set(key, (indexCounts.get(key) ?? 0) + 1);
    }

    const duplicateIndexCount = Array.from(indexCounts.values()).filter(
        (count) => count > 1,
    ).length;

    console.info(`[inbox-finalize:${requestId}] Pending sequence audit`, {
        messageCount: pendingMessages.length,
        duplicateIndexCount,
        currentIndexes: pendingMessages.map((message) => message.sequence_index),
    });

    for (let index = 0; index < pendingMessages.length; index += 1) {
        const message = pendingMessages[index];
        const nextSequenceIndex = index + 1;

        if (message.sequence_index === nextSequenceIndex) {
            continue;
        }

        const { error: updateError } = await supabase
            .from("messages")
            .update({ sequence_index: nextSequenceIndex })
            .eq("id", message.id)
            .eq("thread_id", threadId)
            .is("conversation_id", null);

        if (updateError) {
            console.error(
                `[inbox-finalize:${requestId}] Failed to normalize message`,
                {
                    messageId: message.id,
                    previousSequenceIndex: message.sequence_index,
                    nextSequenceIndex,
                    error: updateError.message,
                },
            );

            return {
                ok: false as const,
                error: `Failed to normalize message order: ${updateError.message}`,
            };
        }
    }

    console.info(`[inbox-finalize:${requestId}] Sequence normalized`, {
        messageCount: pendingMessages.length,
        duplicateIndexCount,
    });

    return {
        ok: true as const,
        messageCount: pendingMessages.length,
        duplicateIndexCount,
    };
}
