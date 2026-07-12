// lib/ai/analyzeConversation.ts
import { z } from "zod";

import { getGroqClient } from "./groq";
import { conversationAnalysisSchema } from "./conversationAnalysisSchema";
import type {
    AnalyzeConversationInput,
    AnalyzeConversationMessage,
    ConversationAnalysis,
} from "@/types";

const GROQ_MODEL =
    process.env.GROQ_MODEL_ANALYSIS_PRIMARY ?? "openai/gpt-oss-120b";
const PROMPT_VERSION = "groq-evidence-ledger-v4";
const EVIDENCE_OUTPUT_TOKENS = 2_400;
const ANALYSIS_OUTPUT_TOKENS = 3_000;
const TECHNICAL_ATTEMPTS = 2;

const goalValues = [
    "answer_information",
    "schedule_consultation",
    "reschedule_consultation",
    "confirm_attendance",
    "recover_inactive_lead",
    "explain_treatment",
    "handle_price_objection",
    "collect_documents_or_exams",
    "post_consultation_followup",
    "other",
] as const;

const outcomeEventValues = [
    "information_requested",
    "information_answered",
    "consultation_offered",
    "price_presented",
    "objection_raised",
    "appointment_scheduled",
    "appointment_rescheduled",
    "attendance_confirmed",
    "customer_stopped_responding",
    "attendant_followed_up",
    "customer_returned",
    "handoff_to_human",
    "handoff_to_unit",
] as const;

const objectionValues = [
    "price",
    "distance",
    "online_consultation",
    "time_availability",
    "trust",
    "medical_uncertainty",
    "partner_or_family",
    "already_treating_elsewhere",
    "other",
] as const;

const sentimentValues = [
    "positive",
    "neutral",
    "negative",
    "anxious",
    "confused",
    "frustrated",
] as const;

const evidenceIds = z.array(z.string());

const evidenceLedgerSchema = z.object({
    primary_goal: z.object({
        category: z.enum(goalValues),
        summary_pt_br: z.string().min(1),
        evidence_message_ids: evidenceIds,
    }),
    requests: z.array(
        z.object({
            summary_pt_br: z.string().min(1),
            status: z.enum([
                "answered",
                "partially_answered",
                "unanswered",
                "unclear",
            ]),
            request_message_ids: evidenceIds,
            answer_message_ids: evidenceIds,
        }),
    ),
    explicit_outcomes: z.array(
        z.object({
            type: z.enum(outcomeEventValues),
            confidence: z.number().min(0).max(1),
            evidence_message_ids: evidenceIds,
        }),
    ),
    explicit_objections: z.array(
        z.object({
            type: z.enum(objectionValues),
            severity: z.enum(["low", "medium", "high"]),
            resolved: z.boolean(),
            confidence: z.number().min(0).max(1),
            evidence_message_ids: evidenceIds,
            resolution_message_ids: evidenceIds,
        }),
    ),
    sentiment_signals: z.array(
        z.object({
            sentiment: z.enum(sentimentValues),
            confidence: z.number().min(0).max(1),
            supports_satisfaction_score: z.boolean(),
            evidence_message_ids: evidenceIds,
        }),
    ),
    routing: z.object({
        human_attendant_present: z.boolean(),
        handoff_to_human: z.boolean(),
        handoff_to_unit: z.boolean(),
        out_of_hours_notice: z.boolean(),
        evidence_message_ids: evidenceIds,
    }),
    final_exchange: z.object({
        last_meaningful_client_message_id: z.string().nullable(),
        last_meaningful_clinic_message_id: z.string().nullable(),
        primary_goal_answered: z.boolean(),
        client_waiting_for_substantive_answer: z.boolean(),
        evidence_message_ids: evidenceIds,
    }),
});

type EvidenceLedger = z.infer<typeof evidenceLedgerSchema>;
type ParsedAnalysis = z.infer<typeof conversationAnalysisSchema>;

type DeterministicFacts = {
    human_attendant_present: boolean;
    bot_present: boolean;
    client_message_count: number;
    attendant_message_count: number;
    bot_message_count: number;
    first_sender_type: AnalyzeConversationMessage["sender_type"];
    last_sender_type: AnalyzeConversationMessage["sender_type"];
};

const EVIDENCE_JSON_SCHEMA = z.toJSONSchema(evidenceLedgerSchema, {
    target: "draft-7",
    unrepresentable: "any",
});
const ANALYSIS_JSON_SCHEMA = z.toJSONSchema(conversationAnalysisSchema, {
    target: "draft-7",
    unrepresentable: "any",
});

export async function analyzeConversation(
    input: AnalyzeConversationInput,
): Promise<ConversationAnalysis> {
    const messages = prepareMessages(input.messages);
    if (messages.length === 0) throw new Error("Conversation has no messages");

    const facts = deterministicFacts(messages);

    console.info("[analyzeConversation] starting Groq evidence-ledger pipeline", {
        conversation_id: input.conversation_id,
        model: GROQ_MODEL,
        prompt_version: PROMPT_VERSION,
        message_count: messages.length,
        human_attendant_present: facts.human_attendant_present,
        automatic_openai_calls: false,
    });

    const ledger = validateLedger(
        await callStructured({
            schema: evidenceLedgerSchema,
            jsonSchema: EVIDENCE_JSON_SCHEMA,
            schemaName: "conversation_evidence_ledger",
            system: evidenceSystemPrompt(),
            user: evidenceUserPrompt(input, messages, facts),
            maxCompletionTokens: EVIDENCE_OUTPUT_TOKENS,
        }),
        messages,
        facts,
    );

    let rawAnalysis: ParsedAnalysis | null = null;
    let normalizedAnalysis: ConversationAnalysis | null = null;
    let validationIssues: string[] = [];

    try {
        rawAnalysis = await runFinalPass({ input, messages, facts, ledger });
        normalizedAnalysis = validateAndNormalize(
            input,
            messages,
            rawAnalysis,
        );
        validationIssues = findConsistencyIssues(
            normalizedAnalysis,
            ledger,
            facts,
        );
    } catch (error) {
        validationIssues = [formatError(error)];
    }

    if (validationIssues.length > 0) {
        console.warn("[analyzeConversation] final pass requires one Groq repair", {
            conversation_id: input.conversation_id,
            issues: validationIssues,
        });

        try {
            rawAnalysis = await runFinalPass({
                input,
                messages,
                facts,
                ledger,
                priorAnalysis: rawAnalysis,
                repairIssues: validationIssues,
            });
            normalizedAnalysis = validateAndNormalize(
                input,
                messages,
                rawAnalysis,
            );
            validationIssues = findConsistencyIssues(
                normalizedAnalysis,
                ledger,
                facts,
            );
        } catch (error) {
            if (!normalizedAnalysis) throw error;
            validationIssues = Array.from(
                new Set([...validationIssues, formatError(error)]),
            );
        }
    }

    if (!normalizedAnalysis) {
        throw new Error("Groq did not produce a valid conversation analysis");
    }

    const finalAnalysis = applyEvidenceGuardrails(
        normalizedAnalysis,
        ledger,
        facts,
        messages,
    );

    const remainingIssues = findConsistencyIssues(
        finalAnalysis,
        ledger,
        facts,
    );

    if (remainingIssues.length > 0) {
        console.warn(
            "[analyzeConversation] conservative guardrails resolved model conflicts",
            {
                conversation_id: input.conversation_id,
                original_issues: validationIssues,
                remaining_issues: remainingIssues,
            },
        );
    }

    console.info("[analyzeConversation] Groq quality pipeline completed", {
        conversation_id: input.conversation_id,
        model: GROQ_MODEL,
        prompt_version: PROMPT_VERSION,
        goal_status: finalAnalysis.goal_status,
        final_state: finalAnalysis.customer_final_state,
        resolution: finalAnalysis.resolution.resolved,
        resolution_score: finalAnalysis.resolution.resolution_score,
    });

    return finalAnalysis;
}

async function runFinalPass(args: {
    input: AnalyzeConversationInput;
    messages: AnalyzeConversationMessage[];
    facts: DeterministicFacts;
    ledger: EvidenceLedger;
    priorAnalysis?: ParsedAnalysis | null;
    repairIssues?: string[];
}) {
    return callStructured({
        schema: conversationAnalysisSchema,
        jsonSchema: ANALYSIS_JSON_SCHEMA,
        schemaName: "conversation_analysis",
        system: analysisSystemPrompt(),
        user: analysisUserPrompt(args),
        maxCompletionTokens: ANALYSIS_OUTPUT_TOKENS,
    });
}

async function callStructured<T>(args: {
    schema: z.ZodType<T>;
    jsonSchema: unknown;
    schemaName: string;
    system: string;
    user: string;
    maxCompletionTokens: number;
}): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= TECHNICAL_ATTEMPTS; attempt += 1) {
        try {
            const response = await getGroqClient().chat.completions.create({
                model: GROQ_MODEL,
                temperature: 0,
                max_completion_tokens: args.maxCompletionTokens,
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: args.schemaName,
                        strict: true,
                        schema: args.jsonSchema,
                    },
                },
                messages: [
                    { role: "system", content: args.system },
                    {
                        role: "user",
                        content:
                            attempt === 1
                                ? args.user
                                : `${args.user}\n\nTECHNICAL JSON REPAIR: The previous response failed parsing or schema validation. Return the same requested analysis as valid strict JSON. Error: ${truncate(
                                      formatError(lastError),
                                      900,
                                  )}`,
                    },
                ],
            } as any);

            const content = response.choices[0]?.message?.content?.trim();
            if (!content) throw new Error("Groq did not return content");

            const parsed = args.schema.safeParse(
                JSON.parse(extractJson(content)),
            );
            if (!parsed.success) throw parsed.error;

            return parsed.data;
        } catch (error) {
            lastError = error;
            console.warn("[analyzeConversation] Groq structured pass failed", {
                schema: args.schemaName,
                attempt,
                error: formatError(error),
            });
        }
    }

    throw new Error(
        `Groq failed to return valid ${args.schemaName}: ${formatError(lastError)}`,
    );
}

function evidenceSystemPrompt() {
    return `Você extrai um REGISTRO DE EVIDÊNCIAS de conversas completas de WhatsApp de uma clínica de fertilidade.

Esta etapa NÃO decide pontuações, resolução final nem qualidade do atendimento. Ela apenas registra fatos explícitos e os message_ids que os sustentam.

REGRAS ABSOLUTAS
- Leia a conversa inteira em ordem cronológica.
- Diferencie rigorosamente cliente, bot, atendente humano e sistema.
- Uma mensagem de bot nunca prova que houve atendimento humano.
- Perguntas de triagem, menus, avisos de fila, transferência e horário de atendimento NÃO respondem ao objetivo clínico/comercial do cliente.
- Um aviso de que o cliente será conectado a um atendente é apenas handoff_to_human; não é atendimento concluído.
- "Voltar ao Menu" e payloads preservados são ações técnicas/interface, não são nova intenção, objeção, sentimento ou resposta substantiva.
- Uma pergunta sobre preço não é objeção. Objeção exige resistência, impossibilidade, preocupação, rejeição ou hesitação explícita.
- Não confunda o fim do transcript com abandono.
- Um pedido só está answered quando uma mensagem da clínica responde diretamente ao conteúdo solicitado.
- Em sentiment_signals, supports_satisfaction_score só pode ser true quando o cliente avalia explicitamente ou de forma inequívoca o atendimento/resultado; emoção geral, respostas factuais e educação não bastam.
- Use apenas message_ids existentes.
- summary_pt_br deve ser curto, factual e em português do Brasil.
- Não invente fatos ausentes.`;
}

function evidenceUserPrompt(
    input: AnalyzeConversationInput,
    messages: AnalyzeConversationMessage[],
    facts: DeterministicFacts,
) {
    return JSON.stringify(
        {
            instruction:
                "Extraia o registro de evidências factual da conversa completa. Não faça a análise final ainda.",
            prompt_version: PROMPT_VERSION,
            metadata: metadata(input),
            deterministic_sender_facts: facts,
            messages,
        },
        null,
        2,
    );
}

function analysisSystemPrompt() {
    return `Você produz a análise FINAL de uma conversa completa de WhatsApp de uma clínica de fertilidade. Retorne apenas JSON estrito no schema solicitado.

Leia novamente TODA a conversa. O registro de evidências fornecido é um mapa factual para impedir que o objetivo principal seja perdido, mas você ainda deve verificar tudo no transcript completo.

CONTRATO DE QUALIDADE
- Nunca invente fatos, sentimentos, objeções, resultados, datas ou message_ids.
- Toda conclusão semântica deve citar message_ids relevantes.
- Prefira unclear ou null quando algo realmente não é observável.
- O objetivo substantivo do cliente é o que ele queria obter da clínica; completar triagem, entrar em fila, receber menu ou aviso de horário não realiza esse objetivo.
- Bot não é atendente humano. Se não houve atendente humano, todos os attendant_quality scores devem ser null e os tempos humanos devem ser null.
- Se o cliente fez uma pergunta substantiva e recebeu somente triagem, fila, transferência, menu ou aviso fora do horário: goal_status=not_achieved, resolution.resolved=false e resolution_score=0. customer_final_state pode ser redirected quando houve encaminhamento explícito.
- Use reasoning_category=attendant_failed_to_answer quando o objetivo substantivo permaneceu sem resposta pela clínica, inclusive em fluxo somente de bot/encaminhamento.
- information_answered exige uma resposta substantiva real; não use para mensagens administrativas ou de roteamento.
- received_information exige que a informação solicitada tenha sido realmente fornecida.
- appointment_scheduled exige confirmação explícita de agendamento, não apenas oferta, link ou disponibilidade.
- Uma pergunta de preço não é objeção. Objeção exige resistência, impossibilidade, preocupação, rejeição ou hesitação explícita.
- asked_to_think exige fala explícita do cliente dizendo que irá pensar, avaliar, conversar ou decidir depois.
- Não marque customer_stopped_responding/dropoff apenas porque o transcript terminou. É preciso evidência de uma interação que esperava resposta e contexto suficiente de inatividade.
- Agradecimento, confirmação curta ou fechamento natural não são abandono.
- satisfaction_score mede evidência de satisfação do cliente com o serviço/resultado. Use null sem evidência direta ou forte; educação genérica não basta.
- resolution_score: 100 para objetivo totalmente alcançado; valor intermediário somente quando parte substantiva foi realmente resolvida; 0 quando o objetivo claro ficou totalmente sem resposta; null apenas quando o próprio objetivo/resolução é verdadeiramente incerto.
- goal_status, customer_final_state, outcome_events, dropoff, objections e resolution devem ser mutuamente consistentes.
- short_label e notable_reason devem ser concisos e em PT-BR.

CONTRAEXEMPLOS IMPORTANTES
1. Cliente pergunta sobre opções de tratamento. Bot pergunta dados, informa fila/fora do horário e mostra menu. Resultado: pedido não respondido, resolução 0, sem qualidade de atendente, handoff pode existir.
2. Cliente pergunta "qual o valor?". Isso é information_requested, não price objection.
3. Cliente recebe resposta e diz "obrigada". Isso não é abandono.
4. Bot diz "aguarde um atendente". Isso é encaminhamento, não consulta oferecida nem informação respondida.
5. Cliente vê horários disponíveis, mas não confirma um deles. Não houve appointment_scheduled.`;
}

function analysisUserPrompt(args: {
    input: AnalyzeConversationInput;
    messages: AnalyzeConversationMessage[];
    facts: DeterministicFacts;
    ledger: EvidenceLedger;
    priorAnalysis?: ParsedAnalysis | null;
    repairIssues?: string[];
}) {
    return JSON.stringify(
        {
            instruction:
                args.repairIssues && args.repairIssues.length > 0
                    ? "Refaça a análise final completa. A saída anterior contrariou evidências ou o schema. Não faça patch superficial; derive novamente todos os campos da conversa inteira."
                    : "Produza uma única análise final completa, consistente e apoiada por evidências.",
            prompt_version: PROMPT_VERSION,
            metadata: metadata(args.input),
            deterministic_sender_facts: args.facts,
            evidence_ledger: args.ledger,
            rejected_analysis:
                args.repairIssues && args.repairIssues.length > 0
                    ? args.priorAnalysis ?? null
                    : null,
            repair_issues: args.repairIssues ?? [],
            messages: args.messages,
        },
        null,
        2,
    );
}

function validateLedger(
    raw: EvidenceLedger,
    messages: AnalyzeConversationMessage[],
    facts: DeterministicFacts,
): EvidenceLedger {
    const messageById = new Map(messages.map((message) => [message.id, message]));
    const validIds = (ids: string[]) =>
        Array.from(new Set(ids)).filter((id) => messageById.has(id));
    const clientIds = (ids: string[]) =>
        validIds(ids).filter(
            (id) => messageById.get(id)?.sender_type === "client",
        );
    const clinicIds = (ids: string[]) =>
        validIds(ids).filter((id) => {
            const sender = messageById.get(id)?.sender_type;
            return sender === "attendant" || sender === "bot";
        });

    const primaryGoalEvidence = clientIds(
        raw.primary_goal.evidence_message_ids,
    );
    if (primaryGoalEvidence.length === 0) {
        const firstClient = messages.find(
            (message) => message.sender_type === "client",
        );
        if (firstClient) primaryGoalEvidence.push(firstClient.id);
    }

    const requests = raw.requests
        .map((request) => ({
            ...request,
            request_message_ids: clientIds(request.request_message_ids),
            answer_message_ids: clinicIds(request.answer_message_ids),
        }))
        .filter((request) => request.request_message_ids.length > 0);

    const explicitOutcomes = raw.explicit_outcomes
        .map((event) => ({
            ...event,
            confidence: clampConfidence(event.confidence),
            evidence_message_ids: validIds(event.evidence_message_ids),
        }))
        .filter((event) => event.evidence_message_ids.length > 0);

    const explicitObjections = raw.explicit_objections
        .map((objection) => ({
            ...objection,
            confidence: clampConfidence(objection.confidence),
            evidence_message_ids: clientIds(objection.evidence_message_ids),
            resolution_message_ids: clinicIds(
                objection.resolution_message_ids,
            ),
        }))
        .filter((objection) => objection.evidence_message_ids.length > 0);

    const sentimentSignals = raw.sentiment_signals
        .map((signal) => ({
            ...signal,
            confidence: clampConfidence(signal.confidence),
            evidence_message_ids: clientIds(signal.evidence_message_ids),
        }))
        .filter((signal) => signal.evidence_message_ids.length > 0);

    const routingEvidence = validIds(raw.routing.evidence_message_ids);
    const finalEvidence = validIds(raw.final_exchange.evidence_message_ids);

    return {
        primary_goal: {
            ...raw.primary_goal,
            evidence_message_ids: primaryGoalEvidence,
        },
        requests,
        explicit_outcomes: dedupeLedgerEvents(explicitOutcomes),
        explicit_objections: explicitObjections,
        sentiment_signals: sentimentSignals,
        routing: {
            human_attendant_present: facts.human_attendant_present,
            handoff_to_human: raw.routing.handoff_to_human,
            handoff_to_unit: raw.routing.handoff_to_unit,
            out_of_hours_notice: raw.routing.out_of_hours_notice,
            evidence_message_ids: routingEvidence,
        },
        final_exchange: {
            ...raw.final_exchange,
            last_meaningful_client_message_id: validSenderId(
                raw.final_exchange.last_meaningful_client_message_id,
                "client",
                messageById,
            ),
            last_meaningful_clinic_message_id: validClinicId(
                raw.final_exchange.last_meaningful_clinic_message_id,
                messageById,
            ),
            evidence_message_ids: finalEvidence,
        },
    };
}

function validateAndNormalize(
    input: AnalyzeConversationInput,
    messages: AnalyzeConversationMessage[],
    raw: ParsedAnalysis,
): ConversationAnalysis {
    const messageById = new Map(messages.map((message) => [message.id, message]));
    const validEvidence = (ids: string[], field: string) => {
        const unique = Array.from(new Set(ids));
        const unknown = unique.filter((id) => !messageById.has(id));
        if (unknown.length > 0) {
            throw new Error(
                `${field} references unknown message IDs: ${unknown.join(", ")}`,
            );
        }
        return unique;
    };

    const outcomeEvents = raw.outcome_events.map((event, index) => {
        const evidence = validEvidence(
            event.evidence_message_ids,
            `outcome_events[${index}]`,
        );
        if (evidence.length === 0) {
            throw new Error(`outcome_events[${index}] has no evidence`);
        }
        return {
            ...event,
            occurred_at: canonicalEventTime(
                evidence,
                messageById,
                event.occurred_at,
            ),
            confidence: clampConfidence(event.confidence),
            evidence_message_ids: evidence,
        };
    });

    const objections = raw.objections.map((objection, index) => {
        const evidence = validEvidence(
            objection.evidence_message_ids,
            `objections[${index}]`,
        );
        if (evidence.length === 0) {
            throw new Error(`objections[${index}] has no evidence`);
        }
        return {
            ...objection,
            confidence: clampConfidence(objection.confidence),
            evidence_message_ids: evidence,
        };
    });

    const dropoffEvidence = validEvidence(
        raw.dropoff.evidence_message_ids,
        "dropoff",
    );
    if (
        !raw.dropoff.happened &&
        (raw.dropoff.moment !== null ||
            raw.dropoff.likely_reason !== null ||
            dropoffEvidence.length > 0)
    ) {
        throw new Error(
            "dropoff=false must not contain a moment, reason, or evidence",
        );
    }
    if (raw.dropoff.happened && raw.dropoff.moment === null) {
        throw new Error("dropoff=true requires a moment");
    }
    if (raw.dropoff.happened && dropoffEvidence.length === 0) {
        throw new Error("dropoff=true requires evidence");
    }

    const sentimentEvidence = validEvidence(
        raw.sentiment.evidence_message_ids,
        "sentiment",
    );
    if (
        raw.sentiment.satisfaction_score !== null &&
        sentimentEvidence.length === 0
    ) {
        throw new Error("A satisfaction score requires direct evidence");
    }

    const timing = responseTiming(messages);
    const hasAttendant = messages.some(
        (message) => message.sender_type === "attendant",
    );
    const qualityEvidence = validEvidence(
        raw.attendant_quality.evidence_message_ids,
        "attendant_quality",
    );
    const quality: ConversationAnalysis["attendant_quality"] = hasAttendant
        ? {
              clarity_score: raw.attendant_quality.clarity_score ?? null,
              empathy_score: raw.attendant_quality.empathy_score ?? null,
              proactivity_score:
                  raw.attendant_quality.proactivity_score ?? null,
              objection_handling_score:
                  objections.length > 0
                      ? raw.attendant_quality.objection_handling_score ?? null
                      : null,
              response_speed_score:
                  timing.first_human_response_time_seconds !== null
                      ? raw.attendant_quality.response_speed_score ?? null
                      : null,
              overall_score: raw.attendant_quality.overall_score ?? null,
              evidence_message_ids: qualityEvidence,
          }
        : emptyQuality();

    if (hasAnyScore(quality) && quality.evidence_message_ids.length === 0) {
        throw new Error("Attendant quality scores require evidence");
    }

    const resolutionEvidence = validEvidence(
        raw.resolution.evidence_message_ids,
        "resolution",
    );
    if (
        raw.resolution.resolution_score !== null &&
        resolutionEvidence.length === 0
    ) {
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
            likely_reason: raw.dropoff.happened
                ? clean(raw.dropoff.likely_reason)
                : null,
            confidence: raw.dropoff.happened
                ? clampConfidence(raw.dropoff.confidence)
                : 0,
            evidence_message_ids: raw.dropoff.happened
                ? dropoffEvidence
                : [],
        },
        objections,
        sentiment: {
            customer_sentiment: raw.sentiment.customer_sentiment,
            satisfaction_score: nullableScore(
                raw.sentiment.satisfaction_score,
            ),
            confidence: clampConfidence(raw.sentiment.confidence),
            evidence_message_ids: sentimentEvidence,
        },
        attendant_quality: normalizeQuality(quality),
        response_timing: timing,
        resolution: {
            resolved:
                raw.resolution.resolved === "true"
                    ? true
                    : raw.resolution.resolved === "false"
                      ? false
                      : "partial",
            resolution_score: nullableScore(
                raw.resolution.resolution_score,
            ),
            reasoning_category: raw.resolution.reasoning_category,
            evidence_message_ids: resolutionEvidence,
        },
        short_label: raw.short_label.trim(),
        notable: raw.notable,
        notable_reason: raw.notable ? clean(raw.notable_reason) : null,
        analysis_provider: "groq",
        analysis_model: GROQ_MODEL,
        analysis_prompt_version: PROMPT_VERSION,
        analysis_message_count: messages.length,
    };
}

function findConsistencyIssues(
    analysis: ConversationAnalysis,
    ledger: EvidenceLedger,
    facts: DeterministicFacts,
) {
    const issues = new Set<string>();
    const eventTypes = new Set(
        analysis.outcome_events.map((event) => event.type),
    );
    const primaryUnanswered = isPrimaryGoalUnanswered(ledger);
    const primaryPartiallyAnswered = isPrimaryGoalPartiallyAnswered(ledger);

    if (
        analysis.goal_status === "achieved" &&
        analysis.resolution.resolved !== true
    ) {
        issues.add("goal_status=achieved conflicts with resolution");
    }
    if (
        analysis.goal_status === "not_achieved" &&
        analysis.resolution.resolved !== false
    ) {
        issues.add("goal_status=not_achieved conflicts with resolution");
    }
    if (
        analysis.goal_status === "partially_achieved" &&
        analysis.resolution.resolved !== "partial"
    ) {
        issues.add("goal_status=partially_achieved conflicts with resolution");
    }

    if (primaryUnanswered) {
        if (analysis.goal_status === "achieved") {
            issues.add("primary request is unanswered but goal is achieved");
        }
        if (analysis.resolution.resolved === true) {
            issues.add("primary request is unanswered but resolution is true");
        }
        if ((analysis.resolution.resolution_score ?? 0) > 25) {
            issues.add("unanswered primary request has a positive resolution score");
        }
        if (eventTypes.has("information_answered")) {
            issues.add("unanswered primary request has information_answered event");
        }
        if (analysis.customer_final_state === "received_information") {
            issues.add("unanswered primary request ends as received_information");
        }
    }

    if (
        primaryPartiallyAnswered &&
        analysis.resolution.resolved === true
    ) {
        issues.add("partially answered primary request marked fully resolved");
    }

    if (!facts.human_attendant_present) {
        if (hasAnyScore(analysis.attendant_quality)) {
            issues.add("bot-only conversation has attendant quality scores");
        }
        if (
            analysis.response_timing.first_human_response_time_seconds !== null ||
            analysis.response_timing.average_human_response_time_seconds !== null ||
            analysis.response_timing.longest_human_delay_seconds !== null
        ) {
            issues.add("bot-only conversation has human response timing");
        }
    }

    if (
        ledger.explicit_objections.length === 0 &&
        analysis.objections.length > 0
    ) {
        issues.add("analysis invented an objection absent from evidence ledger");
    }

    if (
        !ledger.sentiment_signals.some(
            (signal) => signal.supports_satisfaction_score,
        ) &&
        analysis.sentiment.satisfaction_score !== null
    ) {
        issues.add("satisfaction score lacks client sentiment evidence");
    }

    const ledgerDropoff = ledger.explicit_outcomes.some(
        (event) => event.type === "customer_stopped_responding",
    );
    if (analysis.dropoff.happened && !ledgerDropoff) {
        issues.add("dropoff was asserted without ledger evidence");
    }

    if (
        analysis.customer_final_state === "scheduled" &&
        !eventTypes.has("appointment_scheduled")
    ) {
        issues.add("scheduled final state lacks appointment_scheduled event");
    }
    if (
        analysis.customer_final_state === "rescheduled" &&
        !eventTypes.has("appointment_rescheduled")
    ) {
        issues.add("rescheduled final state lacks appointment_rescheduled event");
    }
    if (
        analysis.customer_final_state === "confirmed_attendance" &&
        !eventTypes.has("attendance_confirmed")
    ) {
        issues.add("confirmed final state lacks attendance_confirmed event");
    }

    if (
        primaryUnanswered &&
        (ledger.routing.handoff_to_human || ledger.routing.handoff_to_unit) &&
        analysis.customer_final_state !== "redirected"
    ) {
        issues.add("unanswered routed conversation should end as redirected");
    }

    return Array.from(issues);
}

function applyEvidenceGuardrails(
    analysis: ConversationAnalysis,
    ledger: EvidenceLedger,
    facts: DeterministicFacts,
    messages: AnalyzeConversationMessage[],
): ConversationAnalysis {
    const result: ConversationAnalysis = structuredClone(analysis);
    const primaryUnanswered = isPrimaryGoalUnanswered(ledger);
    const primaryPartiallyAnswered = isPrimaryGoalPartiallyAnswered(ledger);
    const resolutionEvidence = uniqueIds([
        ...ledger.primary_goal.evidence_message_ids,
        ...ledger.final_exchange.evidence_message_ids,
        ...ledger.routing.evidence_message_ids,
    ]);

    result.conversation_goal = ledger.primary_goal.category;
    if (result.customer_start_intent === "other") {
        result.customer_start_intent = ledger.primary_goal.category;
    }

    result.outcome_events = mergeLedgerEvents(
        result.outcome_events,
        ledger,
        messages,
    );

    if (!facts.human_attendant_present) {
        result.attendant_quality = emptyQuality();
        result.response_timing = {
            first_human_response_time_seconds: null,
            average_human_response_time_seconds: null,
            longest_human_delay_seconds: null,
        };
    }

    result.objections = result.objections.filter((objection) =>
        ledger.explicit_objections.some(
            (ledgerObjection) =>
                ledgerObjection.type === objection.type &&
                hasIdOverlap(
                    ledgerObjection.evidence_message_ids,
                    objection.evidence_message_ids,
                ),
        ),
    );
    if (result.objections.length === 0) {
        result.outcome_events = result.outcome_events.filter(
            (event) => event.type !== "objection_raised",
        );
    }

    if (
        !ledger.sentiment_signals.some(
            (signal) => signal.supports_satisfaction_score,
        )
    ) {
        result.sentiment.satisfaction_score = null;
        if (result.sentiment.evidence_message_ids.length === 0) {
            result.sentiment.customer_sentiment = "neutral";
            result.sentiment.confidence = 0;
        }
    }

    const ledgerDropoff = ledger.explicit_outcomes.some(
        (event) => event.type === "customer_stopped_responding",
    );
    if (!ledgerDropoff) {
        result.dropoff = {
            happened: false,
            moment: null,
            likely_reason: null,
            confidence: 0,
            evidence_message_ids: [],
        };
        result.outcome_events = result.outcome_events.filter(
            (event) => event.type !== "customer_stopped_responding",
        );
        if (result.customer_final_state === "stopped_responding") {
            result.customer_final_state =
                ledger.routing.handoff_to_human || ledger.routing.handoff_to_unit
                    ? "redirected"
                    : "unclear";
        }
    }

    if (primaryUnanswered) {
        result.goal_status = "not_achieved";
        result.resolution = {
            resolved: false,
            resolution_score: 0,
            reasoning_category: "attendant_failed_to_answer",
            evidence_message_ids: resolutionEvidence,
        };
        result.outcome_events = result.outcome_events.filter(
            (event) => event.type !== "information_answered",
        );
        if (ledger.routing.handoff_to_human || ledger.routing.handoff_to_unit) {
            result.customer_final_state = "redirected";
        } else if (result.customer_final_state === "received_information") {
            result.customer_final_state = "unclear";
        }
    } else if (primaryPartiallyAnswered) {
        if (result.goal_status === "achieved") {
            result.goal_status = "partially_achieved";
        }
        if (result.resolution.resolved === true) {
            result.resolution.resolved = "partial";
        }
        if (
            result.resolution.resolution_score === null ||
            result.resolution.resolution_score > 75
        ) {
            result.resolution.resolution_score = 50;
        }
        if (result.resolution.evidence_message_ids.length === 0) {
            result.resolution.evidence_message_ids = resolutionEvidence;
        }
    }

    if (result.goal_status === "achieved") {
        result.resolution.resolved = true;
    } else if (result.goal_status === "not_achieved") {
        result.resolution.resolved = false;
    } else if (result.goal_status === "partially_achieved") {
        result.resolution.resolved = "partial";
    }

    result.notable_reason = result.notable
        ? clean(result.notable_reason)
        : null;
    result.analysis_provider = "groq";
    result.analysis_model = GROQ_MODEL;
    result.analysis_prompt_version = PROMPT_VERSION;
    result.analysis_message_count = messages.length;

    return result;
}

function mergeLedgerEvents(
    analysisEvents: ConversationAnalysis["outcome_events"],
    ledger: EvidenceLedger,
    messages: AnalyzeConversationMessage[],
) {
    const messageById = new Map(messages.map((message) => [message.id, message]));
    const events = [...analysisEvents];

    if (
        ledger.primary_goal.evidence_message_ids.length > 0 &&
        (ledger.primary_goal.category === "answer_information" ||
            ledger.primary_goal.category === "explain_treatment") &&
        !events.some((event) => event.type === "information_requested")
    ) {
        events.push({
            type: "information_requested",
            occurred_at: canonicalEventTime(
                ledger.primary_goal.evidence_message_ids,
                messageById,
                null,
            ),
            confidence: 1,
            evidence_message_ids: ledger.primary_goal.evidence_message_ids,
        });
    }

    for (const ledgerEvent of ledger.explicit_outcomes) {
        const alreadyPresent = events.some(
            (event) =>
                event.type === ledgerEvent.type &&
                hasIdOverlap(
                    event.evidence_message_ids,
                    ledgerEvent.evidence_message_ids,
                ),
        );
        if (alreadyPresent) continue;

        events.push({
            type: ledgerEvent.type,
            occurred_at: canonicalEventTime(
                ledgerEvent.evidence_message_ids,
                messageById,
                null,
            ),
            confidence: ledgerEvent.confidence,
            evidence_message_ids: ledgerEvent.evidence_message_ids,
        });
    }

    if (
        ledger.routing.handoff_to_human &&
        ledger.routing.evidence_message_ids.length > 0 &&
        !events.some((event) => event.type === "handoff_to_human")
    ) {
        events.push({
            type: "handoff_to_human",
            occurred_at: canonicalEventTime(
                ledger.routing.evidence_message_ids,
                messageById,
                null,
            ),
            confidence: 1,
            evidence_message_ids: ledger.routing.evidence_message_ids,
        });
    }

    if (
        ledger.routing.handoff_to_unit &&
        ledger.routing.evidence_message_ids.length > 0 &&
        !events.some((event) => event.type === "handoff_to_unit")
    ) {
        events.push({
            type: "handoff_to_unit",
            occurred_at: canonicalEventTime(
                ledger.routing.evidence_message_ids,
                messageById,
                null,
            ),
            confidence: 1,
            evidence_message_ids: ledger.routing.evidence_message_ids,
        });
    }

    return dedupeEvents(events);
}

function deterministicFacts(
    messages: AnalyzeConversationMessage[],
): DeterministicFacts {
    const first = messages[0];
    const last = messages[messages.length - 1];
    return {
        human_attendant_present: messages.some(
            (message) => message.sender_type === "attendant",
        ),
        bot_present: messages.some(
            (message) => message.sender_type === "bot",
        ),
        client_message_count: messages.filter(
            (message) => message.sender_type === "client",
        ).length,
        attendant_message_count: messages.filter(
            (message) => message.sender_type === "attendant",
        ).length,
        bot_message_count: messages.filter(
            (message) => message.sender_type === "bot",
        ).length,
        first_sender_type: first.sender_type,
        last_sender_type: last.sender_type,
    };
}

function prepareMessages(messages: AnalyzeConversationMessage[]) {
    return [...messages]
        .sort(
            (a, b) =>
                Date.parse(a.sent_at) - Date.parse(b.sent_at) ||
                a.sequence_index - b.sequence_index ||
                a.id.localeCompare(b.id),
        )
        .map((message) => ({
            ...message,
            sender_name: normalizeText(message.sender_name ?? "") || null,
            text: normalizeText(message.text),
        }));
}

function normalizeText(value: string) {
    return String(value ?? "")
        .normalize("NFKC")
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
        .replace(/\uFFFD/g, "")
        .replace(/[\t\r]+/g, " ")
        .replace(/ {2,}/g, " ")
        .trim();
}

function responseTiming(messages: AnalyzeConversationMessage[]) {
    const delays: number[] = [];
    let pendingClientAt: number | null = null;

    for (const message of messages) {
        const time = Date.parse(message.sent_at);
        if (!Number.isFinite(time)) continue;

        if (message.sender_type === "client") pendingClientAt ??= time;
        if (
            message.sender_type === "attendant" &&
            pendingClientAt !== null
        ) {
            delays.push(
                Math.max(0, Math.round((time - pendingClientAt) / 1000)),
            );
            pendingClientAt = null;
        }
    }

    if (delays.length === 0) {
        return {
            first_human_response_time_seconds: null,
            average_human_response_time_seconds: null,
            longest_human_delay_seconds: null,
        };
    }

    return {
        first_human_response_time_seconds: delays[0],
        average_human_response_time_seconds: Math.round(
            delays.reduce((sum, value) => sum + value, 0) / delays.length,
        ),
        longest_human_delay_seconds: Math.max(...delays),
    };
}

function isPrimaryGoalUnanswered(ledger: EvidenceLedger) {
    if (ledger.final_exchange.primary_goal_answered) return false;
    if (
        ledger.explicit_outcomes.some((event) =>
            [
                "information_answered",
                "appointment_scheduled",
                "appointment_rescheduled",
                "attendance_confirmed",
            ].includes(event.type),
        )
    ) {
        return false;
    }
    const relevantRequests = ledger.requests.filter((request) =>
        hasIdOverlap(
            request.request_message_ids,
            ledger.primary_goal.evidence_message_ids,
        ),
    );
    const requests = relevantRequests.length > 0 ? relevantRequests : ledger.requests;
    return (
        requests.length === 0 ||
        requests.every(
            (request) =>
                request.status === "unanswered" ||
                request.status === "unclear",
        )
    );
}

function isPrimaryGoalPartiallyAnswered(ledger: EvidenceLedger) {
    if (ledger.final_exchange.primary_goal_answered) return false;
    return ledger.requests.some(
        (request) => request.status === "partially_answered",
    );
}

function emptyQuality(): ConversationAnalysis["attendant_quality"] {
    return {
        clarity_score: null,
        empathy_score: null,
        proactivity_score: null,
        objection_handling_score: null,
        response_speed_score: null,
        overall_score: null,
        evidence_message_ids: [],
    };
}

function normalizeQuality(
    value: ConversationAnalysis["attendant_quality"],
) {
    return {
        ...value,
        clarity_score: nullableScore(value.clarity_score),
        empathy_score: nullableScore(value.empathy_score),
        proactivity_score: nullableScore(value.proactivity_score),
        objection_handling_score: nullableScore(
            value.objection_handling_score,
        ),
        response_speed_score: nullableScore(value.response_speed_score),
        overall_score: nullableScore(value.overall_score),
    };
}

function hasAnyScore(value: ConversationAnalysis["attendant_quality"]) {
    return [
        value.clarity_score,
        value.empathy_score,
        value.proactivity_score,
        value.objection_handling_score,
        value.response_speed_score,
        value.overall_score,
    ].some((item) => typeof item === "number");
}

function canonicalEventTime(
    ids: string[],
    messages: Map<string, AnalyzeConversationMessage>,
    proposed: string | null,
) {
    const times = ids
        .map((id) => messages.get(id)?.sent_at)
        .filter((value): value is string => Boolean(value));
    if (times.length === 0) return proposed;
    return times.sort((a, b) => Date.parse(a) - Date.parse(b))[
        times.length - 1
    ];
}

function validSenderId(
    id: string | null,
    sender: AnalyzeConversationMessage["sender_type"],
    messageById: Map<string, AnalyzeConversationMessage>,
) {
    if (!id) return null;
    return messageById.get(id)?.sender_type === sender ? id : null;
}

function validClinicId(
    id: string | null,
    messageById: Map<string, AnalyzeConversationMessage>,
) {
    if (!id) return null;
    const sender = messageById.get(id)?.sender_type;
    return sender === "attendant" || sender === "bot" ? id : null;
}

function dedupeEvents<T extends {
    type: string;
    occurred_at: string | null;
    evidence_message_ids: string[];
}>(events: T[]) {
    const seen = new Set<string>();
    return events.filter((event) => {
        const ids = [...event.evidence_message_ids].sort();
        const key = `${event.type}:${event.occurred_at ?? ""}:${ids.join(",")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function dedupeLedgerEvents<T extends {
    type: string;
    evidence_message_ids: string[];
}>(events: T[]) {
    const seen = new Set<string>();
    return events.filter((event) => {
        const key = `${event.type}:${[...event.evidence_message_ids]
            .sort()
            .join(",")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function metadata(input: AnalyzeConversationInput) {
    return {
        conversation_id: input.conversation_id,
        client_id: input.client_id,
        started_at: input.started_at,
        ended_at: input.ended_at,
        attendant_id: input.attendant_id,
        unit_id: input.unit_id,
        service_id: input.service_id,
    };
}

function hasIdOverlap(left: string[], right: string[]) {
    const rightSet = new Set(right);
    return left.some((id) => rightSet.has(id));
}

function uniqueIds(ids: string[]) {
    return Array.from(new Set(ids));
}

function nullableScore(value: number | null) {
    return value === null
        ? null
        : Math.max(0, Math.min(100, Math.round(value)));
}

function clampConfidence(value: number) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function clean(value: string | null | undefined) {
    const text = String(value ?? "").trim();
    return text || null;
}

function extractJson(content: string) {
    const stripped = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end < start) {
        throw new Error("AI response does not contain JSON");
    }
    return stripped.slice(start, end + 1);
}

function truncate(value: string, length: number) {
    return value.length <= length ? value : `${value.slice(0, length)}…`;
}

function formatError(error: unknown) {
    if (error instanceof Error) return error.message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}
