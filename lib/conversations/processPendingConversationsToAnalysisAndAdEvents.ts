// lib/conversations/processPendingConversationsToAnalysisAndAdEvents.ts
import { supabase } from "@/lib";
import { analyzeConversation } from "@/lib/ai/analyzeConversation";
import { saveConversationAnalysis } from "@/lib/analysis/saveConversationAnalysis";
import { deriveAdEventsFromAnalysis } from "@/lib/ads/deriveAdEventsFromAnalysis";
import { sendMetaEvents } from "@/lib/ads/meta/sendMetaEvents";
import { sendGoogleEvents } from "@/lib/ads/google/sendGoogleEvents";
import type { AnalyzeConversationInput, Conversation, Message } from "@/types";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const RETRIES = 4;

export async function processPendingConversationsToAnalysisAndAdEvents({ limit = 1000, conversationIds }: { limit?: number; conversationIds?: string[] }) {
    const conversations = await getPending({ limit, conversationIds });
    return mapWithConcurrency(conversations, concurrency(), processConversation);
}

async function processConversation(conversation: Conversation) {
    try {
        const messages = await retry(() => getMessages(conversation.id), `load ${conversation.id}`);
        if (!messages.length) throw new Error("Conversation has no messages");
        const normalized = messages.map((message) => ({ ...message, sender_name: senderLabel(message) }));
        const first = normalized[0];
        const last = normalized.at(-1)!;
        const input: AnalyzeConversationInput = {
            conversation_id: conversation.id, client_id: conversation.client_id,
            started_at: first.sent_at, ended_at: last.sent_at,
            attendant_id: conversation.attendant_id, unit_id: conversation.unit_id, service_id: conversation.service_id,
            conversationText: buildText(normalized),
            messages: normalized.map((message) => ({ id: message.id, sender_type: message.sender_type, sender_name: message.sender_name, text: message.text, sent_at: message.sent_at, sequence_index: message.sequence_index })),
        };

        const analysis = await analyzeConversation(input);
        const analysisId = await retry(() => saveConversationAnalysis(analysis), `save ${conversation.id}`);
        await retry(() => markAnalyzed(conversation.id, String(analysisId), analysis.started_at, analysis.ended_at, String(last.text)), `mark ${conversation.id}`);

        const events = deriveAdEventsFromAnalysis(analysis).filter((event) => event.type === "lead");
        const delivery = await sendAdsSafely(conversation, analysis, events);
        return {
            ok: true as const, conversation_id: conversation.id, client_id: conversation.client_id,
            conversation_analysis_id: analysisId, short_label: analysis.short_label,
            ad_events: events, meta: delivery.meta, google: delivery.google, ad_delivery_errors: delivery.errors,
        };
    } catch (error) {
        await defer(conversation.id);
        console.error("[analysis-pipeline] conversation failed", { conversation_id: conversation.id, error });
        return { ok: false as const, conversation_id: conversation.id, client_id: conversation.client_id, error: formatError(error) };
    }
}

async function sendAdsSafely(conversation: Conversation, analysis: Awaited<ReturnType<typeof analyzeConversation>>, events: ReturnType<typeof deriveAdEventsFromAnalysis>) {
    let meta = null;
    let google = null;
    const errors: string[] = [];
    if (!events.length || await hasExistingAdEvents(conversation.id)) return { meta, google, errors };

    try {
        const result = await supabase.from("clients").select("phone, email, name").eq("id", analysis.client_id).single();
        if (result.error) throw result.error;
        try {
            meta = await sendMetaEvents({ events, phone: result.data.phone, email: result.data.email, conversation_id: conversation.id, conversation_ended_at: analysis.ended_at });
        } catch (error) { errors.push(`Meta: ${formatError(error)}`); }
        try {
            google = await sendGoogleEvents({ events, phone: result.data.phone, email: result.data.email, name: result.data.name, conversation_id: conversation.id, conversation_ended_at: analysis.ended_at });
        } catch (error) { errors.push(`Google: ${formatError(error)}`); }
    } catch (error) { errors.push(`Client lookup: ${formatError(error)}`); }
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
            const result = await supabase.from("conversations").select("*").is("conversation_analysis_id", null).not("ended_at", "is", null).in("id", ids).order("ended_at", { ascending: true });
            if (result.error) throw new Error(`Failed to fetch pending conversations: ${result.error.message}`);
            rows.push(...((result.data ?? []) as Conversation[]));
        }
        return rows.sort((a, b) => new Date(a.ended_at ?? a.started_at).getTime() - new Date(b.ended_at ?? b.started_at).getTime()).slice(0, limit);
    }
    const result = await supabase.from("conversations").select("*").is("conversation_analysis_id", null).not("ended_at", "is", null).order("updated_at", { ascending: true }).order("ended_at", { ascending: true }).limit(limit);
    if (result.error) throw new Error(`Failed to fetch pending conversations: ${result.error.message}`);
    return (result.data ?? []) as Conversation[];
}

async function getMessages(conversationId: string): Promise<Message[]> {
    const result = await supabase.from("messages").select("*").eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true }).order("sequence_index", { ascending: true }).order("id", { ascending: true });
    if (result.error) throw new Error(`Failed to fetch conversation messages: ${result.error.message}`);
    return (result.data ?? []) as Message[];
}

async function markAnalyzed(id: string, analysisId: string, startedAt: string, endedAt: string, lastText: string) {
    const result = await supabase.from("conversations").update({ conversation_analysis_id: analysisId, started_at: startedAt, ended_at: endedAt, last_message_at: endedAt, last_message_text: lastText }).eq("id", id);
    if (result.error) throw new Error(`Failed to mark conversation analyzed: ${result.error.message}`);
}
async function defer(id: string) { await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id).is("conversation_analysis_id", null); }
function senderLabel(message: Message) { if (message.sender_type === "client") return message.sender_name?.trim() || "Cliente"; if (message.sender_type === "attendant") return message.sender_name?.trim() || "Atendente"; if (message.sender_type === "bot") return "Bot"; return "Sistema"; }
function buildText(messages: Message[]) { return messages.map((message) => `[${new Date(message.sent_at).toLocaleString("pt-BR")}] ${senderLabel(message)}: ${message.text}`).join("\n"); }
async function retry<T>(operation: () => Promise<T>, label: string): Promise<T> { let last: unknown; for (let attempt = 1; attempt <= RETRIES; attempt += 1) { try { return await operation(); } catch (error) { last = error; console.error("[analysis-pipeline] retry", { label, attempt, error }); if (attempt < RETRIES) await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 400 * 2 ** (attempt - 1)))); } } throw last; }
function concurrency() { const value = Number(process.env.CONVERSATION_ANALYSIS_CONCURRENCY ?? DEFAULT_CONCURRENCY); return Math.min(MAX_CONCURRENCY, Math.max(1, Number.isFinite(value) ? Math.floor(value) : DEFAULT_CONCURRENCY)); }
async function mapWithConcurrency<T, R>(items: T[], count: number, mapper: (item: T, index: number) => Promise<R>) { const results = new Array<R>(items.length); let next = 0; async function worker() { while (true) { const index = next++; if (index >= items.length) return; results[index] = await mapper(items[index], index); } } await Promise.all(Array.from({ length: Math.min(count, items.length) }, worker)); return results; }
function chunk<T>(items: T[], size: number) { const result: T[][] = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }
function formatError(error: unknown) { if (error instanceof Error) return error.message; try { return JSON.stringify(error); } catch { return String(error); } }
