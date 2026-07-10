// lib/inbox/finalizeInboxThreadAndAnalyze.ts
import { supabase } from "@/lib";

import { analyzeConversationById } from "@/lib/conversations/analyzeConversationsByIds";

type FinalizeMode = "manual" | "automatic";

type ThreadRow = {
    id: string;
    status: string;
    assigned_attendant_id: string | null;
    last_message_at: string | null;
    latest_conversation_id: string | null;
};

export class InboxFinalizeError extends Error {
    status: number;
    code: string;

    constructor({
        message,
        status = 500,
        code = "inbox_finalize_failed",
    }: {
        message: string;
        status?: number;
        code?: string;
    }) {
        super(message);
        this.name = "InboxFinalizeError";
        this.status = status;
        this.code = code;
    }
}

export async function finalizeInboxThreadAndAnalyze({
    threadId,
    attendantId,
    requestId,
    mode,
    inactiveBefore,
    analyze = true,
}: {
    threadId: string;
    attendantId: string;
    requestId: string;
    mode: FinalizeMode;
    inactiveBefore?: Date;
    analyze?: boolean;
}) {
    const logPrefix = `[inbox-finalize:${requestId}]`;

    console.info(`${logPrefix} Loading thread`, {
        threadId,
        attendantId,
        mode,
        inactiveBefore: inactiveBefore?.toISOString() ?? null,
        analyze,
    });

    const thread = await loadThread(threadId);

    if (!thread) {
        throw new InboxFinalizeError({
            message: "Thread not found",
            status: 404,
            code: "thread_not_found",
        });
    }

    if (thread.assigned_attendant_id !== attendantId) {
        throw new InboxFinalizeError({
            message: "Thread is not assigned to this attendant",
            status: 409,
            code: "thread_assignment_changed",
        });
    }

    if (
        mode === "automatic" &&
        !isThreadInactiveBefore(thread, inactiveBefore)
    ) {
        console.info(`${logPrefix} Automatic finalization skipped`, {
            threadId,
            status: thread.status,
            lastMessageAt: thread.last_message_at,
            inactiveBefore: inactiveBefore?.toISOString() ?? null,
        });

        return {
            ok: true as const,
            skipped: true as const,
            reason: "thread_not_inactive" as const,
            thread_id: threadId,
            conversation_id: thread.latest_conversation_id,
            normalized_messages: 0,
            repaired_duplicate_indexes: 0,
            analysis: null,
        };
    }

    if (thread.status === "closed") {
        console.info(`${logPrefix} Thread already closed`, {
            threadId,
            conversationId: thread.latest_conversation_id,
        });

        const analysis =
            analyze && thread.latest_conversation_id
                ? await safelyAnalyzeConversation({
                      conversationId: thread.latest_conversation_id,
                      requestId,
                  })
                : null;

        return {
            ok: true as const,
            skipped: true as const,
            reason: "already_closed" as const,
            thread_id: threadId,
            conversation_id: thread.latest_conversation_id,
            normalized_messages: 0,
            repaired_duplicate_indexes: 0,
            analysis,
        };
    }

    const normalizeResult = await normalizePendingMessageSequence({
        threadId,
        requestId,
    });

    if (
        mode === "automatic" &&
        inactiveBefore &&
        !(await threadStillEligibleForAutomaticFinalization({
            threadId,
            attendantId,
            inactiveBefore,
        }))
    ) {
        console.info(
            `${logPrefix} Automatic finalization cancelled after final guard`,
            {
                threadId,
                inactiveBefore: inactiveBefore.toISOString(),
            },
        );

        return {
            ok: true as const,
            skipped: true as const,
            reason: "thread_became_active" as const,
            thread_id: threadId,
            conversation_id: null,
            normalized_messages: normalizeResult.messageCount,
            repaired_duplicate_indexes:
                normalizeResult.duplicateIndexCount,
            analysis: null,
        };
    }

    console.info(`${logPrefix} Calling finalize RPC`, {
        threadId,
        attendantId,
        mode,
        normalizedMessages: normalizeResult.messageCount,
        repairedDuplicateIndexes:
            normalizeResult.duplicateIndexCount,
    });

    const { data: conversationId, error } = await supabase.rpc(
        "finalize_inbox_thread",
        {
            p_thread_id: threadId,
            p_attendant_id: attendantId,
        },
    );

    if (error) {
        console.error(`${logPrefix} Finalize RPC failed`, {
            code: error.code ?? null,
            message: error.message,
            details: error.details ?? null,
            hint: error.hint ?? null,
        });

        throw new InboxFinalizeError({
            message: error.message,
            status: 500,
            code: "finalize_rpc_failed",
        });
    }

    const normalizedConversationId =
        typeof conversationId === "string" ? conversationId : null;

    console.info(`${logPrefix} Finalized successfully`, {
        threadId,
        conversationId: normalizedConversationId,
        mode,
    });

    const analysis =
        analyze && normalizedConversationId
            ? await safelyAnalyzeConversation({
                  conversationId: normalizedConversationId,
                  requestId,
              })
            : null;

    return {
        ok: true as const,
        skipped: false as const,
        reason: null,
        thread_id: threadId,
        conversation_id: normalizedConversationId,
        normalized_messages: normalizeResult.messageCount,
        repaired_duplicate_indexes:
            normalizeResult.duplicateIndexCount,
        analysis,
    };
}

async function safelyAnalyzeConversation({
    conversationId,
    requestId,
}: {
    conversationId: string;
    requestId: string;
}) {
    const logPrefix = `[inbox-finalize:${requestId}]`;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
            const result = await analyzeConversationById(conversationId);
            const item = result.result;
            if (!item || item.ok === false) {
                throw new Error(item && "error" in item ? String(item.error) : item && "reason" in item ? String(item.reason) : "Conversation analysis did not complete");
            }
            console.info(`${logPrefix} Targeted analysis finished`, { conversationId, attempt, result: item });
            return { ok: true as const, response: result };
        } catch (error) {
            lastError = error;
            console.error(`${logPrefix} Targeted analysis attempt failed`, { conversationId, attempt, error });
            if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, 500 * 2 ** (attempt - 1))));
        }
    }

    return { ok: false as const, error: lastError instanceof Error ? lastError.message : "Failed to analyze finalized conversation" };
}

async function loadThread(threadId: string) {
    const { data, error } = await supabase
        .from("thread")
        .select(
            "id, status, assigned_attendant_id, last_message_at, latest_conversation_id",
        )
        .eq("id", threadId)
        .maybeSingle();

    if (error) {
        throw new InboxFinalizeError({
            message: error.message,
            status: 500,
            code: "thread_load_failed",
        });
    }

    return (data ?? null) as ThreadRow | null;
}

function isThreadInactiveBefore(
    thread: ThreadRow,
    inactiveBefore?: Date,
) {
    if (thread.status !== "open") return false;
    if (!inactiveBefore || !thread.last_message_at) return false;

    return (
        new Date(thread.last_message_at).getTime() <=
        inactiveBefore.getTime()
    );
}

async function threadStillEligibleForAutomaticFinalization({
    threadId,
    attendantId,
    inactiveBefore,
}: {
    threadId: string;
    attendantId: string;
    inactiveBefore: Date;
}) {
    const thread = await loadThread(threadId);

    return Boolean(
        thread &&
            thread.status === "open" &&
            thread.assigned_attendant_id === attendantId &&
            thread.last_message_at &&
            new Date(thread.last_message_at).getTime() <=
                inactiveBefore.getTime(),
    );
}

async function normalizePendingMessageSequence({
    threadId,
    requestId,
}: {
    threadId: string;
    requestId: string;
}) {
    const logPrefix = `[inbox-finalize:${requestId}]`;

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
            `${logPrefix} Failed to load pending messages`,
            { error: error.message },
        );

        throw new InboxFinalizeError({
            message: error.message,
            status: 500,
            code: "pending_messages_load_failed",
        });
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

    const duplicateIndexCount = Array.from(
        indexCounts.values(),
    ).filter((count) => count > 1).length;

    console.info(`${logPrefix} Pending sequence audit`, {
        messageCount: pendingMessages.length,
        duplicateIndexCount,
        currentIndexes: pendingMessages.map(
            (message) => message.sequence_index,
        ),
    });

    for (
        let index = 0;
        index < pendingMessages.length;
        index += 1
    ) {
        const message = pendingMessages[index];
        const nextSequenceIndex = index + 1;

        if (message.sequence_index === nextSequenceIndex) {
            continue;
        }

        const { error: updateError } = await supabase
            .from("messages")
            .update({
                sequence_index: nextSequenceIndex,
            })
            .eq("id", message.id)
            .eq("thread_id", threadId)
            .is("conversation_id", null);

        if (updateError) {
            console.error(
                `${logPrefix} Failed to normalize message`,
                {
                    messageId: message.id,
                    previousSequenceIndex:
                        message.sequence_index,
                    nextSequenceIndex,
                    error: updateError.message,
                },
            );

            throw new InboxFinalizeError({
                message: `Failed to normalize message order: ${updateError.message}`,
                status: 500,
                code: "message_sequence_normalization_failed",
            });
        }
    }

    console.info(`${logPrefix} Sequence normalized`, {
        messageCount: pendingMessages.length,
        duplicateIndexCount,
    });

    return {
        messageCount: pendingMessages.length,
        duplicateIndexCount,
    };
}
