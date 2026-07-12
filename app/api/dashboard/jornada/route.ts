// app/api/dashboard/jornada/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import {
    executiveRpcParams,
    readDashboardFilters,
    resolveDashboardDateRange,
} from "@/lib/dashboard/metrics";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);
    const filters = readDashboardFilters(searchParams);

    const { data, error } = await supabase.rpc(
        "dashboard_journey_metrics_v2",
        executiveRpcParams(
            { startAt: range.startAt, endAt: range.endAt },
            filters,
        ),
    );

    if (error) {
        console.error("[dashboard/jornada] canonical metric RPC failed", error);
        return NextResponse.json(
            { error: error.message },
            { status: 500 },
        );
    }

    const payload = data && typeof data === "object" ? data : {};

    return NextResponse.json(
        {
            journey_funnel: Array.isArray((payload as any).journey_funnel)
                ? (payload as any).journey_funnel
                : [],
            dropoff_moments: Array.isArray((payload as any).dropoff_moments)
                ? (payload as any).dropoff_moments
                : [],
            intent_paths: Array.isArray((payload as any).intent_paths)
                ? (payload as any).intent_paths
                : [],
            objections: Array.isArray((payload as any).objections)
                ? (payload as any).objections
                : [],
            audit: (payload as any).audit ?? null,
        },
        {
            headers: {
                "Cache-Control": "private, no-store",
            },
        },
    );
}
