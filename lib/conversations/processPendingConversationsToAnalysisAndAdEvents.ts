// lib/conversations/processPendingConversationsToAnalysisAndAdEvents.ts
import { supabase } from "@/lib";

import { analyzeConversation } from "@/lib/ai/analyzeConversation";
import { saveConversationAnalysis } from "@/lib/analysis/saveConversationAnalysis";
import { deriveAdEventsFromAnalysis } from "@/lib/ads/deriveAdEventsFromAnalysis";
import { sendMetaEvents } from "@/lib/ads/meta/sendMetaEvents";
import { sendGoogleEvents } from "@/lib/ads/google/sendGoogleEvents";

import type {
    AnalyzeConversationInput,
    Conversation,
    Message,
} from "@/types";

const AD_EVENT_SENDING_ENABLED = true;
const DEFAULT_ANALYSIS_CONCURRENCY = 4;
const MAX_ANALYSIS_CONCURRENCY = 8;

export async function processPendingConversationsToAnalysisAndAdEvents({
    limit = 1000,
    conversationIds,
}: {
    limit?: number;
    conversationIds?: string[];
}) {
    const conversations = await getConversationsWithoutAnalysis({
        limit,
        conversationIds,
    });

    console.log(
        "[processPendingConversationsToAnalysisAndAdEvents] gathered conversations without analysis",
        { conversations_found: conversations.length },
    );

    const concurrency = getAnalysisConcurrency();

    console.log(
        "[processPendingConversationsToAnalysisAndAdEvents] processing batch",
        {
            conversations: conversations.length,
            concurrency,
        },
    );

    return mapWithConcurrency(
        conversations,
        concurrency,
        processConversation,
    );
}

async function processConversation(conversation: Conversation) {
    try {
        console.log(
            "[processPendingConversationsToAnalysisAndAdEvents] preparing conversation",
            {
                conversation_id: conversation.id,
                client_id: conversation.client_id,
            },
        );

        const messages = await getConversationMessages(conversation.id);

        const missingSenderName = messages.find(
            (message) => !getSenderLabel(message),
        );

        if (missingSenderName) {
            console.log(
                "[processPendingConversationsToAnalysisAndAdEvents] skipped conversation: missing sender name",
                {
                    conversation_id: conversation.id,
                    message_id: missingSenderName.id,
                    sender_type: missingSenderName.sender_type,
                },
            );

            await deferConversationRetry(conversation.id);

            return {
                ok: false as const,
                skipped: true as const,
                reason: "missing_sender_name" as const,
                conversation_id: conversation.id,
                client_id: conversation.client_id,
                message_id: missingSenderName.id,
            };
        }

        const analysisInput: AnalyzeConversationInput = {
            conversation_id: conversation.id,
            client_id: conversation.client_id,
            started_at: conversation.started_at,
            ended_at: conversation.ended_at ?? conversation.started_at,
            attendant_id: conversation.attendant_id,
            unit_id: conversation.unit_id,
            service_id: conversation.service_id,
            conversationText: buildConversationText(messages),
        };

        console.log(
            "[processPendingConversationsToAnalysisAndAdEvents] analyzing conversation with AI",
            {
                conversation_id: conversation.id,
                messages_count: messages.length,
            },
        );

        const analysis = await analyzeConversation(analysisInput);

        console.log(
            "[processPendingConversationsToAnalysisAndAdEvents] analyzed conversation with AI",
            {
                conversation_id: analysis.conversation_id,
                short_label: analysis.short_label,
                goal: analysis.conversation_goal,
                status: analysis.goal_status,
                final_state: analysis.customer_final_state,
            },
        );

        const analysisId = await saveConversationAnalysis(analysis);

        await markConversationAsAnalyzed({
            conversationId: conversation.id,
            analysisId,
        });

        console.log(
            "[processPendingConversationsToAnalysisAndAdEvents] analysis and conversation saved to supabase",
            {
                conversation_id: conversation.id,
                conversation_analysis_id: analysisId,
            },
        );

        const adEvents = deriveAdEventsFromAnalysis(analysis).filter(
            (event) => event.type === "lead",
        );

        console.log(
            "[processPendingConversationsToAnalysisAndAdEvents] ad events derived",
            {
                conversation_id: conversation.id,
                count: adEvents.length,
                ad_events: adEvents,
            },
        );

        let metaResult = null;
        let googleResult = null;

        if (!AD_EVENT_SENDING_ENABLED) {
            console.log(
                "[processPendingConversationsToAnalysisAndAdEvents] ad event sending disabled",
                {
                    conversation_id: conversation.id,
                    derived_count: adEvents.length,
                    meta_sent: false,
                    google_sent: false,
                },
            );
        } else if (adEvents.length > 0) {
            const { data: client, error: clientError } = await supabase
                .from("clients")
                .select("phone, email, name")
                .eq("id", analysis.client_id)
                .single();

            if (clientError) {
                throw clientError;
            }

            metaResult = await sendMetaEvents({
                events: adEvents,
                phone: client.phone,
                email: client.email,
                conversation_id: conversation.id,
                conversation_ended_at:
                    conversation.ended_at ?? conversation.started_at,
            });

            googleResult = await sendGoogleEvents({
                events: adEvents,
                phone: client.phone,
                email: client.email,
                name: client.name,
                conversation_id: conversation.id,
                conversation_ended_at:
                    conversation.ended_at ?? conversation.started_at,
            });
        }

        return {
            ok: true as const,
            conversation_id: conversation.id,
            client_id: conversation.client_id,
            conversation_analysis_id: analysisId,
            short_label: analysis.short_label,
            ad_events: adEvents,
            meta: metaResult,
            google: googleResult,
        };
    } catch (error) {
        await deferConversationRetry(conversation.id);

        console.error(
            "[processPendingConversationsToAnalysisAndAdEvents] failed processing conversation",
            {
                conversation_id: conversation.id,
                client_id: conversation.client_id,
                error,
            },
        );

        return {
            ok: false as const,
            conversation_id: conversation.id,
            client_id: conversation.client_id,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to analyze conversation",
        };
    }
}

async function getConversationsWithoutAnalysis({
    limit,
    conversationIds,
}: {
    limit: number;
    conversationIds?: string[];
}): Promise<Conversation[]> {
    if (conversationIds && conversationIds.length === 0) {
        return [];
    }

    if (conversationIds) {
        const conversations: Conversation[] = [];

        for (const ids of chunk(conversationIds, 100)) {
            const { data, error } = await supabase
                .from("conversations")
                .select("*")
                .is("conversation_analysis_id", null)
                .not("ended_at", "is", null)
                .in("id", ids)
                .order("ended_at", { ascending: true });

            if (error) {
                console.error(
                    "[processPendingConversationsToAnalysisAndAdEvents] failed fetching conversations batch",
                    {
                        message: error.message,
                        details: error.details,
                        hint: error.hint,
                        code: error.code,
                        batch_size: ids.length,
                        first_conversation_ids: ids.slice(0, 10),
                        raw: error,
                    },
                );

                throw new Error(
                    `Failed to fetch conversations without analysis: ${error.message}`,
                );
            }

            conversations.push(...((data ?? []) as Conversation[]));
        }

        return conversations
            .sort(
                (a, b) =>
                    new Date(a.ended_at ?? a.started_at).getTime() -
                    new Date(b.ended_at ?? b.started_at).getTime(),
            )
            .slice(0, limit);
    }

    const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .is("conversation_analysis_id", null)
        .not("ended_at", "is", null)
        .order("ended_at", { ascending: true })
        .limit(limit);

    if (error) {
        throw new Error(
            `Failed to fetch conversations without analysis: ${error.message}`,
        );
    }

    return (data ?? []) as Conversation[];
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

async function getConversationMessages(
    conversationId: string,
): Promise<Message[]> {
    const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (error) {
        throw new Error(
            `Failed to fetch conversation messages: ${error.message}`,
        );
    }

    return (data ?? []) as Message[];
}

async function markConversationAsAnalyzed({
    conversationId,
    analysisId,
}: {
    conversationId: string;
    analysisId: string;
}) {
    const { error } = await supabase
        .from("conversations")
        .update({ conversation_analysis_id: analysisId })
        .eq("id", conversationId);

    if (error) {
        throw new Error(
            `Failed to mark conversation as analyzed: ${error.message}`,
        );
    }
}

async function deferConversationRetry(conversationId: string) {
    // Move a temporarily unprocessable conversation to the back of the retry
    // queue. Without this, a small group of permanent failures can occupy the
    // oldest N rows forever and starve every newer conversation.
    const { error } = await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .is("conversation_analysis_id", null);

    if (error) {
        console.warn(
            "[processPendingConversationsToAnalysisAndAdEvents] failed to defer retry",
            { conversation_id: conversationId, error: error.message },
        );
    }
}

function buildConversationText(messages: Message[]): string {
    return messages
        .map((message) => {
            const date = new Date(message.sent_at).toLocaleString("pt-BR");
            const sender = getSenderLabel(message);
            return `[${date}] ${sender}: ${message.text}`;
        })
        .join("\n");
}

function getSenderLabel(message: Message): string | null {
    if (message.sender_type === "client") return message.sender_name;
    if (message.sender_type === "attendant") return message.sender_name;
    if (message.sender_type === "bot") return "Bot";
    if (message.sender_type === "system") return "Sistema";
    return null;
}

function getAnalysisConcurrency() {
    const parsed = Number(
        process.env.CONVERSATION_ANALYSIS_CONCURRENCY ??
            DEFAULT_ANALYSIS_CONCURRENCY,
    );

    if (!Number.isFinite(parsed)) return DEFAULT_ANALYSIS_CONCURRENCY;

    return Math.min(
        MAX_ANALYSIS_CONCURRENCY,
        Math.max(1, Math.floor(parsed)),
    );
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
            const index = nextIndex;
            nextIndex += 1;

            if (index >= items.length) return;
            results[index] = await mapper(items[index], index);
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
