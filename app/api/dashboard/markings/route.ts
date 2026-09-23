import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import {
    readDashboardFilters,
    resolveDashboardDateRange,
} from "@/lib/dashboard/metrics";
import { normalizeScheduleStatus } from "@/lib/schedules/status";

export const runtime = "nodejs";

const PAGE_SIZE = 1_000;
const MAX_ROWS = 50_000;

type MarkingRow = {
    id: string;
    source_hash: string | null;
    client_id: string | null;
    normalized_phone: string | null;
    patient_name: string | null;
    created_in_source_at: string;
    unit_name: string | null;
    status: string | null;
};

type MarkingUnitRow = {
    unit_name: string;
    markings: number;
    unique_markings: number;
    unique_projection: number;
    rescheduled: number;
    cancelled: number;
    first_appointments: number;
    first_appointments_projection: number;
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);
    const startDate = range.startDate ?? brazilDate(range.startAt);
    const endDate =
        range.endDate ??
        brazilDate(
            new Date(new Date(range.endAt).getTime() - 1).toISOString(),
        );
    const endExclusive = nextDate(endDate);
    const previousStartDate = brazilDate(range.previousStartAt);
    const previousEndDate = brazilDate(
        new Date(new Date(range.previousEndAt).getTime() - 1).toISOString(),
    );

    try {
        const selectedUnitNames = await resolveSelectedUnitNames(
            searchParams,
            request.signal,
        );
        const rows = await loadMarkingRows(endExclusive, request.signal);
        const firstRowIds = firstMarkingRowIds(rows);
        const selectedUnitKeys =
            selectedUnitNames === null
                ? null
                : new Set(selectedUnitNames.map(normalizeUnitName));
        const currentRows = rows.filter((row) => {
            const createdDate = row.created_in_source_at.slice(0, 10);
            if (createdDate < startDate || createdDate > endDate) {
                return false;
            }

            if (selectedUnitKeys === null) return true;
            return selectedUnitKeys.has(
                normalizeUnitName(row.unit_name?.trim() || "Sem unidade"),
            );
        });
        const previousRows = rows.filter((row) => {
            const createdDate = row.created_in_source_at.slice(0, 10);
            if (
                createdDate < previousStartDate ||
                createdDate > previousEndDate
            ) {
                return false;
            }

            if (selectedUnitKeys === null) return true;
            return selectedUnitKeys.has(
                normalizeUnitName(row.unit_name?.trim() || "Sem unidade"),
            );
        });
        const projectionFactor = rangeProjectionFactor(startDate, endDate);
        const rowsByUnit = new Map<string, MarkingRow[]>();

        for (const row of currentRows) {
            const unitName = row.unit_name?.trim() || "Sem unidade";
            const key = normalizeUnitName(unitName);
            const unitRows = rowsByUnit.get(key) ?? [];
            unitRows.push(row);
            rowsByUnit.set(key, unitRows);
        }

        const tableRows = [...rowsByUnit.values()]
            .map((unitRows) =>
                summarizeUnit(
                    unitRows[0]?.unit_name?.trim() || "Sem unidade",
                    unitRows,
                    firstRowIds,
                    projectionFactor,
                ),
            )
            .sort(
                (first, second) =>
                    second.unique_markings - first.unique_markings ||
                    first.unit_name.localeCompare(second.unit_name, "pt-BR"),
            );

        return NextResponse.json(
            {
                rows: tableRows,
                total: summarizeUnit(
                    "Total geral",
                    currentRows,
                    firstRowIds,
                    projectionFactor,
                ),
                previous_total: summarizeUnit(
                    "Total geral",
                    previousRows,
                    firstRowIds,
                    1,
                ),
            },
            { headers: { "Cache-Control": "private, no-store" } },
        );
    } catch (error) {
        console.error("[dashboard-markings]", error);
        return NextResponse.json(
            { error: "Não foi possível carregar as marcações." },
            {
                status: 500,
                headers: { "Cache-Control": "private, no-store" },
            },
        );
    }
}

async function resolveSelectedUnitNames(
    searchParams: URLSearchParams,
    signal: AbortSignal,
): Promise<string[] | null> {
    const explicitNames = searchParams.get("unit_names");
    if (explicitNames !== null) {
        return explicitNames
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean);
    }

    const { unitIds } = readDashboardFilters(searchParams);
    if (unitIds.length === 0) return null;

    const { data, error } = await supabase
        .from("units")
        .select("name")
        .in("id", unitIds)
        .abortSignal(signal);

    if (error) throw error;

    return (data ?? [])
        .map((unit: { name?: string | null }) => unit.name?.trim())
        .filter((name: string | undefined): name is string => Boolean(name));
}

async function loadMarkingRows(endExclusive: string, signal: AbortSignal) {
    const rows: MarkingRow[] = [];

    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("schedules")
            .select(
                "id, source_hash, client_id, normalized_phone, patient_name, created_in_source_at, unit_name, status",
            )
            .not("created_in_source_at", "is", null)
            .lt("created_in_source_at", endExclusive)
            .order("created_in_source_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);

        if (error) throw error;

        const page = (data ?? []) as MarkingRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

function firstMarkingRowIds(rows: MarkingRow[]) {
    const seen = new Set<string>();
    const firstIds = new Set<string>();

    for (const row of rows) {
        const identity = markingIdentity(row);
        if (seen.has(identity)) continue;

        seen.add(identity);
        firstIds.add(row.id);
    }

    return firstIds;
}

function summarizeUnit(
    unitName: string,
    rows: MarkingRow[],
    firstRowIds: Set<string>,
    projectionFactor: number,
): MarkingUnitRow {
    const uniqueMarkings = new Set(rows.map(markingIdentity)).size;
    const firstAppointments = rows.filter((row) => firstRowIds.has(row.id)).length;
    const rescheduled = rows.filter(
        (row) => normalizeScheduleStatus(row.status) === "rescheduled",
    ).length;
    const cancelled = rows.filter(
        (row) => normalizeScheduleStatus(row.status) === "cancelled",
    ).length;

    return {
        unit_name: unitName,
        markings: rows.length,
        unique_markings: uniqueMarkings,
        unique_projection: Math.round(uniqueMarkings * projectionFactor),
        rescheduled,
        cancelled,
        first_appointments: firstAppointments,
        first_appointments_projection: Math.round(
            firstAppointments * projectionFactor,
        ),
    };
}

function markingIdentity(row: MarkingRow) {
    const patient = normalizePatientName(row.patient_name);
    if (patient) return `patient:${patient}`;

    const phone = row.normalized_phone?.trim();
    if (phone) return `phone:${phone}`;
    if (row.client_id) return `client:${row.client_id}`;

    return `schedule:${row.source_hash || row.id}`;
}

function rangeProjectionFactor(startDate: string, endDate: string) {
    const today = brazilDate(new Date().toISOString());
    const currentMonthStart = `${today.slice(0, 7)}-01`;
    if (startDate !== currentMonthStart || endDate < today) return 1;

    const [year, monthNumber, day] = today.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return daysInMonth / Math.max(1, Math.min(day, daysInMonth));
}

function nextDate(value: string) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + 1))
        .toISOString()
        .slice(0, 10);
}

function brazilDate(value: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(
        parts.map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
}

function normalizePatientName(value: string | null) {
    return value?.trim().toLocaleLowerCase("pt-BR") ?? "";
}

function normalizeUnitName(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLocaleLowerCase("pt-BR");
}
