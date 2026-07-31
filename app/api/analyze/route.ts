// app/api/analyze/route.ts
import { NextResponse } from "next/server";

import { runGoogleBatchAnalysis } from "@/lib/ai/googleBatchAnalysis";
import { matchConversationOriginMap } from "@/lib/conversations/matchConversationOriginMap";
import { messageToConversations } from "@/lib/conversations/messagesToConversations";
import { matchMessagesSenderName } from "@/lib/messages/matchMessagesSenderName";

export const maxDuration = 300;

export async function GET(request: Request) {
    let currentStage = "request";

    const runLoggedStage = async <T>(
        stage: string,
        operation: () => Promise<T>,
        summarize: (value: T) => Record<string, unknown> = () => ({}),
    ) => {
        currentStage = stage;
        const startedAt = Date.now();

        console.log("[/api/analyze] stage started", {
            stage,
            started_at: new Date(startedAt).toISOString(),
        });

        const heartbeat = setInterval(() => {
            console.log("[/api/analyze] stage still running", {
                stage,
                elapsed_ms: Date.now() - startedAt,
            });
        }, 30_000);

        try {
            const value = await operation();

            console.log("[/api/analyze] stage completed", {
                stage,
                duration_ms: Date.now() - startedAt,
                ...summarize(value),
            });

            return value;
        } catch (error) {
            console.error("[/api/analyze] stage failed", {
                stage,
                duration_ms: Date.now() - startedAt,
                error: serializeError(error),
            });
            throw error;
        } finally {
            clearInterval(heartbeat);
        }
    };

    try {
        const { searchParams } = new URL(request.url);
        const inactivityHours = Number(searchParams.get("inactivity_hours") ?? 16);
        const limit = Number(searchParams.get("limit") ?? 100000);

        console.log("[/api/analyze] starting daily Google batch pipeline", {
            inactivity_hours: inactivityHours,
            limit,
            request_url: request.url,
        });

        const createdConversations = await runLoggedStage(
            "message_to_conversations",
            () =>
                messageToConversations({
                    inactivityHours,
                    limit,
                }),
            (result) => ({
                conversations_created: result.length,
                first_conversation_id: result[0]?.conversation_id ?? null,
                last_conversation_id:
                    result.at(-1)?.conversation_id ?? null,
            }),
        );

        const senderNameMatch = await runLoggedStage(
            "sender_name_match",
            () => matchMessagesSenderName({ limit }),
            (result) => ({
                ready_conversations: result.ready_conversation_ids.length,
                skipped_conversations: result.skipped_conversation_ids.length,
            }),
        );

        const googleBatch = await runLoggedStage(
            "google_batch",
            () =>
                runGoogleBatchAnalysis({
                    limit,
                    beforeSubmit: (conversationIds) =>
                        matchConversationOriginMap({ conversationIds }),
                }),
            (result) => ({ result }),
        );
        const originMapAttribution =
            googleBatch.origin_map_attribution ?? null;

        console.log("[/api/analyze] daily Google batch pipeline finished", {
            conversations_created: createdConversations.length,
            origin_map_attribution: originMapAttribution,
            origin_map_attribution_error: null,
            sender_names_ready: senderNameMatch.ready_conversation_ids.length,
            google_batch: googleBatch,
        });

        return NextResponse.json({
            ok: true,
            origin_map_attribution: originMapAttribution,
            origin_map_attribution_error: null,
            sender_name_match: senderNameMatch,
            google_batch: googleBatch,
        });
    } catch (error) {
        const details = serializeError(error);
        console.error("[/api/analyze] pipeline failed", {
            stage: currentStage,
            ...details,
        });

        return NextResponse.json(
            {
                ok: false,
                error: getErrorMessage(error),
                failed_stage: currentStage,
                details,
            },
            { status: 500 },
        );
    }
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function serializeError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause:
                error.cause instanceof Error
                    ? serializeError(error.cause)
                    : error.cause,
        };
    }

    if (typeof error === "string") {
        return { message: error };
    }

    try {
        return { value: error };
    } catch {
        return { message: String(error) };
    }
}
