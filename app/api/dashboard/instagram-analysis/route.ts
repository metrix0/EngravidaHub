// app/api/dashboard/instagram-analysis/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { resolveDashboardDateRange } from "@/lib/dashboard/metrics";

const PAGE_SIZE = 1_000;
const MAX_CONVERSATIONS = 100_000;
const ID_BATCH_SIZE = 100;

type InstagramConversationRow = {
    id: string;
    started_at: string;
};

type InstagramAnalysisRow = {
    conversation_id: string;
    resolution_result: string | null;
    satisfaction_score: number | string | null;
    customer_sentiment: string | null;
    first_human_response_time_seconds: number | string | null;
    attendant_quality_score: number | string | null;
};

type DailyAccumulator = {
    date_iso: string;
    conversations: number;
    resolution_observed: number;
    resolved: number;
    satisfaction_observed: number;
    satisfied: number;
    quality_total: number;
    quality_observed: number;
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);

    try {
        const conversations = await loadInstagramConversations(
            range.startAt,
            range.endAt,
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

async function loadInstagramConversations(
    startAt: string,
    endAt: string,
    signal: AbortSignal,
) {
    const rows: InstagramConversationRow[] = [];

    for (let from = 0; from < MAX_CONVERSATIONS; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("conversations")
            .select("id, started_at")
            .eq("channel", "Instagram")
            .gte("started_at", startAt)
            .lt("started_at", endAt)
            .order("started_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);

        if (error) throw error;

        const page = (data ?? []) as InstagramConversationRow[];
        rows.push(...page);
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
                "conversation_id, resolution_result, satisfaction_score, customer_sentiment, first_human_response_time_seconds, attendant_quality_score",
            )
            .in("conversation_id", ids)
            .abortSignal(signal);

        if (error) throw error;
        rows.push(...((data ?? []) as InstagramAnalysisRow[]));
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

    let resolutionObserved = 0;
    let resolved = 0;
    let satisfactionObserved = 0;
    let satisfied = 0;
    let responseTotal = 0;
    let responseObserved = 0;
    let qualityTotal = 0;
    let qualityObserved = 0;

    for (const analysis of analyses) {
        const startedAt = startedAtByConversationId.get(
            analysis.conversation_id,
        );
        if (!startedAt) continue;

        const dateIso = saoPauloDate(startedAt);
        const point = daily.get(dateIso) ?? emptyDailyAccumulator(dateIso);
        point.conversations += 1;

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

        const responseSeconds = nullableNumber(
            analysis.first_human_response_time_seconds,
        );
        if (responseSeconds !== null && responseSeconds <= 7_200) {
            responseTotal += responseSeconds;
            responseObserved += 1;
        }

        const qualityScore = nullableNumber(analysis.attendant_quality_score);
        if (qualityScore !== null) {
            qualityTotal += qualityScore;
            qualityObserved += 1;
            point.quality_total += qualityScore;
            point.quality_observed += 1;
        }

        daily.set(dateIso, point);
    }

    return {
        scope: "instagram_global",
        conversations_total: conversations.length,
        conversations_analyzed: analyses.length,
        analysis_coverage_rate: percentage(analyses.length, conversations.length),
        resolution_rate: percentage(resolved, resolutionObserved),
        resolution_observed: resolutionObserved,
        satisfaction_rate: percentage(satisfied, satisfactionObserved),
        satisfaction_observed: satisfactionObserved,
        average_first_human_response_seconds:
            responseObserved > 0
                ? Math.round(responseTotal / responseObserved)
                : null,
        attendant_quality_score:
            qualityObserved > 0
                ? roundOneDecimal(qualityTotal / qualityObserved)
                : null,
        attendant_quality_observed: qualityObserved,
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
                attendant_quality_score:
                    point.quality_observed > 0
                        ? roundOneDecimal(
                              point.quality_total / point.quality_observed,
                          )
                        : null,
            })),
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
        quality_total: 0,
        quality_observed: 0,
    };
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

function nullableNumber(value: number | string | null) {
    if (value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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
