import { NextResponse } from "next/server";
import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { readDashboardFilters, resolveDashboardDateRange } from "@/lib/dashboard/metrics";
import { supabase } from "@/lib/supabase/client";

export const maxDuration = 60;
const SHARDS = 8;

type Histogram = { n: number; days?: number; value?: number; metric?: string; segment?: string; kind?: string };
type Shard = {
    scope: { clients: number };
    timeline_hist: Histogram[];
    touch_hist: Histogram[];
    return_hist: Histogram[];
    recovery: { total: number; mature: number; returned: number; booked: number };
    recovery_moments: Array<{ moment: string; eligible: number; returned: number }>;
    sources: Array<{ origin: string; clients: number; bookings: number }>;
};

function number(value: unknown) {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
}

function quantiles(points: Array<{ value: number; count: number }>) {
    const counts = new Map<number, number>();
    for (const point of points) {
        if (point.count <= 0 || !Number.isFinite(point.value)) continue;
        counts.set(point.value, (counts.get(point.value) ?? 0) + point.count);
    }
    const sorted = [...counts].sort((a, b) => a[0] - b[0]);
    const sample = sorted.reduce((sum, [, count]) => sum + count, 0);
    if (!sample) return { sample: 0, p25: null, median: null, p75: null };

    const valueAt = (index: number) => {
        let cumulative = 0;
        for (const [value, count] of sorted) {
            cumulative += count;
            if (index < cumulative) return value;
        }
        return sorted[sorted.length - 1][0];
    };
    const percentile = (p: number) => {
        const position = (sample - 1) * p;
        const lower = Math.floor(position);
        const fraction = position - lower;
        return Math.round((valueAt(lower) * (1 - fraction) + valueAt(Math.ceil(position)) * fraction) * 10) / 10;
    };
    return { sample, p25: percentile(0.25), median: percentile(0.5), p75: percentile(0.75) };
}

function mergeShards(parts: Shard[]) {
    const timelineMetrics = ["consulta", "comparecimento", "procedimento", "fatura"];
    const timelines = timelineMetrics.map(metric => ({
        metric,
        ...quantiles(parts.flatMap(part => (part.timeline_hist ?? [])
            .filter(point => point.metric === metric)
            .map(point => ({ value: number(point.days), count: number(point.n) })))),
    }));

    const segments = ["agendaram", "sem_agendamento_30d"];
    const fields = ["conversations", "attendants", "calls", "followups"] as const;
    const touchpoints = segments.map(segment => {
        const result = Object.fromEntries(fields.map(field => [
            field,
            quantiles(parts.flatMap(part => (part.touch_hist ?? [])
                .filter(point => point.segment === segment && point.kind === field)
                .map(point => ({ value: number(point.value), count: number(point.n) })))).median,
        ]));
        return {
            segment,
            sample: parts.reduce((total, part) => total +
                number(part.touch_hist?.filter(point => point.segment === segment && point.kind === "conversations")
                    .reduce((sum, point) => sum + number(point.n), 0)), 0),
            ...result,
        };
    });

    const recovery = {
        total: parts.reduce((sum, part) => sum + number(part.recovery?.total), 0),
        mature: parts.reduce((sum, part) => sum + number(part.recovery?.mature), 0),
        returned: parts.reduce((sum, part) => sum + number(part.recovery?.returned), 0),
        booked: parts.reduce((sum, part) => sum + number(part.recovery?.booked), 0),
        median_days: quantiles(parts.flatMap(part => (part.return_hist ?? [])
            .map(point => ({ value: number(point.days), count: number(point.n) })))).median,
    };

    const moments = new Map<string, { moment: string; eligible: number; returned: number }>();
    const sources = new Map<string, { origin: string; clients: number; bookings: number }>();
    for (const part of parts) {
        for (const moment of part.recovery_moments ?? []) {
            const current = moments.get(moment.moment) ?? { moment: moment.moment, eligible: 0, returned: 0 };
            current.eligible += number(moment.eligible);
            current.returned += number(moment.returned);
            moments.set(moment.moment, current);
        }
        for (const source of part.sources ?? []) {
            const current = sources.get(source.origin) ?? { origin: source.origin, clients: 0, bookings: 0 };
            current.clients += number(source.clients);
            current.bookings += number(source.bookings);
            sources.set(source.origin, current);
        }
    }

    return {
        scope: { clients: parts.reduce((sum, part) => sum + number(part.scope?.clients), 0) },
        timelines,
        touchpoints,
        recovery,
        recovery_moments: [...moments.values()].sort((a, b) => b.eligible - a.eligible).slice(0, 6),
        sources: [...sources.values()].sort((a, b) => b.clients - a.clients).slice(0, 8),
    };
}

export async function GET(request: Request) {
    try {
        const { user } = await getCurrentAttendantFromRequest();
        if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const range = resolveDashboardDateRange(searchParams);
        const filters = readDashboardFilters(searchParams);
        const creativeRequest = supabase.rpc("dashboard_journey_creative_outcomes", {
            p_start_at: range.startAt,
            p_end_at: range.endAt,
        });

        const parts: Shard[] = [];
        for (let start = 0; start < SHARDS; start += 4) {
            const results = await Promise.all(
                Array.from({ length: 4 }, (_, index) => supabase.rpc("dashboard_journey_deep_insights", {
                    p_start_at: range.startAt,
                    p_end_at: range.endAt,
                    p_unit_ids: filters.unitIds,
                    p_attendant_ids: filters.attendantIds,
                    p_tunnels: filters.tunnels,
                    p_origins: filters.origins,
                    p_shard: start + index,
                    p_shards: SHARDS,
                })),
            );
            for (const result of results) {
                if (result.error) throw result.error;
                parts.push(result.data as Shard);
            }
        }

        const creativeResult = await creativeRequest;
        if (creativeResult.error) console.error("[jornada/insights] creative metrics", creativeResult.error);

        return NextResponse.json({
            analytics: mergeShards(parts),
            creatives: creativeResult.error ? null : creativeResult.data,
            creative_error: Boolean(creativeResult.error),
        }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        if (request.signal.aborted) return new NextResponse(null, { status: 499 });
        console.error("[jornada/insights] failed", error);
        return NextResponse.json({ error: "Não foi possível carregar as análises da jornada." }, { status: 500 });
    }
}
