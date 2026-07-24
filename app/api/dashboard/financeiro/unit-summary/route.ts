// app/api/dashboard/financeiro/unit-summary/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { resolveDashboardDateRange } from "@/lib/dashboard/metrics";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import {
    FINANCIAL_CATEGORIES,
    type FinancialCategory,
} from "@/lib/invoices/categories";
import {
    findDoctorBySourceName,
    type DoctorReference,
} from "@/lib/invoices/matchDoctor";
import type {
    FinancialUnitRow,
    FinancialUnitSummaryData,
} from "@/types/financial-dashboard-extras";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1_000;

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
    doctor_name: string | null;
    doctors: DoctorReference | DoctorReference[] | null;
};

type FinancialBucket = Omit<FinancialUnitRow, "projection">;

export async function GET(request: Request) {
    const access = await getServerTabAccess("financeiro");
    if (access.ok === false) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status },
        );
    }

    try {
        const { searchParams } = new URL(request.url);
        const range = resolveDashboardDateRange(searchParams);
        const unitIds = readCsv(searchParams.get("unit_ids"));
        const categories = readCategories(searchParams.get("categories"));
        const currentMonth = currentMonthClock();

        const [units, doctors] = await Promise.all([loadUnits(), loadDoctors()]);
        const selectedUnits = (
            unitIds.length === 0
                ? units
                : units.filter((unit) => unitIds.includes(unit.id))
        ).filter((unit) => normalizeText(unit.name) !== "campinas");

        const selectedStartDate =
            range.startDate ?? saoPauloDate(range.startAt);
        const selectedEndDate =
            range.endDate ??
            saoPauloDate(
                new Date(new Date(range.endAt).getTime() - 1).toISOString(),
            );
        const selectedRangeMatchesCurrentMonth =
            selectedStartDate === currentMonth.startDate &&
            selectedEndDate === currentMonth.endDate;
        const selectedInvoiceBounds = invoiceDateBounds(
            selectedStartDate,
            selectedEndDate,
        );
        const selectedInvoicesPromise = loadInvoices({
            startAt: selectedInvoiceBounds.startAt,
            endAt: selectedInvoiceBounds.endAt,
            unitIds,
            categories,
        });
        const [selectedInvoices, currentMonthInvoices] =
            selectedRangeMatchesCurrentMonth
                ? await selectedInvoicesPromise.then((invoices) => [
                      invoices,
                      invoices,
                  ] as const)
                : await Promise.all([
                      selectedInvoicesPromise,
                      loadInvoices({
                          startAt: currentMonth.startAt,
                          endAt: currentMonth.endAt,
                          unitIds,
                          categories,
                      }),
                  ]);
        const projectionFactor = rangeProjectionFactor(
            selectedStartDate,
            selectedEndDate,
        );
        const table = buildFinancialTable({
            invoices: selectedInvoices,
            units: selectedUnits,
            doctors,
            projectionFactor,
        });
        const currentMonthTable = selectedRangeMatchesCurrentMonth
            ? table
            : buildFinancialTable({
                  invoices: currentMonthInvoices,
                  units: selectedUnits,
                  doctors,
                  projectionFactor: currentMonth.projectionFactor,
              });
        const currentMonthTotal = currentMonthTable.total.total;

        const response: FinancialUnitSummaryData = {
            projection: roundMoney(
                currentMonthTotal * currentMonth.projectionFactor,
            ),
            rows: table.rows,
            total: table.total,
        };

        return NextResponse.json(response, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        console.error("[dashboard/financeiro/unit-summary] failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar faturamento por unidade.",
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
                "source_invoice_id, issued_at, amount, description, category, status, unit_id, unit_name, doctor_name, doctors!clinisys_invoices_doctor_id_fkey(id, name)",
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
        buckets.set(unit.id, emptyFinancialBucket(unit.id, unit.name));
    }

    for (const invoice of invoices) {
        if (invoiceStatusGroup(invoice.status) !== "authorized") continue;
        const unitName =
            (invoice.unit_id ? unitNames.get(invoice.unit_id) : null) ??
            invoice.unit_name?.trim() ??
            "Sem unidade";
        if (normalizeText(unitName) === "campinas") continue;

        const key = invoice.unit_id ?? `name:${normalizeText(invoice.unit_name)}`;
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
        .sort(
            (first, second) =>
                second.total - first.total ||
                first.unit_name.localeCompare(second.unit_name, "pt-BR"),
        );
    const totalBucket = rows.reduce<FinancialBucket>(
        (total, row) => addFinancialRow(total, row),
        emptyFinancialBucket(null, "Total geral"),
    );

    return {
        rows,
        total: finalizeFinancialBucket(totalBucket, projectionFactor),
    };
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

function addFinancialRow(total: FinancialBucket, row: FinancialUnitRow) {
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
): FinancialUnitRow {
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

function invoiceDateBounds(startDate: string, endDate: string) {
    return {
        startAt: `${startDate}T00:00:00.000Z`,
        endAt: `${addCalendarDays(endDate, 1)}T00:00:00.000Z`,
    };
}

function addCalendarDays(dateString: string, days: number) {
    const [year, month, day] = dateString.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
}

function currentMonthClock() {
    const today = currentSaoPauloDate();
    const [year, monthNumber, day] = today.split("-").map(Number);
    const month = `${year}-${String(monthNumber).padStart(2, "0")}`;
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const nextMonth = new Date(Date.UTC(year, monthNumber, 1))
        .toISOString()
        .slice(0, 7);

    return {
        startDate: `${month}-01`,
        endDate: `${month}-${String(daysInMonth).padStart(2, "0")}`,
        startAt: `${month}-01T00:00:00.000Z`,
        endAt: `${nextMonth}-01T00:00:00.000Z`,
        projectionFactor:
            daysInMonth / Math.max(1, Math.min(day, daysInMonth)),
    };
}

function rangeProjectionFactor(startDate: string, endDate: string) {
    const today = currentSaoPauloDate();
    const currentMonthStart = `${today.slice(0, 7)}-01`;
    if (startDate !== currentMonthStart || endDate < today) return 1;

    const [year, monthNumber, day] = today.split("-").map(Number);
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

function numeric(value: number | string | null | undefined) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
    return Number(value.toFixed(2));
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
