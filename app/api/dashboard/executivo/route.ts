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
    median_first_human_response_seconds: number | null;
    p90_first_human_response_seconds: number | null;
    first_human_response_observed: number;
    first_human_response_eligible: number;
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
    }[];
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
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);
    const filters = readDashboardFilters(searchParams);

    const [currentResult, previousResult] = await Promise.all([
        supabase.rpc(
            "dashboard_executive_metrics_v2",
            executiveRpcParams(
                { startAt: range.startAt, endAt: range.endAt },
                filters,
            ),
        ),
        supabase.rpc(
            "dashboard_executive_metrics_v2",
            executiveRpcParams(
                {
                    startAt: range.previousStartAt,
                    endAt: range.previousEndAt,
                },
                filters,
            ),
        ),
    ]);

    if (currentResult.error || previousResult.error) {
        const error = currentResult.error ?? previousResult.error;
        console.error("[dashboard/executivo] canonical metric RPC failed", error);
        return NextResponse.json(
            { error: error?.message ?? "Falha ao carregar métricas." },
            { status: 500 },
        );
    }

    const current = normalizeExecutivePayload(currentResult.data);
    const previous = normalizeExecutivePayload(previousResult.data);

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
        kpis: current.kpis,
        previous_kpis: previous.kpis,
        daily_evolution: current.daily_evolution,
        attendance_score: current.attendance_score,
        dropoff_moments: current.dropoff_moments,
        conversation_goals: current.conversation_goals,
        by_unit: current.by_unit,
    };

    return NextResponse.json(response, {
        headers: {
            "Cache-Control": "private, no-store",
        },
    });
}

function normalizeExecutivePayload(value: unknown): ExecutiveMetricsPayload {
    const payload = asObject(value);

    return {
        kpis: {
            conversations_analyzed: numberOrZero(payload.kpis, "conversations_analyzed"),
            real_resolution_rate: nullableNumber(payload.kpis, "real_resolution_rate"),
            resolution_observed: numberOrZero(payload.kpis, "resolution_observed"),
            resolution_coverage_rate: nullableNumber(payload.kpis, "resolution_coverage_rate"),
            clear_satisfaction_rate: nullableNumber(payload.kpis, "clear_satisfaction_rate"),
            satisfaction_observed: numberOrZero(payload.kpis, "satisfaction_observed"),
            satisfaction_coverage_rate: nullableNumber(payload.kpis, "satisfaction_coverage_rate"),
            scheduling_rate: nullableNumber(payload.kpis, "scheduling_rate"),
            scheduling_eligible: numberOrZero(payload.kpis, "scheduling_eligible"),
            average_first_human_response_seconds: nullableNumber(
                payload.kpis,
                "average_first_human_response_seconds",
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
            first_human_response_coverage_rate: nullableNumber(
                payload.kpis,
                "first_human_response_coverage_rate",
            ),
        },
        daily_evolution: arrayOrEmpty<ExecutiveMetricsPayload["daily_evolution"][number]>(payload.daily_evolution),
        attendance_score: {
            overall_score: nullableNumber(payload.attendance_score, "overall_score"),
            resolution_score: nullableNumber(payload.attendance_score, "resolution_score"),
            satisfaction_score: nullableNumber(payload.attendance_score, "satisfaction_score"),
            response_speed_score: nullableNumber(payload.attendance_score, "response_speed_score"),
            attendant_quality_score: nullableNumber(
                payload.attendance_score,
                "attendant_quality_score",
            ),
        },
        dropoff_moments: arrayOrEmpty<ExecutiveMetricsPayload["dropoff_moments"][number]>(payload.dropoff_moments),
        conversation_goals: arrayOrEmpty<ExecutiveMetricsPayload["conversation_goals"][number]>(payload.conversation_goals),
        by_unit: arrayOrEmpty<ExecutiveMetricsPayload["by_unit"][number]>(payload.by_unit),
    };
}

function asObject(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, any>)
        : {};
}

function arrayOrEmpty<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function nullableNumber(container: unknown, key: string): number | null {
    const value = asObject(container)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrZero(container: unknown, key: string): number {
    return nullableNumber(container, key) ?? 0;
}
