// app/api/dashboard/monthly-management/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { resolveDashboardDateRange } from "@/lib/dashboard/metrics";
import {
    FINANCIAL_CATEGORIES,
    type FinancialCategory,
} from "@/lib/invoices/categories";
import {
    findDoctorBySourceName,
    type DoctorReference,
} from "@/lib/invoices/matchDoctor";
import { normalizeScheduleStatus, scheduleShowedUp } from "@/lib/schedules/status";
import type {
    MonthlyFinancialUnitRow,
    MonthlyManagementData,
    MonthlyScheduleUnitRow,
} from "@/types/monthly-management";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1_000;

const FINANCIAL_UNIT_ORDER = [
    "Vitória",
    "São Paulo",
    "Salvador",
    "Rio de Janeiro",
    "Manaus",
    "Juiz de Fora",
    "Brasília",
    "Belo Horizonte",
    "Bauru",
];

const SCHEDULE_UNIT_ORDER = [
    "Vitória",
    "São Paulo",
    "Salvador",
    "Rio de Janeiro",
    "Manaus",
    "Juiz de Fora",
    "Campinas",
    "Brasília",
    "Belo Horizonte",
    "Bauru",
];

type UnitRow = {
    id: string;
    name: string;
};

type InvoiceRow = {
    source_invoice_id: number | string;
    issued_at: string;
    amount: number | string;
    description: string;
    category: string;
    status: string;
    unit_id: string | null;
    unit_name: string | null;
    doctor_id: string | null;
    doctor_name: string | null;
    doctors: DoctorReference | DoctorReference[] | null;
};

type ScheduleRow = {
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

type FinancialBucket = Omit<MonthlyFinancialUnitRow, "projection">;

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const unitIds = readCsv(searchParams.get("unit_ids"));
        const categories = readCategories(searchParams.get("categories"));
        const section = readSection(searchParams.get("section"));
        const clock = managementClock(searchParams);

        const [units, doctors] = await Promise.all([
            loadUnits(),
            section === "schedules" ? Promise.resolve([]) : loadDoctors(),
        ]);
        const selectedUnits =
            unitIds.length === 0
                ? units
                : units.filter((unit) => unitIds.includes(unit.id));
        const selectedUnitNames = selectedUnits.map((unit) => unit.name);

        const [invoices, schedules] = await Promise.all([
            section === "schedules"
                ? Promise.resolve([])
                : loadInvoices({
                      startAt: clock.monthStartAt,
                      endAt: clock.nextMonthStartAt,
                      unitIds,
                      categories,
                  }),
            section === "financial"
                ? Promise.resolve([])
                : loadSchedules({
                      startDate: clock.monthStart,
                      endDate: clock.monthEnd,
                      unitNames: unitIds.length === 0 ? null : selectedUnitNames,
                  }),
        ]);

        const financial = buildFinancialTable({
            invoices,
            units: selectedUnits,
            doctors,
            projectionFactor: clock.projectionFactor,
        });
        const scheduleTable = buildScheduleTable({
            schedules,
            units: selectedUnits,
            projectionFactor: clock.projectionFactor,
        });

        const response: MonthlyManagementData = {
            month: clock.month,
            month_label: clock.monthLabel,
            generated_at: new Date().toISOString(),
            days_elapsed: clock.daysElapsed,
            days_in_month: clock.daysInMonth,
            financial,
            schedules: scheduleTable,
        };

        return NextResponse.json(response, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        console.error("[dashboard/monthly-management] failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar os consolidados mensais.",
            },
            { status: 500 },
        );
    }
}

async function loadUnits() {
    const { data, error } = await supabase
        .from("units")
        .select("id, name")
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) throw error;
    return (data ?? []) as UnitRow[];
}

async function loadDoctors() {
    const { data, error } = await supabase
        .from("doctors")
        .select("id, name")
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) throw error;
    return (data ?? []) as DoctorReference[];
}

async function loadInvoices({
    startAt,
    endAt,
    unitIds,
    categories,
}: {
    startAt: string;
    endAt: string;
    unitIds: string[];
    categories: FinancialCategory[];
}) {
    const rows: InvoiceRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
        let query = supabase
            .from("clinisys_invoices")
            .select(
                "source_invoice_id, issued_at, amount, description, category, status, unit_id, unit_name, doctor_id, doctor_name, doctors!clinisys_invoices_doctor_id_fkey(id, name)",
            )
            .gte("issued_at", startAt)
            .lt("issued_at", endAt)
            .order("issued_at", { ascending: true })
            .order("source_invoice_id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (unitIds.length > 0) query = query.in("unit_id", unitIds);
        if (categories.length > 0) query = query.in("category", categories);

        const { data, error } = await query;
        if (error) throw error;

        const page = (data ?? []) as InvoiceRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadSchedules({
    startDate,
    endDate,
    unitNames,
}: {
    startDate: string;
    endDate: string;
    unitNames: string[] | null;
}) {
    if (unitNames?.length === 0) return [];
    const rows: ScheduleRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
        let query = supabase
            .from("schedules")
            .select(
                "id, source_hash, source_external_id, client_id, normalized_phone, patient_name, scheduled_for, created_in_source_at, unit_name, status, updated_at",
            )
            .gte("scheduled_for", startDate)
            .lte("scheduled_for", endDate)
            .order("scheduled_for", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (unitNames) query = query.in("unit_name", unitNames);

        const { data, error } = await query;
        if (error) throw error;

        const page = (data ?? []) as ScheduleRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

function buildFinancialTable({
    invoices,
    units,
    doctors,
    projectionFactor,
}: {
    invoices: InvoiceRow[];
    units: UnitRow[];
    doctors: DoctorReference[];
    projectionFactor: number;
}) {
    const unitNames = new Map(units.map((unit) => [unit.id, unit.name]));
    const buckets = new Map<string, FinancialBucket>();

    for (const unit of units) {
        if (!FINANCIAL_UNIT_ORDER.includes(unit.name)) continue;
        buckets.set(unit.id, emptyFinancialBucket(unit.id, unit.name));
    }

    for (const invoice of invoices) {
        if (invoiceStatusGroup(invoice.status) !== "authorized") continue;
        const key = invoice.unit_id ?? `name:${normalizeText(invoice.unit_name)}`;
        const unitName =
            (invoice.unit_id ? unitNames.get(invoice.unit_id) : null) ??
            invoice.unit_name?.trim() ??
            "Sem unidade";
        const bucket =
            buckets.get(key) ?? emptyFinancialBucket(invoice.unit_id, unitName);
        const amount = numeric(invoice.amount);
        const description = normalizeText(invoice.description);
        const linkedDoctor =
            relationOne(invoice.doctors) ??
            findDoctorBySourceName(invoice.doctor_name, doctors);

        bucket.total += amount;
        if (linkedDoctor) bucket.internal_doctors += amount;
        else bucket.external_doctors += amount;

        if (isFirstEvaluation(description)) {
            bucket.first_evaluation += amount;
        } else if (invoice.category === "ivf") {
            bucket.ivf += amount;
        } else if (isEmbryoTransfer(invoice.category, description)) {
            bucket.embryo_transfer += amount;
        } else if (invoice.category === "storage") {
            bucket.storage += amount;
        } else if (
            invoice.category === "exams" ||
            invoice.category === "genetics"
        ) {
            bucket.exams += amount;
        } else if (invoice.category === "freezing") {
            bucket.freezing += amount;
        } else {
            bucket.other += amount;
        }

        if (isEggFreezingCycle(description)) {
            bucket.egg_freezing_cycle += amount;
        }

        buckets.set(key, bucket);
    }

    const rows = [...buckets.values()]
        .map((bucket) => finalizeFinancialBucket(bucket, projectionFactor))
        .sort(compareFinancialUnits);
    const totalBucket = rows.reduce<FinancialBucket>(
        (total, row) => addFinancialRow(total, row),
        emptyFinancialBucket(null, "Total geral"),
    );
    const total = finalizeFinancialBucket(totalBucket, projectionFactor);

    return {
        projection: total.projection,
        current_total: total.total,
        rows,
        total,
    };
}

function buildScheduleTable({
    schedules,
    units,
    projectionFactor,
}: {
    schedules: ScheduleRow[];
    units: UnitRow[];
    projectionFactor: number;
}) {
    const rowsByUnit = new Map<string, ScheduleRow[]>();

    for (const unit of units) rowsByUnit.set(normalizeText(unit.name), []);
    for (const schedule of schedules) {
        const key = normalizeText(schedule.unit_name) || "sem unidade";
        const group = rowsByUnit.get(key) ?? [];
        group.push(schedule);
        rowsByUnit.set(key, group);
    }

    const rows = [...rowsByUnit.entries()]
        .map(([unitKey, unitSchedules]) => {
            const unitName =
                units.find((unit) => normalizeText(unit.name) === unitKey)?.name ??
                unitSchedules[0]?.unit_name?.trim() ??
                "Sem unidade";
            return summarizeScheduleUnit(
                unitName,
                unitSchedules,
                projectionFactor,
            );
        })
        .sort(compareScheduleUnits);
    const total = summarizeScheduleUnit(
        "Total geral",
        schedules,
        projectionFactor,
    );

    return { rows, total };
}

function summarizeScheduleUnit(
    unitName: string,
    schedules: ScheduleRow[],
    projectionFactor: number,
): MonthlyScheduleUnitRow {
    const unique = latestUniqueSchedules(schedules);
    const appointments = schedules.length;
    const rescheduledRows = schedules.filter(
        (schedule) => normalizeScheduleStatus(schedule.status) === "rescheduled",
    );
    const reschedulings = rescheduledRows.length;
    const rescheduledPatients = new Set(
        rescheduledRows.map((schedule) => scheduleIdentity(schedule)),
    ).size;
    const counts = {
        pending: 0,
        showedUp: 0,
        rescheduled: 0,
        cancelled: 0,
        noShow: 0,
    };

    for (const schedule of unique) {
        const status = normalizeScheduleStatus(schedule.status);
        if (status === "pending") counts.pending += 1;
        if (scheduleShowedUp(status)) counts.showedUp += 1;
        if (status === "rescheduled") counts.rescheduled += 1;
        if (status === "cancelled") counts.cancelled += 1;
        if (status === "no_show") counts.noShow += 1;
    }

    return {
        unit_name: unitName,
        appointments,
        reschedulings,
        rescheduling_rate: percentage(rescheduledPatients, appointments),
        unique_appointments: unique.length,
        pending: counts.pending,
        showed_up: counts.showedUp,
        showed_up_rate: percentage(counts.showedUp, unique.length),
        projection: roundMetric(counts.showedUp * projectionFactor),
        rescheduled: counts.rescheduled,
        rescheduled_rate: percentage(counts.rescheduled, unique.length),
        cancelled: counts.cancelled,
        cancelled_rate: percentage(counts.cancelled, unique.length),
        no_show: counts.noShow,
        no_show_rate: percentage(counts.noShow, unique.length),
    };
}

function latestUniqueSchedules(rows: ScheduleRow[]) {
    const latest = new Map<string, ScheduleRow>();

    for (const row of rows) {
        const identity = scheduleIdentity(row);
        const current = latest.get(identity);
        if (!current || compareScheduleRecency(row, current) > 0) {
            latest.set(identity, row);
        }
    }

    return [...latest.values()];
}

function scheduleIdentity(row: ScheduleRow) {
    const phone = row.normalized_phone?.trim();
    if (phone) return `phone:${phone}`;
    if (row.client_id) return `client:${row.client_id}`;
    const patient = normalizeText(row.patient_name);
    if (patient) return `patient:${patient}`;
    return `schedule:${row.source_hash || row.id}`;
}

function compareScheduleRecency(first: ScheduleRow, second: ScheduleRow) {
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

function emptyFinancialBucket(
    unitId: string | null,
    unitName: string,
): FinancialBucket {
    return {
        unit_id: unitId,
        unit_name: unitName,
        total: 0,
        internal_doctors: 0,
        external_doctors: 0,
        first_evaluation: 0,
        ivf: 0,
        egg_freezing_cycle: 0,
        embryo_transfer: 0,
        storage: 0,
        exams: 0,
        freezing: 0,
        other: 0,
    };
}

function addFinancialRow(
    total: FinancialBucket,
    row: MonthlyFinancialUnitRow,
): FinancialBucket {
    total.total += row.total;
    total.internal_doctors += row.internal_doctors;
    total.external_doctors += row.external_doctors;
    total.first_evaluation += row.first_evaluation;
    total.ivf += row.ivf;
    total.egg_freezing_cycle += row.egg_freezing_cycle;
    total.embryo_transfer += row.embryo_transfer;
    total.storage += row.storage;
    total.exams += row.exams;
    total.freezing += row.freezing;
    total.other += row.other;
    return total;
}

function finalizeFinancialBucket(
    bucket: FinancialBucket,
    projectionFactor: number,
): MonthlyFinancialUnitRow {
    return {
        ...bucket,
        projection: roundMoney(bucket.total * projectionFactor),
        total: roundMoney(bucket.total),
        internal_doctors: roundMoney(bucket.internal_doctors),
        external_doctors: roundMoney(bucket.external_doctors),
        first_evaluation: roundMoney(bucket.first_evaluation),
        ivf: roundMoney(bucket.ivf),
        egg_freezing_cycle: roundMoney(bucket.egg_freezing_cycle),
        embryo_transfer: roundMoney(bucket.embryo_transfer),
        storage: roundMoney(bucket.storage),
        exams: roundMoney(bucket.exams),
        freezing: roundMoney(bucket.freezing),
        other: roundMoney(bucket.other),
    };
}

function isFirstEvaluation(description: string) {
    return /(^|\s)1a\.?\s*avaliacao/.test(description);
}

function isEggFreezingCycle(description: string) {
    return /ciclo para congelamento de ovulos/.test(description);
}

function isEmbryoTransfer(category: string, description: string) {
    return category === "embryo_transfer" || /\btod\b/.test(description);
}

function invoiceStatusGroup(value: string) {
    const normalized = normalizeText(value).replace(/\s+/g, "");
    if (
        normalized.startsWith("autorizada") ||
        normalized.includes("cancelamentonegado") ||
        normalized.includes("cancelamentorejeitado")
    ) {
        return "authorized";
    }
    if (normalized === "cancelada") return "cancelled";
    return "other";
}

function compareFinancialUnits(
    first: MonthlyFinancialUnitRow,
    second: MonthlyFinancialUnitRow,
) {
    const firstIndex = FINANCIAL_UNIT_ORDER.indexOf(first.unit_name);
    const secondIndex = FINANCIAL_UNIT_ORDER.indexOf(second.unit_name);
    if (firstIndex >= 0 || secondIndex >= 0) {
        return (
            (firstIndex < 0 ? Number.MAX_SAFE_INTEGER : firstIndex) -
            (secondIndex < 0 ? Number.MAX_SAFE_INTEGER : secondIndex)
        );
    }
    return first.unit_name.localeCompare(second.unit_name, "pt-BR");
}

function compareScheduleUnits(
    first: MonthlyScheduleUnitRow,
    second: MonthlyScheduleUnitRow,
) {
    const firstIndex = SCHEDULE_UNIT_ORDER.indexOf(first.unit_name);
    const secondIndex = SCHEDULE_UNIT_ORDER.indexOf(second.unit_name);
    if (firstIndex >= 0 || secondIndex >= 0) {
        return (
            (firstIndex < 0 ? Number.MAX_SAFE_INTEGER : firstIndex) -
            (secondIndex < 0 ? Number.MAX_SAFE_INTEGER : secondIndex)
        );
    }
    return first.unit_name.localeCompare(second.unit_name, "pt-BR");
}

function managementClock(searchParams: URLSearchParams) {
    const hasSelectedRange =
        searchParams.has("days") ||
        searchParams.has("start_date") ||
        searchParams.has("end_date");

    if (!hasSelectedRange) return monthClock();

    const range = resolveDashboardDateRange(searchParams);
    const startDate = range.startDate ?? saoPauloDate(range.startAt);
    const endDate =
        range.endDate ??
        saoPauloDate(
            new Date(new Date(range.endAt).getTime() - 1).toISOString(),
        );
    const selectedDays = inclusiveDays(startDate, endDate);

    return {
        month: startDate.slice(0, 7),
        monthLabel: dateRangeLabel(startDate, endDate),
        monthStart: startDate,
        monthEnd: endDate,
        monthStartAt: range.startAt,
        nextMonthStartAt: range.endAt,
        daysElapsed: selectedDays,
        daysInMonth: selectedDays,
        projectionFactor: rangeProjectionFactor(startDate, endDate),
    };
}

function monthClock() {
    const today = currentSaoPauloDate();
    const [year, monthNumber, day] = today.split("-").map(Number);
    const month = `${year}-${String(monthNumber).padStart(2, "0")}`;
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
    const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
    const nextMonth = nextMonthDate.toISOString().slice(0, 7);

    return {
        month,
        monthLabel: new Intl.DateTimeFormat("pt-BR", {
            month: "long",
            year: "numeric",
            timeZone: "America/Sao_Paulo",
        }).format(new Date(`${monthStart}T12:00:00-03:00`)),
        monthStart,
        monthEnd,
        monthStartAt: `${monthStart}T00:00:00-03:00`,
        nextMonthStartAt: `${nextMonth}-01T00:00:00-03:00`,
        daysElapsed: Math.max(1, Math.min(day, daysInMonth)),
        daysInMonth,
        projectionFactor: daysInMonth / Math.max(1, Math.min(day, daysInMonth)),
    };
}

function rangeProjectionFactor(startDate: string, endDate: string) {
    const today = currentSaoPauloDate();
    const currentMonth = today.slice(0, 7);
    const currentMonthStart = `${currentMonth}-01`;

    if (startDate !== currentMonthStart || endDate < today) return 1;

    const [, monthNumber, day] = today.split("-").map(Number);
    const year = Number(today.slice(0, 4));
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return daysInMonth / Math.max(1, Math.min(day, daysInMonth));
}

function currentSaoPauloDate() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

function saoPauloDate(value: string) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(value));
}

function inclusiveDays(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T12:00:00Z`).getTime();
    const end = new Date(`${endDate}T12:00:00Z`).getTime();
    return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function dateRangeLabel(startDate: string, endDate: string) {
    const formatter = new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "America/Sao_Paulo",
    });
    const start = formatter.format(new Date(`${startDate}T12:00:00-03:00`));
    const end = formatter.format(new Date(`${endDate}T12:00:00-03:00`));
    return startDate === endDate ? start : `${start} – ${end}`;
}

function readSection(value: string | null) {
    if (value === "financial" || value === "schedules") return value;
    return "all" as const;
}

function readCsv(value: string | null) {
    return (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function readCategories(value: string | null): FinancialCategory[] {
    const allowed = new Set<string>(
        FINANCIAL_CATEGORIES.map((category) => category.value),
    );
    return readCsv(value).filter((item): item is FinancialCategory =>
        allowed.has(item),
    );
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

function percentage(value: number, total: number) {
    if (total <= 0) return null;
    return Number(((value / total) * 100).toFixed(1));
}

function numeric(value: number | string | null | undefined) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
    return Number(value.toFixed(2));
}

function roundMetric(value: number) {
    return Number(value.toFixed(1));
}

function normalizeText(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
