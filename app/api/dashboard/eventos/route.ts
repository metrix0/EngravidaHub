// app/api/dashboard/eventos/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import {
    clampInteger,
    parseTextArray,
    readDashboardFilters,
    resolveDashboardDateRange,
} from "@/lib/dashboard/metrics";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);
    const filters = readDashboardFilters(searchParams);
    const page = clampInteger(searchParams.get("page"), 1, 1, 1_000_000);
    const pageSize = clampInteger(searchParams.get("page_size"), 50, 1, 200);

    const eventFilters = {
        p_unit_ids: filters.unitIds,
        p_service_ids: filters.serviceIds,
        p_platforms: parseTextArray(searchParams.get("platforms")),
        p_event_types: parseTextArray(searchParams.get("event_types")),
        p_statuses: parseTextArray(searchParams.get("statuses")),
        p_sources: parseTextArray(searchParams.get("sources")),
        p_tunnels: filters.tunnels,
        p_origins: filters.origins,
    };

    const [currentResult, previousResult] = await Promise.all([
        supabase.rpc("dashboard_events_metrics_v2", {
            p_start_at: range.startAt,
            p_end_at: range.endAt,
            ...eventFilters,
            p_page: page,
            p_page_size: pageSize,
        }),
        supabase.rpc("dashboard_events_metrics_v2", {
            p_start_at: range.previousStartAt,
            p_end_at: range.previousEndAt,
            ...eventFilters,
            p_page: 1,
            p_page_size: 1,
        }),
    ]);

    if (currentResult.error || previousResult.error) {
        const error = currentResult.error ?? previousResult.error;
        console.error("[dashboard/eventos] canonical metric RPC failed", error);
        return NextResponse.json(
            { error: error?.message ?? "Falha ao carregar eventos." },
            { status: 500 },
        );
    }

    const current = asObject(currentResult.data);
    const previous = asObject(previousResult.data);

    return NextResponse.json(
        {
            kpis: asObject(current.kpis),
            previous_kpis: asObject(previous.kpis),
            by_platform: arrayOrEmpty(current.by_platform),
            previous_by_platform: arrayOrEmpty(previous.by_platform),
            by_type: arrayOrEmpty(current.by_type),
            previous_by_type: arrayOrEmpty(previous.by_type),
            by_status: arrayOrEmpty(current.by_status),
            daily: arrayOrEmpty(current.daily),
            recent: arrayOrEmpty(current.recent),
            recent_total: numberOrZero(current.recent_total),
            page,
            page_size: pageSize,
        },
        {
            headers: {
                "Cache-Control": "private, no-store",
            },
        },
    );
}

function asObject(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, any>)
        : {};
}

function arrayOrEmpty<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function numberOrZero(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
