// apps/insights/src/lib/ai/analyzeConversation.ts
import { getGroqClient } from "./groq";
import { conversationAnalysisSchema } from "./conversationAnalysisSchema";
import type { AnalyzeConversationInput, ConversationAnalysis } from "@engravida/types";

const analysisModels = [
    process.env.GROQ_MODEL_ANALYSIS,
    process.env.GROQ_MODEL_ANALYSIS_2,
    process.env.GROQ_MODEL_ANALYSIS_3,
    process.env.GROQ_MODEL_ANALYSIS_4,
].filter(Boolean) as string[];

if (analysisModels.length === 0) {
    analysisModels.push("openai/gpt-oss-120b");
}

function getRandomAnalysisModel() {
    return analysisModels[Math.floor(Math.random() * analysisModels.length)];
}

const MAX_ATTEMPTS = 3;

export async function analyzeConversation({
                                              conversation_id,
                                              client_id,
                                              started_at,
                                              ended_at,
                                              attendant_id,
                                              unit_id,
                                              service_id,
                                              conversationText,
                                          }: AnalyzeConversationInput): Promise<ConversationAnalysis> {
    let lastError: unknown = null;
    let lastContent: string | null = null;
    const attemptedModels: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const groq = getGroqClient();
        const model = getRandomAnalysisModel();

        attemptedModels.push(model);


        let response: any;

        try {
            response = await groq.chat.completions.create({
                model,
                temperature: 0,
                // response_format: {
                //     type: "json_object",
                // },
                messages: [
                    {
                        role: "system",
                        content: buildSystemPrompt(),
                    },
                    {
                        role: "user",
                        content: buildUserPrompt({
                            conversation_id,
                            client_id,
                            started_at,
                            ended_at,
                            attendant_id,
                            unit_id,
                            service_id,
                            conversationText,
                            previousError:
                                attempt > 1
                                    ? formatValidationError(lastError, lastContent)
                                    : null,
                        }),
                    },
                ],
            });
        } catch (error) {
            lastError = error;

            console.error("[analyzeConversation] AI request failed:", {
                conversation_id,
                client_id,
                attempt,
                model,
                error,
            });

            continue;
        }

        const content = response.choices[0]?.message?.content;

        if (!content) {
            lastError = new Error("AI did not return content");

            console.error("[analyzeConversation] AI did not return content", {
                attempt,
                model,
            });

            continue;
        }

        lastContent = content;

        let json: unknown;

        try {
            json = JSON.parse(content);
        } catch (error) {
            lastError = error;

            console.error("[analyzeConversation] Invalid AI JSON:", {
                attempt,
                model,
                content,
            });

            continue;
        }

        const parsed = conversationAnalysisSchema.safeParse(json);

        if (!parsed.success) {
            lastError = parsed.error;
            console.error("[analyzeConversation] AI schema validation failed:", {
                attempt,
                model,
                issues: parsed.error.issues,
                content,
            });
            continue;
        }

        const normalizedResolved =
            parsed.data.resolution.resolved === "partial"
                ? "partial"
                : parsed.data.resolution.resolved === "true"

        const analysis = {
            ...parsed.data,

            attendant_id: parsed.data.attendant_id ?? null,
            unit_id: parsed.data.unit_id ?? null,
            service_id: parsed.data.service_id ?? null,

            resolution: {
                ...parsed.data.resolution,
                resolved: normalizedResolved,
                resolution_score: Math.max(
                    0,
                    Math.min(100, parsed.data.resolution.resolution_score)
                ),
            },

            outcome_events: (parsed.data.outcome_events ?? []).map((event) => ({
                ...event,
                occurred_at: event.occurred_at ?? null,
            })),

            dropoff: {
                ...parsed.data.dropoff,
                happened: parsed.data.dropoff.happened,
                moment: parsed.data.dropoff.moment ?? "unknown",
                likely_reason: parsed.data.dropoff.likely_reason ?? "",
                confidence: parsed.data.dropoff.confidence,
            },
        }

        return analysis as ConversationAnalysis
    }

    console.error("[analyzeConversation] AI failed after retries", {
        attemptedModels,
        lastError,
        lastContent,
    });

    throw new Error("AI failed to return valid conversation analysis");
}

function buildSystemPrompt() {
    return `
You analyze WhatsApp/Blip conversations between fertility clinic attendants and clients.

Return ONLY valid JSON.
Do not use markdown.
Do not wrap in code blocks.
Do not add comments.
Do not add extra fields.
Do not omit required fields.

ABSOLUTE OUTPUT REQUIREMENTS:
- You MUST return every field from the requested JSON shape.
- You MUST NOT omit any required field.
- You MUST NOT return null for any score field.
- You MUST NOT return null for any enum field.
- You MUST NOT return null for any boolean field.
- You MUST NOT return null for any array field.
- You MUST NOT return null for any object field.
- You may return null ONLY for fields explicitly typed as nullable in the requested shape.
- Arrays must always be arrays, even if empty.
- Objects must always be objects.
- Confidence fields must be numbers from 0 to 1.
- Score fields must be integers from 0 to 100.
- Do not use "No data".
- short_label must be in Portuguese.

SCORE FIELDS THAT ARE NEVER NULL:
- All score fields must be integers from 0 to 100, never decimals from 0 to 1.
- Example: use 60, not 0.6.
- sentiment.satisfaction_score
- attendant_quality.clarity_score
- attendant_quality.empathy_score
- attendant_quality.proactivity_score
- attendant_quality.objection_handling_score
- attendant_quality.response_speed_score
- attendant_quality.overall_score
- resolution.resolution_score

CUSTOMER FINAL STATE RULES:
- Do NOT overuse "asked_to_think".
- Use "asked_to_think" ONLY when the customer explicitly says something like:
  "vou pensar", "preciso pensar", "vou ver", "vou decidir", "vou falar com meu marido", "depois retorno", "não sei ainda", "preciso avaliar".
- If the attendant sent information, price, schedule options, payment info, unit/location, or follow-up and the customer did not answer afterwards, use "stopped_responding", NOT "asked_to_think".
- If the customer objected to price, use "objected_to_price", not "asked_to_think".
- If the customer was transferred to another team/person/unit, use "redirected".
- If the customer got the requested answer and there is no clear pending action, use "received_information".
- If the customer thanks, acknowledges, or accepts the answer after receiving help, use "received_information" unless there is a clearer final state like scheduled/rescheduled/confirmed_attendance.
- If the customer scheduled, use "scheduled".
- If the customer rescheduled, use "rescheduled".
- If attendance was confirmed, use "confirmed_attendance".
- Use "unclear" only when the final state cannot be inferred.

NORMAL CLOSURE RULES:
- Do NOT mark dropoff when the customer sends a closing/acknowledgement message such as:
  "obrigado", "obrigada", "muito obrigado", "muito obrigada", "valeu", "tá bom", "tá bem", "ok", "certo", "perfeito", "entendi", "beleza", "combinado", "até", "sim", "não", or similar.
- If the customer thanks or acknowledges after receiving help, information, instructions, files, schedule confirmation, or payment information, then dropoff.happened = false.
- If the bot sends a final closing message after the customer thanked/acknowledged, that is a normal closure, NOT abandonment.
- A final bot closing message after customer acknowledgement does not mean the customer stopped responding.
- In normal closure cases, set:
  dropoff.happened = false
  dropoff.moment = null
  dropoff.likely_reason = null
  dropoff.confidence = 0

DROPOFF RULES:
- Always evaluate whether the customer abandoned the conversation.
- Bot-to-attendant abandonment rule:
  If the customer talked with the bot, then a human attendant sent the first attendant message, and after that first human attendant message the customer never replied again, classify it as abandonment.
  In this case:
  customer_final_state = "stopped_responding"
  dropoff.happened = true
  dropoff.moment = "after_delay" if the attendant was following up/waiting, otherwise use "unknown"
  dropoff.likely_reason = "Cliente abandonou após entrada da atendente"
  resolution.resolved = "partial" or "false" depending on whether the customer's issue was already answered before the attendant entered
  resolution.reasoning_category = "customer_abandoned"
Add outcome event "customer_stopped_responding"
- dropoff.happened = true ONLY when the conversation ends because the customer stopped replying while a relevant question, offer, request, price, schedule option, payment step, medical question, document request, or confirmation was still pending.- If the last meaningful customer message is gratitude, acknowledgement, agreement, or closure, then dropoff.happened = false.
- If the last meaningful message is from the attendant/bot and it asks a question, offers schedule options, presents price, asks for payment/document, gives follow-up, or waits for confirmation, then dropoff.happened should usually be true.
- If customer_final_state = "stopped_responding", then dropoff.happened MUST be true.
- If dropoff.happened = true, then dropoff.moment MUST NOT be null.
- If dropoff.happened = true, then dropoff.likely_reason MUST be a short Portuguese explanation.
- If dropoff.happened = true, then add an outcome event of type "customer_stopped_responding".
- Use dropoff.moment based on what happened immediately before the customer stopped:
  - after_price: after price/payment value was presented
  - after_consultation_online: after online consultation was mentioned/offered
  - after_unit_presented: after clinic unit/location was presented
  - after_schedule_options: after dates/times/scheduling options were presented
  - after_payment_info: after PIX/payment/comprovante/payment instructions
  - after_medical_question: after medical doubt/question/exam/treatment question
  - after_delay: after waiting/follow-up/delay/queue/attendant asked if customer was still there
  - unknown: stopped responding but the exact trigger is unclear
- If there is no abandonment, set:
  dropoff.happened = false
  dropoff.moment = null
  dropoff.likely_reason = null
  dropoff.confidence = 0

RESOLUTION RULES:
- resolution.resolution_score must always estimate how much the customer's issue was resolved.
- If the customer thanks, acknowledges, or accepts the answer after the attendant helped, resolution.resolved should usually be "true".
- If the customer says "obrigado/obrigada", "tá bom", "ok", "certo", "entendi", "perfeito", "muito obrigado", or similar after the attendant response, do NOT set resolution_score to 0.
- A final bot closing message after customer thanks does not reduce resolution.
- If the customer stopped responding before the issue was resolved, resolution.resolved = "partial" or "false".
- If the attendant answered the question but the customer did not confirm satisfaction, usually use "partial".
- If the customer clearly got the answer, confirmed, thanked, scheduled, or accepted next step, use "true".
- If the attendant failed to answer the customer's last question/request, use "false" and reasoning_category = "attendant_failed_to_answer".
- If the customer abandoned after receiving answer/options/price, use reasoning_category = "customer_abandoned".
- Do not use 0 as a placeholder.
- Use 0 only when there is truly no resolution.

OUTCOME EVENT RULES:
- Add "information_requested" when the customer asks a question or asks for information.
- Add "information_answered" when the attendant/bot answers the requested information.
- Add "consultation_offered" when a consultation/assessment/evaluation is offered.
- Add "price_presented" when price/payment value is presented.
- Add "objection_raised" when the customer objects or shows concern.
- Add "appointment_scheduled" when a date/time is confirmed.
- Add "appointment_rescheduled" when a previous appointment is changed.
- Add "attendance_confirmed" when attendance/presence is confirmed.
- Add "customer_stopped_responding" only when dropoff.happened = true.
- Add "attendant_followed_up" when attendant checks if customer is still there or follows up.
- Add "handoff_to_human" when bot transfers to a human.
- Add "handoff_to_unit" when transferred/redirected to a clinic/unit/team.

SCORING RULES:
- Do not use 0 as a placeholder.
- Use 0 only when the evaluated thing is truly absent or impossible to evaluate.
- If there is human attendant interaction, attendant_quality scores must be based on actual quality and should not all be 0.
- If there is no human attendant interaction, attendant_quality scores should be 0.
- sentiment.satisfaction_score must always estimate customer satisfaction from the conversation.
- If evidence is weak, still provide a conservative valid score, not null.

ANALYSIS RULES:
- Be conservative. If unclear, use "unclear".
- Do not invent events that are not supported by the conversation.
- response_timing must be based on message timestamps when possible.
- response_timing fields may be null only if timing cannot be inferred.
- For resolution.resolved, use exactly "true", "false", or "partial".
`.trim();
}

function buildUserPrompt({
                             conversation_id,
                             client_id,
                             started_at,
                             ended_at,
                             attendant_id,
                             unit_id,
                             service_id,
                             conversationText,
                             previousError,
                         }: AnalyzeConversationInput & {
    previousError: string | null;
}) {
    return `
Return a JSON object with exactly this shape:

{
  "conversation_id": string,
  "client_id": string,
  "started_at": string,
  "ended_at": string,
  "attendant_id": string | null,
  "unit_id": string | null,
  "service_id": string | null,
"customer_start_intent": "answer_information" | "schedule_consultation" | "reschedule_consultation" | "confirm_attendance" | "recover_inactive_lead" | "explain_treatment" | "handle_price_objection" | "collect_documents_or_exams" | "post_consultation_followup" | "asked_to_think" | "other",
  "conversation_goal": "answer_information" | "schedule_consultation" | "reschedule_consultation" | "confirm_attendance" | "recover_inactive_lead" | "explain_treatment" | "handle_price_objection" | "collect_documents_or_exams" | "post_consultation_followup" | "other",
  "goal_status": "achieved" | "partially_achieved" | "not_achieved" | "unclear",
  "customer_final_state": "scheduled" | "rescheduled" | "confirmed_attendance" | "received_information" | "asked_to_think" | "objected_to_price" | "stopped_responding" | "redirected" | "not_qualified" | "unclear",
  "outcome_events": [
    {
      "type": "information_requested" | "information_answered" | "consultation_offered" | "price_presented" | "objection_raised" | "appointment_scheduled" | "appointment_rescheduled" | "attendance_confirmed" | "customer_stopped_responding" | "attendant_followed_up" | "customer_returned" | "handoff_to_human" | "handoff_to_unit",
      "occurred_at": string | null,
      "confidence": number
    }
  ],
  "dropoff": {
    "happened": boolean,
    "moment": "after_price" | "after_consultation_online" | "after_unit_presented" | "after_schedule_options" | "after_payment_info" | "after_medical_question" | "after_delay" | "unknown" | null,
    "likely_reason": string | null,
    "confidence": number
  },
  "objections": [
    {
      "type": "price" | "distance" | "online_consultation" | "time_availability" | "trust" | "medical_uncertainty" | "partner_or_family" | "already_treating_elsewhere" | "other",
      "severity": "low" | "medium" | "high",
      "resolved": boolean,
      "confidence": number
    }
  ],
  "sentiment": {
    "customer_sentiment": "positive" | "neutral" | "negative" | "anxious" | "confused" | "frustrated",
    "satisfaction_score": number,
    "confidence": number
  },
  "attendant_quality": {
    "clarity_score": number,
    "empathy_score": number,
    "proactivity_score": number,
    "objection_handling_score": number,
    "response_speed_score": number,
    "overall_score": number
  },
  "response_timing": {
    "first_human_response_time_seconds": number | null,
    "average_human_response_time_seconds": number | null,
    "longest_human_delay_seconds": number | null
  },
  "resolution": {
    "resolved": "true" | "false" | "partial",
    "resolution_score": number,
    "reasoning_category": "customer_got_answer" | "customer_scheduled" | "customer_confirmed" | "customer_not_qualified" | "customer_abandoned" | "attendant_failed_to_answer" | "unclear"
  },
  "short_label": string,
  "notable": boolean,
  "notable_reason": string | null
}

Conversation metadata:
conversation_id: ${conversation_id}
client_id: ${client_id}
started_at: ${started_at}
ended_at: ${ended_at}
attendant_id: ${attendant_id}
unit_id: ${unit_id}
service_id: ${service_id}

${
        previousError
            ? `
Your previous response was invalid.

Fix these validation errors and return the full JSON again.
Do not omit any fields.

Validation error:
${previousError}
`
            : ""
    }

Important classification reminder:
- Do not classify silence as "asked_to_think".
- If the customer spoke with the bot, then a human attendant entered, and the customer did not send any message after the first human attendant message, classify as abandonment after bot-to-attendant handoff.
- Silence after attendant/bot expected a reply = "stopped_responding" + dropoff.happened = true.
- Explicit thinking/deciding language = "asked_to_think".
- Customer thanks/acknowledgement after help = resolved/normal closure, not abandonment.
- Bot closing message after customer thanks = normal closure, not dropoff.
- If dropoff.happened = true, fill moment, likely_reason, confidence, and add customer_stopped_responding to outcome_events.

Conversation:
${conversationText}
`.trim();
}

function formatValidationError(error: unknown, content: string | null) {
    if (!error) {
        return "Unknown validation error";
    }

    if (error instanceof Error) {
        return error.message;
    }

    return JSON.stringify({
        error,
        content,
    });
}