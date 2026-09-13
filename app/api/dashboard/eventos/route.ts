// app/api/dashboard/eventos/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import {
    clampInteger,
    parseTextArray,
    readDashboardFilters,
    resolveDashboardDateRange,
    type DashboardDateRange,
} from "@/lib/dashboard/metrics";
import { withSupabaseRetry } from "@/lib/supabase/retry";

const UNIQUE_EVENT_PAGE_SIZE = 1_000;
const NULL_FILTER_VALUE = "__NULL__";

type UniqueEventConversation = {
    unit_id: string | null;
    service_id: string | null;
    tunnel: string | null;
    origin: string | null;
};

type UniqueEventRow = {
    id: string;
    conversation_id: string | null;
    schedule_id: string | null;
    event_type: string;
    event_date: string;
    platform: string;
    status: string;
    conversations: UniqueEventConversation | UniqueEventConversation[] | null;
};

type UniqueEventFilters = {
    unitIds: string[];
    serviceIds: string[];
    platforms: string[];
    eventTypes: string[];
    statuses: string[];
    sources: string[];
    tunnels: string[];
    origins: string[];
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);
    const filters = readDashboardFilters(searchParams);
    const page = clampInteger(searchParams.get("page"), 1, 1, 1_000_000);
    const pageSize = clampInteger(searchParams.get("page_size"), 50, 1, 200);
    const platforms = parseTextArray(searchParams.get("platforms"));
    const eventTypes = parseTextArray(searchParams.get("event_types"));
    const statuses = parseTextArray(searchParams.get("statuses"));
    const sources = parseTextArray(searchParams.get("sources"));

    const eventFilters = {
        p_unit_ids: filters.unitIds,
        p_service_ids: filters.serviceIds,
        p_platforms: platforms,
        p_event_types: eventTypes,
        p_statuses: statuses,
        p_sources: sources,
        p_tunnels: filters.tunnels,
        p_origins: filters.origins,
    };

    const [currentResult, previousResult] = await Promise.all([
        withSupabaseRetry(
            () =>
                supabase.rpc("dashboard_events_metrics_v2", {
                    p_start_at: range.startAt,
                    p_end_at: range.endAt,
                    ...eventFilters,
                    p_page: page,
                    p_page_size: pageSize,
                }),
            {
                attempts: 2,
                label: "dashboard/eventos current metric RPC",
                signal: request.signal,
            },
        ),
        withSupabaseRetry(
            () =>
                supabase.rpc("dashboard_events_metrics_v2", {
                    p_start_at: range.previousStartAt,
                    p_end_at: range.previousEndAt,
                    ...eventFilters,
                    p_page: 1,
                    p_page_size: 1,
                }),
            {
                attempts: 2,
                label: "dashboard/eventos previous metric RPC",
                signal: request.signal,
            },
        ),
    ]);

    if (currentResult.error || previousResult.error) {
        const error = currentResult.error ?? previousResult.error;
        console.error("[dashboard/eventos] canonical metric RPC failed", error);
        return NextResponse.json(
            { error: error?.message ?? "Falha ao carregar eventos." },
            { status: 500 },
        );
    }

    let uniqueEvents;
    try {
        uniqueEvents = await loadUniqueEventCounts(
            range,
            {
                unitIds: filters.unitIds,
                serviceIds: filters.serviceIds,
                platforms,
                eventTypes,
                statuses,
                sources,
                tunnels: filters.tunnels,
                origins: filters.origins,
            },
            request.signal,
        );
    } catch (error) {
        console.error("[dashboard/eventos] unique event count failed", error);
        return NextResponse.json(
            { error: "Falha ao carregar eventos únicos." },
            { status: 500 },
        );
    }

    const current = asObject(currentResult.data);
    const previous = asObject(previousResult.data);

    return NextResponse.json(
        {
            kpis: {
                ...asObject(current.kpis),
                unique_events: uniqueEvents.current,
            },
            previous_kpis: {
                ...asObject(previous.kpis),
                unique_events: uniqueEvents.previous,
            },
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

async function loadUniqueEventCounts(
    range: DashboardDateRange,
    filters: UniqueEventFilters,
    signal: AbortSignal,
) {
    const current = new Set<string>();
    const previous = new Set<string>();
    const currentStart = new Date(range.startAt).getTime();

    for (let offset = 0; ; offset += UNIQUE_EVENT_PAGE_SIZE) {
        const result = await withSupabaseRetry(
            () => {
                let query = supabase
                    .from("ad_events")
                    .select(
                        `
                        id,
                        conversation_id,
                        schedule_id,
                        event_type,
                        event_date,
                        platform,
                        status,
                        conversations (
                            unit_id,
                            service_id,
                            tunnel,
                            origin
                        )
                    `,
                    )
                    .gte("event_date", range.previousStartAt)
                    .lt("event_date", range.endAt)
                    .order("event_date", { ascending: true })
                    .order("id", { ascending: true })
                    .range(offset, offset + UNIQUE_EVENT_PAGE_SIZE - 1);

                if (filters.platforms.length > 0)
                    query = query.in("platform", filters.platforms);
                if (filters.eventTypes.length > 0)
                    query = query.in("event_type", filters.eventTypes);
                if (filters.statuses.length > 0)
                    query = query.in("status", filters.statuses);

                return query;
            },
            {
                attempts: 2,
                label: "dashboard/eventos unique events",
                signal,
            },
        );

        if (result.error) throw result.error;
        const rows = (result.data ?? []) as unknown as UniqueEventRow[];

        for (const row of rows) {
            if (!matchesUniqueEventFilters(row, filters)) continue;

            const key = uniqueEventKey(row);
            if (new Date(row.event_date).getTime() >= currentStart) current.add(key);
            else previous.add(key);
        }

        if (rows.length < UNIQUE_EVENT_PAGE_SIZE) break;
    }

    return { current: current.size, previous: previous.size };
}

function matchesUniqueEventFilters(
    row: UniqueEventRow,
    filters: UniqueEventFilters,
) {
    const conversation = relationOne(row.conversations);
    const source = row.conversation_id
        ? "ai"
        : row.schedule_id
          ? "clinisys"
          : null;

    if (filters.sources.length > 0 && (!source || !filters.sources.includes(source)))
        return false;
    if (
        filters.unitIds.length > 0 &&
        (!conversation?.unit_id || !filters.unitIds.includes(conversation.unit_id))
    )
        return false;
    if (
        filters.serviceIds.length > 0 &&
        (!conversation?.service_id ||
            !filters.serviceIds.includes(conversation.service_id))
    )
        return false;
    if (!matchesNullableText(filters.tunnels, conversation?.tunnel ?? null))
        return false;
    if (!matchesNullableText(filters.origins, conversation?.origin ?? null))
        return false;

    return true;
}

function uniqueEventKey(row: UniqueEventRow) {
    const sourceId = row.conversation_id
        ? `conversation:${row.conversation_id}`
        : row.schedule_id
          ? `schedule:${row.schedule_id}`
          : `event:${row.id}`;

    return `${sourceId}|${row.event_type}`;
}

function matchesNullableText(values: string[], value: string | null) {
    if (values.length === 0) return true;
    const normalized = value?.trim() || NULL_FILTER_VALUE;
    return values.includes(normalized);
}

function relationOne<T>(value: T | T[] | null): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value;
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function arrayOrEmpty<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function numberOrZero(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
