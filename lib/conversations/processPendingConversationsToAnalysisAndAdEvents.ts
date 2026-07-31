// lib/conversations/processPendingConversationsToAnalysisAndAdEvents.ts
import { supabase } from "@/lib";
import { analyzeConversation } from "@/lib/ai/analyzeConversation";
import { saveConversationAnalysis } from "@/lib/analysis/saveConversationAnalysis";
import { deriveAdEventsFromAnalysis } from "@/lib/ads/deriveAdEventsFromAnalysis";
import { sendMetaEvents } from "@/lib/ads/meta/sendMetaEvents";
import { sendGoogleEvents } from "@/lib/ads/google/sendGoogleEvents";
import { getConversationEffectiveEndMessage } from "@/lib/conversations/conversationEffectiveEnd";
import {
    filterAnalyzableMessages,
    getConversationAnalysisIneligibility,
} from "@/lib/analysis/conversationEligibility";
import type { AnalyzeConversationInput, Conversation, ConversationAnalysis, Message } from "@/types";

const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 4;

type ExistingAnalysisRow = { id: string; started_at: string; ended_at: string };

export async function processPendingConversationsToAnalysisAndAdEvents({
    limit = 1000,
    conversationIds,
}: {
    limit?: number;
    conversationIds?: string[];
}) {
    const conversations = await getPending({ limit, conversationIds });
    return mapWithConcurrency(conversations, concurrency(), processConversation);
}

async function processConversation(conversation: Conversation) {
    const claimed = await claimConversation(conversation.id);
    if (!claimed) {
        return {
            ok: false as const,
            skipped: true as const,
            conversation_id: conversation.id,
            client_id: conversation.client_id,
            error: "Conversation was not pending or was already claimed",
        };
    }

    try {
        const messages = await getMessages(conversation.id);
        if (!messages.length) throw new Error("Conversation has no messages");

        const normalized = filterAnalyzableMessages(messages).map((message) => ({
            ...message,
            sender_name: senderLabel(message),
        }));
        const ineligibleReason = getConversationAnalysisIneligibility(normalized);
        if (ineligibleReason) {
            await failConversation(conversation.id, ineligibleReason);
            return {
                ok: false as const,
                skipped: true as const,
                conversation_id: conversation.id,
                client_id: conversation.client_id,
                error: ineligibleReason,
            };
        }

        const first = normalized[0];
        const last = normalized.at(-1)!;
        const effectiveEnd = getConversationEffectiveEndMessage(normalized);

        const existingAnalysis = await findExistingAnalysis(conversation.id);
        if (existingAnalysis) {
            await completeConversation(
                conversation.id,
                existingAnalysis.id,
                existingAnalysis.started_at,
                existingAnalysis.ended_at,
                String(last.text),
            );
            return {
                ok: true as const,
                recovered: true as const,
                conversation_id: conversation.id,
                client_id: conversation.client_id,
                conversation_analysis_id: existingAnalysis.id,
                short_label: null,
                ad_events: [],
                meta: null,
                google: null,
                ad_delivery_errors: [],
            };
        }

        const input: AnalyzeConversationInput = {
            conversation_id: conversation.id,
            client_id: conversation.client_id,
            instagram_user_id: conversation.instagram_user_id,
            started_at: first.sent_at,
            ended_at: effectiveEnd.sent_at,
            attendant_id: conversation.attendant_id,
            unit_id: conversation.unit_id,
            service_id: conversation.service_id,
            conversationText: buildText(normalized),
            messages: normalized.map((message) => ({
                id: message.id,
                sender_type: message.sender_type,
                sender_name: message.sender_name,
                text: message.text,
                sent_at: message.sent_at,
                sequence_index: message.sequence_index,
            })),
        };

        const rawAnalysis = await analyzeConversation(input);
        const analysis = applyDeterministicRefinements(rawAnalysis, normalized, effectiveEnd.sent_at);
        const analysisId = await saveConversationAnalysis(analysis);
        await completeConversation(
            conversation.id,
            String(analysisId),
            analysis.started_at,
            analysis.ended_at,
            String(last.text),
        );

        const events = deriveAdEventsFromAnalysis(analysis).filter((event) => event.type === "lead");
        const delivery = await sendAdsSafely(conversation, analysis, events);

        return {
            ok: true as const,
            recovered: false as const,
            conversation_id: conversation.id,
            client_id: conversation.client_id,
            conversation_analysis_id: analysisId,
            short_label: analysis.short_label,
            ad_events: events,
            meta: delivery.meta,
            google: delivery.google,
            ad_delivery_errors: delivery.errors,
        };
    } catch (error) {
        const message = formatError(error);
        await failConversation(conversation.id, message);
        console.error("[analysis-pipeline] conversation permanently failed", {
            conversation_id: conversation.id,
            error: message,
            automatic_retry: false,
            automatic_openai_calls: false,
            automatic_pipeline_retry: false,
        });
        return {
            ok: false as const,
            skipped: false as const,
            conversation_id: conversation.id,
            client_id: conversation.client_id,
            error: message,
        };
    }
}

function applyDeterministicRefinements(
    source: ConversationAnalysis,
    messages: Message[],
    effectiveEndedAt: string,
): ConversationAnalysis {
    const analysis = structuredClone(source);
    analysis.ended_at = effectiveEndedAt;

    if (!isClientSilenceAfterMeaningfulHumanProgress(analysis, messages)) return analysis;

    const lastAttendant = [...messages].reverse().find((message) => message.sender_type === "attendant");
    const evidenceIds = Array.from(new Set([
        ...analysis.resolution.evidence_message_ids,
        ...(lastAttendant ? [lastAttendant.id] : []),
    ]));

    analysis.goal_status = "partially_achieved";
    analysis.customer_final_state = "stopped_responding";
    analysis.resolution = {
        resolved: "partial",
        resolution_score: 50,
        reasoning_category: "customer_abandoned",
        evidence_message_ids: evidenceIds,
    };
    analysis.dropoff = {
        happened: true,
        moment: inferDropoffMoment(analysis.conversation_goal, lastAttendant?.text ?? ""),
        likely_reason: "O atendimento avançou e aguardava uma informação do cliente para continuar, mas não houve nova resposta.",
        confidence: 1,
        evidence_message_ids: evidenceIds,
    };
    if (!analysis.outcome_events.some((event) => event.type === "customer_stopped_responding")) {
        analysis.outcome_events.push({
            type: "customer_stopped_responding",
            occurred_at: lastAttendant?.sent_at ?? effectiveEndedAt,
            confidence: 1,
            evidence_message_ids: evidenceIds,
        });
    }
    return analysis;
}

function isClientSilenceAfterMeaningfulHumanProgress(analysis: ConversationAnalysis, messages: Message[]) {
    if (analysis.resolution.resolution_score !== 0 || analysis.resolution.resolved !== false) return false;
    if (!messages.some((message) => message.sender_type === "attendant")) return false;

    const lastClientIndex = findLastIndex(messages, (message) => message.sender_type === "client");
    const lastAttendantIndex = findLastIndex(messages, (message) => message.sender_type === "attendant");
    if (lastClientIndex < 0 || lastAttendantIndex <= lastClientIndex) return false;
    if (messages.slice(lastAttendantIndex + 1).some((message) => message.sender_type === "client")) return false;

    const attendantMessages = messages.slice(lastClientIndex + 1, lastAttendantIndex + 1)
        .filter((message) => message.sender_type === "attendant");
    if (!attendantMessages.length) return false;

    const combinedText = attendantMessages.map((message) => normalize(message.text)).join(" ");
    const asksForNextStep = /\?|\bqual\b|\bquais\b|\bpode me (?:dizer|informar)\b|\bme diga\b|\bprefere\b|\bgostaria\b/.test(combinedText);
    const hasProgressContent = combinedText.replace(/[?!.\s]/g, "").length >= 35;
    return asksForNextStep && hasProgressContent;
}

function inferDropoffMoment(goal: ConversationAnalysis["conversation_goal"], text: string) {
    const normalized = normalize(text);
    if (/unidade|clinica|clínica|cidade/.test(normalized)) return "after_unit_presented" as const;
    if (/horario|horário|agenda|data|dia/.test(normalized)) return "after_schedule_options" as const;
    if (/valor|preco|preço|pagamento/.test(normalized)) return "after_price" as const;
    if (goal === "schedule_consultation" || goal === "reschedule_consultation") return "after_schedule_options" as const;
    return "unknown" as const;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
    for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index])) return index;
    return -1;
}

function normalize(value: string) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/<[^>]+>/g, " ");
}

async function claimConversation(conversationId: string) {
    const result = await supabase.rpc("claim_conversation_for_analysis", { p_conversation_id: conversationId });
    if (result.error) throw new Error(`Failed to claim conversation: ${result.error.message}`);
    return result.data === true;
}

async function findExistingAnalysis(conversationId: string): Promise<ExistingAnalysisRow | null> {
    const result = await supabase.from("conversation_analysis").select("id, started_at, ended_at")
        .eq("conversation_id", conversationId).maybeSingle();
    if (result.error) throw new Error(`Failed to check existing analysis: ${result.error.message}`);
    return (result.data ?? null) as ExistingAnalysisRow | null;
}

async function completeConversation(conversationId: string, analysisId: string, startedAt: string, endedAt: string, lastText: string) {
    const result = await supabase.rpc("complete_conversation_analysis", {
        p_conversation_id: conversationId,
        p_analysis_id: analysisId,
        p_started_at: startedAt,
        p_ended_at: endedAt,
        p_last_message_text: lastText,
    });
    if (result.error) throw new Error(`Failed to complete conversation analysis: ${result.error.message}`);
    if (result.data !== true) throw new Error("Conversation analysis completion was rejected by the database state guard");
}

async function failConversation(conversationId: string, error: string) {
    const result = await supabase.rpc("fail_conversation_analysis", { p_conversation_id: conversationId, p_error: error });
    if (result.error) console.error("[analysis-pipeline] failed to persist permanent failure", { conversation_id: conversationId, error: result.error.message });
}

async function sendAdsSafely(
    conversation: Conversation,
    analysis: Awaited<ReturnType<typeof analyzeConversation>>,
    events: ReturnType<typeof deriveAdEventsFromAnalysis>,
) {
    let meta = null;
    let google = null;
    const errors: string[] = [];
    if (!events.length || await hasExistingAdEvents(conversation.id)) return { meta, google, errors };
    if (!analysis.client_id) return { meta, google, errors };

    try {
        const result = await supabase.from("clients").select("phone, email, name").eq("id", analysis.client_id).single();
        if (result.error) throw result.error;
        try {
            meta = await sendMetaEvents({ events, phone: result.data.phone, email: result.data.email, conversation_id: conversation.id, conversation_ended_at: analysis.ended_at });
        } catch (error) { errors.push(`Meta: ${formatError(error)}`); }
        try {
            google = await sendGoogleEvents({ events, phone: result.data.phone, email: result.data.email, name: result.data.name, conversation_id: conversation.id, conversation_ended_at: analysis.ended_at });
        } catch (error) { errors.push(`Google: ${formatError(error)}`); }
    } catch (error) {
        errors.push(`Client lookup: ${formatError(error)}`);
    }
    return { meta, google, errors };
}

async function hasExistingAdEvents(conversationId: string) {
    try {
        const result = await supabase.from("ad_events").select("id").eq("conversation_id", conversationId).limit(1).maybeSingle();
        if (result.error) throw result.error;
        return Boolean(result.data);
    } catch (error) {
        console.error("[analysis-pipeline] ad idempotency check failed", { conversation_id: conversationId, error });
        return true;
    }
}

async function getPending({ limit, conversationIds }: { limit: number; conversationIds?: string[] }): Promise<Conversation[]> {
    if (conversationIds?.length === 0) return [];
    if (conversationIds) {
        const rows: Conversation[] = [];
        for (const ids of chunk(conversationIds, 100)) {
            const result = await supabase.from("conversations").select("*")
                .is("conversation_analysis_id", null).eq("analysis_status", "pending").not("ended_at", "is", null)
                .in("id", ids).order("ended_at", { ascending: true });
            if (result.error) throw new Error(`Failed to fetch pending conversations: ${result.error.message}`);
            rows.push(...((result.data ?? []) as Conversation[]));
        }
        return rows.sort((a, b) => new Date(a.ended_at ?? a.started_at).getTime() - new Date(b.ended_at ?? b.started_at).getTime()).slice(0, limit);
    }

    const result = await supabase.from("conversations").select("*")
        .is("conversation_analysis_id", null).eq("analysis_status", "pending").not("ended_at", "is", null)
        .order("updated_at", { ascending: true }).order("ended_at", { ascending: true }).limit(limit);
    if (result.error) throw new Error(`Failed to fetch pending conversations: ${result.error.message}`);
    return (result.data ?? []) as Conversation[];
}

async function getMessages(conversationId: string): Promise<Message[]> {
    const result = await supabase.from("messages").select("*").eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true }).order("sequence_index", { ascending: true }).order("id", { ascending: true });
    if (result.error) throw new Error(`Failed to fetch conversation messages: ${result.error.message}`);
    return (result.data ?? []) as Message[];
}

function senderLabel(message: Message) {
    if (message.sender_type === "client") return message.sender_name?.trim() || "Cliente";
    if (message.sender_type === "attendant") return message.sender_name?.trim() || "Atendente";
    if (message.sender_type === "bot") return "Bot";
    return "Sistema";
}

function buildText(messages: Message[]) {
    return messages.map((message) => `[${new Date(message.sent_at).toLocaleString("pt-BR")}] ${senderLabel(message)}: ${message.text}`).join("\n");
}

function concurrency() {
    const value = Number(process.env.CONVERSATION_ANALYSIS_CONCURRENCY ?? DEFAULT_CONCURRENCY);
    return Math.min(MAX_CONCURRENCY, Math.max(1, Number.isFinite(value) ? Math.floor(value) : DEFAULT_CONCURRENCY));
}

async function mapWithConcurrency<T, R>(items: T[], count: number, mapper: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let next = 0;
    async function worker() {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await mapper(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(count, items.length) }, worker));
    return results;
}

function chunk<T>(items: T[], size: number) {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
}

function formatError(error: unknown) {
    if (error instanceof Error) return error.message;
    try { return JSON.stringify(error); } catch { return String(error); }
}
