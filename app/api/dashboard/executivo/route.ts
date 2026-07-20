// app/api/dashboard/executivo/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import {
    executiveRpcParams,
    readDashboardFilters,
    resolveDashboardDateRange,
} from "@/lib/dashboard/metrics";

type ExecutiveKpis = {
    conversations_analyzed: number;
    real_resolution_rate: number | null;
    resolution_observed: number;
    resolution_coverage_rate: number | null;
    clear_satisfaction_rate: number | null;
    satisfaction_observed: number;
    satisfaction_coverage_rate: number | null;
    scheduling_rate: number | null;
    scheduling_eligible: number;
    average_first_human_response_seconds: number | null;
    raw_average_first_human_response_seconds: number | null;
    median_first_human_response_seconds: number | null;
    p90_first_human_response_seconds: number | null;
    first_human_response_observed: number;
    first_human_response_eligible: number;
    first_human_response_included_in_average: number;
    first_human_response_excluded_over_2h: number;
    first_human_response_coverage_rate: number | null;
};

type ExecutiveMetricsPayload = {
    kpis: ExecutiveKpis;
    daily_evolution: {
        date: string;
        date_iso?: string;
        conversations: number;
        resolution_rate: number | null;
        resolution_observed: number;
        satisfaction_rate: number | null;
        satisfaction_observed: number;
    }[];
    attendance_score: {
        overall_score: number | null;
        resolution_score: number | null;
        satisfaction_score: number | null;
        response_speed_score: number | null;
        attendant_quality_score: number | null;
    };
    dropoff_moments: {
        moment: string;
        label: string;
        count: number;
        percentage: number | null;
    }[];
    conversation_goals: {
        goal: string;
        label: string;
        count: number;
        percentage: number | null;
    }[];
    by_unit: {
        unit_id: string | null;
        unit_name: string;
        conversations: number;
        resolution_rate: number | null;
        resolution_observed: number;
        satisfaction_rate: number | null;
        satisfaction_observed: number;
        scheduling_rate: number | null;
        scheduling_eligible: number;
        appointments_count: number;
    }[];
};

type ClearSatisfactionMetric = {
    conversations_analyzed: number;
    satisfaction_observed: number;
    satisfied: number;
    clear_satisfaction_rate: number | null;
    satisfaction_coverage_rate: number | null;
};

type ExecutiveDashboardResponse = ExecutiveMetricsPayload & {
    filters: {
        days: number;
        start_date: string | null;
        end_date: string | null;
        unit_ids: string[];
        service_ids: string[];
        attendant_ids: string[];
        tunnel_values: string[];
        origin_values: string[];
    };
    previous_kpis: ExecutiveKpis;
    response_anchor_breakdown: {
        bot_handoff_to_attendant: number;
        pending_client_to_attendant: number;
    };
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);
    const filters = readDashboardFilters(searchParams);
    const currentParams = executiveRpcParams(
        { startAt: range.startAt, endAt: range.endAt },
        filters,
    );
    const previousParams = executiveRpcParams(
        {
            startAt: range.previousStartAt,
            endAt: range.previousEndAt,
        },
        filters,
    );

    // v3 returns the canonical metrics, clear-satisfaction overrides, response
    // anchors and per-unit satisfaction from one database scan per period.
    // This replaces the previous N+1 RPC pattern without changing the payload
    // shown by the dashboard.
    const [currentResult, previousResult] = await Promise.all([
        supabase
            .rpc("dashboard_executive_metrics_v3", currentParams)
            .abortSignal(request.signal),
        supabase
            .rpc("dashboard_executive_metrics_v3", previousParams)
            .abortSignal(request.signal),
    ]);

    if (currentResult.error) {
        console.error(
            "[dashboard/executivo] canonical metric RPC failed",
            currentResult.error,
        );
        return NextResponse.json(
            {
                error:
                    currentResult.error.message ??
                    "Falha ao carregar métricas.",
            },
            { status: 500 },
        );
    }

    if (previousResult.error) {
        console.error(
            "[dashboard/executivo] previous metric RPC failed; hiding trends",
            previousResult.error,
        );
    }

    const current = applyClearSatisfactionMetric(
        normalizeExecutivePayload(currentResult.data),
        normalizeClearSatisfactionMetric(
            asObject(currentResult.data).clear_satisfaction_metric,
        ),
    );
    const previous = applyClearSatisfactionMetric(
        normalizeExecutivePayload(
            previousResult.error ? null : previousResult.data,
        ),
        previousResult.error
            ? null
            : normalizeClearSatisfactionMetric(
                  asObject(previousResult.data).clear_satisfaction_metric,
        ),
    );
    const unitSatisfaction = normalizeUnitSatisfaction(
        asObject(currentResult.data).unit_clear_satisfaction,
    );

    const [
        scheduleCounts,
        currentScheduleCount,
        previousScheduleCount,
        currentConversationCount,
        previousConversationCount,
    ] = await Promise.all([
        loadScheduleCounts(range, filters, request.signal),
        loadScheduleTotal(range, filters, "current", request.signal),
        loadScheduleTotal(range, filters, "previous", request.signal),
        loadRawConversationCount(range, filters, "current", request.signal),
        loadRawConversationCount(range, filters, "previous", request.signal),
    ]);
    const currentWithScheduleRate = applyScheduleRateMetric(current, {
        scheduleCount: currentScheduleCount,
        conversationCount: currentConversationCount,
    });
    const previousWithScheduleRate = applyScheduleRateMetric(previous, {
        scheduleCount: previousScheduleCount,
        conversationCount: previousConversationCount,
    });
    const byUnit = mergeUnitMetrics(
        currentWithScheduleRate.by_unit,
        scheduleCounts,
        unitSatisfaction,
    );

    const response: ExecutiveDashboardResponse = {
        filters: {
            days: range.days,
            start_date: range.startDate,
            end_date: range.endDate,
            unit_ids: filters.unitIds,
            service_ids: filters.serviceIds,
            attendant_ids: filters.attendantIds,
            tunnel_values: filters.tunnels,
            origin_values: filters.origins,
        },
        kpis: currentWithScheduleRate.kpis,
        previous_kpis: previousWithScheduleRate.kpis,
        response_anchor_breakdown: normalizeResponseAnchorBreakdown(
            asObject(currentResult.data).response_anchor_breakdown,
        ),
        daily_evolution: current.daily_evolution,
        attendance_score: currentWithScheduleRate.attendance_score,
        dropoff_moments: current.dropoff_moments,
        conversation_goals: current.conversation_goals,
        by_unit: byUnit,
    };

    return NextResponse.json(response, {
        headers: { "Cache-Control": "private, no-store" },
    });
}

type ScheduleCount = {
    unit_name: string;
    count: number;
};

type UnitSatisfaction = {
    satisfaction_observed: number;
    satisfaction_rate: number | null;
};

async function loadScheduleCounts(
    range: ReturnType<typeof resolveDashboardDateRange>,
    filters: ReturnType<typeof readDashboardFilters>,
    signal: AbortSignal,
): Promise<ScheduleCount[]> {
    try {
        let selectedUnitNames: string[] | null = null;

        if (filters.unitIds.length > 0) {
            const { data: units, error: unitsError } = await supabase
                .from("units")
                .select("name")
                .in("id", filters.unitIds)
                .abortSignal(signal);

            if (unitsError) throw unitsError;
            selectedUnitNames = (units ?? [])
                .map((unit) => unit.name?.trim())
                .filter((name): name is string => Boolean(name));
        }

        const startDate = range.startDate ?? brazilDate(range.startAt);
        const endDate = range.endDate ?? brazilDate(
            new Date(new Date(range.endAt).getTime() - 1).toISOString(),
        );

        let query = supabase
            .from("schedules")
            .select("unit_name")
            .gte("scheduled_for", startDate)
            .lte("scheduled_for", endDate)
            .limit(50_000);

        if (selectedUnitNames) {
            if (selectedUnitNames.length === 0) return [];
            query = query.in("unit_name", selectedUnitNames);
        }

        const { data, error } = await query.abortSignal(signal);
        if (error) throw error;

        const counts = new Map<string, ScheduleCount>();
        for (const row of data ?? []) {
            const unitName = row.unit_name?.trim() || "Sem unidade";
            const key = normalizeUnitName(unitName);
            const current = counts.get(key) ?? { unit_name: unitName, count: 0 };
            current.count += 1;
            counts.set(key, current);
        }

        return [...counts.values()];
    } catch (error) {
        console.error("[dashboard/executivo] failed to load schedules", error);
        return [];
    }
}

async function loadScheduleTotal(
    range: ReturnType<typeof resolveDashboardDateRange>,
    filters: ReturnType<typeof readDashboardFilters>,
    period: "current" | "previous",
    signal: AbortSignal,
): Promise<number | null> {
    try {
        const startAt =
            period === "current" ? range.startAt : range.previousStartAt;
        const endAt = period === "current" ? range.endAt : range.previousEndAt;
        const startDate =
            period === "current" && range.startDate
                ? range.startDate
                : brazilDate(startAt);
        const endDate =
            period === "current" && range.endDate
                ? range.endDate
                : brazilDate(
                      new Date(new Date(endAt).getTime() - 1).toISOString(),
                  );

        let selectedUnitNames: string[] | null = null;

        if (filters.unitIds.length > 0) {
            const { data: units, error: unitsError } = await supabase
                .from("units")
                .select("name")
                .in("id", filters.unitIds)
                .abortSignal(signal);

            if (unitsError) throw unitsError;
            selectedUnitNames = (units ?? [])
                .map((unit) => unit.name?.trim())
                .filter((name): name is string => Boolean(name));
        }

        let query = supabase
            .from("schedules")
            .select("id", { count: "exact", head: true })
            .gte("scheduled_for", startDate)
            .lte("scheduled_for", endDate);

        if (selectedUnitNames) {
            if (selectedUnitNames.length === 0) return 0;
            query = query.in("unit_name", selectedUnitNames);
        }

        const { count, error } = await query.abortSignal(signal);
        if (error) throw error;
        return count ?? 0;
    } catch (error) {
        console.error(
            `[dashboard/executivo] failed to load ${period} schedules total`,
            error,
        );
        return null;
    }
}

async function loadRawConversationCount(
    range: ReturnType<typeof resolveDashboardDateRange>,
    filters: ReturnType<typeof readDashboardFilters>,
    period: "current" | "previous",
    signal: AbortSignal,
): Promise<number | null> {
    try {
        const startAt =
            period === "current" ? range.startAt : range.previousStartAt;
        const endAt = period === "current" ? range.endAt : range.previousEndAt;

        let query = supabase
            .from("conversations")
            .select("id", { count: "exact", head: true })
            .gte("started_at", startAt)
            .lt("started_at", endAt);

        if (filters.unitIds.length > 0) {
            query = query.in("unit_id", filters.unitIds);
        }
        if (filters.serviceIds.length > 0) {
            query = query.in("service_id", filters.serviceIds);
        }
        if (filters.attendantIds.length > 0) {
            query = query.in("attendant_id", filters.attendantIds);
        }
        if (filters.tunnels.length > 0) {
            query = query.in("tunnel", filters.tunnels);
        }
        if (filters.origins.length > 0) {
            query = query.in("origin", filters.origins);
        }

        const { count, error } = await query.abortSignal(signal);
        if (error) throw error;
        return count ?? 0;
    } catch (error) {
        console.error(
            `[dashboard/executivo] failed to load ${period} raw conversations`,
            error,
        );
        return null;
    }
}

function applyScheduleRateMetric(
    payload: ExecutiveMetricsPayload,
    values: {
        scheduleCount: number | null;
        conversationCount: number | null;
    },
): ExecutiveMetricsPayload {
    const schedulingRate =
        values.scheduleCount === null ||
        values.conversationCount === null ||
        values.conversationCount <= 0
            ? null
            : Number(
                  ((values.scheduleCount / values.conversationCount) * 100).toFixed(
                      1,
                  ),
              );
    const attendanceScore = {
        ...payload.attendance_score,
        overall_score: averageNullable([
            payload.attendance_score.resolution_score,
            payload.attendance_score.satisfaction_score,
            schedulingRate,
            payload.attendance_score.attendant_quality_score,
        ]),
    };

    return {
        ...payload,
        kpis: {
            ...payload.kpis,
            scheduling_rate: schedulingRate,
            // Kept for API compatibility; this is now the raw conversation
            // denominator used by the schedules-based rate.
            scheduling_eligible: values.conversationCount ?? 0,
        },
        attendance_score: attendanceScore,
    };
}

function mergeUnitMetrics(
    units: ExecutiveMetricsPayload["by_unit"],
    scheduleCounts: ScheduleCount[],
    unitSatisfaction: Map<string, UnitSatisfaction | null>,
) {
    const schedulesByName = new Map(
        scheduleCounts.map((item) => [normalizeUnitName(item.unit_name), item.count]),
    );
    const seenNames = new Set<string>();

    const merged = units.map((unit) => {
        const nameKey = normalizeUnitName(unit.unit_name);
        seenNames.add(nameKey);
        const satisfaction = unit.unit_id
            ? unitSatisfaction.get(unit.unit_id)
            : null;

        return {
            ...unit,
            satisfaction_rate:
                satisfaction?.satisfaction_rate ?? unit.satisfaction_rate,
            satisfaction_observed:
                satisfaction?.satisfaction_observed ??
                unit.satisfaction_observed,
            appointments_count: schedulesByName.get(nameKey) ?? 0,
        };
    });

    for (const schedule of scheduleCounts) {
        const nameKey = normalizeUnitName(schedule.unit_name);
        if (seenNames.has(nameKey)) continue;

        merged.push({
            unit_id: null,
            unit_name: schedule.unit_name,
            conversations: 0,
            resolution_rate: null,
            resolution_observed: 0,
            satisfaction_rate: null,
            satisfaction_observed: 0,
            scheduling_rate: null,
            scheduling_eligible: 0,
            appointments_count: schedule.count,
        });
    }

    return merged;
}

function normalizeUnitSatisfaction(value: unknown) {
    const entries = arrayOrEmpty<unknown>(value).flatMap((item) => {
        const row = asObject(item);
        const unitId = typeof row.unit_id === "string" ? row.unit_id : null;

        if (!unitId) return [];

        return [[
            unitId,
            {
                satisfaction_observed: numberOrZero(
                    row,
                    "satisfaction_observed",
                ),
                satisfaction_rate: nullableNumber(
                    row,
                    "clear_satisfaction_rate",
                ),
            },
        ] as const];
    });

    return new Map<string, UnitSatisfaction | null>(entries);
}

function brazilDate(value: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function normalizeUnitName(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLocaleLowerCase("pt-BR");
}

function normalizeResponseAnchorBreakdown(value: unknown) {
    const payload = asObject(value);
    return {
        bot_handoff_to_attendant: numberOrZero(
            payload,
            "bot_handoff_to_attendant",
        ),
        pending_client_to_attendant: numberOrZero(
            payload,
            "pending_client_to_attendant",
        ),
    };
}

function normalizeClearSatisfactionMetric(
    value: unknown,
): ClearSatisfactionMetric | null {
    const payload = asObject(value);
    const conversationsAnalyzed = nullableNumber(
        payload,
        "conversations_analyzed",
    );

    if (conversationsAnalyzed === null) {
        return null;
    }

    return {
        conversations_analyzed: conversationsAnalyzed,
        satisfaction_observed: numberOrZero(
            payload,
            "satisfaction_observed",
        ),
        satisfied: numberOrZero(payload, "satisfied"),
        clear_satisfaction_rate: nullableNumber(
            payload,
            "clear_satisfaction_rate",
        ),
        satisfaction_coverage_rate: nullableNumber(
            payload,
            "satisfaction_coverage_rate",
        ),
    };
}

function applyClearSatisfactionMetric(
    payload: ExecutiveMetricsPayload,
    metric: ClearSatisfactionMetric | null,
): ExecutiveMetricsPayload {
    if (!metric) {
        return payload;
    }

    const satisfactionRate = metric.clear_satisfaction_rate;
    const attendanceScore = {
        ...payload.attendance_score,
        satisfaction_score: satisfactionRate,
    };

    return {
        ...payload,
        kpis: {
            ...payload.kpis,
            clear_satisfaction_rate: satisfactionRate,
            satisfaction_observed: metric.satisfaction_observed,
            satisfaction_coverage_rate:
                metric.satisfaction_coverage_rate,
        },
        attendance_score: {
            ...attendanceScore,
            overall_score: averageNullable([
                attendanceScore.resolution_score,
                satisfactionRate,
                payload.kpis.scheduling_rate,
                attendanceScore.attendant_quality_score,
            ]),
        },
    };
}

function normalizeExecutivePayload(value: unknown): ExecutiveMetricsPayload {
    const payload = asObject(value);
    const conversationsAnalyzed = numberOrZero(
        payload.kpis,
        "conversations_analyzed",
    );
    const satisfactionObserved = numberOrZero(
        payload.kpis,
        "satisfaction_observed",
    );
    const observedSatisfactionRate = nullableNumber(
        payload.kpis,
        "clear_satisfaction_rate",
    );
    const clearSatisfactionRate = satisfactionRateAcrossAllAnalyzed({
        conversationsAnalyzed,
        satisfactionObserved,
        observedSatisfactionRate,
    });

    const attendanceScorePayload = asObject(payload.attendance_score);
    const resolutionScore = nullableNumber(
        attendanceScorePayload,
        "resolution_score",
    );
    const schedulingRate = nullableNumber(payload.kpis, "scheduling_rate");
    const attendantQualityScore = nullableNumber(
        attendanceScorePayload,
        "attendant_quality_score",
    );

    return {
        kpis: {
            conversations_analyzed: conversationsAnalyzed,
            real_resolution_rate: nullableNumber(
                payload.kpis,
                "real_resolution_rate",
            ),
            resolution_observed: numberOrZero(
                payload.kpis,
                "resolution_observed",
            ),
            resolution_coverage_rate: nullableNumber(
                payload.kpis,
                "resolution_coverage_rate",
            ),
            clear_satisfaction_rate: clearSatisfactionRate,
            satisfaction_observed: satisfactionObserved,
            satisfaction_coverage_rate: nullableNumber(
                payload.kpis,
                "satisfaction_coverage_rate",
            ),
            scheduling_rate: schedulingRate,
            scheduling_eligible: numberOrZero(
                payload.kpis,
                "scheduling_eligible",
            ),
            average_first_human_response_seconds: nullableNumber(
                payload.kpis,
                "average_first_human_response_seconds",
            ),
            raw_average_first_human_response_seconds: nullableNumber(
                payload.kpis,
                "raw_average_first_human_response_seconds",
            ),
            median_first_human_response_seconds: nullableNumber(
                payload.kpis,
                "median_first_human_response_seconds",
            ),
            p90_first_human_response_seconds: nullableNumber(
                payload.kpis,
                "p90_first_human_response_seconds",
            ),
            first_human_response_observed: numberOrZero(
                payload.kpis,
                "first_human_response_observed",
            ),
            first_human_response_eligible: numberOrZero(
                payload.kpis,
                "first_human_response_eligible",
            ),
            first_human_response_included_in_average: numberOrZero(
                payload.kpis,
                "first_human_response_included_in_average",
            ),
            first_human_response_excluded_over_2h: numberOrZero(
                payload.kpis,
                "first_human_response_excluded_over_2h",
            ),
            first_human_response_coverage_rate: nullableNumber(
                payload.kpis,
                "first_human_response_coverage_rate",
            ),
        },
        daily_evolution: arrayOrEmpty<
            ExecutiveMetricsPayload["daily_evolution"][number]
        >(payload.daily_evolution),
        attendance_score: {
            overall_score: averageNullable([
                resolutionScore,
                clearSatisfactionRate,
                schedulingRate,
                attendantQualityScore,
            ]),
            resolution_score: resolutionScore,
            satisfaction_score: clearSatisfactionRate,
            response_speed_score: nullableNumber(
                attendanceScorePayload,
                "response_speed_score",
            ),
            attendant_quality_score: attendantQualityScore,
        },
        dropoff_moments: arrayOrEmpty<
            ExecutiveMetricsPayload["dropoff_moments"][number]
        >(payload.dropoff_moments),
        conversation_goals: arrayOrEmpty<
            ExecutiveMetricsPayload["conversation_goals"][number]
        >(payload.conversation_goals),
        by_unit: arrayOrEmpty<
            ExecutiveMetricsPayload["by_unit"][number]
        >(payload.by_unit),
    };
}

function satisfactionRateAcrossAllAnalyzed({
    conversationsAnalyzed,
    satisfactionObserved,
    observedSatisfactionRate,
}: {
    conversationsAnalyzed: number;
    satisfactionObserved: number;
    observedSatisfactionRate: number | null;
}) {
    if (
        conversationsAnalyzed <= 0 ||
        satisfactionObserved <= 0 ||
        observedSatisfactionRate === null
    ) {
        return null;
    }

    const estimatedSatisfied = Math.round(
        (satisfactionObserved * observedSatisfactionRate) / 100,
    );
    return Math.round((estimatedSatisfied * 100) / conversationsAnalyzed);
}

function averageNullable(values: (number | null)[]) {
    const present = values.filter(
        (value): value is number => value !== null,
    );
    return present.length
        ? Math.round(
              present.reduce((sum, value) => sum + value, 0) /
                  present.length,
          )
        : null;
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function arrayOrEmpty<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function nullableNumber(container: unknown, key: string): number | null {
    const value = asObject(container)[key];
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : null;
}

function numberOrZero(container: unknown, key: string) {
    return nullableNumber(container, key) ?? 0;
}
