// app/api/dashboard/financeiro/comparison/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import {
    FINANCIAL_CATEGORIES,
    type FinancialCategory,
} from "@/lib/invoices/categories";
import type {
    RevenueComparisonData,
    RevenueMonthSeries,
} from "@/types/financial-dashboard-extras";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1_000;

type InvoiceRow = {
    issued_at: string;
    amount: number | string;
    status: string;
};

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
        const comparisonMonth = parseMonth(searchParams.get("month"));
        const currentMonth = parseOptionalMonth(
            searchParams.get("current_month"),
        ) ?? currentSaoPauloMonth();
        const unitIds = readCsv(searchParams.get("unit_ids"));
        const categories = readCategories(searchParams.get("categories"));
        const currentRange = monthRange(currentMonth);
        const comparisonRange = monthRange(comparisonMonth);

        const [currentInvoices, comparisonInvoices] = await Promise.all([
            loadInvoices({
                startAt: currentRange.startAt,
                endAt: currentRange.endAt,
                unitIds,
                categories,
            }),
            loadInvoices({
                startAt: comparisonRange.startAt,
                endAt: comparisonRange.endAt,
                unitIds,
                categories,
            }),
        ]);

        const response: RevenueComparisonData = {
            current: buildMonthSeries(
                currentMonth,
                currentRange,
                currentInvoices,
            ),
            comparison: buildMonthSeries(
                comparisonMonth,
                comparisonRange,
                comparisonInvoices,
            ),
        };

        return NextResponse.json(response, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        console.error("[dashboard/financeiro/comparison] failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar o mês de comparação.",
            },
            { status: 500 },
        );
    }
}

function buildMonthSeries(
    month: string,
    range: ReturnType<typeof monthRange>,
    invoices: InvoiceRow[],
): RevenueMonthSeries {
    const buckets = new Map(
        buildDateRange(range.startDate, range.endDate).map((date) => [
            date,
            {
                authorized_revenue: 0,
                cancelled_amount: 0,
                authorized_invoices: 0,
            },
        ]),
    );

    for (const invoice of invoices) {
        const bucket = buckets.get(saoPauloDate(invoice.issued_at));
        if (!bucket) continue;
        const group = statusGroup(invoice.status);

        if (group === "authorized") {
            bucket.authorized_revenue += numeric(invoice.amount);
            bucket.authorized_invoices += 1;
        }
        if (group === "cancelled") {
            bucket.cancelled_amount += numeric(invoice.amount);
        }
    }

    const evolution = [...buckets.entries()].map(([period, bucket]) => ({
        period,
        label: period.slice(8, 10),
        authorized_revenue: roundMoney(bucket.authorized_revenue),
        cancelled_amount: roundMoney(bucket.cancelled_amount),
        authorized_invoices: bucket.authorized_invoices,
    }));

    return {
        month,
        month_label: new Intl.DateTimeFormat("pt-BR", {
            month: "long",
            year: "numeric",
            timeZone: "America/Sao_Paulo",
        }).format(new Date(`${range.startDate}T12:00:00-03:00`)),
        authorized_invoices: evolution.reduce(
            (total, point) => total + point.authorized_invoices,
            0,
        ),
        evolution,
    };
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
            .select("issued_at, amount, status")
            .gte("issued_at", startAt)
            .lt("issued_at", endAt)
            .order("issued_at", { ascending: true })
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

function parseMonth(value: string | null) {
    if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
        throw new Error("Mês de comparação inválido.");
    }
    return value;
}

function parseOptionalMonth(value: string | null) {
    if (!value) return null;
    return parseMonth(value);
}

function currentSaoPauloMonth() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}`;
}

function monthRange(month: string) {
    const [year, monthNumber] = month.split("-").map(Number);
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const startDate = `${month}-01`;
    const endDate = `${month}-${String(days).padStart(2, "0")}`;
    const next = new Date(Date.UTC(year, monthNumber, 1))
        .toISOString()
        .slice(0, 7);

    return {
        startDate,
        endDate,
        startAt: `${startDate}T00:00:00-03:00`,
        endAt: `${next}-01T00:00:00-03:00`,
    };
}

function buildDateRange(startDate: string, endDate: string) {
    const result: string[] = [];
    const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
    const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
    const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay));
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

    while (cursor <= end) {
        result.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return result;
}

function statusGroup(value: string) {
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

function saoPauloDate(value: string) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
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
