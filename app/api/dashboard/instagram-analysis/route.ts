// app/api/dashboard/instagram-analysis/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import {
    getConversationGoalLabel,
    getCustomerFinalStateLabel,
    getCustomerStartIntentLabel,
    getDropoffMomentLabel,
    getGoalStatusLabel,
    getOutcomeEventLabel,
    humanizeAnalysisCode,
} from "@/lib/conversationAnalysisLabels";
import {
    parseUuidArray,
    resolveDashboardDateRange,
} from "@/lib/dashboard/metrics";

const PAGE_SIZE = 1_000;
const MAX_CONVERSATIONS = 100_000;
const ID_BATCH_SIZE = 100;
const MAX_FIRST_RESPONSE_SECONDS = 7_200;
const MAX_AVERAGE_RESPONSE_SECONDS = 7_200;
const MAX_LONGEST_DELAY_SECONDS = 86_400;

type InstagramConversationRow = {
    id: string;
    started_at: string;
};

type AnalysisOutcomeEvent = {
    type?: string | null;
};

type AnalysisObjection = {
    type?: string | null;
    resolved?: boolean | null;
};

type InstagramAnalysisRow = {
    conversation_id: string;
    customer_start_intent: string | null;
    conversation_goal: string | null;
    goal_status: string | null;
    customer_final_state: string | null;
    outcome_events: unknown;
    objections: unknown;
    dropoff_happened: boolean | null;
    dropoff_moment: string | null;
    dropoff_likely_reason: string | null;
    customer_sentiment: string | null;
    satisfaction_score: number | string | null;
    clarity_score: number | string | null;
    empathy_score: number | string | null;
    proactivity_score: number | string | null;
    objection_handling_score: number | string | null;
    response_speed_score: number | string | null;
    attendant_quality_score: number | string | null;
    first_human_response_time_seconds: number | string | null;
    average_human_response_time_seconds: number | string | null;
    longest_human_delay_seconds: number | string | null;
    resolution_result: string | null;
    resolution_score: number | string | null;
    resolution_reasoning_category: string | null;
    notable: boolean | null;
};

type DailyAccumulator = {
    date_iso: string;
    conversations: number;
    resolution_observed: number;
    resolved: number;
    satisfaction_observed: number;
    satisfied: number;
    dropoffs: number;
    quality_total: number;
    quality_observed: number;
};

type QualityKey =
    | "clarity_score"
    | "empathy_score"
    | "proactivity_score"
    | "objection_handling_score"
    | "response_speed_score"
    | "attendant_quality_score";

type QualityAccumulator = {
    total: number;
    observed: number;
};

const QUALITY_DIMENSIONS: Array<{
    key: QualityKey;
    label: string;
}> = [
    { key: "clarity_score", label: "Clareza" },
    { key: "empathy_score", label: "Empatia" },
    { key: "proactivity_score", label: "Proatividade" },
    { key: "objection_handling_score", label: "Tratamento de objeções" },
    { key: "response_speed_score", label: "Velocidade percebida" },
    { key: "attendant_quality_score", label: "Qualidade geral" },
];

const SENTIMENT_LABELS: Record<string, string> = {
    positive: "Positivo",
    neutral: "Neutro",
    negative: "Negativo",
    anxious: "Ansioso",
    confused: "Confuso",
    frustrated: "Frustrado",
};

const RESOLUTION_RESULT_LABELS: Record<string, string> = {
    resolved: "Resolvida",
    partial: "Parcialmente resolvida",
    not_resolved: "Não resolvida",
};

const RESOLUTION_REASON_LABELS: Record<string, string> = {
    customer_got_answer: "Cliente recebeu a resposta",
    customer_scheduled: "Cliente agendou",
    customer_confirmed: "Cliente confirmou",
    customer_not_qualified: "Cliente não qualificado",
    customer_abandoned: "Cliente abandonou",
    attendant_failed_to_answer: "Atendente não respondeu",
    unclear: "Motivo indefinido",
};

const OBJECTION_LABELS: Record<string, string> = {
    price: "Preço",
    distance: "Distância",
    online_consultation: "Consulta online",
    time_availability: "Disponibilidade de horário",
    trust: "Confiança",
    medical_uncertainty: "Incerteza médica",
    partner_or_family: "Parceiro ou família",
    already_treating_elsewhere: "Tratamento em outra clínica",
    other: "Outros",
};

const DROPOFF_REASON_LABELS: Record<string, string> = {
    unit_selection: "Escolha da unidade",
    price_or_payment: "Preço ou pagamento",
    scheduling: "Agendamento",
    medical_information: "Informações médicas/pessoais",
    location_or_distance: "Localização ou distância",
    needed_time: "Precisava decidir ou pensar",
    no_response: "Cliente não respondeu",
    other: "Outros motivos",
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);
    const unitIds = parseUuidArray(searchParams.get("unit_ids"));

    try {
        const unitLocations = await loadUnitLocations(
            unitIds,
            request.signal,
        );
        const conversations = await loadInstagramConversations(
            range.startAt,
            range.endAt,
            unitLocations,
            request.signal,
        );
        const analyses = await loadInstagramAnalyses(
            conversations.map((conversation) => conversation.id),
            request.signal,
        );
        const payload = buildInstagramAnalysisPayload(conversations, analyses);

        return NextResponse.json(payload, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        if (request.signal.aborted) {
            return new NextResponse(null, { status: 499 });
        }

        console.error("[dashboard/instagram-analysis] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar a análise do Instagram.",
            },
            { status: 500 },
        );
    }
}

async function loadUnitLocations(
    unitIds: string[],
    signal: AbortSignal,
): Promise<string[] | null> {
    if (unitIds.length === 0) return null;

    const { data, error } = await supabase
        .from("units")
        .select("name")
        .in("id", unitIds)
        .abortSignal(signal);

    if (error) throw error;

    return (data ?? []).flatMap((unit) =>
        typeof unit.name === "string" && unit.name.trim()
            ? [unit.name.trim()]
            : [],
    );
}

async function loadInstagramConversations(
    startAt: string,
    endAt: string,
    unitLocations: string[] | null,
    signal: AbortSignal,
) {
    const rows: InstagramConversationRow[] = [];
    if (unitLocations?.length === 0) return rows;

    const unitLocationSet = unitLocations ? new Set(unitLocations) : null;

    for (let from = 0; from < MAX_CONVERSATIONS; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("conversations")
            .select("id, started_at, instagram_users(location)")
            .eq("channel", "Instagram")
            .gte("started_at", startAt)
            .lt("started_at", endAt)
            .order("started_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);

        if (error) throw error;

        const page = (data ?? []) as unknown as Array<
            InstagramConversationRow & {
                instagram_users: { location: string | null } | null;
            }
        >;
        rows.push(
            ...(unitLocationSet
                ? page.filter((conversation) =>
                      conversation.instagram_users?.location
                          ? unitLocationSet.has(
                                conversation.instagram_users.location,
                            )
                          : false,
                  )
                : page),
        );
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadInstagramAnalyses(
    conversationIds: string[],
    signal: AbortSignal,
) {
    const rows: InstagramAnalysisRow[] = [];

    for (const ids of chunk(conversationIds, ID_BATCH_SIZE)) {
        const { data, error } = await supabase
            .from("conversation_analysis")
            .select(
                [
                    "conversation_id",
                    "customer_start_intent",
                    "conversation_goal",
                    "goal_status",
                    "customer_final_state",
                    "outcome_events",
                    "objections",
                    "dropoff_happened",
                    "dropoff_moment",
                    "dropoff_likely_reason",
                    "customer_sentiment",
                    "satisfaction_score",
                    "clarity_score",
                    "empathy_score",
                    "proactivity_score",
                    "objection_handling_score",
                    "response_speed_score",
                    "attendant_quality_score",
                    "first_human_response_time_seconds",
                    "average_human_response_time_seconds",
                    "longest_human_delay_seconds",
                    "resolution_result",
                    "resolution_score",
                    "resolution_reasoning_category",
                    "notable",
                ].join(", "),
            )
            .in("conversation_id", ids)
            .abortSignal(signal);

        if (error) throw error;
        rows.push(...((data ?? []) as unknown as InstagramAnalysisRow[]));
    }

    return rows;
}

function buildInstagramAnalysisPayload(
    conversations: InstagramConversationRow[],
    analyses: InstagramAnalysisRow[],
) {
    const startedAtByConversationId = new Map(
        conversations.map((conversation) => [
            conversation.id,
            conversation.started_at,
        ]),
    );
    const daily = new Map<string, DailyAccumulator>();
    const customerIntents = new Map<string, number>();
    const conversationGoals = new Map<string, number>();
    const goalStatuses = new Map<string, number>();
    const customerFinalStates = new Map<string, number>();
    const dropoffMoments = new Map<string, number>();
    const dropoffReasons = new Map<string, number>();
    const sentiments = new Map<string, number>();
    const resolutionResults = new Map<string, number>();
    const resolutionReasons = new Map<string, number>();
    const outcomeEvents = new Map<string, number>();
    const objections = new Map<
        string,
        { total: number; resolved: number; unresolved: number }
    >();
    const quality = new Map<QualityKey, QualityAccumulator>(
        QUALITY_DIMENSIONS.map(({ key }) => [
            key,
            { total: 0, observed: 0 },
        ]),
    );

    const firstResponseValues: number[] = [];
    const averageResponseValues: number[] = [];
    const longestDelayValues: number[] = [];

    let resolutionObserved = 0;
    let resolved = 0;
    let satisfactionObserved = 0;
    let satisfied = 0;
    let dropoffCount = 0;
    let notableCount = 0;

    for (const analysis of analyses) {
        const startedAt = startedAtByConversationId.get(
            analysis.conversation_id,
        );
        if (!startedAt) continue;

        const dateIso = saoPauloDate(startedAt);
        const point = daily.get(dateIso) ?? emptyDailyAccumulator(dateIso);
        point.conversations += 1;

        incrementIfPresent(customerIntents, analysis.customer_start_intent);
        incrementIfPresent(conversationGoals, analysis.conversation_goal);
        incrementIfPresent(goalStatuses, analysis.goal_status);
        incrementIfPresent(customerFinalStates, analysis.customer_final_state);
        incrementIfPresent(sentiments, analysis.customer_sentiment);
        incrementIfPresent(resolutionResults, analysis.resolution_result);
        incrementIfPresent(
            resolutionReasons,
            analysis.resolution_reasoning_category,
        );

        if (analysis.dropoff_happened === true) {
            dropoffCount += 1;
            point.dropoffs += 1;
            increment(dropoffMoments, analysis.dropoff_moment ?? "unknown");
            increment(
                dropoffReasons,
                categorizeDropoffReason(analysis.dropoff_likely_reason),
            );
        }

        if (analysis.notable === true) notableCount += 1;

        if (isResolutionObservable(analysis.resolution_result)) {
            resolutionObserved += 1;
            point.resolution_observed += 1;
            if (analysis.resolution_result === "resolved") {
                resolved += 1;
                point.resolved += 1;
            }
        }

        const satisfaction = clearSatisfactionOutcome(analysis);
        if (satisfaction !== null) {
            satisfactionObserved += 1;
            point.satisfaction_observed += 1;
            if (satisfaction) {
                satisfied += 1;
                point.satisfied += 1;
            }
        }

        for (const dimension of QUALITY_DIMENSIONS) {
            const score = nullableNumber(analysis[dimension.key]);
            if (score === null) continue;

            const accumulator = quality.get(dimension.key)!;
            accumulator.total += score;
            accumulator.observed += 1;

            if (dimension.key === "attendant_quality_score") {
                point.quality_total += score;
                point.quality_observed += 1;
            }
        }

        pushBoundedNumber(
            firstResponseValues,
            analysis.first_human_response_time_seconds,
            MAX_FIRST_RESPONSE_SECONDS,
        );
        pushBoundedNumber(
            averageResponseValues,
            analysis.average_human_response_time_seconds,
            MAX_AVERAGE_RESPONSE_SECONDS,
        );
        pushBoundedNumber(
            longestDelayValues,
            analysis.longest_human_delay_seconds,
            MAX_LONGEST_DELAY_SECONDS,
        );

        const uniqueOutcomeTypes = new Set(
            parseOutcomeEvents(analysis.outcome_events)
                .map((event) => event.type?.trim())
                .filter((value): value is string => Boolean(value)),
        );
        for (const type of uniqueOutcomeTypes) increment(outcomeEvents, type);

        for (const objection of parseObjections(analysis.objections)) {
            const type = objection.type?.trim();
            if (!type) continue;

            const current = objections.get(type) ?? {
                total: 0,
                resolved: 0,
                unresolved: 0,
            };
            current.total += 1;
            if (objection.resolved === true) current.resolved += 1;
            else current.unresolved += 1;
            objections.set(type, current);
        }

        daily.set(dateIso, point);
    }

    const attendantQuality = quality.get("attendant_quality_score")!;
    const averageFirstResponse = average(firstResponseValues);

    return {
        scope: "instagram_global",
        conversations_total: conversations.length,
        conversations_analyzed: analyses.length,
        analysis_coverage_rate: percentage(analyses.length, conversations.length),
        resolution_rate: percentage(resolved, resolutionObserved),
        resolution_observed: resolutionObserved,
        satisfaction_rate: percentage(satisfied, satisfactionObserved),
        satisfaction_observed: satisfactionObserved,
        dropoff_rate: percentage(dropoffCount, analyses.length),
        dropoff_count: dropoffCount,
        notable_count: notableCount,
        average_first_human_response_seconds: averageFirstResponse,
        median_first_human_response_seconds: percentile(
            firstResponseValues,
            0.5,
        ),
        p90_first_human_response_seconds: percentile(firstResponseValues, 0.9),
        first_human_response_observed: firstResponseValues.length,
        attendant_quality_score:
            attendantQuality.observed > 0
                ? roundOneDecimal(
                      attendantQuality.total / attendantQuality.observed,
                  )
                : null,
        attendant_quality_observed: attendantQuality.observed,
        daily_evolution: [...daily.values()]
            .sort((first, second) =>
                first.date_iso.localeCompare(second.date_iso),
            )
            .map((point) => ({
                date: displayDate(point.date_iso),
                date_iso: point.date_iso,
                conversations: point.conversations,
                resolution_rate: percentage(
                    point.resolved,
                    point.resolution_observed,
                ),
                satisfaction_rate: percentage(
                    point.satisfied,
                    point.satisfaction_observed,
                ),
                dropoff_rate: percentage(point.dropoffs, point.conversations),
                attendant_quality_score:
                    point.quality_observed > 0
                        ? roundOneDecimal(
                              point.quality_total / point.quality_observed,
                          )
                        : null,
            })),
        dropoff_moments: buildDistribution(
            dropoffMoments,
            dropoffCount,
            getDropoffMomentLabel,
        ),
        dropoff_reasons: buildDistribution(
            dropoffReasons,
            dropoffCount,
            (value) => DROPOFF_REASON_LABELS[value] ?? humanizeAnalysisCode(value),
        ),
        customer_intents: buildDistribution(
            customerIntents,
            analyses.length,
            getCustomerStartIntentLabel,
        ),
        conversation_goals: buildDistribution(
            conversationGoals,
            analyses.length,
            getConversationGoalLabel,
        ),
        goal_statuses: buildDistribution(
            goalStatuses,
            analyses.length,
            getGoalStatusLabel,
        ),
        customer_final_states: buildDistribution(
            customerFinalStates,
            analyses.length,
            getCustomerFinalStateLabel,
        ),
        sentiments: buildDistribution(
            sentiments,
            analyses.length,
            (value) => SENTIMENT_LABELS[value] ?? humanizeAnalysisCode(value),
        ),
        resolution_results: buildDistribution(
            resolutionResults,
            analyses.length,
            (value) =>
                RESOLUTION_RESULT_LABELS[value] ?? humanizeAnalysisCode(value),
        ),
        resolution_reasons: buildDistribution(
            resolutionReasons,
            analyses.length,
            (value) =>
                RESOLUTION_REASON_LABELS[value] ?? humanizeAnalysisCode(value),
        ),
        outcome_events: buildDistribution(
            outcomeEvents,
            analyses.length,
            getOutcomeEventLabel,
        ),
        quality_dimensions: QUALITY_DIMENSIONS.map(({ key, label }) => {
            const value = quality.get(key)!;
            return {
                key,
                label,
                score:
                    value.observed > 0
                        ? roundOneDecimal(value.total / value.observed)
                        : null,
                observed: value.observed,
            };
        }).filter((item) => item.observed > 0),
        response_times: [
            {
                key: "average_first_response",
                label: "Média da 1ª resposta",
                seconds: averageFirstResponse,
                observed: firstResponseValues.length,
            },
            {
                key: "median_first_response",
                label: "Mediana da 1ª resposta",
                seconds: percentile(firstResponseValues, 0.5),
                observed: firstResponseValues.length,
            },
            {
                key: "p90_first_response",
                label: "P90 da 1ª resposta",
                seconds: percentile(firstResponseValues, 0.9),
                observed: firstResponseValues.length,
            },
            {
                key: "average_human_response",
                label: "Média entre respostas",
                seconds: average(averageResponseValues),
                observed: averageResponseValues.length,
            },
            {
                key: "average_longest_delay",
                label: "Maior demora média",
                seconds: average(longestDelayValues),
                observed: longestDelayValues.length,
            },
        ].filter((item) => item.seconds !== null),
        objections: [...objections.entries()]
            .map(([key, value]) => ({
                key,
                label: OBJECTION_LABELS[key] ?? humanizeAnalysisCode(key),
                ...value,
                resolution_rate: percentage(value.resolved, value.total),
            }))
            .sort((first, second) => second.total - first.total),
    };
}

function emptyDailyAccumulator(dateIso: string): DailyAccumulator {
    return {
        date_iso: dateIso,
        conversations: 0,
        resolution_observed: 0,
        resolved: 0,
        satisfaction_observed: 0,
        satisfied: 0,
        dropoffs: 0,
        quality_total: 0,
        quality_observed: 0,
    };
}

function buildDistribution(
    values: Map<string, number>,
    denominator: number,
    getLabel: (value: string) => string,
) {
    return [...values.entries()]
        .map(([key, count]) => ({
            key,
            label: getLabel(key),
            count,
            percentage: percentage(count, denominator),
        }))
        .sort((first, second) => second.count - first.count);
}

function isResolutionObservable(value: string | null) {
    return value === "resolved" || value === "partial" || value === "not_resolved";
}

function clearSatisfactionOutcome(row: InstagramAnalysisRow): boolean | null {
    const score = nullableNumber(row.satisfaction_score);
    if (score !== null) return score >= 70;

    const sentiment = row.customer_sentiment
        ?.trim()
        .toLocaleLowerCase("pt-BR");

    if (sentiment === "positive") return true;
    if (sentiment === "negative" || sentiment === "frustrated") {
        return false;
    }

    return null;
}

function categorizeDropoffReason(value: string | null) {
    if (!value?.trim()) return "other";

    const normalized = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR");

    if (/unidade|unit|clinica|clinic/.test(normalized)) {
        return "unit_selection";
    }
    if (/preco|price|pagamento|payment|valor|custo/.test(normalized)) {
        return "price_or_payment";
    }
    if (/agend|schedule|appointment|consulta|consultation|link/.test(normalized)) {
        return "scheduling";
    }
    if (
        /medic|companheir|partner|idade|age|infertil|ovul|doa|tratamento|treatment/.test(
            normalized,
        )
    ) {
        return "medical_information";
    }
    if (/distanc|distance|regiao|region|localiz|location/.test(normalized)) {
        return "location_or_distance";
    }
    if (/pens|consider|decid|decision|tempo|time|espos|famil/.test(normalized)) {
        return "needed_time";
    }
    if (/nao respond|no response|did not respond|stopped responding|abandon/.test(normalized)) {
        return "no_response";
    }

    return "other";
}

function parseOutcomeEvents(value: unknown): AnalysisOutcomeEvent[] {
    return Array.isArray(value)
        ? value.filter(isRecord).map((event) => ({
              type: typeof event.type === "string" ? event.type : null,
          }))
        : [];
}

function parseObjections(value: unknown): AnalysisObjection[] {
    return Array.isArray(value)
        ? value.filter(isRecord).map((objection) => ({
              type:
                  typeof objection.type === "string" ? objection.type : null,
              resolved:
                  typeof objection.resolved === "boolean"
                      ? objection.resolved
                      : null,
          }))
        : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function incrementIfPresent(map: Map<string, number>, value: string | null) {
    const normalized = value?.trim();
    if (normalized) increment(map, normalized);
}

function increment(map: Map<string, number>, key: string) {
    map.set(key, (map.get(key) ?? 0) + 1);
}

function pushBoundedNumber(
    values: number[],
    rawValue: number | string | null,
    maximum: number,
) {
    const value = nullableNumber(rawValue);
    if (value !== null && value >= 0 && value <= maximum) values.push(value);
}

function nullableNumber(value: number | string | null) {
    if (value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function average(values: number[]) {
    if (values.length === 0) return null;
    return Math.round(
        values.reduce((total, value) => total + value, 0) / values.length,
    );
}

function percentile(values: number[], quantile: number) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((first, second) => first - second);
    const index = (sorted.length - 1) * quantile;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const interpolated =
        sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
    return Math.round(interpolated);
}

function percentage(numerator: number, denominator: number) {
    if (denominator <= 0) return null;
    return roundOneDecimal((numerator * 100) / denominator);
}

function roundOneDecimal(value: number) {
    return Math.round(value * 10) / 10;
}

function saoPauloDate(value: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const month = parts.find((part) => part.type === "month")?.value ?? "00";
    const day = parts.find((part) => part.type === "day")?.value ?? "00";
    return `${year}-${month}-${day}`;
}

function displayDate(dateIso: string) {
    const [, month, day] = dateIso.split("-");
    return `${day}/${month}`;
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}
