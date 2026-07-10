// lib/ai/analyzeConversation.ts
import OpenAI from "openai";
import { z } from "zod";
import { getGroqClient } from "./groq";
import { conversationAnalysisSchema } from "./conversationAnalysisSchema";
import type { AnalyzeConversationInput, AnalyzeConversationMessage, ConversationAnalysis } from "@/types";

const PRIMARY = process.env.GROQ_MODEL_ANALYSIS_PRIMARY ?? "openai/gpt-oss-120b";
const SECONDARY = process.env.GROQ_MODEL_ANALYSIS_SECONDARY ?? "openai/gpt-oss-20b";
const OPENAI_FALLBACK = process.env.OPENAI_MODEL_ANALYSIS_FALLBACK ?? "gpt-5.5";
const JSON_SCHEMA = z.toJSONSchema(conversationAnalysisSchema, { target: "draft-7", unrepresentable: "any" });

type ParsedAnalysis = z.infer<typeof conversationAnalysisSchema>;
type Attempt = { provider: "groq" | "openai"; model: string };

export async function analyzeConversation(input: AnalyzeConversationInput): Promise<ConversationAnalysis> {
    const prompt = userPrompt(input, null);
    const estimatedInputTokens = estimateTokens(systemPrompt()) + estimateTokens(prompt);
    const canUseGroq = estimatedInputTokens <= 5_000;
    const attempts: Attempt[] = [
        ...(canUseGroq
            ? [
                  { provider: "groq", model: PRIMARY } as Attempt,
                  { provider: "groq", model: SECONDARY } as Attempt,
              ]
            : []),
        { provider: "openai", model: OPENAI_FALLBACK },
        { provider: "openai", model: OPENAI_FALLBACK },
    ];
    let lastError: unknown = null;
    let lastContent = "";
    let skipRemainingGroqAttempts = false;

    console.info("[analyzeConversation] analysis plan", {
        conversation_id: input.conversation_id,
        estimated_input_tokens: estimatedInputTokens,
        groq_enabled: canUseGroq,
        attempts: attempts.map((attempt) => ({
            provider: attempt.provider,
            model: attempt.model,
        })),
    });

    for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];

        if (attempt.provider === "groq" && skipRemainingGroqAttempts) {
            continue;
        }

        try {
            const retryContext =
                index > 0 ? errorText(lastError, lastContent) : null;
            const messages = [
                { role: "system" as const, content: systemPrompt() },
                {
                    role: "user" as const,
                    content: userPrompt(input, retryContext),
                },
            ];
            const request =
                attempt.provider === "groq"
                    ? {
                          model: attempt.model,
                          temperature: 0,
                          max_completion_tokens: 2_000,
                          response_format: {
                              type: "json_schema" as const,
                              json_schema: {
                                  name: "conversation_analysis",
                                  strict: true,
                                  schema: JSON_SCHEMA,
                              },
                          },
                          messages,
                      }
                    : {
                          model: attempt.model,
                          max_completion_tokens: 4_000,
                          response_format: {
                              type: "json_schema" as const,
                              json_schema: {
                                  name: "conversation_analysis",
                                  strict: true,
                                  schema: JSON_SCHEMA,
                              },
                          },
                          messages,
                      };
            const response: any = await clientFor(
                attempt.provider,
            ).chat.completions.create(request as any);
            const content = response.choices[0]?.message?.content?.trim();
            if (!content) throw new Error("AI did not return content");
            lastContent = content;
            const parsed = conversationAnalysisSchema.safeParse(
                JSON.parse(extractJson(content)),
            );
            if (!parsed.success) throw parsed.error;
            return enforceRules(input, parsed.data);
        } catch (error) {
            lastError = error;

            if (
                attempt.provider === "groq" &&
                isGroqCapacityError(error)
            ) {
                skipRemainingGroqAttempts = true;
            }

            console.error("[analyzeConversation] attempt failed", {
                conversation_id: input.conversation_id,
                attempt: index + 1,
                provider: attempt.provider,
                model: attempt.model,
                error: formatError(error),
            });

            if (index < attempts.length - 1) {
                await sleep(Math.min(8_000, 750 * 2 ** index));
            }
        }
    }

    throw new Error(
        `Conversation analysis failed after all providers: ${formatError(lastError)}`,
    );
}

function clientFor(provider: Attempt["provider"]) {
    if (provider === "groq") return getGroqClient();
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function systemPrompt() {
    return `You analyze complete WhatsApp conversations for a fertility clinic. Return only the strict JSON schema.
Use only the provided messages and timestamps; never invent evidence. Bot/system messages remain evidence.
Silence is never asked_to_think unless the client explicitly says they will think/evaluate.
A gratitude or acknowledgement closing is not abandonment.
after_delay means the clinic failed to answer the client's final substantive message. It is valid ONLY when the final meaningful message is from the client. If the final meaningful message is from an attendant or bot, after_delay is forbidden.
If an attendant asks a pending question and the client does not reply, classify the trigger from price/schedule/unit/payment/medical/online content or unknown, never after_delay.
If the final client message is substantive and unanswered, resolution=false, reasoning_category=attendant_failed_to_answer, dropoff.moment=after_delay.
Do not guess response timing. Scores are 0-100 integers; confidence is 0-1. Portuguese labels/reasons.`;
}

function userPrompt(input: AnalyzeConversationInput, previousError: string | null) {
    return JSON.stringify({
        instruction: "Analyze every message and return the complete schema.",
        previous_attempt_error: previousError,
        metadata: {
            conversation_id: input.conversation_id, client_id: input.client_id,
            started_at: input.started_at, ended_at: input.ended_at,
            attendant_id: input.attendant_id, unit_id: input.unit_id, service_id: input.service_id,
        },
        messages: sortMessages(input.messages),
    }, null, 2);
}

function enforceRules(input: AnalyzeConversationInput, raw: ParsedAnalysis): ConversationAnalysis {
    const messages = sortMessages(input.messages).filter((message) => message.text.trim());
    const first = messages[0];
    const last = messages.at(-1);
    const hasAttendant = messages.some((message) => message.sender_type === "attendant");
    const finalClosure = last?.sender_type === "client" && isClosure(last.text);
    const unansweredClient = Boolean(last?.sender_type === "client" && !finalClosure && substantive(last.text));
    const pendingFromTeam = Boolean(last && ["attendant", "bot"].includes(last.sender_type) && expectsReply(last.text));

    let finalState = raw.customer_final_state;
    let goalStatus = raw.goal_status;
    let dropoff: ConversationAnalysis["dropoff"] = {
        happened: raw.dropoff.happened,
        moment: raw.dropoff.moment,
        likely_reason: clean(raw.dropoff.likely_reason),
        confidence: confidence(raw.dropoff.confidence),
    };
    let resolution: ConversationAnalysis["resolution"] = {
        resolved: raw.resolution.resolved === "true" ? true : raw.resolution.resolved === "false" ? false : "partial",
        resolution_score: score(raw.resolution.resolution_score),
        reasoning_category: raw.resolution.reasoning_category,
    };

    if (finalClosure) {
        dropoff = noDropoff();
        if (finalState === "stopped_responding") finalState = "received_information";
    } else if (unansweredClient) {
        dropoff = { happened: true, moment: "after_delay", likely_reason: "Cliente ficou aguardando retorno da equipe", confidence: 1 };
        finalState = "stopped_responding";
        goalStatus = "not_achieved";
        resolution = { resolved: false, resolution_score: Math.min(25, resolution.resolution_score), reasoning_category: "attendant_failed_to_answer" };
    } else {
        if (dropoff.moment === "after_delay") {
            dropoff.moment = inferMoment(last?.text ?? "");
            dropoff.likely_reason ??= "Cliente não respondeu à última interação";
            dropoff.confidence = Math.min(dropoff.confidence, 0.7);
        }
        if (pendingFromTeam) {
            dropoff = { happened: true, moment: inferMoment(last?.text ?? ""), likely_reason: "Cliente não respondeu à última interação da equipe", confidence: Math.max(0.75, dropoff.confidence) };
            finalState = "stopped_responding";
            if (goalStatus === "achieved") goalStatus = "partially_achieved";
            if (resolution.resolved === true) resolution = { resolved: "partial", resolution_score: Math.min(75, resolution.resolution_score), reasoning_category: "customer_abandoned" };
        }
    }

    if (!dropoff.happened) dropoff = noDropoff();
    else {
        dropoff.moment ??= "unknown";
        dropoff.likely_reason ??= "Cliente não concluiu a conversa";
        dropoff.confidence = Math.max(0.5, dropoff.confidence);
    }

    const events = (raw.outcome_events ?? [])
        .filter((event) => event.type !== "customer_stopped_responding")
        .map((event) => ({ ...event, occurred_at: event.occurred_at ?? null, confidence: confidence(event.confidence) }));
    if (dropoff.happened) events.push({ type: "customer_stopped_responding", occurred_at: last?.sent_at ?? input.ended_at, confidence: dropoff.confidence });

    const timing = responseTiming(messages);
    const quality = hasAttendant ? {
        clarity_score: score(raw.attendant_quality.clarity_score),
        empathy_score: score(raw.attendant_quality.empathy_score),
        proactivity_score: score(raw.attendant_quality.proactivity_score),
        objection_handling_score: score(raw.attendant_quality.objection_handling_score),
        response_speed_score: speedScore(timing.average_human_response_time_seconds),
        overall_score: score(raw.attendant_quality.overall_score),
    } : zeroQuality();

    return {
        conversation_id: input.conversation_id,
        client_id: input.client_id,
        started_at: first?.sent_at ?? input.started_at,
        ended_at: last?.sent_at ?? input.ended_at,
        attendant_id: input.attendant_id,
        unit_id: input.unit_id,
        service_id: input.service_id,
        customer_start_intent: raw.customer_start_intent,
        conversation_goal: raw.conversation_goal,
        goal_status: goalStatus,
        customer_final_state: finalState,
        outcome_events: dedupeEvents(events),
        dropoff,
        objections: raw.objections.map((item) => ({ ...item, confidence: confidence(item.confidence) })),
        sentiment: { customer_sentiment: raw.sentiment.customer_sentiment, satisfaction_score: score(raw.sentiment.satisfaction_score), confidence: confidence(raw.sentiment.confidence) },
        attendant_quality: quality,
        response_timing: hasAttendant ? timing : { first_human_response_time_seconds: null, average_human_response_time_seconds: null, longest_human_delay_seconds: null },
        resolution,
        short_label: raw.short_label.trim() || fallbackLabel(dropoff),
        notable: raw.notable,
        notable_reason: clean(raw.notable_reason),
    };
}

function responseTiming(messages: AnalyzeConversationMessage[]) {
    const delays: number[] = [];
    let pendingClient: number | null = null;
    for (const message of messages) {
        const time = new Date(message.sent_at).getTime();
        if (!Number.isFinite(time)) continue;
        if (message.sender_type === "client") pendingClient ??= time;
        else if (message.sender_type === "attendant" && pendingClient !== null) {
            delays.push(Math.max(0, Math.round((time - pendingClient) / 1000)));
            pendingClient = null;
        }
    }
    return delays.length ? {
        first_human_response_time_seconds: delays[0],
        average_human_response_time_seconds: Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length),
        longest_human_delay_seconds: Math.max(...delays),
    } : { first_human_response_time_seconds: null, average_human_response_time_seconds: null, longest_human_delay_seconds: null };
}

function inferMoment(text: string): NonNullable<ConversationAnalysis["dropoff"]["moment"]> {
    const value = normalize(text);
    if (/pix|boleto|cartao|pagamento/.test(value)) return "after_payment_info";
    if (/r\$|preco|valor/.test(value)) return "after_price";
    if (/horario|agenda|data|disponibilidade/.test(value)) return "after_schedule_options";
    if (/unidade|clinica|endereco|cidade|local/.test(value)) return "after_unit_presented";
    if (/online|video|teleconsulta/.test(value)) return "after_consultation_online";
    if (/medic|tratamento|exame|fiv|fertil|diagnost|saude/.test(value)) return "after_medical_question";
    return "unknown";
}
function expectsReply(text: string) { return text.includes("?") || /qual|quando|podemos|gostaria|quer|confirma|envie|mande|aguardo|retorno|escolha|prefere/.test(normalize(text)); }
function substantive(text: string) { const value = normalize(text); return !isClosure(text) && (text.includes("?") || value.split(/\s+/).length >= 2 || /quero|preciso|gostaria|onde|quando|como|qual|valor|preco|agenda|consulta/.test(value)); }
function isClosure(text: string) { return /^(obrigad[oa]|muito obrigad[oa]|valeu|ok|okay|certo|perfeito|entendi|beleza|combinado|ta bom|tudo bem|sim|nao|ate mais)(\s.*)?$/.test(normalize(text).replace(/[^a-z0-9\s]/g, " ").trim()); }
function normalize(text: string) { return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function noDropoff(): ConversationAnalysis["dropoff"] { return { happened: false, moment: null, likely_reason: null, confidence: 0 }; }
function zeroQuality(): ConversationAnalysis["attendant_quality"] { return { clarity_score: 0, empathy_score: 0, proactivity_score: 0, objection_handling_score: 0, response_speed_score: 0, overall_score: 0 }; }
function speedScore(seconds: number | null) { if (seconds === null) return 0; if (seconds <= 60) return 100; if (seconds <= 180) return 90; if (seconds <= 300) return 80; if (seconds <= 600) return 65; if (seconds <= 1800) return 45; if (seconds <= 3600) return 25; return 10; }
function score(value: number) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
function confidence(value: number) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function clean(value: string | null | undefined) { const result = String(value ?? "").trim(); return result || null; }
function fallbackLabel(dropoff: ConversationAnalysis["dropoff"]) { return dropoff.moment === "after_delay" ? "Cliente aguardando retorno" : "Atendimento analisado"; }
function sortMessages(messages: AnalyzeConversationMessage[]) { return [...messages].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime() || a.sequence_index - b.sequence_index || a.id.localeCompare(b.id)); }
function dedupeEvents<T extends { type: string; occurred_at: string | null }>(events: T[]) { const seen = new Set<string>(); return events.filter((event) => { const key = `${event.type}:${event.occurred_at ?? ""}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function extractJson(content: string) { const cleanContent = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(); const start = cleanContent.indexOf("{"); const end = cleanContent.lastIndexOf("}"); if (start < 0 || end < start) throw new Error("AI response does not contain JSON"); return cleanContent.slice(start, end + 1); }
function errorText(error: unknown, content: string) {
    return `${formatError(error).slice(0, 500)}${
        content ? ` | output: ${content.slice(0, 500)}` : ""
    }`;
}
function estimateTokens(value: string) {
    return Math.ceil(value.length / 3);
}
function isGroqCapacityError(error: unknown) {
    const message = formatError(error).toLowerCase();
    return (
        message.includes("request too large") ||
        message.includes("tokens per minute") ||
        message.includes("tokens per day") ||
        message.includes("rate limit") ||
        message.includes("status 413") ||
        message.includes("status 429")
    );
}
function formatError(error: unknown) { if (error instanceof Error) return error.message; try { return JSON.stringify(error); } catch { return String(error); } }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
