// lib/ai/analyzeConversation.ts
import OpenAI from "openai";
import { z } from "zod";

import { getGroqClient } from "./groq";
import { conversationAnalysisSchema } from "./conversationAnalysisSchema";
import type { AnalyzeConversationInput, AnalyzeConversationMessage, ConversationAnalysis } from "@/types";

const OPENAI_PRIMARY = process.env.OPENAI_MODEL_ANALYSIS_FALLBACK ?? "gpt-5.5";
const GROQ_FALLBACK = process.env.GROQ_MODEL_ANALYSIS_PRIMARY ?? "openai/gpt-oss-120b";
const PROMPT_VERSION = "grounded-evidence-v2";
const MAX_GROQ_INPUT_TOKENS = 5_000;
const GROQ_OUTPUT_TOKENS = 1_800;
const OPENAI_OUTPUT_TOKENS = 4_000;
const JSON_SCHEMA = z.toJSONSchema(conversationAnalysisSchema, { target: "draft-7", unrepresentable: "any" });

type ParsedAnalysis = z.infer<typeof conversationAnalysisSchema>;
type Provider = "openai" | "groq";
type Attempt = { provider: Provider; model: string };

export async function analyzeConversation(input: AnalyzeConversationInput): Promise<ConversationAnalysis> {
    const sortedMessages = sortMessages(input.messages);
    if (sortedMessages.length === 0) throw new Error("Conversation has no messages");

    const system = systemPrompt();
    const user = userPrompt(input, sortedMessages);
    const estimatedInputTokens = estimateTokens(system) + estimateTokens(user);
    const attempts: Attempt[] = [
        { provider: "openai", model: OPENAI_PRIMARY },
        ...(estimatedInputTokens <= MAX_GROQ_INPUT_TOKENS
            ? [{ provider: "groq", model: GROQ_FALLBACK } as Attempt]
            : []),
    ];

    console.info("[analyzeConversation] grounded analysis plan", {
        conversation_id: input.conversation_id,
        prompt_version: PROMPT_VERSION,
        message_count: sortedMessages.length,
        estimated_input_tokens: estimatedInputTokens,
        attempts,
    });

    let lastError: unknown = null;
    for (const [index, attempt] of attempts.entries()) {
        try {
            const response = await createCompletion(attempt, {
                model: attempt.model,
                max_completion_tokens: attempt.provider === "groq" ? GROQ_OUTPUT_TOKENS : OPENAI_OUTPUT_TOKENS,
                response_format: {
                    type: "json_schema",
                    json_schema: { name: "conversation_analysis", strict: true, schema: JSON_SCHEMA },
                },
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
            });

            const content = response.choices[0]?.message?.content?.trim();
            if (!content) throw new Error("AI did not return content");
            const parsed = conversationAnalysisSchema.safeParse(JSON.parse(extractJson(content)));
            if (!parsed.success) throw parsed.error;

            const result = validateAndNormalize(input, sortedMessages, parsed.data, attempt);
            console.info("[analyzeConversation] grounded analysis succeeded", {
                conversation_id: input.conversation_id,
                provider: attempt.provider,
                model: attempt.model,
                prompt_version: PROMPT_VERSION,
            });
            return result;
        } catch (error) {
            lastError = error;
            console.error("[analyzeConversation] grounded attempt failed", {
                conversation_id: input.conversation_id,
                attempt: index + 1,
                provider: attempt.provider,
                model: attempt.model,
                error: formatError(error),
            });
        }
    }

    throw new Error(`Conversation analysis failed after every real provider: ${formatError(lastError)}`);
}

function systemPrompt() {
    return `You analyze complete WhatsApp conversations for a fertility clinic. Return only strict JSON.

GROUNDING CONTRACT
- Read every provided message, including bot and system messages.
- Never invent facts, intent, emotion, objections, outcomes, dates, or message IDs.
- Every semantic conclusion must cite the exact supporting evidence_message_ids.
- Evidence IDs must come from the provided messages. Use [] only when the field explicitly represents absence or unobservability.
- Use null for satisfaction and quality scores when the conversation does not contain enough direct evidence. Never manufacture a neutral score.
- A client asking a price is not a price objection. An objection requires resistance, inability, rejection, concern, or hesitation about price.
- Silence is not asked_to_think. Use asked_to_think only when the client explicitly says they will think, evaluate, discuss, or decide later.
- A gratitude, acknowledgement, or natural closing is not abandonment by itself.
- customer_stopped_responding requires an unanswered interaction that reasonably expected a reply. Do not infer it merely because the transcript ended.
- after_delay is allowed only when the final relevant client request is unanswered by the clinic.
- If the clinic asks a question and the client does not answer, classify the preceding topic when supported; do not call it after_delay.
- information_answered requires the requested information to have actually been supplied.
- appointment_scheduled requires explicit confirmation of an appointment, not merely an offer or availability.
- Resolution concerns the client's substantive goal, not whether the chat had a polite ending.
- short_label and reasons must be concise PT-BR.
- Confidence reflects evidential strength, not stylistic certainty.

Do not reinterpret the schema. Do not add fields.`;
}

function userPrompt(input: AnalyzeConversationInput, messages: AnalyzeConversationMessage[]) {
    return JSON.stringify({
        instruction: "Analyze this complete conversation once under the grounding contract.",
        prompt_version: PROMPT_VERSION,
        metadata: {
            conversation_id: input.conversation_id,
            client_id: input.client_id,
            started_at: input.started_at,
            ended_at: input.ended_at,
            attendant_id: input.attendant_id,
            unit_id: input.unit_id,
            service_id: input.service_id,
        },
        messages,
    }, null, 2);
}

function validateAndNormalize(
    input: AnalyzeConversationInput,
    messages: AnalyzeConversationMessage[],
    raw: ParsedAnalysis,
    attempt: Attempt,
): ConversationAnalysis {
    const messageById = new Map(messages.map((message) => [message.id, message]));
    const validEvidence = (ids: string[], field: string) => {
        const unique = Array.from(new Set(ids));
        const unknown = unique.filter((id) => !messageById.has(id));
        if (unknown.length) throw new Error(`${field} references unknown message IDs: ${unknown.join(", ")}`);
        return unique;
    };

    const outcomeEvents = raw.outcome_events.map((event, index) => {
        const evidence = validEvidence(event.evidence_message_ids, `outcome_events[${index}]`);
        if (evidence.length === 0) throw new Error(`outcome_events[${index}] has no evidence`);
        return {
            ...event,
            occurred_at: canonicalEventTime(evidence, messageById, event.occurred_at),
            confidence: clampConfidence(event.confidence),
            evidence_message_ids: evidence,
        };
    });

    const objections = raw.objections.map((objection, index) => {
        const evidence = validEvidence(objection.evidence_message_ids, `objections[${index}]`);
        if (evidence.length === 0) throw new Error(`objections[${index}] has no evidence`);
        return { ...objection, confidence: clampConfidence(objection.confidence), evidence_message_ids: evidence };
    });

    const dropoffEvidence = validEvidence(raw.dropoff.evidence_message_ids, "dropoff");
    if (!raw.dropoff.happened && (raw.dropoff.moment !== null || raw.dropoff.likely_reason !== null || dropoffEvidence.length > 0)) {
        throw new Error("dropoff=false must not contain a moment, reason, or evidence");
    }
    if (raw.dropoff.happened && dropoffEvidence.length === 0) throw new Error("dropoff=true requires evidence");
    if (raw.dropoff.moment === "after_delay") validateAfterDelay(dropoffEvidence, messages);

    const sentimentEvidence = validEvidence(raw.sentiment.evidence_message_ids, "sentiment");
    if (raw.sentiment.satisfaction_score !== null && sentimentEvidence.length === 0) {
        throw new Error("A satisfaction score requires direct evidence");
    }

    const hasAttendant = messages.some((message) => message.sender_type === "attendant");
    const qualityEvidence = validEvidence(raw.attendant_quality.evidence_message_ids, "attendant_quality");
    const quality = hasAttendant
        ? { ...raw.attendant_quality, evidence_message_ids: qualityEvidence }
        : {
              clarity_score: null, empathy_score: null, proactivity_score: null,
              objection_handling_score: null, response_speed_score: null, overall_score: null,
              evidence_message_ids: [],
          };
    if (hasAnyScore(quality) && quality.evidence_message_ids.length === 0) {
        throw new Error("Attendant quality scores require evidence");
    }

    const resolutionEvidence = validEvidence(raw.resolution.evidence_message_ids, "resolution");
    if (raw.resolution.resolution_score !== null && resolutionEvidence.length === 0) {
        throw new Error("A resolution score requires evidence");
    }

    const first = messages[0];
    const last = messages[messages.length - 1];
    return {
        conversation_id: input.conversation_id,
        client_id: input.client_id,
        started_at: first.sent_at,
        ended_at: last.sent_at,
        attendant_id: input.attendant_id,
        unit_id: input.unit_id,
        service_id: input.service_id,
        customer_start_intent: raw.customer_start_intent,
        conversation_goal: raw.conversation_goal,
        goal_status: raw.goal_status,
        customer_final_state: raw.customer_final_state,
        outcome_events: dedupeEvents(outcomeEvents),
        dropoff: {
            happened: raw.dropoff.happened,
            moment: raw.dropoff.happened ? raw.dropoff.moment : null,
            likely_reason: raw.dropoff.happened ? clean(raw.dropoff.likely_reason) : null,
            confidence: raw.dropoff.happened ? clampConfidence(raw.dropoff.confidence) : 0,
            evidence_message_ids: raw.dropoff.happened ? dropoffEvidence : [],
        },
        objections,
        sentiment: {
            customer_sentiment: raw.sentiment.customer_sentiment,
            satisfaction_score: nullableScore(raw.sentiment.satisfaction_score),
            confidence: clampConfidence(raw.sentiment.confidence),
            evidence_message_ids: sentimentEvidence,
        },
        attendant_quality: normalizeQuality(quality),
        response_timing: responseTiming(messages),
        resolution: {
            resolved: raw.resolution.resolved === "true" ? true : raw.resolution.resolved === "false" ? false : "partial",
            resolution_score: nullableScore(raw.resolution.resolution_score),
            reasoning_category: raw.resolution.reasoning_category,
            evidence_message_ids: resolutionEvidence,
        },
        short_label: raw.short_label.trim(),
        notable: raw.notable,
        notable_reason: clean(raw.notable_reason),
        analysis_provider: attempt.provider,
        analysis_model: attempt.model,
        analysis_prompt_version: PROMPT_VERSION,
        analysis_message_count: messages.length,
    };
}

function validateAfterDelay(evidenceIds: string[], messages: AnalyzeConversationMessage[]) {
    const evidence = new Set(evidenceIds);
    const lastEvidenceIndex = messages.reduce((latest, message, index) => evidence.has(message.id) ? index : latest, -1);
    if (lastEvidenceIndex < 0 || messages[lastEvidenceIndex].sender_type !== "client") {
        throw new Error("after_delay must cite a client message");
    }
    const laterReply = messages.slice(lastEvidenceIndex + 1).some((message) => message.sender_type === "attendant" || message.sender_type === "bot");
    if (laterReply) throw new Error("after_delay contradicts a later clinic reply");
}

function responseTiming(messages: AnalyzeConversationMessage[]) {
    const delays: number[] = [];
    let pendingClientAt: number | null = null;
    for (const message of messages) {
        const time = Date.parse(message.sent_at);
        if (!Number.isFinite(time)) continue;
        if (message.sender_type === "client") pendingClientAt ??= time;
        if (message.sender_type === "attendant" && pendingClientAt !== null) {
            delays.push(Math.max(0, Math.round((time - pendingClientAt) / 1000)));
            pendingClientAt = null;
        }
    }
    if (!delays.length) return { first_human_response_time_seconds: null, average_human_response_time_seconds: null, longest_human_delay_seconds: null };
    return {
        first_human_response_time_seconds: delays[0],
        average_human_response_time_seconds: Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length),
        longest_human_delay_seconds: Math.max(...delays),
    };
}

async function createCompletion(attempt: Attempt, body: Record<string, unknown>) {
    if (attempt.provider === "groq") {
        return getGroqClient().chat.completions.create(body as any);
    }
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).chat.completions.create(body as any);
}

function canonicalEventTime(ids: string[], messages: Map<string, AnalyzeConversationMessage>, proposed: string | null) {
    const times = ids.map((id) => messages.get(id)?.sent_at).filter((value): value is string => Boolean(value));
    if (!times.length) return proposed;
    return times.sort((a, b) => Date.parse(a) - Date.parse(b))[times.length - 1];
}
function normalizeQuality<T extends { clarity_score: number | null; empathy_score: number | null; proactivity_score: number | null; objection_handling_score: number | null; response_speed_score: number | null; overall_score: number | null; evidence_message_ids: string[] }>(value: T) {
    return { ...value, clarity_score: nullableScore(value.clarity_score), empathy_score: nullableScore(value.empathy_score), proactivity_score: nullableScore(value.proactivity_score), objection_handling_score: nullableScore(value.objection_handling_score), response_speed_score: nullableScore(value.response_speed_score), overall_score: nullableScore(value.overall_score) };
}
function hasAnyScore(value: { clarity_score: number | null; empathy_score: number | null; proactivity_score: number | null; objection_handling_score: number | null; response_speed_score: number | null; overall_score: number | null }) { return Object.values(value).some((item) => typeof item === "number"); }
function nullableScore(value: number | null) { return value === null ? null : Math.max(0, Math.min(100, Math.round(value))); }
function clampConfidence(value: number) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function clean(value: string | null | undefined) { const text = String(value ?? "").trim(); return text || null; }
function sortMessages(messages: AnalyzeConversationMessage[]) { return [...messages].sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at) || a.sequence_index - b.sequence_index || a.id.localeCompare(b.id)); }
function dedupeEvents<T extends { type: string; occurred_at: string | null; evidence_message_ids: string[] }>(events: T[]) { const seen = new Set<string>(); return events.filter((event) => { const key = `${event.type}:${event.occurred_at ?? ""}:${event.evidence_message_ids.join(",")}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function extractJson(content: string) { const stripped = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(); const start = stripped.indexOf("{"); const end = stripped.lastIndexOf("}"); if (start < 0 || end < start) throw new Error("AI response does not contain JSON"); return stripped.slice(start, end + 1); }
function estimateTokens(value: string) { return Math.ceil(value.length / 3); }
function formatError(error: unknown) { if (error instanceof Error) return error.message; try { return JSON.stringify(error); } catch { return String(error); } }
