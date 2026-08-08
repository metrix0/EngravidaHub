// app/api/dashboard/calls/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getClientCallClosureTone } from "@/lib/clients/callTracking";

const PAGE_SIZE = 1_000;
const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

type CallRow = {
    called_at: string;
    closure_tag: string;
};

type CallTone = "positive" | "neutral" | "negative";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDateRange(
        searchParams.get("start_date"),
        searchParams.get("end_date"),
    );
    const unitNames = [...new Set(searchParams.getAll("unit").filter(Boolean))];

    const unitIdsResult = await resolveUnitIds(unitNames);
    if (unitIdsResult.error) {
        return NextResponse.json(
            { error: unitIdsResult.error.message },
            { status: 500 },
        );
    }

    if (unitNames.length > 0 && unitIdsResult.ids.length === 0) {
        return NextResponse.json(buildResponse([], range));
    }

    const callsResult = await loadCalls({
        start: range.startIso,
        end: range.endIso,
        unitIds: unitIdsResult.ids,
    });

    if (callsResult.error) {
        return NextResponse.json(
            { error: callsResult.error.message },
            { status: 500 },
        );
    }

    return NextResponse.json(buildResponse(callsResult.calls, range));
}

async function resolveUnitIds(unitNames: string[]) {
    if (unitNames.length === 0) {
        return { ids: [] as string[], error: null };
    }

    const { data, error } = await supabase
        .from("units")
        .select("id")
        .in("name", unitNames);

    const units = (data ?? []) as Array<{ id: string }>;

    return {
        ids: units.map((unit) => unit.id),
        error,
    };
}

async function loadCalls({
    start,
    end,
    unitIds,
}: {
    start: string;
    end: string;
    unitIds: string[];
}) {
    const first = await loadCallPage({
        start,
        end,
        unitIds,
        from: 0,
        withCount: true,
    });
    if (first.error) return { calls: [] as CallRow[], error: first.error };

    const total = first.count ?? first.calls.length;
    const offsets = Array.from(
        {
            length: Math.max(0, Math.ceil((total - PAGE_SIZE) / PAGE_SIZE)),
        },
        (_, index) => (index + 1) * PAGE_SIZE,
    );
    const remaining = await Promise.all(
        offsets.map((from) =>
            loadCallPage({
                start,
                end,
                unitIds,
                from,
                withCount: false,
            }),
        ),
    );
    const failed = remaining.find((page) => page.error);

    return {
        calls: [
            ...first.calls,
            ...remaining.flatMap((page) => page.calls),
        ],
        error: failed?.error ?? null,
    };
}

async function loadCallPage({
    start,
    end,
    unitIds,
    from,
    withCount,
}: {
    start: string;
    end: string;
    unitIds: string[];
    from: number;
    withCount: boolean;
}) {
    let query = supabase
        .from("client_calls")
        .select(
            "called_at, closure_tag, clients!inner(unit_id)",
            withCount ? { count: "exact" } : undefined,
        )
        .gte("called_at", start)
        .lte("called_at", end)
        .order("called_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

    if (unitIds.length > 0) {
        query = query.in("clients.unit_id", unitIds);
    }

    const { data, error, count } = await query;
    const rows = (data ?? []) as Array<{
        called_at: string;
        closure_tag: string;
    }>;

    return {
        calls: rows.map((row) => ({
            called_at: row.called_at,
            closure_tag: row.closure_tag,
        })),
        error,
        count,
    };
}

function buildResponse(
    calls: CallRow[],
    range: ReturnType<typeof resolveDateRange>,
) {
    const counts: Record<CallTone, number> = {
        positive: 0,
        neutral: 0,
        negative: 0,
    };
    const byDate = new Map<
        string,
        Record<CallTone, number>
    >();

    for (const call of calls) {
        const tone = getClientCallClosureTone(call.closure_tag) ?? "neutral";
        counts[tone] += 1;

        const date = saoPauloDateKey(call.called_at);
        const current = byDate.get(date) ?? {
            positive: 0,
            neutral: 0,
            negative: 0,
        };
        current[tone] += 1;
        byDate.set(date, current);
    }

    const total = calls.length;
    const daily = eachDate(range.startDate, range.endDate).map((date) => {
        const values = byDate.get(date) ?? {
            positive: 0,
            neutral: 0,
            negative: 0,
        };

        return {
            date: formatDateLabel(date),
            date_iso: date,
            good: values.positive,
            neutral: values.neutral,
            bad: values.negative,
        };
    });

    return {
        total,
        good: counts.positive,
        neutral: counts.neutral,
        bad: counts.negative,
        good_rate: percentage(counts.positive, total),
        neutral_rate: percentage(counts.neutral, total),
        bad_rate: percentage(counts.negative, total),
        daily_evolution: daily,
    };
}

function resolveDateRange(startValue: string | null, endValue: string | null) {
    const now = new Date();
    const today = saoPauloDateKey(now.toISOString());
    const startDate = isDateKey(startValue)
        ? startValue!
        : `${today.slice(0, 8)}01`;
    const endDate = isDateKey(endValue) ? endValue! : today;

    return {
        startDate,
        endDate,
        startIso: new Date(`${startDate}T00:00:00-03:00`).toISOString(),
        endIso: new Date(`${endDate}T23:59:59.999-03:00`).toISOString(),
    };
}

function saoPauloDateKey(value: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: SAO_PAULO_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(
        parts.map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
}

function eachDate(start: string, end: string) {
    const dates: string[] = [];
    const current = new Date(`${start}T12:00:00-03:00`);
    const endTime = new Date(`${end}T12:00:00-03:00`).getTime();

    while (current.getTime() <= endTime) {
        dates.push(saoPauloDateKey(current.toISOString()));
        current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
}

function formatDateLabel(value: string) {
    const [, month, day] = value.split("-");
    return `${day}/${month}`;
}

function percentage(value: number, total: number) {
    if (total === 0) return 0;
    return Math.round((value / total) * 1_000) / 10;
}

function isDateKey(value: string | null): value is string {
    return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}
