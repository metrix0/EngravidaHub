// lib/ai/bedrockBatchAnalysis.ts
import { z } from "zod";

import { supabase } from "@/lib";
import { saveConversationAnalysis } from "@/lib/analysis/saveConversationAnalysis";
import { deriveAdEventsFromAnalysis } from "@/lib/ads/deriveAdEventsFromAnalysis";
import { sendMetaEvents } from "@/lib/ads/meta/sendMetaEvents";
import { sendGoogleEvents } from "@/lib/ads/google/sendGoogleEvents";
import { conversationAnalysisSchema } from "@/lib/ai/conversationAnalysisSchema";
import { getConversationEffectiveEndMessage } from "@/lib/conversations/conversationEffectiveEnd";
import { awsFetch, requiredEnv } from "@/lib/aws/awsSigV4";
import type {
    AnalyzeConversationInput,
    Conversation,
    ConversationAnalysis,
    Message,
} from "@/types";

const MODEL_ID = "openai.gpt-oss-120b-1:0";
const JOB_PREFIX = "engravida-analysis";
const INPUT_PREFIX = "engravida/analysis/input";
const OUTPUT_PREFIX = "engravida/analysis/output";
const PROCESSED_PREFIX = "engravida/analysis/processed";
const PAGE_SIZE = 1_000;
const MIN_RECORDS_PER_JOB = 100;
const MAX_RECORDS_PER_JOB = 100_000;
const DEFAULT_MAX_RECORDS = 100_000;
const DEFAULT_MAX_COMPLETION_TOKENS = 4_500;

const ANALYSIS_JSON_SCHEMA = z.toJSONSchema(conversationAnalysisSchema, {
    target: "draft-2020-12",
    unrepresentable: "any",
});

type BatchJobSummary = {
    jobArn: string;
    jobName: string;
    status: string;
    message?: string;
    inputDataConfig?: {
        s3InputDataConfig?: { s3Uri?: string };
    };
    outputDataConfig?: {
        s3OutputDataConfig?: { s3Uri?: string };
    };
};

type BatchOutputLine = {
    recordId?: string;
    modelOutput?: {
        choices?: Array<{
            message?: {
                content?: string;
            };
        }>;
    };
    error?: {
        errorCode?: number | string;
        errorMessage?: string;
    };
};

export async function runBedrockBatchAnalysis({
    limit = DEFAULT_MAX_RECORDS,
}: {
    limit?: number;
} = {}) {
    const collected = await collectFinishedJobs();

    if (!batchEnabled()) {
        return {
            provider: "amazon-bedrock-batch",
            model: MODEL_ID,
            collected,
            submitted: {
                submitted: false,
                records: 0,
                reason: "disabled_by_environment",
            },
        };
    }

    const submitted = await submitPendingBatch(
        Math.min(normalizeRequestedLimit(limit), configuredMaxRecords()),
    );

    return {
        provider: "amazon-bedrock-batch",
        model: MODEL_ID,
        collected,
        submitted,
    };
}

async function collectFinishedJobs() {
    const jobs = await listOurJobs();
    const finished = jobs.filter((job) =>
        ["Completed", "PartiallyCompleted", "Failed", "Expired", "Stopped"].includes(
            job.status,
        ),
    );

    const results = [];

    for (const job of finished) {
        const jobId = job.jobArn.split("/").at(-1) ?? job.jobName;
        const markerKey = `${PROCESSED_PREFIX}/${jobId}.json`;
        if (await s3Exists(markerKey)) continue;

        if (["Failed", "Expired", "Stopped"].includes(job.status)) {
            const restored = await restoreJobRecords(job, job.message ?? job.status);
            await putS3Json(markerKey, {
                job_arn: job.jobArn,
                status: job.status,
                restored,
                processed_at: new Date().toISOString(),
            });
            await cleanupJobObjects(job);
            results.push({ job_name: job.jobName, status: job.status, restored });
            continue;
        }

        const outputUri = job.outputDataConfig?.s3OutputDataConfig?.s3Uri;
        if (!outputUri) {
            results.push({
                job_name: job.jobName,
                status: job.status,
                error: "Batch job has no S3 output URI",
            });
            continue;
        }

        const { bucket, key: outputPrefix } = parseS3Uri(outputUri);
        ensureConfiguredBucket(bucket);
        const allOutputKeys = await listS3Objects(outputPrefix);
        const outputKeys = allOutputKeys.filter((key) =>
            key.endsWith(".jsonl.out"),
        );
        if (outputKeys.length === 0) {
            results.push({
                job_name: job.jobName,
                status: job.status,
                error: "Completed job output is not visible in S3 yet",
            });
            continue;
        }

        let succeeded = 0;
        let failed = 0;
        const seenRecordIds = new Set<string>();

        for (const key of outputKeys) {
            const text = await getS3Text(key);
            for (const rawLine of text.split(/\r?\n/)) {
                const line = rawLine.trim();
                if (!line) continue;

                let conversationId: string | null = null;
                try {
                    const record = JSON.parse(line) as BatchOutputLine;
                    conversationId = record.recordId?.trim() ?? null;
                    if (!conversationId) throw new Error("Missing recordId in Bedrock output");
                    seenRecordIds.add(conversationId);

                    if (record.error) {
                        await restoreConversation(
                            conversationId,
                            `Bedrock record failed: ${record.error.errorMessage ?? record.error.errorCode ?? "unknown error"}`,
                        );
                        failed += 1;
                        continue;
                    }

                    const content = record.modelOutput?.choices?.[0]?.message?.content;
                    if (!content) throw new Error("Bedrock record returned no message content");

                    await persistCompletedAnalysis(conversationId, content);
                    succeeded += 1;
                } catch (error) {
                    failed += 1;
                    if (conversationId) {
                        await restoreConversation(
                            conversationId,
                            `Failed to import Bedrock result: ${formatError(error)}`,
                        );
                    }
                    console.error("[bedrock-batch] failed to import output record", {
                        job_name: job.jobName,
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
            `Bedrock job ${job.status} did not return an output record`,
        );
        failed += missing;

        await putS3Json(markerKey, {
            job_arn: job.jobArn,
            status: job.status,
            succeeded,
            failed,
            missing_restored: missing,
            processed_at: new Date().toISOString(),
        });
        await cleanupJobObjects(job, allOutputKeys);

        results.push({
            job_name: job.jobName,
            status: job.status,
            succeeded,
            failed,
            missing_restored: missing,
        });
    }

    return results;
}

async function submitPendingBatch(limit: number) {
    const pending = await getPendingConversations(limit);
    if (pending.length === 0) {
        return { submitted: false, records: 0, reason: "no_pending_conversations" };
    }

    if (pending.length < MIN_RECORDS_PER_JOB) {
        return {
            submitted: false,
            records: pending.length,
            minimum_records: MIN_RECORDS_PER_JOB,
            reason: "waiting_for_minimum_batch_size",
        };
    }

    const records: string[] = [];
    const claimedIds: string[] = [];

    for (const conversation of pending) {
        const claimed = await claimConversation(conversation.id);
        if (!claimed) continue;

        try {
            const input = await buildAnalysisInput(conversation);
            records.push(
                JSON.stringify({
                    recordId: conversation.id,
                    modelInput: buildModelInput(input),
                }),
            );
            claimedIds.push(conversation.id);
        } catch (error) {
            await restoreConversation(conversation.id, formatError(error));
        }
    }

    if (records.length === 0) {
        return { submitted: false, records: 0, reason: "nothing_claimed" };
    }

    if (records.length < MIN_RECORDS_PER_JOB) {
        await Promise.all(
            claimedIds.map((conversationId) =>
                restoreConversation(
                    conversationId,
                    `Waiting for at least ${MIN_RECORDS_PER_JOB} conversations before submitting a Bedrock batch`,
                ),
            ),
        );

        return {
            submitted: false,
            records: records.length,
            minimum_records: MIN_RECORDS_PER_JOB,
            reason: "waiting_for_minimum_batch_size_after_claim",
        };
    }

    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const random = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const jobName = `${JOB_PREFIX}-${stamp}-${random}`.slice(0, 63);
    const inputKey = `${INPUT_PREFIX}/${jobName}/input.jsonl`;
    const outputPrefix = `${OUTPUT_PREFIX}/${jobName}`;

    try {
        await putS3Text(inputKey, `${records.join("\n")}\n`, "application/jsonl");
        const response = await createModelInvocationJob({
            jobName,
            inputKey,
            outputPrefix,
        });

        return {
            submitted: true,
            records: records.length,
            job_name: jobName,
            job_arn: response.jobArn,
            input: `s3://${bucketName()}/${inputKey}`,
            output: `s3://${bucketName()}/${outputPrefix}`,
        };
    } catch (error) {
        await Promise.all(
            claimedIds.map((conversationId) =>
                restoreConversation(
                    conversationId,
                    `Failed to submit Bedrock batch: ${formatError(error)}`,
                ),
            ),
        );
        await deleteS3Object(inputKey).catch(() => undefined);
        throw error;
    }
}

function buildModelInput(input: AnalyzeConversationInput) {
    return {
        model: MODEL_ID,
        temperature: 0,
        reasoning_effort: "medium",
        max_completion_tokens: configuredMaxCompletionTokens(),
        response_format: {
            type: "json_schema",
            json_schema: {
                name: "conversation_analysis",
                strict: true,
                schema: ANALYSIS_JSON_SCHEMA,
            },
        },
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
                            "Analise integralmente a conversa e retorne somente o JSON final no schema informado.",
                        metadata: {
                            conversation_id: input.conversation_id,
                            client_id: input.client_id,
                            instagram_user_id: input.instagram_user_id,
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

Retorne SOMENTE JSON estrito no schema solicitado. Antes de decidir, forme internamente um registro factual de evidências baseado exclusivamente nos message_ids existentes.

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

async function persistCompletedAnalysis(conversationId: string, rawContent: string) {
    const conversation = await getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

    const messages = await getMessages(conversationId);
    if (messages.length === 0) throw new Error("Conversation has no messages");

    const content = extractJson(rawContent);
    const parsed = conversationAnalysisSchema.parse(JSON.parse(content));

    if (parsed.conversation_id !== conversationId) {
        throw new Error(
            `Bedrock returned conversation_id ${parsed.conversation_id} for ${conversationId}`,
        );
    }
    if (parsed.client_id !== conversation.client_id) {
        throw new Error("Bedrock returned a mismatched client_id");
    }
    if (parsed.instagram_user_id !== conversation.instagram_user_id) {
        throw new Error("Bedrock returned a mismatched instagram_user_id");
    }

    const effectiveEnd = getConversationEffectiveEndMessage(messages);
    const normalizedAnalysis: ConversationAnalysis = {
        ...parsed,
        conversation_id: conversationId,
        client_id: conversation.client_id,
        instagram_user_id: conversation.instagram_user_id,
        started_at: messages[0]!.sent_at,
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
        analysis_provider: "bedrock",
        analysis_model: MODEL_ID,
        analysis_prompt_version: "bedrock-batch-single-pass-v1",
        analysis_message_count: messages.length,
    };

    const analysis = applyDeterministicRefinements(
        normalizedAnalysis,
        messages,
        effectiveEnd.sent_at,
    );

    const analysisId = await saveConversationAnalysis(analysis);
    await completeConversation(
        conversationId,
        String(analysisId),
        analysis.started_at,
        analysis.ended_at,
        String(messages.at(-1)?.text ?? ""),
    );

    const events = deriveAdEventsFromAnalysis(analysis).filter(
        (event) => event.type === "lead",
    );
    await sendAdsSafely(conversation, analysis, events);
}

async function buildAnalysisInput(
    conversation: Conversation,
): Promise<AnalyzeConversationInput> {
    const messages = await getMessages(conversation.id);
    if (messages.length === 0) throw new Error("Conversation has no messages");

    const normalized = messages
        .filter((message) => !isInvisibleBlipControlText(message.text))
        .map((message) => ({
            ...message,
            sender_name: senderLabel(message),
        }));
    if (normalized.length === 0) {
        throw new Error("Conversation contains only internal Blip control events");
    }
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

function isInvisibleBlipControlText(value: string) {
    return /^\[Mensagem preservada:\s*(?:application\/vnd\.iris\.ticket\+json|application\/json)\]$/i.test(
        value.trim(),
    );
}

async function getPendingConversations(limit: number) {
    const rows: Conversation[] = [];

    for (let from = 0; rows.length < limit; from += PAGE_SIZE) {
        const to = Math.min(from + PAGE_SIZE - 1, limit - 1);
        const result = await supabase
            .from("conversations")
            .select("*")
            .is("conversation_analysis_id", null)
            .eq("analysis_status", "pending")
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

async function completeConversation(
    conversationId: string,
    analysisId: string,
    startedAt: string,
    endedAt: string,
    lastText: string,
) {
    const result = await supabase.rpc("complete_conversation_analysis", {
        p_conversation_id: conversationId,
        p_analysis_id: analysisId,
        p_started_at: startedAt,
        p_ended_at: endedAt,
        p_last_message_text: lastText,
    });
    if (result.error) throw new Error(`Failed to complete analysis: ${result.error.message}`);
    if (result.data !== true) {
        throw new Error("Conversation analysis completion was rejected by database guard");
    }
}

async function restoreConversation(conversationId: string, reason: string) {
    const result = await supabase
        .from("conversations")
        .update({
            analysis_status: "pending",
            analysis_error: reason.slice(0, 2_000),
            updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId)
        .is("conversation_analysis_id", null);
    if (result.error) {
        console.error("[bedrock-batch] failed to restore conversation", {
            conversation_id: conversationId,
            error: result.error.message,
        });
    }
}

async function restoreMissingJobRecords(
    job: BatchJobSummary,
    seenRecordIds: Set<string>,
    reason: string,
) {
    const inputUri = job.inputDataConfig?.s3InputDataConfig?.s3Uri;
    if (!inputUri) return 0;

    const { bucket, key } = parseS3Uri(inputUri);
    ensureConfiguredBucket(bucket);
    const keys = key.endsWith(".jsonl")
        ? [key]
        : (await listS3Objects(key)).filter((item) => item.endsWith(".jsonl"));

    let restored = 0;
    for (const inputKey of keys) {
        const text = await getS3Text(inputKey);
        for (const rawLine of text.split(/\r?\n/)) {
            if (!rawLine.trim()) continue;
            const record = JSON.parse(rawLine) as { recordId?: string };
            const recordId = record.recordId?.trim();
            if (!recordId || seenRecordIds.has(recordId)) continue;
            await restoreConversation(recordId, reason);
            restored += 1;
        }
    }
    return restored;
}

async function restoreJobRecords(job: BatchJobSummary, reason: string) {
    const inputUri = job.inputDataConfig?.s3InputDataConfig?.s3Uri;
    if (!inputUri) return 0;

    const { bucket, key } = parseS3Uri(inputUri);
    ensureConfiguredBucket(bucket);
    const keys = key.endsWith(".jsonl")
        ? [key]
        : (await listS3Objects(key)).filter((item) => item.endsWith(".jsonl"));

    let restored = 0;
    for (const inputKey of keys) {
        const text = await getS3Text(inputKey);
        for (const rawLine of text.split(/\r?\n/)) {
            if (!rawLine.trim()) continue;
            const record = JSON.parse(rawLine) as { recordId?: string };
            if (!record.recordId) continue;
            await restoreConversation(record.recordId, `Bedrock job ${job.status}: ${reason}`);
            restored += 1;
        }
    }
    return restored;
}

async function sendAdsSafely(
    conversation: Conversation,
    analysis: ConversationAnalysis,
    events: ReturnType<typeof deriveAdEventsFromAnalysis>,
) {
    if (
        !events.length ||
        !analysis.client_id ||
        (await hasExistingAdEvents(conversation.id))
    ) {
        return;
    }

    const client = await supabase
        .from("clients")
        .select("phone, email, name")
        .eq("id", analysis.client_id)
        .single();
    if (client.error) {
        console.error("[bedrock-batch] client lookup for ads failed", client.error);
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
        console.error("[bedrock-batch] Meta delivery failed", error);
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
        console.error("[bedrock-batch] Google delivery failed", error);
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

async function listOurJobs() {
    const region = awsRegion();
    const url = new URL(`https://bedrock.${region}.amazonaws.com/model-invocation-jobs`);
    url.searchParams.set("maxResults", "1000");
    url.searchParams.set("nameContains", JOB_PREFIX);
    url.searchParams.set("sortBy", "CreationTime");
    url.searchParams.set("sortOrder", "Descending");

    const response = await awsFetch({
        service: "bedrock",
        region,
        method: "GET",
        url: url.toString(),
    });
    const body = await readJsonResponse<{
        invocationJobSummaries?: BatchJobSummary[];
    }>(response, "list Bedrock batch jobs");
    return body.invocationJobSummaries ?? [];
}

async function createModelInvocationJob({
    jobName,
    inputKey,
    outputPrefix,
}: {
    jobName: string;
    inputKey: string;
    outputPrefix: string;
}) {
    const region = awsRegion();
    const payload = JSON.stringify({
        jobName,
        roleArn: requiredEnv("BEDROCK_BATCH_ROLE_ARN"),
        modelId: MODEL_ID,
        modelInvocationType: "InvokeModel",
        inputDataConfig: {
            s3InputDataConfig: {
                s3Uri: `s3://${bucketName()}/${inputKey}`,
            },
        },
        outputDataConfig: {
            s3OutputDataConfig: {
                s3Uri: `s3://${bucketName()}/${outputPrefix}`,
            },
        },
        timeoutDurationInHours: 24,
        clientRequestToken: crypto.randomUUID().replace(/-/g, ""),
    });

    const response = await awsFetch({
        service: "bedrock",
        region,
        method: "POST",
        url: `https://bedrock.${region}.amazonaws.com/model-invocation-jobs`,
        body: payload,
        headers: { "content-type": "application/json" },
    });
    return readJsonResponse<{ jobArn: string }>(
        response,
        "create Bedrock batch job",
    );
}

async function cleanupJobObjects(
    job: BatchJobSummary,
    outputKeys: string[] = [],
) {
    try {
        const inputUri = job.inputDataConfig?.s3InputDataConfig?.s3Uri;
        const inputKeys: string[] = [];

        if (inputUri) {
            const { bucket, key } = parseS3Uri(inputUri);
            ensureConfiguredBucket(bucket);
            inputKeys.push(
                ...(key.endsWith(".jsonl")
                    ? [key]
                    : (await listS3Objects(key)).filter((item) =>
                          item.endsWith(".jsonl"),
                      )),
            );
        }

        await Promise.allSettled(
            Array.from(new Set([...inputKeys, ...outputKeys])).map((key) =>
                deleteS3Object(key),
            ),
        );
    } catch (error) {
        console.warn("[bedrock-batch] S3 cleanup failed", {
            job_name: job.jobName,
            error: formatError(error),
        });
    }
}

async function deleteS3Object(key: string) {
    const response = await awsFetch({
        service: "s3",
        region: awsRegion(),
        method: "DELETE",
        url: s3ObjectUrl(key),
    });
    if (!response.ok && response.status !== 404) {
        throw new Error(
            `S3 DELETE failed (${response.status}): ${await response.text()}`,
        );
    }
}

async function putS3Json(key: string, value: unknown) {
    return putS3Text(key, JSON.stringify(value), "application/json");
}

async function putS3Text(key: string, value: string, contentType: string) {
    const response = await awsFetch({
        service: "s3",
        region: awsRegion(),
        method: "PUT",
        url: s3ObjectUrl(key),
        body: value,
        headers: { "content-type": contentType },
    });
    if (!response.ok) {
        throw new Error(`S3 PUT failed (${response.status}): ${await response.text()}`);
    }
}

async function getS3Text(key: string) {
    const response = await awsFetch({
        service: "s3",
        region: awsRegion(),
        method: "GET",
        url: s3ObjectUrl(key),
    });
    if (!response.ok) {
        throw new Error(`S3 GET failed (${response.status}): ${await response.text()}`);
    }
    return response.text();
}

async function s3Exists(key: string) {
    const response = await awsFetch({
        service: "s3",
        region: awsRegion(),
        method: "HEAD",
        url: s3ObjectUrl(key),
    });
    if (response.status === 404) return false;
    if (!response.ok) {
        throw new Error(`S3 HEAD failed (${response.status}): ${await response.text()}`);
    }
    return true;
}

async function listS3Objects(prefix: string) {
    const url = new URL(`https://${bucketName()}.s3.${awsRegion()}.amazonaws.com/`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix.replace(/^\/+/, ""));

    const response = await awsFetch({
        service: "s3",
        region: awsRegion(),
        method: "GET",
        url: url.toString(),
    });
    if (!response.ok) {
        throw new Error(`S3 LIST failed (${response.status}): ${await response.text()}`);
    }

    const xml = await response.text();
    return [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((match) =>
        decodeXml(match[1] ?? ""),
    );
}

function s3ObjectUrl(key: string) {
    const encoded = key
        .replace(/^\/+/, "")
        .split("/")
        .map(encodeURIComponent)
        .join("/");
    return `https://${bucketName()}.s3.${awsRegion()}.amazonaws.com/${encoded}`;
}

function parseS3Uri(uri: string) {
    const match = uri.match(/^s3:\/\/([^/]+)\/?(.*)$/);
    if (!match) throw new Error(`Invalid S3 URI: ${uri}`);
    return { bucket: match[1]!, key: match[2] ?? "" };
}

function ensureConfiguredBucket(bucket: string) {
    if (bucket !== bucketName()) {
        throw new Error(`Unexpected batch bucket ${bucket}; expected ${bucketName()}`);
    }
}

function bucketName() {
    return requiredEnv("BEDROCK_BATCH_S3_BUCKET");
}

function awsRegion() {
    return process.env.AWS_REGION?.trim() || "sa-east-1";
}

function batchEnabled() {
    return process.env.BEDROCK_BATCH_ENABLED?.trim().toLowerCase() !== "false";
}

function configuredMaxRecords() {
    return integerEnv(
        "BEDROCK_BATCH_MAX_RECORDS",
        DEFAULT_MAX_RECORDS,
        MIN_RECORDS_PER_JOB,
        MAX_RECORDS_PER_JOB,
    );
}

function configuredMaxCompletionTokens() {
    return integerEnv(
        "BEDROCK_BATCH_MAX_COMPLETION_TOKENS",
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

async function readJsonResponse<T>(response: Response, operation: string): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${operation} failed (${response.status}): ${text}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
}

function decodeXml(value: string) {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
