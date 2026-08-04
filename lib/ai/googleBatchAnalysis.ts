// lib/ai/googleBatchAnalysis.ts
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

import { supabase } from "@/lib";
import { saveConversationAnalysis } from "@/lib/analysis/saveConversationAnalysis";
import { deriveAdEventsFromAnalysis } from "@/lib/ads/deriveAdEventsFromAnalysis";
import { sendMetaEvents } from "@/lib/ads/meta/sendMetaEvents";
import { sendGoogleEvents } from "@/lib/ads/google/sendGoogleEvents";
import { conversationAnalysisSchema } from "@/lib/ai/conversationAnalysisSchema";
import { getConversationEffectiveEndMessage } from "@/lib/conversations/conversationEffectiveEnd";
import {
    filterAnalyzableMessages,
    getConversationAnalysisIneligibility,
} from "@/lib/analysis/conversationEligibility";
import type {
    AnalyzeConversationInput,
    Conversation,
    ConversationAnalysis,
    Message,
} from "@/types";

const MODEL_ID = "openai/gpt-oss-120b-maas";
const MODEL_RESOURCE = "publishers/openai/models/gpt-oss-120b-maas";
const JOB_PREFIX = "engravida-analysis";
const INPUT_PREFIX = "engravida/analysis/input";
const OUTPUT_PREFIX = "engravida/analysis/output";
const PROCESSED_PREFIX = "engravida/analysis/processed";
const PAGE_SIZE = 1_000;
const MIN_RECORDS_PER_JOB = 100;
const MAX_RECORDS_PER_JOB = 100_000;
const DEFAULT_MAX_RECORDS = 100_000;
const DEFAULT_MAX_COMPLETION_TOKENS = 4_500;
const CANDIDATE_SCAN_MULTIPLIER = 10;
const MAX_ANALYSIS_FAILURES = 3;
const GOOGLE_CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

const ANALYSIS_JSON_SCHEMA = z.toJSONSchema(conversationAnalysisSchema, {
    target: "draft-2020-12",
    unrepresentable: "any",
});

type BatchJobSummary = {
    name: string;
    displayName: string;
    state: string;
    error?: {
        code?: number;
        message?: string;
    };
    createTime?: string;
    updateTime?: string;
    completionStats?: {
        successfulCount?: string | number;
        failedCount?: string | number;
        incompleteCount?: string | number;
    };
    inputConfig?: {
        gcsSource?: { uris?: string[] };
    };
    outputConfig?: {
        gcsDestination?: { outputUriPrefix?: string };
    };
    outputInfo?: {
        gcsOutputDirectory?: string;
    };
};

type BatchOutputLine = {
    custom_id?: string;
    customId?: string;
    status?: string;
    error?: unknown;
    body?: unknown;
    instance?: unknown;
    request?: unknown;
    response?: unknown;
    prediction?: unknown;
    predictions?: unknown[];
};

type GoogleServiceAccountCredentials = {
    client_email: string;
    private_key: string;
    project_id?: string;
};

type AnalysisPlatform = "whatsapp" | "instagram";

let googleAuth: GoogleAuth | null = null;
let googleCredentials: GoogleServiceAccountCredentials | null = null;

export async function runGoogleBatchAnalysis({
    limit = DEFAULT_MAX_RECORDS,
    platform = "whatsapp",
    beforeSubmit,
}: {
    limit?: number;
    platform?: AnalysisPlatform;
    beforeSubmit?: (conversationIds: string[]) => Promise<unknown>;
} = {}) {
    const jobs = await listOurJobs();
    const collected = await collectFinishedJobs(jobs);
    const activeJobs = jobs
        .filter((job) => !isTerminalJob(job.state))
        .map(summarizeJob);

    if (!batchEnabled()) {
        return {
            provider: "google-vertex-batch",
            model: MODEL_ID,
            platform,
            collected,
            active_jobs: activeJobs,
            origin_map_attribution: null,
            submitted: {
                submitted: false,
                records: 0,
                reason: "disabled_by_environment",
            },
        };
    }

    const submitted = await submitPendingBatch(
        Math.min(normalizeRequestedLimit(limit), configuredMaxRecords()),
        platform,
        beforeSubmit,
    );
    const originMapAttribution =
        "origin_map_attribution" in submitted
            ? submitted.origin_map_attribution
            : null;

    return {
        provider: "google-vertex-batch",
        model: MODEL_ID,
        platform,
        collected,
        active_jobs: activeJobs,
        origin_map_attribution: originMapAttribution,
        submitted,
    };
}

async function collectFinishedJobs(jobs: BatchJobSummary[]) {
    const finished = jobs.filter((job) => isTerminalJob(job.state));

    const results: Array<Record<string, unknown>> = [];

    for (const job of finished) {
        const jobId = job.name.split("/").at(-1) ?? job.displayName;
        const markerKey = `${PROCESSED_PREFIX}/${jobId}.json`;
        if (await gcsExists(markerKey)) continue;

        if (
            [
                "JOB_STATE_FAILED",
                "JOB_STATE_CANCELLED",
                "JOB_STATE_EXPIRED",
                "JOB_STATE_PAUSED",
            ].includes(job.state)
        ) {
            const restored = await restoreJobRecords(
                job,
                job.error?.message ?? job.state,
            );
            await putGcsJson(markerKey, {
                job_name: job.name,
                status: job.state,
                restored,
                processed_at: new Date().toISOString(),
            });
            await cleanupJobObjects(job);
            results.push({
                job_name: job.displayName,
                status: job.state,
                restored,
            });
            continue;
        }

        const outputUri =
            job.outputInfo?.gcsOutputDirectory ??
            job.outputConfig?.gcsDestination?.outputUriPrefix;
        if (!outputUri) {
            results.push({
                job_name: job.displayName,
                status: job.state,
                error: "Batch job has no Cloud Storage output URI",
            });
            continue;
        }

        const { bucket, key: outputPrefix } = parseGcsUri(outputUri);
        ensureConfiguredBucket(bucket);
        const allOutputKeys = await listGcsObjects(outputPrefix);
        const outputKeys = allOutputKeys.filter(isBatchOutputObject);
        if (outputKeys.length === 0) {
            results.push({
                job_name: job.displayName,
                status: job.state,
                error: "Completed job output is not visible in Cloud Storage yet",
            });
            continue;
        }

        let succeeded = 0;
        let failed = 0;
        let ineligible = 0;
        let retryScheduled = 0;
        let retryExhausted = 0;
        let alreadyCompleted = 0;
        let retryLimitSkipped = 0;
        let stateConflicts = 0;
        const seenRecordIds = new Set<string>();
        const expectedRecordIds = await getJobRecordIds(job);

        const countFailure = (outcome: FailureRecordingOutcome) => {
            if (outcome.kind === "retry_scheduled") {
                failed += 1;
                retryScheduled += 1;
                return;
            }
            if (outcome.kind === "retry_exhausted") {
                failed += 1;
                retryExhausted += 1;
                return;
            }
            if (outcome.kind === "already_completed") {
                alreadyCompleted += 1;
                return;
            }
            if (outcome.kind === "retry_limit_reached") {
                retryLimitSkipped += 1;
                return;
            }
            stateConflicts += 1;
        };

        for (const key of outputKeys) {
            const text = await getGcsText(key);
            for (const rawLine of text.split(/\r?\n/)) {
                const line = rawLine.trim();
                if (!line) continue;

                let conversationId: string | null = null;
                try {
                    const record = JSON.parse(line) as BatchOutputLine;
                    const content = extractBatchContent(record);
                    conversationId = getBatchRecordId(record, content);
                    if (!conversationId) {
                        throw new Error(
                            "Missing conversation ID in Google batch output",
                        );
                    }
                    if (!expectedRecordIds.has(conversationId)) {
                        throw new Error(
                            `Google batch returned unexpected conversation ID ${conversationId}`,
                        );
                    }
                    seenRecordIds.add(conversationId);

                    const recordError = getBatchRecordError(record);
                    if (recordError) {
                        countFailure(
                            await recordConversationAnalysisFailure(
                                conversationId,
                                `Google batch record failed: ${recordError}`,
                            ),
                        );
                        continue;
                    }

                    if (!content) {
                        throw new Error(
                            "Google batch record returned no message content",
                        );
                    }

                    const result = await persistCompletedAnalysis(conversationId, content);
                    if (result === "saved") succeeded += 1;
                    else if (result === "ineligible") ineligible += 1;
                    else if (result === "already_completed") alreadyCompleted += 1;
                    else if (result === "retry_limit_reached") retryLimitSkipped += 1;
                    else stateConflicts += 1;
                } catch (error) {
                    if (conversationId) {
                        countFailure(
                            await recordConversationAnalysisFailure(
                                conversationId,
                                `Failed to import Google batch result: ${formatError(error)}`,
                            ),
                        );
                    } else {
                        failed += 1;
                    }
                    console.error("[google-batch] failed to import output record", {
                        job_name: job.displayName,
                        output_key: key,
                        conversation_id: conversationId,
                        error: formatError(error),
                    });
                }
            }
        }

        const missing = await restoreMissingJobRecords(
            job,
            seenRecordIds,
            `Google batch job ${job.state} did not return an output record`,
        );
        failed += missing;

        const summary = {
            status: job.state,
            succeeded,
            failed,
            ineligible,
            retry_scheduled: retryScheduled,
            retry_exhausted: retryExhausted,
            already_completed: alreadyCompleted,
            retry_limit_skipped: retryLimitSkipped,
            state_conflicts: stateConflicts,
            missing_restored: missing,
        };

        await putGcsJson(markerKey, {
            job_name: job.name,
            ...summary,
            processed_at: new Date().toISOString(),
        });
        await cleanupJobObjects(job, allOutputKeys);
        results.push({
            job_name: job.displayName,
            ...summary,
        });
    }

    return results;
}

async function submitPendingBatch(
    limit: number,
    platform: AnalysisPlatform,
    beforeSubmit?: (conversationIds: string[]) => Promise<unknown>,
) {
    const candidateLimit = Math.min(
        MAX_RECORDS_PER_JOB,
        Math.max(limit, limit * CANDIDATE_SCAN_MULTIPLIER),
    );
    const pending = await getPendingConversations(candidateLimit, platform);
    if (pending.length === 0) {
        return { submitted: false, records: 0, reason: "no_pending_conversations" };
    }

    const records: string[] = [];
    const claimedIds: string[] = [];
    let ineligible = 0;

    for (const conversation of pending) {
        if (records.length >= limit) break;

        const claimed = await claimConversation(conversation.id);
        if (!claimed) continue;

        try {
            const input = await buildAnalysisInput(conversation);
            records.push(
                JSON.stringify({
                    custom_id: conversation.id,
                    method: "POST",
                    url: "/v1/chat/completions",
                    body: buildModelInput(input),
                }),
            );
            claimedIds.push(conversation.id);
        } catch (error) {
            if (error instanceof IneligibleConversationError) {
                await markConversationIneligible(conversation.id, error.message);
                ineligible += 1;
            } else {
                await restoreConversation(conversation.id, formatError(error));
            }
        }
    }

    if (records.length === 0) {
        return {
            submitted: false,
            records: 0,
            ineligible,
            reason: ineligible > 0 ? "nothing_eligible" : "nothing_claimed",
        };
    }

    if (records.length < MIN_RECORDS_PER_JOB) {
        await Promise.all(
            claimedIds.map((conversationId) =>
                restoreConversation(
                    conversationId,
                    `Waiting for at least ${MIN_RECORDS_PER_JOB} conversations before submitting a Google batch`,
                ),
            ),
        );

        return {
            submitted: false,
            records: records.length,
            ineligible,
            minimum_records: MIN_RECORDS_PER_JOB,
            reason: "waiting_for_minimum_batch_size_after_eligibility",
        };
    }

    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const random = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const jobName = `${JOB_PREFIX}-${platform}-${stamp}-${random}`.slice(0, 63);
    const inputKey = `${INPUT_PREFIX}/${jobName}/input.jsonl`;
    const outputPrefix = `${OUTPUT_PREFIX}/${jobName}`;

    try {
        // Attribution must run against the exact conversations already claimed
        // and proven eligible for this batch. If it fails, the catch below
        // restores every claim and no Google batch is submitted.
        const originMapAttribution = beforeSubmit
            ? await beforeSubmit([...claimedIds])
            : null;

        await putGcsText(inputKey, `${records.join("\n")}\n`, "application/jsonl");
        const response = await createBatchPredictionJob({
            jobName,
            inputKey,
            outputPrefix,
        });

        return {
            submitted: true,
            platform,
            records: records.length,
            ineligible,
            origin_map_attribution: originMapAttribution,
            job_name: jobName,
            job_resource: response.name,
            input: `gs://${bucketName()}/${inputKey}`,
            output: `gs://${bucketName()}/${outputPrefix}`,
        };
    } catch (error) {
        await Promise.all(
            claimedIds.map((conversationId) =>
                restoreConversation(
                    conversationId,
                    `Failed to submit Google batch: ${formatError(error)}`,
                ),
            ),
        );
        await deleteGcsObject(inputKey).catch(() => undefined);
        throw error;
    }
}

function buildModelInput(input: AnalyzeConversationInput) {
    return {
        model: MODEL_ID,
        temperature: 0,
        reasoning_effort: "medium",
        max_tokens: configuredMaxCompletionTokens(),
        messages: [
            {
                role: "system",
                content: analysisSystemPrompt(),
            },
            {
                role: "user",
                content: JSON.stringify(
                    {
                        instruction:
                            "Analise integralmente a conversa e retorne somente JSON válido que corresponda exatamente a output_schema.",
                        output_schema: ANALYSIS_JSON_SCHEMA,
                        metadata: {
                            conversation_id: input.conversation_id,
                            client_id: input.client_id,
                            instagram_user_id: input.instagram_user_id ?? null,
                            started_at: input.started_at,
                            ended_at: input.ended_at,
                            attendant_id: input.attendant_id,
                            unit_id: input.unit_id,
                            service_id: input.service_id,
                        },
                        messages: input.messages,
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}

function analysisSystemPrompt() {
    return `Você analisa conversas completas de atendimento de uma clínica de fertilidade.

Retorne SOMENTE JSON estrito no output_schema fornecido. Antes de decidir, forme internamente um registro factual de evidências baseado exclusivamente nos message_ids existentes.

REGRAS ABSOLUTAS
- Leia a conversa inteira em ordem cronológica.
- Diferencie rigorosamente cliente, bot, atendente humano e sistema.
- Bot, triagem, menu, fila, transferência e aviso de horário não equivalem a atendimento humano nem resolução.
- Uma pergunta sobre preço não é objeção. Só marque objeção com resistência, preocupação, rejeição, impossibilidade ou hesitação explícita.
- Não confunda o fim do transcript com abandono. Marque stopped_responding/dropoff apenas quando a clínica avançou de forma substantiva, aguardava o cliente e ele não respondeu.
- Um pedido só está respondido quando a clínica responde diretamente ao conteúdo solicitado.
- Agendamento, reagendamento e confirmação exigem evidência explícita; não inferir pela mera oferta de horários.
- satisfaction_score só pode ser diferente de null quando o cliente avalia explicitamente ou inequivocamente o atendimento/resultado. Educação, agradecimento curto ou emoção geral não bastam.
- Pontuações do atendente devem ser null quando não houver atendente humano ou evidência suficiente.
- first_human_response_time_seconds mede da mensagem relevante do cliente até a primeira resposta humana substantiva; bot não conta.
- Use apenas message_ids existentes em evidence_message_ids.
- Preserve exatamente IDs e timestamps recebidos nos campos de metadados.
- short_label deve ser curto, factual e em português do Brasil.
- Não invente fatos ausentes. Em dúvida, use estados conservadores como unclear, null ou baixa confiança.`;
}

async function persistCompletedAnalysis(
    conversationId: string,
    rawContent: string,
): Promise<
    | "saved"
    | "ineligible"
    | "already_completed"
    | "retry_limit_reached"
    | "state_conflict"
> {
    const readiness = await ensureConversationReadyForBatchResult(conversationId);
    if (readiness.kind !== "ready") return readiness.kind;

    const conversation = await getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

    const messages = await getMessages(conversationId);
    const normalizedMessages = normalizeMessagesForAnalysis(messages);
    const ineligibleReason = getConversationAnalysisIneligibility(normalizedMessages);
    if (ineligibleReason) {
        await markConversationIneligible(conversationId, ineligibleReason);
        return "ineligible";
    }

    const content = extractJson(rawContent);
    const parsed = conversationAnalysisSchema.parse(JSON.parse(content));

    if (parsed.conversation_id !== conversationId) {
        throw new Error(
            `Google returned conversation_id ${parsed.conversation_id} for ${conversationId}`,
        );
    }
    if (parsed.client_id !== conversation.client_id) {
        throw new Error("Google returned a mismatched client_id");
    }
    if (parsed.instagram_user_id !== conversation.instagram_user_id) {
        throw new Error("Google returned a mismatched instagram_user_id");
    }

    const effectiveEnd = getConversationEffectiveEndMessage(normalizedMessages);
    const normalizedAnalysis: ConversationAnalysis = {
        ...parsed,
        conversation_id: conversationId,
        client_id: conversation.client_id,
        instagram_user_id: conversation.instagram_user_id,
        started_at: normalizedMessages[0]!.sent_at,
        ended_at: effectiveEnd.sent_at,
        attendant_id: conversation.attendant_id,
        unit_id: conversation.unit_id,
        service_id: conversation.service_id,
        resolution: {
            ...parsed.resolution,
            resolution_score: parsed.resolution.resolution_score ?? null,
            resolved:
                parsed.resolution.resolved === "true"
                    ? true
                    : parsed.resolution.resolved === "false"
                      ? false
                      : "partial",
        },
        analysis_provider: "google",
        analysis_model: MODEL_ID,
        analysis_prompt_version: "google-batch-single-pass-v1",
        analysis_message_count: normalizedMessages.length,
    };

    const analysis = applyDeterministicRefinements(
        normalizedAnalysis,
        normalizedMessages,
        effectiveEnd.sent_at,
    );

    const analysisId = await saveConversationAnalysis(analysis);
    const completion = await completeConversation(
        conversationId,
        String(analysisId),
        analysis.started_at,
        analysis.ended_at,
        String(normalizedMessages.at(-1)?.text ?? ""),
    );
    if (completion !== "saved") return completion;

    const events = deriveAdEventsFromAnalysis(analysis).filter(
        (event) => event.type === "lead",
    );
    await sendAdsSafely(conversation, analysis, events);
    return "saved";
}

async function buildAnalysisInput(
    conversation: Conversation,
): Promise<AnalyzeConversationInput> {
    const messages = await getMessages(conversation.id);
    const normalized = normalizeMessagesForAnalysis(messages);
    const ineligibleReason = getConversationAnalysisIneligibility(normalized);
    if (ineligibleReason) throw new IneligibleConversationError(ineligibleReason);

    const effectiveEnd = getConversationEffectiveEndMessage(normalized);

    return {
        conversation_id: conversation.id,
        client_id: conversation.client_id,
        instagram_user_id: conversation.instagram_user_id,
        started_at: normalized[0]!.sent_at,
        ended_at: effectiveEnd.sent_at,
        attendant_id: conversation.attendant_id,
        unit_id: conversation.unit_id,
        service_id: conversation.service_id,
        conversationText: normalized
            .map(
                (message) =>
                    `[${new Date(message.sent_at).toLocaleString("pt-BR")}] ${senderLabel(message)}: ${message.text}`,
            )
            .join("\n"),
        messages: normalized.map((message) => ({
            id: message.id,
            sender_type: message.sender_type,
            sender_name: message.sender_name,
            text: message.text,
            sent_at: message.sent_at,
            sequence_index: message.sequence_index,
        })),
    };
}

function normalizeMessagesForAnalysis(messages: Message[]) {
    return filterAnalyzableMessages(messages)
        .map((message) => ({
            ...message,
            sender_name: senderLabel(message),
        }));
}

class IneligibleConversationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "IneligibleConversationError";
    }
}

async function getPendingConversations(
    limit: number,
    platform: AnalysisPlatform,
) {
    const rows: Conversation[] = [];
    const channel = platform === "instagram" ? "Instagram" : "WhatsApp";

    for (let from = 0; rows.length < limit; from += PAGE_SIZE) {
        const to = Math.min(from + PAGE_SIZE - 1, limit - 1);
        const result = await supabase
            .from("conversations")
            .select("*")
            .eq("channel", channel)
            .is("conversation_analysis_id", null)
            .eq("analysis_status", "pending")
            .lt("analysis_failure_count", MAX_ANALYSIS_FAILURES)
            .not("ended_at", "is", null)
            .order("ended_at", { ascending: true })
            .range(from, to);

        if (result.error) {
            throw new Error(`Failed to fetch pending conversations: ${result.error.message}`);
        }

        const page = (result.data ?? []) as Conversation[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows.slice(0, limit);
}

async function getConversation(conversationId: string) {
    const result = await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    return (result.data ?? null) as Conversation | null;
}

async function getMessages(conversationId: string): Promise<Message[]> {
    const result = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true })
        .order("id", { ascending: true });
    if (result.error) throw new Error(`Failed to fetch messages: ${result.error.message}`);
    return (result.data ?? []) as Message[];
}

async function claimConversation(conversationId: string) {
    const result = await supabase.rpc("claim_conversation_for_analysis", {
        p_conversation_id: conversationId,
    });
    if (result.error) throw new Error(`Failed to claim conversation: ${result.error.message}`);
    return result.data === true;
}

type ConversationAnalysisState = {
    analysis_status: string;
    analysis_failure_count: number;
    conversation_analysis_id: string | null;
};

type BatchResultReadiness =
    | { kind: "ready" }
    | { kind: "already_completed" }
    | { kind: "retry_limit_reached" }
    | { kind: "state_conflict" };

type FailureRecordingOutcome =
    | { kind: "retry_scheduled"; failure_count: number }
    | { kind: "retry_exhausted"; failure_count: number }
    | { kind: "already_completed" }
    | { kind: "retry_limit_reached"; failure_count: number }
    | { kind: "state_conflict"; analysis_status: string };

async function completeConversation(
    conversationId: string,
    analysisId: string,
    startedAt: string,
    endedAt: string,
    lastText: string,
): Promise<"saved" | "already_completed" | "retry_limit_reached" | "state_conflict"> {
    const complete = async () => {
        const result = await supabase.rpc("complete_conversation_analysis", {
            p_conversation_id: conversationId,
            p_analysis_id: analysisId,
            p_started_at: startedAt,
            p_ended_at: endedAt,
            p_last_message_text: lastText,
        });
        if (result.error) {
            throw new Error(`Failed to complete analysis: ${result.error.message}`);
        }
        return result.data === true;
    };

    if (await complete()) return "saved";

    // A previous migration temporarily released old batch claims. If an old,
    // still-valid output reaches a pending conversation, reclaim it once and
    // complete normally. This does not bypass the retry limit.
    const readiness = await ensureConversationReadyForBatchResult(conversationId);
    if (readiness.kind !== "ready") return readiness.kind;
    if (await complete()) return "saved";

    const current = await getConversationAnalysisState(conversationId);
    if (isCompletedState(current)) return "already_completed";
    if (hasReachedRetryLimit(current)) return "retry_limit_reached";
    return "state_conflict";
}

async function ensureConversationReadyForBatchResult(
    conversationId: string,
): Promise<BatchResultReadiness> {
    let current = await getConversationAnalysisState(conversationId);
    if (!current) throw new Error(`Conversation not found: ${conversationId}`);

    if (isCompletedState(current)) return { kind: "already_completed" };
    if (current.analysis_status === "processing") return { kind: "ready" };
    if (hasReachedRetryLimit(current)) return { kind: "retry_limit_reached" };

    if (current.analysis_status === "pending") {
        if (await claimConversation(conversationId)) return { kind: "ready" };

        current = await getConversationAnalysisState(conversationId);
        if (!current) throw new Error(`Conversation not found: ${conversationId}`);
        if (isCompletedState(current)) return { kind: "already_completed" };
        if (current.analysis_status === "processing") return { kind: "ready" };
        if (hasReachedRetryLimit(current)) return { kind: "retry_limit_reached" };
    }

    console.warn("[google-batch] output could not acquire conversation state", {
        conversation_id: conversationId,
        analysis_status: current.analysis_status,
        analysis_failure_count: current.analysis_failure_count,
    });
    return { kind: "state_conflict" };
}

async function recordConversationAnalysisFailure(
    conversationId: string,
    reason: string,
): Promise<FailureRecordingOutcome> {
    const readiness = await ensureConversationReadyForBatchResult(conversationId);
    if (readiness.kind === "already_completed") {
        return { kind: "already_completed" };
    }
    if (readiness.kind === "retry_limit_reached") {
        const current = await getConversationAnalysisState(conversationId);
        return {
            kind: "retry_limit_reached",
            failure_count: current?.analysis_failure_count ?? MAX_ANALYSIS_FAILURES,
        };
    }
    if (readiness.kind === "state_conflict") {
        const current = await getConversationAnalysisState(conversationId);
        return {
            kind: "state_conflict",
            analysis_status: current?.analysis_status ?? "missing",
        };
    }

    const result = await supabase.rpc("record_conversation_analysis_failure", {
        p_conversation_id: conversationId,
        p_error: reason,
        p_max_failures: MAX_ANALYSIS_FAILURES,
    });

    if (result.error) {
        throw new Error(
            `Failed to record analysis failure for ${conversationId}: ${result.error.message}`,
        );
    }

    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (row && typeof row.failure_count === "number") {
        return row.retry_scheduled === true
            ? { kind: "retry_scheduled", failure_count: row.failure_count }
            : { kind: "retry_exhausted", failure_count: row.failure_count };
    }

    // A concurrent collector may have completed or released the row after the
    // readiness check. Do not abort the entire pipeline or invent a failure.
    const current = await getConversationAnalysisState(conversationId);
    if (!current) {
        return { kind: "state_conflict", analysis_status: "missing" };
    }
    if (isCompletedState(current)) return { kind: "already_completed" };
    if (hasReachedRetryLimit(current)) {
        return {
            kind: "retry_limit_reached",
            failure_count: current.analysis_failure_count,
        };
    }
    return {
        kind: "state_conflict",
        analysis_status: current.analysis_status,
    };
}

async function getConversationAnalysisState(
    conversationId: string,
): Promise<ConversationAnalysisState | null> {
    const result = await supabase
        .from("conversations")
        .select("analysis_status,analysis_failure_count,conversation_analysis_id")
        .eq("id", conversationId)
        .maybeSingle();

    if (result.error) {
        throw new Error(
            `Failed to read analysis state for ${conversationId}: ${result.error.message}`,
        );
    }
    if (!result.data) return null;

    return {
        analysis_status: String(result.data.analysis_status ?? ""),
        analysis_failure_count: Number(result.data.analysis_failure_count ?? 0),
        conversation_analysis_id: result.data.conversation_analysis_id
            ? String(result.data.conversation_analysis_id)
            : null,
    };
}

function isCompletedState(state: ConversationAnalysisState | null) {
    return Boolean(
        state &&
            (state.conversation_analysis_id || state.analysis_status === "completed"),
    );
}

function hasReachedRetryLimit(state: ConversationAnalysisState | null) {
    return Boolean(
        state &&
            state.analysis_status !== "processing" &&
            state.analysis_failure_count >= MAX_ANALYSIS_FAILURES,
    );
}

async function restoreConversation(conversationId: string, reason: string) {
    const result = await supabase
        .from("conversations")
        .update({
            analysis_status: "pending",
            analysis_claimed_at: null,
            analysis_failed_at: null,
            analysis_error: reason.slice(0, 2_000),
            updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId)
        .is("conversation_analysis_id", null)
        .eq("analysis_status", "processing")
        .lt("analysis_failure_count", MAX_ANALYSIS_FAILURES);
    if (result.error) {
        console.error("[google-batch] failed to restore conversation", {
            conversation_id: conversationId,
            error: result.error.message,
        });
    }
}

async function markConversationIneligible(conversationId: string, reason: string) {
    const result = await supabase.rpc("fail_conversation_analysis", {
        p_conversation_id: conversationId,
        p_error: reason,
    });

    if (result.error) {
        throw new Error(
            `Failed to mark ineligible conversation ${conversationId}: ${result.error.message}`,
        );
    }
    if (result.data !== true) {
        throw new Error(
            `Ineligible conversation ${conversationId} was not in a claimable processing state`,
        );
    }
}

async function restoreMissingJobRecords(
    job: BatchJobSummary,
    seenRecordIds: Set<string>,
    reason: string,
) {
    let restored = 0;
    for (const recordId of await getJobRecordIds(job)) {
        if (seenRecordIds.has(recordId)) continue;
        await restoreConversation(recordId, reason);
        restored += 1;
    }
    return restored;
}

async function restoreJobRecords(job: BatchJobSummary, reason: string) {
    let restored = 0;
    for (const recordId of await getJobRecordIds(job)) {
        await restoreConversation(
            recordId,
            `Google batch job ${job.state}: ${reason}`,
        );
        restored += 1;
    }
    return restored;
}

async function getJobRecordIds(job: BatchJobSummary) {
    const inputUri = job.inputConfig?.gcsSource?.uris?.[0];
    if (!inputUri) return new Set<string>();

    const { bucket, key } = parseGcsUri(inputUri);
    ensureConfiguredBucket(bucket);
    const keys = key.endsWith(".jsonl")
        ? [key]
        : (await listGcsObjects(key)).filter((item) => item.endsWith(".jsonl"));

    const recordIds = new Set<string>();
    for (const inputKey of keys) {
        const text = await getGcsText(inputKey);
        for (const rawLine of text.split(/\r?\n/)) {
            if (!rawLine.trim()) continue;
            const record = JSON.parse(rawLine) as {
                custom_id?: string;
                body?: { user?: string };
            };
            const recordId =
                record.custom_id?.trim() ?? record.body?.user?.trim();
            if (recordId) recordIds.add(recordId);
        }
    }
    return recordIds;
}

async function sendAdsSafely(
    conversation: Conversation,
    analysis: ConversationAnalysis,
    events: ReturnType<typeof deriveAdEventsFromAnalysis>,
) {
    if (!events.length || (await hasExistingAdEvents(conversation.id))) return;
    if (!analysis.client_id) return;

    const client = await supabase
        .from("clients")
        .select("phone, email, name")
        .eq("id", analysis.client_id)
        .single();
    if (client.error) {
        console.error("[google-batch] client lookup for ads failed", client.error);
        return;
    }

    try {
        await sendMetaEvents({
            events,
            phone: client.data.phone,
            email: client.data.email,
            conversation_id: conversation.id,
            conversation_ended_at: analysis.ended_at,
        });
    } catch (error) {
        console.error("[google-batch] Meta delivery failed", error);
    }

    try {
        await sendGoogleEvents({
            events,
            phone: client.data.phone,
            email: client.data.email,
            name: client.data.name,
            conversation_id: conversation.id,
            conversation_ended_at: analysis.ended_at,
        });
    } catch (error) {
        console.error("[google-batch] Google delivery failed", error);
    }
}

async function hasExistingAdEvents(conversationId: string) {
    const result = await supabase
        .from("ad_events")
        .select("id")
        .eq("conversation_id", conversationId)
        .limit(1)
        .maybeSingle();
    return Boolean(result.data);
}

function applyDeterministicRefinements(
    source: ConversationAnalysis,
    messages: Message[],
    effectiveEndedAt: string,
): ConversationAnalysis {
    const analysis = structuredClone(source);
    analysis.ended_at = effectiveEndedAt;

    if (!isClientSilenceAfterMeaningfulHumanProgress(analysis, messages)) return analysis;

    const lastAttendant = [...messages]
        .reverse()
        .find((message) => message.sender_type === "attendant");
    const evidenceIds = Array.from(
        new Set([
            ...analysis.resolution.evidence_message_ids,
            ...(lastAttendant ? [lastAttendant.id] : []),
        ]),
    );

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
        moment: inferDropoffMoment(
            analysis.conversation_goal,
            lastAttendant?.text ?? "",
        ),
        likely_reason:
            "O atendimento avançou e aguardava uma informação do cliente para continuar, mas não houve nova resposta.",
        confidence: 1,
        evidence_message_ids: evidenceIds,
    };

    if (
        !analysis.outcome_events.some(
            (event) => event.type === "customer_stopped_responding",
        )
    ) {
        analysis.outcome_events.push({
            type: "customer_stopped_responding",
            occurred_at: lastAttendant?.sent_at ?? effectiveEndedAt,
            confidence: 1,
            evidence_message_ids: evidenceIds,
        });
    }

    return analysis;
}

function isClientSilenceAfterMeaningfulHumanProgress(
    analysis: ConversationAnalysis,
    messages: Message[],
) {
    if (
        analysis.resolution.resolution_score !== 0 ||
        analysis.resolution.resolved !== false
    ) {
        return false;
    }
    if (!messages.some((message) => message.sender_type === "attendant")) return false;

    const lastClientIndex = findLastIndex(
        messages,
        (message) => message.sender_type === "client",
    );
    const lastAttendantIndex = findLastIndex(
        messages,
        (message) => message.sender_type === "attendant",
    );
    if (lastClientIndex < 0 || lastAttendantIndex <= lastClientIndex) return false;
    if (
        messages
            .slice(lastAttendantIndex + 1)
            .some((message) => message.sender_type === "client")
    ) {
        return false;
    }

    const attendantMessages = messages
        .slice(lastClientIndex + 1, lastAttendantIndex + 1)
        .filter((message) => message.sender_type === "attendant");
    if (!attendantMessages.length) return false;

    const combinedText = attendantMessages
        .map((message) => normalize(message.text))
        .join(" ");
    const asksForNextStep =
        /\?|\bqual\b|\bquais\b|\bpode me (?:dizer|informar)\b|\bme diga\b|\bprefere\b|\bgostaria\b/.test(
            combinedText,
        );
    const hasProgressContent = combinedText.replace(/[?!.\s]/g, "").length >= 35;
    return asksForNextStep && hasProgressContent;
}

function inferDropoffMoment(
    goal: ConversationAnalysis["conversation_goal"],
    text: string,
) {
    const normalized = normalize(text);
    if (/unidade|clinica|clínica|cidade/.test(normalized)) {
        return "after_unit_presented" as const;
    }
    if (/horario|horário|agenda|data|dia/.test(normalized)) {
        return "after_schedule_options" as const;
    }
    if (/valor|preco|preço|pagamento/.test(normalized)) {
        return "after_price" as const;
    }
    if (goal === "schedule_consultation" || goal === "reschedule_consultation") {
        return "after_schedule_options" as const;
    }
    return "unknown" as const;
}

function senderLabel(message: Message) {
    if (message.sender_type === "client") return message.sender_name ?? "Cliente";
    if (message.sender_type === "attendant") return message.sender_name ?? "Atendente";
    if (message.sender_type === "bot") return "Bot";
    return "Sistema";
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (predicate(items[index]!)) return index;
    }
    return -1;
}

function normalize(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/<[^>]+>/g, " ");
}

function extractJson(content: string) {
    const withoutReasoning = content.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "").trim();
    const fenced = withoutReasoning.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const candidate = (fenced ?? withoutReasoning).trim();
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first < 0 || last <= first) throw new Error("Model output did not contain JSON");
    return candidate.slice(first, last + 1);
}

function extractBatchContent(record: BatchOutputLine) {
    const candidates = [
        record.response,
        record.prediction,
        record.predictions?.[0],
    ];

    for (const candidate of candidates) {
        const content = findChoiceContent(candidate);
        if (content) return content;
    }

    return null;
}

function findChoiceContent(value: unknown, depth = 0): string | null {
    if (depth > 5) return null;
    if (typeof value === "string") {
        try {
            return findChoiceContent(JSON.parse(value), depth + 1);
        } catch {
            return null;
        }
    }

    const object = asRecord(value);
    if (!object) return null;

    const choices = Array.isArray(object.choices) ? object.choices : [];
    const firstChoice = asRecord(choices[0]);
    const message = asRecord(firstChoice?.message);
    if (typeof message?.content === "string" && message.content.trim()) {
        return message.content;
    }

    for (const key of ["body", "response", "prediction", "output"]) {
        const content = findChoiceContent(object[key], depth + 1);
        if (content) return content;
    }

    return null;
}

function getBatchRecordId(
    record: BatchOutputLine,
    content: string | null,
) {
    const candidates = [
        record.custom_id,
        record.customId,
        getRecordIdFromObject(record.instance),
        getRecordIdFromObject(record.request),
        getRecordIdFromObject(record.body),
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    }

    if (!content) return null;
    try {
        const parsed = JSON.parse(extractJson(content)) as {
            conversation_id?: unknown;
        };
        return typeof parsed.conversation_id === "string"
            ? parsed.conversation_id.trim()
            : null;
    } catch {
        return null;
    }
}

function getRecordIdFromObject(value: unknown) {
    const object = asRecord(value);
    if (!object) return null;

    for (const key of ["custom_id", "customId", "recordId", "user"]) {
        const candidate = object[key];
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    }

    const body = asRecord(object.body);
    return typeof body?.user === "string" ? body.user.trim() : null;
}

function getBatchRecordError(record: BatchOutputLine) {
    if (typeof record.status === "string" && record.status.trim()) {
        return record.status.trim();
    }
    if (record.error) return formatUnknownValue(record.error);

    for (const value of [record.response, record.prediction]) {
        const object = asRecord(value);
        if (!object) continue;

        const statusCode = Number(object.status_code ?? object.statusCode);
        if (Number.isFinite(statusCode) && statusCode >= 400) {
            return formatUnknownValue(object.body ?? object);
        }

        const body = asRecord(object.body);
        if (body?.error) return formatUnknownValue(body.error);
        if (object.error) return formatUnknownValue(object.error);
    }

    return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function formatUnknownValue(value: unknown) {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

async function listOurJobs() {
    const jobs: BatchJobSummary[] = [];
    let pageToken: string | undefined;

    do {
        const url = new URL(
            `${vertexApiBase()}/v1/${batchParent()}/batchPredictionJobs`,
        );
        url.searchParams.set("pageSize", "100");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const response = await googleFetch(url, { method: "GET" });
        const body = await readJsonResponse<{
            batchPredictionJobs?: BatchJobSummary[];
            nextPageToken?: string;
        }>(response, "list Google batch jobs");

        jobs.push(
            ...(body.batchPredictionJobs ?? []).filter((job) =>
                job.displayName?.startsWith(JOB_PREFIX),
            ),
        );
        pageToken = body.nextPageToken?.trim() || undefined;
    } while (pageToken);

    return jobs.sort((left, right) =>
        (right.createTime ?? "").localeCompare(left.createTime ?? ""),
    );
}

function isTerminalJob(state: string) {
    return [
        "JOB_STATE_SUCCEEDED",
        "JOB_STATE_PARTIALLY_SUCCEEDED",
        "JOB_STATE_FAILED",
        "JOB_STATE_CANCELLED",
        "JOB_STATE_EXPIRED",
        "JOB_STATE_PAUSED",
    ].includes(state);
}

function summarizeJob(job: BatchJobSummary) {
    const succeeded = numericCount(job.completionStats?.successfulCount);
    const failed = numericCount(job.completionStats?.failedCount);
    const incomplete = numericCount(job.completionStats?.incompleteCount);
    const knownTotal = [succeeded, failed, incomplete].filter(
        (value): value is number => value !== null,
    );

    return {
        job_name: job.displayName,
        job_resource: job.name,
        status: job.state,
        message: job.error?.message ?? null,
        submitted_at: job.createTime ?? null,
        last_modified_at: job.updateTime ?? null,
        total_records:
            knownTotal.length > 0
                ? knownTotal.reduce((sum, value) => sum + value, 0)
                : null,
        processed_records:
            succeeded !== null || failed !== null
                ? (succeeded ?? 0) + (failed ?? 0)
                : null,
        succeeded_records: succeeded,
        failed_records: failed,
        incomplete_records: incomplete,
    };
}

function numericCount(value: string | number | undefined) {
    if (value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

async function createBatchPredictionJob({
    jobName,
    inputKey,
    outputPrefix,
}: {
    jobName: string;
    inputKey: string;
    outputPrefix: string;
}) {
    const payload = JSON.stringify({
        displayName: jobName,
        model: MODEL_RESOURCE,
        inputConfig: {
            instancesFormat: "jsonl",
            gcsSource: {
                uris: [`gs://${bucketName()}/${inputKey}`],
            },
        },
        outputConfig: {
            predictionsFormat: "jsonl",
            gcsDestination: {
                outputUriPrefix: `gs://${bucketName()}/${outputPrefix}`,
            },
        },
    });

    const response = await googleFetch(
        `${vertexApiBase()}/v1/${batchParent()}/batchPredictionJobs`,
        {
            method: "POST",
            body: payload,
            headers: { "content-type": "application/json" },
        },
    );
    const result = await readJsonResponse<BatchJobSummary>(
        response,
        "create Google batch job",
    );
    const name = result.name?.trim();
    if (!name) {
        throw new Error("create Google batch job returned no resource name");
    }
    return { name };
}

async function cleanupJobObjects(
    job: BatchJobSummary,
    outputKeys: string[] = [],
) {
    try {
        const inputUri = job.inputConfig?.gcsSource?.uris?.[0];
        const inputKeys: string[] = [];

        if (inputUri) {
            const { bucket, key } = parseGcsUri(inputUri);
            ensureConfiguredBucket(bucket);
            inputKeys.push(
                ...(key.endsWith(".jsonl")
                    ? [key]
                    : (await listGcsObjects(key)).filter((item) =>
                          item.endsWith(".jsonl"),
                      )),
            );
        }

        await Promise.allSettled(
            Array.from(new Set([...inputKeys, ...outputKeys])).map((key) =>
                deleteGcsObject(key),
            ),
        );
    } catch (error) {
        console.warn("[google-batch] Cloud Storage cleanup failed", {
            job_name: job.displayName,
            error: formatError(error),
        });
    }
}

async function deleteGcsObject(key: string) {
    const response = await googleFetch(gcsObjectUrl(key), {
        method: "DELETE",
    });
    if (!response.ok && response.status !== 404) {
        throw new Error(
            `Cloud Storage DELETE failed (${response.status}): ${await response.text()}`,
        );
    }
}

async function putGcsJson(key: string, value: unknown) {
    return putGcsText(key, JSON.stringify(value), "application/json");
}

async function putGcsText(key: string, value: string, contentType: string) {
    const url = new URL(
        `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName())}/o`,
    );
    url.searchParams.set("uploadType", "media");
    url.searchParams.set("name", normalizeObjectKey(key));

    const response = await googleFetch(url, {
        method: "POST",
        body: value,
        headers: { "content-type": contentType },
    });
    if (!response.ok) {
        throw new Error(
            `Cloud Storage upload failed (${response.status}): ${await response.text()}`,
        );
    }
}

async function getGcsText(key: string) {
    const url = new URL(gcsObjectUrl(key));
    url.searchParams.set("alt", "media");
    const response = await googleFetch(url, {
        method: "GET",
    });
    if (!response.ok) {
        throw new Error(
            `Cloud Storage GET failed (${response.status}): ${await response.text()}`,
        );
    }
    return response.text();
}

async function gcsExists(key: string) {
    const response = await googleFetch(gcsObjectUrl(key), { method: "GET" });
    if (response.status === 404) return false;
    if (!response.ok) {
        throw new Error(
            `Cloud Storage metadata lookup failed (${response.status}): ${await response.text()}`,
        );
    }
    return true;
}

async function listGcsObjects(prefix: string) {
    const objects: string[] = [];
    let pageToken: string | undefined;

    do {
        const url = new URL(
            `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName())}/o`,
        );
        url.searchParams.set("prefix", normalizeObjectKey(prefix));
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const response = await googleFetch(url, { method: "GET" });
        const body = await readJsonResponse<{
            items?: Array<{ name?: string }>;
            nextPageToken?: string;
        }>(response, "list Cloud Storage objects");

        objects.push(
            ...(body.items ?? [])
                .map((item) => item.name?.trim())
                .filter((name): name is string => Boolean(name)),
        );
        pageToken = body.nextPageToken?.trim() || undefined;
    } while (pageToken);

    return objects;
}

function isBatchOutputObject(key: string) {
    const name = key.split("/").at(-1) ?? "";
    return (
        name.includes("prediction.results") ||
        name.includes("prediction.errors") ||
        name.startsWith("predictions_") ||
        name.startsWith("errors_") ||
        name.endsWith(".jsonl") ||
        name.endsWith(".jsonl.out")
    );
}

function gcsObjectUrl(key: string) {
    return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName())}/o/${encodeURIComponent(normalizeObjectKey(key))}`;
}

function normalizeObjectKey(key: string) {
    return key.replace(/^\/+/, "");
}

function parseGcsUri(uri: string) {
    const match = uri.match(/^gs:\/\/([^/]+)\/?(.*)$/);
    if (!match) throw new Error(`Invalid Cloud Storage URI: ${uri}`);
    return { bucket: match[1]!, key: match[2] ?? "" };
}

function ensureConfiguredBucket(bucket: string) {
    if (bucket !== bucketName()) {
        throw new Error(`Unexpected batch bucket ${bucket}; expected ${bucketName()}`);
    }
}

function bucketName() {
    return requiredEnv("GOOGLE_AI_BATCH_BUCKET");
}

function googleLocation() {
    const location = process.env.GOOGLE_AI_LOCATION?.trim() || "global";
    if (!/^[a-z][a-z0-9-]*$/.test(location)) {
        throw new Error(`Invalid GOOGLE_AI_LOCATION: ${location}`);
    }
    return location;
}

function vertexApiBase() {
    const location = googleLocation();
    if (location === "global") {
        return "https://aiplatform.googleapis.com";
    }
    if (location === "us" || location === "eu") {
        return `https://aiplatform.${location}.rep.googleapis.com`;
    }
    return `https://${location}-aiplatform.googleapis.com`;
}

function batchParent() {
    return `projects/${encodeURIComponent(googleProjectId())}/locations/${encodeURIComponent(googleLocation())}`;
}

function googleProjectId() {
    const projectId =
        process.env.GOOGLE_AI_PROJECT_ID?.trim() ||
        googleServiceAccountCredentials().project_id?.trim();
    if (!projectId) {
        throw new Error(
            "Missing GOOGLE_AI_PROJECT_ID and project_id in GOOGLE_AI_SERVICE_ACCOUNT_JSON",
        );
    }
    return projectId;
}

function batchEnabled() {
    return process.env.GOOGLE_AI_BATCH_ENABLED?.trim().toLowerCase() !== "false";
}

function configuredMaxRecords() {
    return integerEnv(
        "GOOGLE_AI_BATCH_MAX_RECORDS",
        DEFAULT_MAX_RECORDS,
        MIN_RECORDS_PER_JOB,
        MAX_RECORDS_PER_JOB,
    );
}

function configuredMaxCompletionTokens() {
    return integerEnv(
        "GOOGLE_AI_BATCH_MAX_COMPLETION_TOKENS",
        DEFAULT_MAX_COMPLETION_TOKENS,
        256,
        32_000,
    );
}

function normalizeRequestedLimit(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_MAX_RECORDS;
    return Math.min(
        MAX_RECORDS_PER_JOB,
        Math.max(MIN_RECORDS_PER_JOB, Math.floor(value)),
    );
}

function integerEnv(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
) {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;

    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(
            `${name} must be an integer between ${minimum} and ${maximum}`,
        );
    }

    return value;
}

async function googleFetch(
    input: string | URL,
    init: RequestInit = {},
) {
    const auth = getGoogleAuth();
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token =
        typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;
    if (!token) throw new Error("Google access token was not returned");

    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
}

function getGoogleAuth() {
    if (!googleAuth) {
        googleAuth = new GoogleAuth({
            credentials: googleServiceAccountCredentials(),
            scopes: [GOOGLE_CLOUD_SCOPE],
        });
    }
    return googleAuth;
}

function googleServiceAccountCredentials() {
    if (googleCredentials) return googleCredentials;

    const raw = requiredEnv("GOOGLE_AI_SERVICE_ACCOUNT_JSON");
    let parsed: Partial<GoogleServiceAccountCredentials>;
    try {
        parsed = JSON.parse(raw) as Partial<GoogleServiceAccountCredentials>;
    } catch {
        throw new Error("GOOGLE_AI_SERVICE_ACCOUNT_JSON must be valid JSON");
    }

    if (!parsed.client_email?.trim() || !parsed.private_key?.trim()) {
        throw new Error(
            "GOOGLE_AI_SERVICE_ACCOUNT_JSON must contain client_email and private_key",
        );
    }

    googleCredentials = {
        client_email: parsed.client_email.trim(),
        private_key: parsed.private_key.replace(/\\n/g, "\n"),
        project_id: parsed.project_id?.trim(),
    };
    return googleCredentials;
}

function requiredEnv(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}`);
    return value;
}

async function readJsonResponse<T>(response: Response, operation: string): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${operation} failed (${response.status}): ${text}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
}

function formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
