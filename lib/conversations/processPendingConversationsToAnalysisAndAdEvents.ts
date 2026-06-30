// lib/conversations/processPendingConversationsToAnalysisAndAdEvents.ts
import { supabase } from "@/lib";

import { analyzeConversation } from "@/lib/ai/analyzeConversation";
import { saveConversationAnalysis } from "@/lib/analysis/saveConversationAnalysis";
import { deriveAdEventsFromAnalysis } from "@/lib/ads/deriveAdEventsFromAnalysis";
import { sendMetaEvents } from "@/lib/ads/meta/sendMetaEvents";
import { sendGoogleEvents } from "@/lib/ads/google/sendGoogleEvents";

import type { AnalyzeConversationInput, Conversation, Message } from "@/types";

const AD_EVENT_SENDING_ENABLED = true;

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

    console.log("[processPendingConversationsToAnalysisAndAdEvents] gathered conversations without analysis", {
        conversations_found: conversations.length,
    });

    const results = [];

    for (const conversation of conversations) {
        try {
            console.log("[processPendingConversationsToAnalysisAndAdEvents] preparing conversation", {
                conversation_id: conversation.id,
                client_id: conversation.client_id,
            });

            const messages = await getConversationMessages(conversation.id);

            const missingSenderName = messages.find(
                (message) => !getSenderLabel(message)
            );

            if (missingSenderName) {
                console.log("[processPendingConversationsToAnalysisAndAdEvents] skipped conversation: missing sender name", {
                    conversation_id: conversation.id,
                    message_id: missingSenderName.id,
                    sender_type: missingSenderName.sender_type,
                });

                results.push({
                    ok: false,
                    skipped: true,
                    reason: "missing_sender_name",
                    conversation_id: conversation.id,
                    client_id: conversation.client_id,
                    message_id: missingSenderName.id,
                });

                continue;
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

            console.log("[processPendingConversationsToAnalysisAndAdEvents] analyzing conversation with AI", {
                conversation_id: conversation.id,
                messages_count: messages.length,
            });

            const analysis = await analyzeConversation(analysisInput);

            console.log("[processPendingConversationsToAnalysisAndAdEvents] analyzed conversation with AI", {
                conversation_id: analysis.conversation_id,
                short_label: analysis.short_label,
                goal: analysis.conversation_goal,
                status: analysis.goal_status,
                final_state: analysis.customer_final_state,
            });

            const analysisId = await saveConversationAnalysis(analysis);

            await markConversationAsAnalyzed({
                conversationId: conversation.id,
                analysisId,
            });

            console.log("[processPendingConversationsToAnalysisAndAdEvents] analysis and conversation saved to supabase", {
                conversation_id: conversation.id,
                conversation_analysis_id: analysisId,
            });

            const adEvents = deriveAdEventsFromAnalysis(analysis).filter(
                (event) => event.type === "lead"
            );

            console.log("[processPendingConversationsToAnalysisAndAdEvents] ad events derived", {
                conversation_id: conversation.id,
                count: adEvents.length,
                ad_events: adEvents,
            });

            let metaResult = null;
            let googleResult = null;

            if (!AD_EVENT_SENDING_ENABLED) {
                console.log("[processPendingConversationsToAnalysisAndAdEvents] ad event sending disabled", {
                    conversation_id: conversation.id,
                    derived_count: adEvents.length,
                    meta_sent: false,
                    google_sent: false,
                });
            } else if (adEvents.length > 0) {
                const { data: client, error: clientError } = await supabase
                    .from("clients")
                    .select("phone, email, name")
                    .eq("id", analysis.client_id)
                    .single();

                if (clientError) {
                    throw clientError;
                }

                console.log("[processPendingConversationsToAnalysisAndAdEvents] client ad identity loaded", {
                    conversation_id: conversation.id,
                    client_id: analysis.client_id,
                    has_phone: Boolean(client.phone),
                    has_email: Boolean(client.email),
                    has_name: Boolean(client.name),
                });

                metaResult = await sendMetaEvents({
                    events: adEvents,
                    phone: client.phone,
                    email: client.email,
                    conversation_id: conversation.id,
                    conversation_ended_at: conversation.ended_at ?? conversation.started_at,
                });

                console.log("[processPendingConversationsToAnalysisAndAdEvents] ad events sent to meta", {
                    conversation_id: conversation.id,
                    meta: metaResult,
                });

                googleResult = await sendGoogleEvents({
                    events: adEvents,
                    phone: client.phone,
                    email: client.email,
                    name: client.name,
                    conversation_id: conversation.id,
                    conversation_ended_at: conversation.ended_at ?? conversation.started_at,
                });

                console.log("[processPendingConversationsToAnalysisAndAdEvents] ad events sent to google", {
                    conversation_id: conversation.id,
                    google: googleResult,
                });
            } else {
                console.log("[processPendingConversationsToAnalysisAndAdEvents] no ad events sent", {
                    conversation_id: conversation.id,
                    reason: "no_ad_events_derived",
                    meta_sent: false,
                    google_sent: false,
                });
            }

            results.push({
                ok: true,
                conversation_id: conversation.id,
                client_id: conversation.client_id,
                conversation_analysis_id: analysisId,
                short_label: analysis.short_label,
                ad_events: adEvents,
                meta: metaResult,
                google: googleResult,
            });
        } catch (error) {
            console.error("[processPendingConversationsToAnalysisAndAdEvents] failed processing conversation", {
                conversation_id: conversation.id,
                client_id: conversation.client_id,
                error,
            });

            results.push({
                ok: false,
                conversation_id: conversation.id,
                client_id: conversation.client_id,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to analyze conversation",
            });
        }
    }

    return results;
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
                console.error("[processPendingConversationsToAnalysisAndAdEvents] failed fetching conversations batch", {
                    message: error.message,
                    details: error.details,
                    hint: error.hint,
                    code: error.code,
                    batch_size: ids.length,
                    first_conversation_ids: ids.slice(0, 10),
                    raw: error,
                });

                throw new Error(
                    `Failed to fetch conversations without analysis: ${error.message}`
                );
            }

            conversations.push(...((data ?? []) as Conversation[]));
        }

        return conversations
            .sort(
                (a, b) =>
                    new Date(a.ended_at ?? a.started_at).getTime() -
                    new Date(b.ended_at ?? b.started_at).getTime()
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
            `Failed to fetch conversations without analysis: ${error.message}`
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

async function getConversationMessages(conversationId: string): Promise<Message[]> {
    const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (error) {
        throw new Error(
            `Failed to fetch conversation messages: ${error.message}`
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
        .update({
            conversation_analysis_id: analysisId,
        })
        .eq("id", conversationId);

    if (error) {
        throw new Error(
            `Failed to mark conversation as analyzed: ${error.message}`
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
