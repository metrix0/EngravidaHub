// app/api/cron/finalize-inactive-inbox/route.ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { analyzeConversationsByIds } from "@/lib/conversations/analyzeConversationsByIds";
import { finalizeInboxThreadAndAnalyze } from "@/lib/inbox/finalizeInboxThreadAndAnalyze";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_INACTIVITY_HOURS = 16;
const DEFAULT_FINALIZE_LIMIT = 25;
const DEFAULT_ANALYSIS_RETRY_LIMIT = 25;
const MAX_LIMIT = 100;

type InactiveThreadRow = {
    id: string;
    assigned_attendant_id: string;
    last_message_at: string;
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

    const analysisRetryLimit = parseLimit(
        searchParams.get("analysis_retry_limit"),
        Number(
            process.env.INBOX_ANALYSIS_RETRY_LIMIT ??
                DEFAULT_ANALYSIS_RETRY_LIMIT,
        ),
    );

    const inactiveBefore = new Date(
        Date.now() - inactivityHours * 60 * 60 * 1000,
    );

    console.info(
        `[inbox-auto-finalize:${requestId}] Starting`,
        {
            inactivityHours,
            inactiveBefore: inactiveBefore.toISOString(),
            finalizeLimit,
            analysisRetryLimit,
        },
    );

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

        const finalizeResults = [];

        for (const thread of inactiveThreads) {
            const threadRequestId = `${requestId}:${thread.id}`;

            try {
                finalizeResults.push(
                    await finalizeInboxThreadAndAnalyze({
                        threadId: thread.id,
                        attendantId:
                            thread.assigned_attendant_id,
                        requestId: threadRequestId,
                        mode: "automatic",
                        inactiveBefore,
                        analyze: false,
                    }),
                );
            } catch (error) {
                console.error(
                    `[inbox-auto-finalize:${requestId}] Thread failed`,
                    {
                        threadId: thread.id,
                        attendantId:
                            thread.assigned_attendant_id,
                        error,
                    },
                );

                finalizeResults.push({
                    ok: false as const,
                    thread_id: thread.id,
                    conversation_id: null,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to finalize inactive thread",
                });
            }
        }

        const newlyFinalizedConversationIds = finalizeResults
            .filter(
                (
                    item,
                ): item is typeof item & {
                    conversation_id: string;
                } =>
                    item.ok &&
                    typeof item.conversation_id === "string",
            )
            .map((item) => item.conversation_id);

        const retryConversationIds =
            await loadPendingInboxConversationIds(
                analysisRetryLimit,
            );

        const conversationIdsToAnalyze = Array.from(
            new Set([
                ...newlyFinalizedConversationIds,
                ...retryConversationIds,
            ]),
        );

        console.info(
            `[inbox-auto-finalize:${requestId}] Starting analysis batch`,
            {
                newly_finalized_conversations:
                    newlyFinalizedConversationIds.length,
                retry_conversations:
                    retryConversationIds.length,
                unique_conversations:
                    conversationIdsToAnalyze.length,
            },
        );

        let analysis = null;
        let analysisError: string | null = null;

        if (conversationIdsToAnalyze.length > 0) {
            try {
                analysis = await analyzeConversationsByIds(
                    conversationIdsToAnalyze,
                );
            } catch (error) {
                analysisError =
                    error instanceof Error
                        ? error.message
                        : "Failed to analyze finalized conversations";

                console.error(
                    `[inbox-auto-finalize:${requestId}] Analysis batch failed`,
                    {
                        conversationIds:
                            conversationIdsToAnalyze,
                        error,
                    },
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
            failed_threads: finalizeResults.filter(
                (item) => !item.ok,
            ).length,
            conversation_ids_to_analyze:
                conversationIdsToAnalyze,
            analysis_error: analysisError,
            finalize_results: finalizeResults,
            analysis,
        };

        console.info(
            `[inbox-auto-finalize:${requestId}] Finished`,
            {
                eligible_threads: response.eligible_threads,
                finalized_threads:
                    response.finalized_threads,
                skipped_threads: response.skipped_threads,
                failed_threads: response.failed_threads,
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
    const { data, error } = await supabase
        .from("thread")
        .select("id, assigned_attendant_id, last_message_at")
        .eq("status", "open")
        .not("assigned_attendant_id", "is", null)
        .not("last_message_at", "is", null)
        .lte("last_message_at", inactiveBefore.toISOString())
        .order("last_message_at", {
            ascending: true,
            nullsFirst: false,
        })
        .limit(limit);

    if (error) {
        throw new Error(
            `Failed to load inactive inbox threads: ${error.message}`,
        );
    }

    return (data ?? []) as InactiveThreadRow[];
}

async function loadPendingInboxConversationIds(limit: number) {
    const { data, error } = await supabase
        .from("conversations")
        .select("id")
        .is("conversation_analysis_id", null)
        .not("ended_at", "is", null)
        .not("thread_id", "is", null)
        .order("ended_at", {
            ascending: true,
            nullsFirst: false,
        })
        .limit(limit);

    if (error) {
        throw new Error(
            `Failed to load pending inbox conversations: ${error.message}`,
        );
    }

    return (data ?? [])
        .map((conversation) => conversation.id)
        .filter((value): value is string => Boolean(value));
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
