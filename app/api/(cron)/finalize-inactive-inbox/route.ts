// app/api/(cron)/finalize-inactive-inbox/route.ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { analyzeConversationsByIds } from "@/lib/conversations/analyzeConversationsByIds";
import { messageToConversations } from "@/lib/conversations/messagesToConversations";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_INACTIVITY_HOURS = 16;
const DEFAULT_FINALIZE_LIMIT = 100;
const DEFAULT_LEGACY_MESSAGE_LIMIT = 1000;
const MAX_LIMIT = 250;
const FINALIZE_CONCURRENCY = 8;

type InactiveThreadRow = {
    id: string;
    assigned_attendant_id: string | null;
    status: string;
    last_message_at: string | null;
    updated_at: string;
};

type FinalizeResult =
    | {
          ok: true;
          skipped: false;
          thread_id: string;
          conversation_id: string;
      }
    | {
          ok: true;
          skipped: true;
          thread_id: string;
          conversation_id: null;
          reason: "became_active_or_already_finalized";
      }
    | {
          ok: false;
          thread_id: string;
          conversation_id: null;
          error: string;
      };

export async function GET(request: Request) {
    const requestId = randomUUID();
    const { searchParams } = new URL(request.url);

    const inactivityHours = parsePositiveNumber(
        searchParams.get("inactivity_hours"),
        Number(
            process.env.INBOX_AUTO_FINALIZE_HOURS ??
                DEFAULT_INACTIVITY_HOURS,
        ),
    );
    const finalizeLimit = parseLimit(
        searchParams.get("limit"),
        Number(
            process.env.INBOX_AUTO_FINALIZE_LIMIT ??
                DEFAULT_FINALIZE_LIMIT,
        ),
    );
    const legacyMessageLimit = parseLimit(
        searchParams.get("legacy_limit"),
        Number(
            process.env.LEGACY_ANALYSIS_MESSAGE_LIMIT ??
                DEFAULT_LEGACY_MESSAGE_LIMIT,
        ),
    );
    const inactiveBefore = new Date(
        Date.now() - inactivityHours * 60 * 60 * 1000,
    );

    console.info(`[inbox-auto-finalize:${requestId}] Starting`, {
        inactivityHours,
        inactiveBefore: inactiveBefore.toISOString(),
        finalizeLimit,
        legacyMessageLimit,
    });

    try {
        const inactiveThreads = await loadInactiveThreads({
            inactiveBefore,
            limit: finalizeLimit,
        });

        console.info(
            `[inbox-auto-finalize:${requestId}] Eligible threads loaded`,
            {
                threads: inactiveThreads.length,
                first_thread_ids: inactiveThreads
                    .slice(0, 10)
                    .map((thread) => thread.id),
            },
        );

        const finalizeResults = await mapWithConcurrency(
            inactiveThreads,
            FINALIZE_CONCURRENCY,
            async (thread): Promise<FinalizeResult> => {
                try {
                    const { data, error } = await supabase.rpc(
                        "finalize_inactive_inbox_thread",
                        {
                            p_thread_id: thread.id,
                            p_inactive_before:
                                inactiveBefore.toISOString(),
                        },
                    );

                    if (error) {
                        throw new Error(error.message);
                    }

                    const conversationId =
                        typeof data === "string" ? data : null;

                    if (!conversationId) {
                        return {
                            ok: true,
                            skipped: true,
                            thread_id: thread.id,
                            conversation_id: null,
                            reason: "became_active_or_already_finalized",
                        };
                    }

                    return {
                        ok: true,
                        skipped: false,
                        thread_id: thread.id,
                        conversation_id: conversationId,
                    };
                } catch (error) {
                    console.error(
                        `[inbox-auto-finalize:${requestId}] Thread failed`,
                        {
                            threadId: thread.id,
                            status: thread.status,
                            attendantId: thread.assigned_attendant_id,
                            error,
                        },
                    );

                    return {
                        ok: false,
                        thread_id: thread.id,
                        conversation_id: null,
                        error:
                            error instanceof Error
                                ? error.message
                                : "Failed to finalize inactive thread",
                    };
                }
            },
        );

        let legacyConversationIds: string[] = [];
        let legacyError: string | null = null;

        try {
            const legacyConversations = await messageToConversations({
                inactivityHours,
                limit: legacyMessageLimit,
            });
            legacyConversationIds = legacyConversations.map(
                (conversation) => conversation.conversation_id,
            );
        } catch (error) {
            legacyError =
                error instanceof Error
                    ? error.message
                    : "Failed to convert legacy messages";
            console.error(
                `[inbox-auto-finalize:${requestId}] Legacy conversion failed`,
                error,
            );
        }

        const finalizedConversationIds = finalizeResults
            .filter(
                (
                    item,
                ): item is Extract<
                    FinalizeResult,
                    { ok: true; skipped: false }
                > => item.ok && !item.skipped,
            )
            .map((item) => item.conversation_id);

        // Analyze only conversations produced by this request. A cron execution
        // must never silently expand into an unrelated production backlog.
        const conversationIdsToAnalyze = Array.from(
            new Set([
                ...finalizedConversationIds,
                ...legacyConversationIds,
            ]),
        );

        let analysis = null;
        let analysisError: string | null = null;

        if (conversationIdsToAnalyze.length > 0) {
            try {
                analysis = await analyzeConversationsByIds(
                    conversationIdsToAnalyze,
                );

                const skippedPreparationIds = analysis.sender_preparation
                    .filter((item) => !item.ok)
                    .map((item) => item.conversation_id);

                await deferConversationRetries(skippedPreparationIds);
            } catch (error) {
                analysisError =
                    error instanceof Error
                        ? error.message
                        : "Failed to analyze finalized conversations";
                console.error(
                    `[inbox-auto-finalize:${requestId}] Analysis batch failed`,
                    {
                        conversationIds: conversationIdsToAnalyze,
                        error,
                    },
                );

                await deferConversationRetries(
                    conversationIdsToAnalyze,
                );
            }
        }

        const response = {
            ok: true,
            request_id: requestId,
            inactivity_hours: inactivityHours,
            inactive_before: inactiveBefore.toISOString(),
            eligible_threads: inactiveThreads.length,
            finalized_threads: finalizeResults.filter(
                (item) => item.ok && !item.skipped,
            ).length,
            skipped_threads: finalizeResults.filter(
                (item) => item.ok && item.skipped,
            ).length,
            failed_threads: finalizeResults.filter((item) => !item.ok)
                .length,
            legacy_conversations_created: legacyConversationIds.length,
            legacy_conversation_ids: legacyConversationIds,
            legacy_error: legacyError,
            conversation_ids_to_analyze: conversationIdsToAnalyze,
            analysis_error: analysisError,
            finalize_results: finalizeResults,
            analysis,
        };

        console.info(
            `[inbox-auto-finalize:${requestId}] Finished`,
            {
                eligible_threads: response.eligible_threads,
                finalized_threads: response.finalized_threads,
                skipped_threads: response.skipped_threads,
                failed_threads: response.failed_threads,
                legacy_conversations_created:
                    response.legacy_conversations_created,
                conversations_to_analyze:
                    conversationIdsToAnalyze.length,
                analysis_error: analysisError,
            },
        );

        return NextResponse.json(response);
    } catch (error) {
        console.error(
            `[inbox-auto-finalize:${requestId}] Pipeline failed`,
            error,
        );

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to finalize inactive inbox threads",
                request_id: requestId,
            },
            { status: 500 },
        );
    }
}

async function loadInactiveThreads({
    inactiveBefore,
    limit,
}: {
    inactiveBefore: Date;
    limit: number;
}) {
    const { data, error } = await supabase.rpc(
        "get_inactive_inbox_threads",
        {
            p_inactive_before: inactiveBefore.toISOString(),
            p_limit: limit,
        },
    );

    if (error) {
        throw new Error(
            `Failed to load inactive inbox threads: ${error.message}`,
        );
    }

    return (data ?? []) as InactiveThreadRow[];
}

async function deferConversationRetries(conversationIds: string[]) {
    if (conversationIds.length === 0) return;

    const { error } = await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .in("id", conversationIds)
        .is("conversation_analysis_id", null);

    if (error) {
        console.warn(
            "[inbox-auto-finalize] Failed to defer conversation retries",
            {
                conversations: conversationIds.length,
                error: error.message,
            },
        );
    }
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            if (currentIndex >= items.length) return;
            results[currentIndex] = await mapper(
                items[currentIndex],
                currentIndex,
            );
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(concurrency, items.length) },
            () => worker(),
        ),
    );

    return results;
}

function parsePositiveNumber(
    rawValue: string | null,
    fallback: number,
) {
    const parsed = Number(rawValue ?? fallback);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return parsed;
}

function parseLimit(rawValue: string | null, fallback: number) {
    const parsed = Math.floor(
        parsePositiveNumber(rawValue, fallback),
    );

    return Math.min(MAX_LIMIT, Math.max(1, parsed));
}
