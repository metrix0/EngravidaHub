// lib/dashboard/metrics.ts

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAO_PAULO_OFFSET = "-03:00";

export type DashboardDateRange = {
    startAt: string;
    endAt: string;
    previousStartAt: string;
    previousEndAt: string;
    days: number;
    startDate: string | null;
    endDate: string | null;
};

export function resolveDashboardDateRange(searchParams: URLSearchParams): DashboardDateRange {
    const requestedDays = Number(searchParams.get("days") ?? 7);
    const days = Number.isFinite(requestedDays)
        ? Math.min(3650, Math.max(1, Math.trunc(requestedDays)))
        : 7;

    const requestedStart = normalizeDate(searchParams.get("start_date"));
    const requestedEnd = normalizeDate(searchParams.get("end_date"));

    let start: Date;
    let end: Date;
    let startDate: string | null = null;
    let endDate: string | null = null;

    if (requestedStart) {
        startDate = requestedStart;
        endDate = requestedEnd ?? requestedStart;

        const orderedStart = requestedStart <= endDate ? requestedStart : endDate;
        const orderedEnd = requestedStart <= endDate ? endDate : requestedStart;

        startDate = orderedStart;
        endDate = orderedEnd;
        start = localDateStart(orderedStart);
        end = localDateStart(addCalendarDays(orderedEnd, 1));
    } else {
        end = new Date();
        start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    }

    const durationMs = Math.max(1, end.getTime() - start.getTime());
    const previousEnd = new Date(start.getTime());
    const previousStart = new Date(start.getTime() - durationMs);

    return {
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        previousStartAt: previousStart.toISOString(),
        previousEndAt: previousEnd.toISOString(),
        days,
        startDate,
        endDate,
    };
}

export function parseUuidArray(value: string | null): string[] {
    return parseTextArray(value).filter((item) => UUID_PATTERN.test(item));
}

export function parseTextArray(value: string | null): string[] {
    if (!value) return [];

    return Array.from(
        new Set(
            value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    );
}

export function clampInteger(
    value: string | null,
    fallback: number,
    minimum: number,
    maximum: number,
): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

export function executiveRpcParams(
    range: Pick<DashboardDateRange, "startAt" | "endAt">,
    filters: DashboardFilters,
) {
    return {
        p_start_at: range.startAt,
        p_end_at: range.endAt,
        p_unit_ids: filters.unitIds,
        p_service_ids: filters.serviceIds,
        p_attendant_ids: filters.attendantIds,
        p_tunnels: filters.tunnels,
        p_origins: filters.origins,
    };
}

export type DashboardFilters = {
    unitIds: string[];
    serviceIds: string[];
    attendantIds: string[];
    tunnels: string[];
    origins: string[];
};

export function readDashboardFilters(searchParams: URLSearchParams): DashboardFilters {
    return {
        unitIds: parseUuidArray(searchParams.get("unit_ids")),
        serviceIds: parseUuidArray(searchParams.get("service_ids")),
        attendantIds: parseUuidArray(searchParams.get("attendant_ids")),
        tunnels: parseTextArray(searchParams.get("tunnels")),
        origins: parseTextArray(searchParams.get("origins")),
    };
}

function normalizeDate(value: string | null): string | null {
    if (!value || !DATE_PATTERN.test(value)) return null;

    const parsed = localDateStart(value);
    return Number.isNaN(parsed.getTime()) ? null : value;
}

function localDateStart(date: string): Date {
    return new Date(`${date}T00:00:00${SAO_PAULO_OFFSET}`);
}

function addCalendarDays(date: string, days: number): string {
    const [year, month, day] = date.split("-").map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day + days));
    return cursor.toISOString().slice(0, 10);
}
