// app/api/(cron)/finalize-inactive-inbox/route.ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { matchConversationOriginMap } from "@/lib/conversations/matchConversationOriginMap";
import {
    backfillClosingTagsFromLastDays,
    syncClosingTagsForConversations,
} from "@/lib/conversations/matchConversationsSheetAttribution";
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
    const backfillDays = Number(searchParams.get("backfill_closing_tags_days") ?? 0);

    if (Number.isFinite(backfillDays) && backfillDays > 0) {
        try {
            const result = await backfillClosingTagsFromLastDays({
                days: backfillDays,
            });

            return NextResponse.json({
                ok: true,
                request_id: requestId,
                mode: "closing_tag_backfill",
                closing_tag_backfill: result,
            });
        } catch (error) {
            return NextResponse.json(
                {
                    ok: false,
                    request_id: requestId,
                    mode: "closing_tag_backfill",
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to backfill closing tags",
                },
                { status: 500 },
            );
        }
    }

    const inactivityHours = parsePositiveNumber(
        searchParams.get("inactivity_hours"),
        Number(process.env.INBOX_AUTO_FINALIZE_HOURS ?? DEFAULT_INACTIVITY_HOURS),
    );
    const finalizeLimit = parseLimit(
        searchParams.get("limit"),
        Number(process.env.INBOX_AUTO_FINALIZE_LIMIT ?? DEFAULT_FINALIZE_LIMIT),
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

    try {
        const inactiveThreads = await loadInactiveThreads({
            inactiveBefore,
            limit: finalizeLimit,
        });

        const finalizeResults = await mapWithConcurrency(
            inactiveThreads,
            FINALIZE_CONCURRENCY,
            async (thread): Promise<FinalizeResult> => {
                try {
                    const { data, error } = await supabase.rpc(
                        "finalize_inactive_inbox_thread",
                        {
                            p_thread_id: thread.id,
                            p_inactive_before: inactiveBefore.toISOString(),
                        },
                    );
                    if (error) throw new Error(error.message);

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

        const conversationIdsDeferred = Array.from(
            new Set([...finalizedConversationIds, ...legacyConversationIds]),
        );

        let originTunnelMatch: Awaited<
            ReturnType<typeof matchConversationOriginMap>
        > | null = null;
        let originTunnelError: string | null = null;
        let closingTagMatch: Awaited<
            ReturnType<typeof syncClosingTagsForConversations>
        > | null = null;
        let closingTagError: string | null = null;

        if (conversationIdsDeferred.length > 0) {
            const [originTunnelResult, closingTagResult] = await Promise.allSettled([
                matchConversationOriginMap({
                    conversationIds: conversationIdsDeferred,
                }),
                syncClosingTagsForConversations({
                    conversationIds: conversationIdsDeferred,
                }),
            ]);

            if (originTunnelResult.status === "fulfilled") {
                originTunnelMatch = originTunnelResult.value;
            } else {
                originTunnelError =
                    originTunnelResult.reason instanceof Error
                        ? originTunnelResult.reason.message
                        : String(originTunnelResult.reason);
                console.error(
                    "[finalize-inactive-inbox] origin/tunnel attribution failed; finalization will continue",
                    {
                        request_id: requestId,
                        conversations: conversationIdsDeferred.length,
                        error: originTunnelError,
                    },
                );
            }

            if (closingTagResult.status === "fulfilled") {
                closingTagMatch = closingTagResult.value;
            } else {
                closingTagError =
                    closingTagResult.reason instanceof Error
                        ? closingTagResult.reason.message
                        : String(closingTagResult.reason);
                console.error(
                    "[finalize-inactive-inbox] closing-tag sheet sync failed; finalization will continue",
                    {
                        request_id: requestId,
                        conversations: conversationIdsDeferred.length,
                        error: closingTagError,
                    },
                );
            }
        }

        return NextResponse.json({
            ok: true,
            request_id: requestId,
            inactivity_hours: inactivityHours,
            inactive_before: inactiveBefore.toISOString(),
            eligible_threads: inactiveThreads.length,
            finalized_threads: finalizedConversationIds.length,
            skipped_threads: finalizeResults.filter(
                (item) => item.ok && item.skipped,
            ).length,
            failed_threads: finalizeResults.filter((item) => !item.ok).length,
            legacy_conversations_created: legacyConversationIds.length,
            legacy_conversation_ids: legacyConversationIds,
            legacy_error: legacyError,
            origin_tunnel_match: originTunnelMatch,
            origin_tunnel_error: originTunnelError,
            closing_tag_match: closingTagMatch,
            closing_tag_error: closingTagError,
            conversation_ids_deferred_to_google_batch: conversationIdsDeferred,
            analysis_deferred: true,
            analysis_provider: "google-vertex-batch",
            finalize_results: finalizeResults,
        });
    } catch (error) {
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
    const { data, error } = await supabase.rpc("get_inactive_inbox_threads", {
        p_inactive_before: inactiveBefore.toISOString(),
        p_limit: limit,
    });

    if (error) {
        throw new Error(`Failed to load inactive inbox threads: ${error.message}`);
    }

    return (data ?? []) as InactiveThreadRow[];
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
                items[currentIndex]!,
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

function parsePositiveNumber(rawValue: string | null, fallback: number) {
    const parsed = Number(rawValue ?? fallback);
    return !Number.isFinite(parsed) || parsed <= 0 ? fallback : parsed;
}

function parseLimit(rawValue: string | null, fallback: number) {
    const parsed = Math.floor(parsePositiveNumber(rawValue, fallback));
    return Math.min(MAX_LIMIT, Math.max(1, parsed));
}
