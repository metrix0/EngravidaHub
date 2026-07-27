// app/api/dashboard/executivo/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import {
    executiveRpcParams,
    readDashboardFilters,
    resolveDashboardDateRange,
} from "@/lib/dashboard/metrics";
import {
    normalizeScheduleStatus,
    scheduleShowedUp,
    type ScheduleStatusGroup,
} from "@/lib/schedules/status";

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
    schedule_summary: ScheduleSummary;
    schedule_evolution: ScheduleEvolutionPoint[];
    schedule_creation_evolution: ScheduleCreationEvolutionPoint[];
    schedules_by_unit: ScheduleUnitDistribution[];
    schedule_unit_table: ScheduleUnitTable;
};

type ScheduleSummary = {
    total: number;
    unique_total: number;
    cancelled: number;
    showed_up: number;
    no_show: number;
    rescheduled: number;
    pending: number;
    unknown: number;
};

type ScheduleEvolutionPoint = {
    date: string;
    date_iso: string;
    total: number;
    cancelled: number;
    showed_up: number;
    no_show: number;
    rescheduled: number;
    unique_total: number;
    unique_cancelled: number;
    unique_showed_up: number;
    unique_no_show: number;
    unique_rescheduled: number;
};

type ScheduleCreationEvolutionPoint = {
    date: string;
    date_iso: string;
    total: number;
};

type ScheduleUnitDistribution = {
    unit_name: string;
    count: number;
    percentage: number | null;
    no_show: number;
    outcomes_observed: number;
    no_show_rate: number | null;
};

type ScheduleUnitTableRow = {
    unit_name: string;
    appointments: number;
    reschedulings: number;
    rescheduling_rate: number | null;
    unique_appointments: number;
    pending: number;
    showed_up: number;
    showed_up_rate: number | null;
    projection: number;
    rescheduled: number;
    rescheduled_rate: number | null;
    cancelled: number;
    cancelled_rate: number | null;
    no_show: number;
    no_show_rate: number | null;
};

type ScheduleUnitTable = {
    rows: ScheduleUnitTableRow[];
    total: ScheduleUnitTableRow;
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
    const currentResult = await runExecutiveMetricsRpc(
        currentParams,
        request.signal,
        "current",
    );

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

    const previousResult = await runExecutiveMetricsRpc(
        previousParams,
        request.signal,
        "previous",
    );

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

    const selectedUnitNames = await loadSelectedUnitNames(
        filters,
        request.signal,
    );
    const [
        scheduleAnalytics,
        scheduleCreationEvolution,
        previousScheduleCount,
        currentConversationCount,
        previousConversationCount,
    ] = await Promise.all([
        loadScheduleAnalytics(range, selectedUnitNames, request.signal),
        loadScheduleCreationEvolution(range, selectedUnitNames, request.signal),
        loadScheduleTotal(
            range,
            selectedUnitNames,
            "previous",
            request.signal,
        ),
        loadRawConversationCount(range, filters, "current", request.signal),
        loadRawConversationCount(range, filters, "previous", request.signal),
    ]);
    const currentScheduleCount = scheduleAnalytics.available
        ? scheduleAnalytics.summary.total
        : null;
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
        scheduleAnalytics.byUnit,
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
        schedule_summary: scheduleAnalytics.summary,
        schedule_evolution: scheduleAnalytics.evolution,
        schedule_creation_evolution: scheduleCreationEvolution,
        schedules_by_unit: scheduleAnalytics.byUnit,
        schedule_unit_table: scheduleAnalytics.unitTable,
        attendance_score: currentWithScheduleRate.attendance_score,
        dropoff_moments: current.dropoff_moments,
        conversation_goals: current.conversation_goals,
        by_unit: byUnit,
    };

    return NextResponse.json(response, {
        headers: { "Cache-Control": "private, no-store" },
    });
}

async function runExecutiveMetricsRpc(
    params: ReturnType<typeof executiveRpcParams>,
    signal: AbortSignal,
    period: "current" | "previous",
) {
    let result = await supabase
        .rpc("dashboard_executive_metrics_v3", params)
        .abortSignal(signal);

    if (!signal.aborted && isStatementTimeout(result.error)) {
        console.warn(
            `[dashboard/executivo] ${period} metric RPC timed out; retrying once`,
        );
        result = await supabase
            .rpc("dashboard_executive_metrics_v3", params)
            .abortSignal(signal);
    }

    return result;
}

function isStatementTimeout(error: { code?: string; message?: string } | null) {
    return (
        error?.code === "57014" ||
        error?.message?.toLocaleLowerCase("pt-BR").includes("statement timeout") ===
            true
    );
}

type UnitSatisfaction = {
    satisfaction_observed: number;
    satisfaction_rate: number | null;
};

type ScheduleAnalyticsRow = {
    id: string;
    source_hash: string;
    source_external_id: string | null;
    client_id: string | null;
    normalized_phone: string | null;
    patient_name: string | null;
    scheduled_for: string;
    created_in_source_at: string | null;
    unit_name: string | null;
    status: string | null;
    updated_at: string;
};

type ScheduleCreationRow = {
    id: string;
    created_in_source_at: string;
    unit_name: string | null;
};

type ScheduleAnalyticsResult = {
    available: boolean;
    summary: ScheduleSummary;
    evolution: ScheduleEvolutionPoint[];
    byUnit: ScheduleUnitDistribution[];
    unitTable: ScheduleUnitTable;
};

const SCHEDULE_PAGE_SIZE = 1_000;
const MAX_SCHEDULE_ANALYTICS_ROWS = 50_000;

async function loadSelectedUnitNames(
    filters: ReturnType<typeof readDashboardFilters>,
    signal: AbortSignal,
): Promise<string[] | null> {
    if (filters.unitIds.length === 0) return null;

    const { data, error } = await supabase
        .from("units")
        .select("name")
        .in("id", filters.unitIds)
        .abortSignal(signal);

    if (error) {
        console.error(
            "[dashboard/executivo] failed to resolve schedule unit filters",
            error,
        );
        return [];
    }

    return (data ?? [])
        .map((unit: { name?: string | null }) => unit.name?.trim())
        .filter((name: string | undefined): name is string => Boolean(name));
}

async function loadScheduleAnalytics(
    range: ReturnType<typeof resolveDashboardDateRange>,
    selectedUnitNames: string[] | null,
    signal: AbortSignal,
): Promise<ScheduleAnalyticsResult> {
    try {
        const startDate = range.startDate ?? brazilDate(range.startAt);
        const endDate = range.endDate ?? brazilDate(
            new Date(new Date(range.endAt).getTime() - 1).toISOString(),
        );
        const empty = emptyScheduleAnalytics(startDate, endDate, true);

        if (selectedUnitNames?.length === 0) return empty;

        const rows: ScheduleAnalyticsRow[] = [];

        for (
            let from = 0;
            from < MAX_SCHEDULE_ANALYTICS_ROWS;
            from += SCHEDULE_PAGE_SIZE
        ) {
            let query = supabase
                .from("schedules")
                .select("id, source_hash, source_external_id, client_id, normalized_phone, patient_name, scheduled_for, created_in_source_at, unit_name, status, updated_at")
                .gte("scheduled_for", startDate)
                .lte("scheduled_for", endDate)
                .order("scheduled_for", { ascending: true })
                .order("id", { ascending: true })
                .range(from, from + SCHEDULE_PAGE_SIZE - 1);

            if (selectedUnitNames) {
                query = query.in("unit_name", selectedUnitNames);
            }

            const { data, error } = await query.abortSignal(signal);
            if (error) throw error;

            const page = (data ?? []) as ScheduleAnalyticsRow[];
            rows.push(...page);
            if (page.length < SCHEDULE_PAGE_SIZE) break;
        }

        const summary = emptyScheduleSummary();
        const evolutionByDate = new Map(
            buildDateRange(startDate, endDate).map((dateIso) => [
                dateIso,
                emptyScheduleEvolutionPoint(dateIso),
            ]),
        );
        const units = new Map<
            string,
            {
                unit_name: string;
                count: number;
                no_show: number;
                showed_up: number;
            }
        >();

        for (const row of rows) {
            const group = normalizeScheduleStatus(row.status);
            summary.total += 1;
            incrementScheduleSummary(summary, group);

            const daily = evolutionByDate.get(row.scheduled_for);
            if (daily) {
                daily.total += 1;
                if (group === "cancelled") daily.cancelled += 1;
                if (scheduleShowedUp(group)) daily.showed_up += 1;
                if (group === "no_show") daily.no_show += 1;
                if (group === "rescheduled") daily.rescheduled += 1;
            }

            const unitName = row.unit_name?.trim() || "Sem unidade";
            const key = normalizeUnitName(unitName);
            const current = units.get(key) ?? {
                unit_name: unitName,
                count: 0,
                no_show: 0,
                showed_up: 0,
            };
            current.count += 1;
            if (group === "no_show") current.no_show += 1;
            if (scheduleShowedUp(group)) current.showed_up += 1;
            units.set(key, current);
        }

        const uniqueRows = latestUniqueScheduleRows(rows);
        summary.unique_total = uniqueRows.length;
        for (const row of uniqueRows) {
            const group = normalizeScheduleStatus(row.status);
            const daily = evolutionByDate.get(row.scheduled_for);
            if (!daily) continue;

            daily.unique_total += 1;
            if (group === "cancelled") daily.unique_cancelled += 1;
            if (scheduleShowedUp(group)) daily.unique_showed_up += 1;
            if (group === "no_show") daily.unique_no_show += 1;
            if (group === "rescheduled") daily.unique_rescheduled += 1;
        }

        const byUnit = [...units.values()]
            .map((unit) => {
                const outcomesObserved = unit.showed_up + unit.no_show;
                return {
                    unit_name: unit.unit_name,
                    count: unit.count,
                    percentage:
                        summary.total > 0
                            ? Number(
                                  ((unit.count / summary.total) * 100).toFixed(1),
                              )
                            : null,
                    no_show: unit.no_show,
                    outcomes_observed: outcomesObserved,
                    no_show_rate:
                        outcomesObserved > 0
                            ? Number(
                                  ((unit.no_show / outcomesObserved) * 100).toFixed(1),
                              )
                            : null,
                };
            })
            .sort(
                (first, second) =>
                    second.count - first.count ||
                    first.unit_name.localeCompare(
                        second.unit_name,
                        "pt-BR",
                    ),
            );

        const unitTable = buildScheduleUnitTable(rows, startDate, endDate);

        return {
            available: true,
            summary,
            evolution: [...evolutionByDate.values()],
            byUnit,
            unitTable,
        };
    } catch (error) {
        console.error("[dashboard/executivo] failed to load schedules", error);
        const startDate = range.startDate ?? brazilDate(range.startAt);
        const endDate = range.endDate ?? brazilDate(
            new Date(new Date(range.endAt).getTime() - 1).toISOString(),
        );
        return emptyScheduleAnalytics(startDate, endDate, false);
    }
}

async function loadScheduleCreationEvolution(
    range: ReturnType<typeof resolveDashboardDateRange>,
    selectedUnitNames: string[] | null,
    signal: AbortSignal,
): Promise<ScheduleCreationEvolutionPoint[]> {
    const startDate = range.startDate ?? brazilDate(range.startAt);
    const endDate = range.endDate ?? brazilDate(
        new Date(new Date(range.endAt).getTime() - 1).toISOString(),
    );
    const evolutionByDate = new Map(
        buildDateRange(startDate, endDate).map((dateIso) => [
            dateIso,
            emptyScheduleCreationEvolutionPoint(dateIso),
        ]),
    );

    if (selectedUnitNames?.length === 0) {
        return [...evolutionByDate.values()];
    }

    try {
        for (
            let from = 0;
            from < MAX_SCHEDULE_ANALYTICS_ROWS;
            from += SCHEDULE_PAGE_SIZE
        ) {
            let query = supabase
                .from("schedules")
                .select("id, created_in_source_at, unit_name")
                .gte("created_in_source_at", startDate)
                .lte("created_in_source_at", endDate)
                .order("created_in_source_at", { ascending: true })
                .order("id", { ascending: true })
                .range(from, from + SCHEDULE_PAGE_SIZE - 1);

            if (selectedUnitNames) {
                query = query.in("unit_name", selectedUnitNames);
            }

            const { data, error } = await query.abortSignal(signal);
            if (error) throw error;

            const page = (data ?? []) as ScheduleCreationRow[];
            for (const row of page) {
                const daily = evolutionByDate.get(row.created_in_source_at);
                if (daily) daily.total += 1;
            }

            if (page.length < SCHEDULE_PAGE_SIZE) break;
        }
    } catch (error) {
        console.error(
            "[dashboard/executivo] failed to load schedule creation evolution",
            error,
        );
    }

    return [...evolutionByDate.values()];
}

async function loadScheduleTotal(
    range: ReturnType<typeof resolveDashboardDateRange>,
    selectedUnitNames: string[] | null,
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
    scheduleCounts: ScheduleUnitDistribution[],
    unitSatisfaction: Map<string, UnitSatisfaction | null>,
) {
    const schedulesByName = new Map(
        scheduleCounts.map((item) => [normalizeUnitName(item.unit_name), item]),
    );
    const seenNames = new Set<string>();

    const merged = units.map((unit) => {
        const nameKey = normalizeUnitName(unit.unit_name);
        seenNames.add(nameKey);
        const satisfaction = unit.unit_id
            ? unitSatisfaction.get(unit.unit_id)
            : null;
        const schedules = schedulesByName.get(nameKey) ?? null;

        return {
            ...unit,
            satisfaction_rate:
                satisfaction?.satisfaction_rate ?? unit.satisfaction_rate,
            satisfaction_observed:
                satisfaction?.satisfaction_observed ??
                unit.satisfaction_observed,
            appointments_count: schedules?.count ?? 0,
            no_show_rate: schedules?.no_show_rate ?? null,
            no_show: schedules?.no_show ?? 0,
            outcomes_observed: schedules?.outcomes_observed ?? 0,
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
            no_show_rate: schedule.no_show_rate,
            no_show: schedule.no_show,
            outcomes_observed: schedule.outcomes_observed,
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

function latestUniqueScheduleRows(rows: ScheduleAnalyticsRow[]) {
    const latest = new Map<string, ScheduleAnalyticsRow>();

    for (const row of rows) {
        const key = scheduleIdentity(row);
        const current = latest.get(key);
        if (!current || compareScheduleRecency(row, current) > 0) {
            latest.set(key, row);
        }
    }

    return [...latest.values()];
}

function scheduleIdentity(row: ScheduleAnalyticsRow) {
    const phone = row.normalized_phone?.trim();
    if (phone) return `phone:${phone}`;
    if (row.client_id) return `client:${row.client_id}`;
    const patient = normalizeUnitName(row.patient_name?.trim() || "");
    if (patient) return `patient:${patient}`;
    return `schedule:${row.source_hash || row.id}`;
}

function compareScheduleRecency(
    first: ScheduleAnalyticsRow,
    second: ScheduleAnalyticsRow,
) {
    const dateComparison = first.scheduled_for.localeCompare(second.scheduled_for);
    if (dateComparison !== 0) return dateComparison;

    const firstExternal = Number(first.source_external_id ?? 0);
    const secondExternal = Number(second.source_external_id ?? 0);
    if (Number.isFinite(firstExternal) && Number.isFinite(secondExternal)) {
        const externalComparison = firstExternal - secondExternal;
        if (externalComparison !== 0) return externalComparison;
    }

    const createdComparison = (first.created_in_source_at ?? "").localeCompare(
        second.created_in_source_at ?? "",
    );
    if (createdComparison !== 0) return createdComparison;
    return first.updated_at.localeCompare(second.updated_at);
}

function buildScheduleUnitTable(
    rows: ScheduleAnalyticsRow[],
    startDate: string,
    endDate: string,
): ScheduleUnitTable {
    const projectionFactor = rangeProjectionFactor(startDate, endDate);
    const rowsByUnit = new Map<string, ScheduleAnalyticsRow[]>();

    for (const row of rows) {
        const unitName = row.unit_name?.trim() || "Sem unidade";
        const key = normalizeUnitName(unitName);
        const group = rowsByUnit.get(key) ?? [];
        group.push(row);
        rowsByUnit.set(key, group);
    }

    const tableRows = [...rowsByUnit.values()]
        .map((unitRows) =>
            summarizeScheduleUnit(
                unitRows[0]?.unit_name?.trim() || "Sem unidade",
                unitRows,
                projectionFactor,
            ),
        )
        .sort(
            (first, second) =>
                second.appointments - first.appointments ||
                first.unit_name.localeCompare(second.unit_name, "pt-BR"),
        );

    return {
        rows: tableRows,
        total: summarizeScheduleUnit("Total geral", rows, projectionFactor),
    };
}

function summarizeScheduleUnit(
    unitName: string,
    rows: ScheduleAnalyticsRow[],
    projectionFactor: number,
): ScheduleUnitTableRow {
    const uniqueRows = latestUniqueScheduleRows(rows);
    const rescheduledRows = rows.filter(
        (row) => normalizeScheduleStatus(row.status) === "rescheduled",
    );
    const rescheduledPatients = new Set(
        rescheduledRows.map((row) => scheduleIdentity(row)),
    ).size;
    const counts = {
        pending: 0,
        showedUp: 0,
        rescheduled: 0,
        cancelled: 0,
        noShow: 0,
    };

    for (const row of uniqueRows) {
        const group = normalizeScheduleStatus(row.status);
        if (group === "pending") counts.pending += 1;
        if (scheduleShowedUp(group)) counts.showedUp += 1;
        if (group === "rescheduled") counts.rescheduled += 1;
        if (group === "cancelled") counts.cancelled += 1;
        if (group === "no_show") counts.noShow += 1;
    }

    return {
        unit_name: unitName,
        appointments: rows.length,
        reschedulings: rescheduledRows.length,
        rescheduling_rate: percentage(rescheduledPatients, rows.length),
        unique_appointments: uniqueRows.length,
        pending: counts.pending,
        showed_up: counts.showedUp,
        showed_up_rate: percentage(counts.showedUp, uniqueRows.length),
        projection: roundMetric(counts.showedUp * projectionFactor),
        rescheduled: counts.rescheduled,
        rescheduled_rate: percentage(counts.rescheduled, uniqueRows.length),
        cancelled: counts.cancelled,
        cancelled_rate: percentage(counts.cancelled, uniqueRows.length),
        no_show: counts.noShow,
        no_show_rate: percentage(counts.noShow, uniqueRows.length),
    };
}

function rangeProjectionFactor(startDate: string, endDate: string) {
    const today = brazilDate(new Date().toISOString());
    const currentMonthStart = `${today.slice(0, 7)}-01`;
    if (startDate !== currentMonthStart || endDate < today) return 1;

    const [year, monthNumber, day] = today.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return daysInMonth / Math.max(1, Math.min(day, daysInMonth));
}

function percentage(value: number, total: number) {
    if (total <= 0) return null;
    return Number(((value / total) * 100).toFixed(1));
}

function roundMetric(value: number) {
    return Number(value.toFixed(1));
}

function emptyScheduleSummary(): ScheduleSummary {
    return {
        total: 0,
        unique_total: 0,
        cancelled: 0,
        showed_up: 0,
        no_show: 0,
        rescheduled: 0,
        pending: 0,
        unknown: 0,
    };
}

function incrementScheduleSummary(
    summary: ScheduleSummary,
    group: ScheduleStatusGroup,
) {
    if (group === "cancelled") summary.cancelled += 1;
    if (scheduleShowedUp(group)) summary.showed_up += 1;
    if (group === "no_show") summary.no_show += 1;
    if (group === "rescheduled") summary.rescheduled += 1;
    if (group === "pending") summary.pending += 1;
    if (group === "unknown") summary.unknown += 1;
}

function emptyScheduleEvolutionPoint(
    dateIso: string,
): ScheduleEvolutionPoint {
    const [, month, day] = dateIso.split("-");
    return {
        date: `${day}/${month}`,
        date_iso: dateIso,
        total: 0,
        cancelled: 0,
        showed_up: 0,
        no_show: 0,
        rescheduled: 0,
        unique_total: 0,
        unique_cancelled: 0,
        unique_showed_up: 0,
        unique_no_show: 0,
        unique_rescheduled: 0,
    };
}

function emptyScheduleCreationEvolutionPoint(
    dateIso: string,
): ScheduleCreationEvolutionPoint {
    const [, month, day] = dateIso.split("-");
    return {
        date: `${day}/${month}`,
        date_iso: dateIso,
        total: 0,
    };
}

function emptyScheduleAnalytics(
    startDate: string,
    endDate: string,
    available: boolean,
): ScheduleAnalyticsResult {
    return {
        available,
        summary: emptyScheduleSummary(),
        evolution: buildDateRange(startDate, endDate).map(
            emptyScheduleEvolutionPoint,
        ),
        byUnit: [],
        unitTable: {
            rows: [],
            total: summarizeScheduleUnit(
                "Total geral",
                [],
                rangeProjectionFactor(startDate, endDate),
            ),
        },
    };
}

function buildDateRange(startDate: string, endDate: string) {
    const dates: string[] = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);

    while (cursor.getTime() <= end.getTime()) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
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
