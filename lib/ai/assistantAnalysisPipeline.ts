// lib/ai/assistantAnalysisPipeline.ts

export type ConversationAnalysisPipelineRow = {
    analysis_status: string | null;
    analysis_claimed_at: string | null;
    analysis_error: string | null;
    started_at: string;
    ended_at: string | null;
};

type PipelineFailureReason =
    | "no_analyzable_messages"
    | "no_client_messages"
    | "no_human_attendant_messages"
    | "no_client_or_human_attendant_messages"
    | "other_failure"
    | "without_recorded_reason";

export function summarizeConversationAnalysisPipeline(
    rows: ConversationAnalysisPipelineRow[],
    options: { now?: Date; capped?: boolean } = {},
) {
    const now = options.now ?? new Date();
    const statuses = {
        awaiting_conversation_end: 0,
        queued_for_analysis: 0,
        processing: 0,
        failed: 0,
        inconsistent_or_unknown: 0,
    };
    const processingAge = {
        up_to_1_hour: 0,
        one_to_6_hours: 0,
        six_to_24_hours: 0,
        over_24_hours: 0,
        without_claim_time: 0,
    };
    const failureReasons: Record<PipelineFailureReason, number> = {
        no_analyzable_messages: 0,
        no_client_messages: 0,
        no_human_attendant_messages: 0,
        no_client_or_human_attendant_messages: 0,
        other_failure: 0,
        without_recorded_reason: 0,
    };

    for (const row of rows) {
        if (row.analysis_status === "pending") {
            if (row.ended_at) statuses.queued_for_analysis += 1;
            else statuses.awaiting_conversation_end += 1;
            continue;
        }

        if (row.analysis_status === "processing") {
            statuses.processing += 1;
            incrementProcessingAge(processingAge, row.analysis_claimed_at, now);
            continue;
        }

        if (row.analysis_status === "failed") {
            statuses.failed += 1;
            failureReasons[classifyFailureReason(row.analysis_error)] += 1;
            continue;
        }

        statuses.inconsistent_or_unknown += 1;
    }

    return {
        snapshot_at: now.toISOString(),
        missing_analysis_rows_scanned: rows.length,
        capped: options.capped ?? false,
        statuses,
        processing_age: processingAge,
        failure_reasons: failureReasons,
        notes: [
            "Aguardando encerramento significa que a conversa ainda não ficou pronta para entrar na análise.",
            "Na fila significa que a conversa encerrou e ainda aguarda o início da análise.",
            "Em processamento significa que a conversa foi reservada para análise e ainda não recebeu o resultado; esse estado, sozinho, não confirma que o serviço externo continua ativo.",
            "Falhas por ausência de mensagens do cliente ou do atendimento humano indicam conversas sem conteúdo suficiente para análise, não apenas atraso.",
        ],
    };
}

function incrementProcessingAge(
    buckets: {
        up_to_1_hour: number;
        one_to_6_hours: number;
        six_to_24_hours: number;
        over_24_hours: number;
        without_claim_time: number;
    },
    claimedAt: string | null,
    now: Date,
) {
    if (!claimedAt) {
        buckets.without_claim_time += 1;
        return;
    }

    const claimedTime = new Date(claimedAt).getTime();
    if (!Number.isFinite(claimedTime)) {
        buckets.without_claim_time += 1;
        return;
    }

    const ageHours = Math.max(0, now.getTime() - claimedTime) / 3_600_000;
    if (ageHours <= 1) buckets.up_to_1_hour += 1;
    else if (ageHours <= 6) buckets.one_to_6_hours += 1;
    else if (ageHours <= 24) buckets.six_to_24_hours += 1;
    else buckets.over_24_hours += 1;
}

function classifyFailureReason(error: string | null): PipelineFailureReason {
    if (!error?.trim()) return "without_recorded_reason";

    const normalized = error.toLocaleLowerCase("en-US");
    if (normalized.includes("no analyzable messages")) {
        return "no_analyzable_messages";
    }
    if (normalized.includes("no client or human attendant messages")) {
        return "no_client_or_human_attendant_messages";
    }
    if (normalized.includes("no client messages")) {
        return "no_client_messages";
    }
    if (normalized.includes("no human attendant messages")) {
        return "no_human_attendant_messages";
    }
    return "other_failure";
}
