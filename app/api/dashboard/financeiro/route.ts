// app/api/dashboard/financeiro/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import {
    FINANCIAL_CATEGORIES,
    getFinancialCategoryLabel,
} from "@/lib/invoices/categories";
import {
    findDoctorBySourceName,
    type DoctorReference,
} from "@/lib/invoices/matchDoctor";
import {
    parseTextArray,
    parseUuidArray,
    resolveDashboardDateRange,
} from "@/lib/dashboard/metrics";
import type {
    FinancialDashboardData,
    FinancialKpis,
} from "@/types";

const PAGE_SIZE = 1_000;
const ID_FILTER_BATCH_SIZE = 100;

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
    patient_code: number | string | null;
    client_id: string | null;
    nfe_number: number | string | null;
    updated_at: string;
};

type UnitRow = {
    id: string;
    name: string;
};

type ScheduleRow = {
    client_id: string | null;
    unit_name: string | null;
};

type ClientAttributionRow = {
    id: string;
    last_origin: string | null;
    last_tunnel: string | null;
};

type FinancialFilters = {
    unitIds: string[];
    categories: string[];
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
        const range = resolveDashboardDateRange(searchParams);
        const filters = readFinancialFilters(searchParams);
        const [units, doctors, currentInvoices, previousInvoices, lastSyncedAt] =
            await Promise.all([
                loadUnits(),
                loadDoctors(),
                loadInvoices(range.startAt, range.endAt, filters),
                loadInvoices(
                    range.previousStartAt,
                    range.previousEndAt,
                    filters,
                ),
                loadLastSyncedAt(),
            ]);

        const selectedUnitNames = selectedNames(units, filters.unitIds);
        const schedules = await loadSchedules(
            range.startAt,
            range.endAt,
            selectedUnitNames,
        );
        const clientIds = Array.from(
            new Set(
                currentInvoices
                    .map((invoice) => invoice.client_id)
                    .filter((id): id is string => Boolean(id)),
            ),
        );
        const clients = await loadClients(clientIds);
        const currentKpis = buildKpis(currentInvoices);
        const previousKpis = buildKpis(previousInvoices);

        const response: FinancialDashboardData = {
            filters: {
                start_date: range.startDate,
                end_date: range.endDate,
                unit_ids: filters.unitIds,
                categories: filters.categories,
            },
            available_filters: {
                categories: FINANCIAL_CATEGORIES.map((category) => ({
                    label: category.label,
                    value: category.value,
                })),
            },
            kpis: currentKpis,
            previous_kpis: previousKpis,
            evolution: buildEvolution(currentInvoices, range.startAt, range.endAt),
            by_status: buildStatusBreakdown(currentInvoices),
            by_category: buildCategoryBreakdown(currentInvoices),
            by_unit: buildUnitBreakdown(currentInvoices, schedules, units),
            by_doctor: buildDoctorBreakdown(currentInvoices, doctors),
            crm: buildCrmMetrics(currentInvoices, schedules, clients),
            audit: {
                invoices_in_period: currentInvoices.length,
                authorized_invoices: currentKpis.authorized_invoices,
                invoices_with_client: currentInvoices.filter(
                    (invoice) => Boolean(invoice.client_id),
                ).length,
                last_synced_at: lastSyncedAt,
            },
        };

        return NextResponse.json(response, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        console.error("[dashboard/financeiro] failed", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar o Financeiro.",
            },
            { status: 500 },
        );
    }
}

function readFinancialFilters(searchParams: URLSearchParams): FinancialFilters {
    const validCategories = new Set(
        FINANCIAL_CATEGORIES.map((category) => category.value),
    );

    return {
        unitIds: parseUuidArray(searchParams.get("unit_ids")),
        categories: parseTextArray(searchParams.get("categories")).filter(
            (category) => validCategories.has(
                category as (typeof FINANCIAL_CATEGORIES)[number]["value"],
            ),
        ),
    };
}

async function loadInvoices(
    startAt: string,
    endAt: string,
    filters: FinancialFilters,
) {
    const rows: InvoiceRow[] = [];
    const issuedAtStart = `${saoPauloDate(startAt)}T00:00:00.000Z`;
    const issuedAtEnd = `${addCalendarDays(
        saoPauloDate(new Date(new Date(endAt).getTime() - 1).toISOString()),
        1,
    )}T00:00:00.000Z`;

    for (let from = 0; ; from += PAGE_SIZE) {
        let query = supabase
            .from("clinisys_invoices")
            .select(
                "source_invoice_id, issued_at, amount, description, category, status, unit_id, unit_name, doctor_id, doctor_name, patient_code, client_id, nfe_number, updated_at, doctors!clinisys_invoices_doctor_id_fkey(id, name)",
            )
            .gte("issued_at", issuedAtStart)
            .lt("issued_at", issuedAtEnd)
            .order("issued_at", { ascending: true })
            .order("source_invoice_id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (filters.unitIds.length > 0) {
            query = query.in("unit_id", filters.unitIds);
        }
        if (filters.categories.length > 0) {
            query = query.in("category", filters.categories);
        }

        const { data, error } = await query;
        if (error) throw error;

        const page = (data ?? []) as InvoiceRow[];
        rows.push(...page);

        if (page.length < PAGE_SIZE) break;
    }

    return rows;
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

async function loadSchedules(
    startAt: string,
    endAt: string,
    unitNames: string[] | null,
) {
    if (unitNames && unitNames.length === 0) return [];

    const rows: ScheduleRow[] = [];
    const startDate = saoPauloDate(startAt);
    const endDate = saoPauloDate(
        new Date(new Date(endAt).getTime() - 1).toISOString(),
    );

    for (let from = 0; ; from += PAGE_SIZE) {
        let query = supabase
            .from("schedules")
            .select("client_id, unit_name")
            .gte("scheduled_for", startDate)
            .lte("scheduled_for", endDate)
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

async function loadClients(clientIds: string[]) {
    const clients: ClientAttributionRow[] = [];

    for (const ids of chunk(clientIds, ID_FILTER_BATCH_SIZE)) {
        if (ids.length === 0) continue;

        const { data, error } = await supabase
            .from("clients")
            .select("id, last_origin, last_tunnel")
            .in("id", ids);

        if (error) throw error;
        clients.push(...((data ?? []) as ClientAttributionRow[]));
    }

    return clients;
}

async function loadLastSyncedAt() {
    const { data, error } = await supabase
        .from("clinisys_invoices")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return typeof data?.updated_at === "string" ? data.updated_at : null;
}

function buildKpis(invoices: InvoiceRow[]): FinancialKpis {
    const authorized = invoices.filter(
        (invoice) => statusGroup(invoice.status) === "authorized",
    );
    const cancelled = invoices.filter(
        (invoice) => statusGroup(invoice.status) === "cancelled",
    );
    const authorizedRevenue = sumAmounts(authorized);
    const finalInvoices = authorized.length + cancelled.length;
    const patientIds = new Set(
        authorized.map((invoice) => patientKey(invoice)),
    );

    return {
        authorized_revenue: roundMoney(authorizedRevenue),
        authorized_invoices: authorized.length,
        average_ticket: averageMoney(authorizedRevenue, authorized.length),
        billed_patients: patientIds.size,
        cancelled_amount: roundMoney(sumAmounts(cancelled)),
        cancellation_rate: percentage(cancelled.length, finalInvoices),
    };
}

function buildEvolution(
    invoices: InvoiceRow[],
    startAt: string,
    endAt: string,
): FinancialDashboardData["evolution"] {
    const durationDays = Math.ceil(
        (new Date(endAt).getTime() - new Date(startAt).getTime()) /
            (24 * 60 * 60 * 1_000),
    );
    const resolution =
        durationDays <= 45 ? "day" : durationDays <= 180 ? "week" : "month";
    const buckets = new Map<
        string,
        {
            authorized_revenue: number;
            cancelled_amount: number;
            authorized_invoices: number;
        }
    >();

    for (const invoice of invoices) {
        const key = periodKey(invoice.issued_at, resolution);
        const current = buckets.get(key) ?? {
            authorized_revenue: 0,
            cancelled_amount: 0,
            authorized_invoices: 0,
        };
        const group = statusGroup(invoice.status);

        if (group === "authorized") {
            current.authorized_revenue += numeric(invoice.amount);
            current.authorized_invoices += 1;
        }
        if (group === "cancelled") {
            current.cancelled_amount += numeric(invoice.amount);
        }

        buckets.set(key, current);
    }

    return [...buckets.entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([period, values]) => ({
            period,
            label: periodLabel(period, resolution),
            authorized_revenue: roundMoney(values.authorized_revenue),
            cancelled_amount: roundMoney(values.cancelled_amount),
            authorized_invoices: values.authorized_invoices,
            average_ticket: averageMoney(
                values.authorized_revenue,
                values.authorized_invoices,
            ),
        }));
}

function buildStatusBreakdown(
    invoices: InvoiceRow[],
): FinancialDashboardData["by_status"] {
    const order = [
        "authorized",
        "cancelled",
        "pending",
        "denied",
        "other",
    ] as const;
    const labels: Record<(typeof order)[number], string> = {
        authorized: "Autorizadas",
        cancelled: "Canceladas",
        pending: "Pendentes",
        denied: "Negadas",
        other: "Outros",
    };

    return order
        .map((status) => {
            const matching = invoices.filter(
                (invoice) => statusGroup(invoice.status) === status,
            );

            return {
                status,
                label: labels[status],
                invoices: matching.length,
                amount: roundMoney(sumAmounts(matching)),
                percentage: percentage(matching.length, invoices.length),
            };
        })
        .filter((item) => item.invoices > 0);
}

function buildCategoryBreakdown(
    invoices: InvoiceRow[],
): FinancialDashboardData["by_category"] {
    const authorized = invoices.filter(
        (invoice) => statusGroup(invoice.status) === "authorized",
    );
    const totalRevenue = sumAmounts(authorized);
    const groups = new Map<string, InvoiceRow[]>();

    for (const invoice of authorized) {
        const group = groups.get(invoice.category) ?? [];
        group.push(invoice);
        groups.set(invoice.category, group);
    }

    return [...groups.entries()]
        .map(([category, rows]) => {
            const revenue = sumAmounts(rows);
            return {
                category,
                label: getFinancialCategoryLabel(category),
                invoices: rows.length,
                revenue: roundMoney(revenue),
                average_ticket: averageMoney(revenue, rows.length),
                percentage: percentage(revenue, totalRevenue),
            };
        })
        .sort((first, second) => second.revenue - first.revenue);
}

function buildUnitBreakdown(
    invoices: InvoiceRow[],
    schedules: ScheduleRow[],
    units: UnitRow[],
): FinancialDashboardData["by_unit"] {
    const unitNames = new Map(units.map((unit) => [unit.id, unit.name]));
    const scheduleCounts = new Map<string, number>();
    const groups = new Map<string, InvoiceRow[]>();

    for (const schedule of schedules) {
        const key = normalizeText(schedule.unit_name ?? "Sem unidade");
        scheduleCounts.set(key, (scheduleCounts.get(key) ?? 0) + 1);
    }

    for (const invoice of invoices) {
        const key = invoice.unit_id ?? `name:${normalizeText(
            invoice.unit_name ?? "Sem unidade",
        )}`;
        const group = groups.get(key) ?? [];
        group.push(invoice);
        groups.set(key, group);
    }

    return [...groups.entries()]
        .map(([key, rows]) => {
            const authorized = rows.filter(
                (invoice) => statusGroup(invoice.status) === "authorized",
            );
            const cancelled = rows.filter(
                (invoice) => statusGroup(invoice.status) === "cancelled",
            );
            const revenue = sumAmounts(authorized);
            const unitId = key.startsWith("name:") ? null : key;
            const unitName =
                (unitId ? unitNames.get(unitId) : null) ??
                rows[0]?.unit_name ??
                "Sem unidade";

            return {
                unit_id: unitId,
                unit_name: unitName,
                invoices: authorized.length,
                revenue: roundMoney(revenue),
                average_ticket: averageMoney(revenue, authorized.length),
                patients: new Set(
                    authorized.map((invoice) => patientKey(invoice)),
                ).size,
                cancellation_rate: percentage(
                    cancelled.length,
                    authorized.length + cancelled.length,
                ),
                schedules: scheduleCounts.get(normalizeText(unitName)) ?? 0,
            };
        })
        .sort((first, second) => second.revenue - first.revenue);
}

function buildDoctorBreakdown(
    invoices: InvoiceRow[],
    doctors: DoctorReference[],
): FinancialDashboardData["by_doctor"] {
    const authorized = invoices.filter(
        (invoice) => statusGroup(invoice.status) === "authorized",
    );
    const totalRevenue = sumAmounts(authorized);
    const groups = new Map<
        string,
        { doctorName: string; invoices: InvoiceRow[] }
    >();

    for (const invoice of authorized) {
        const linkedDoctor = relationOne(invoice.doctors) ??
            findDoctorBySourceName(invoice.doctor_name, doctors);
        const doctorName =
            linkedDoctor?.name ?? invoice.doctor_name?.trim() ?? "Sem médico";
        const key = linkedDoctor?.id ?? `source:${normalizeText(doctorName)}`;
        const group = groups.get(key) ?? { doctorName, invoices: [] };
        group.invoices.push(invoice);
        groups.set(key, group);
    }

    return [...groups.entries()]
        .map(([, group]) => {
            const rows = group.invoices;
            const revenue = sumAmounts(rows);
            return {
                doctor_name: group.doctorName,
                invoices: rows.length,
                revenue: roundMoney(revenue),
                average_ticket: averageMoney(revenue, rows.length),
                percentage: percentage(revenue, totalRevenue),
            };
        })
        .sort((first, second) => second.revenue - first.revenue)
        .slice(0, 10);
}

function buildCrmMetrics(
    invoices: InvoiceRow[],
    schedules: ScheduleRow[],
    clients: ClientAttributionRow[],
): FinancialDashboardData["crm"] {
    const authorized = invoices.filter(
        (invoice) => statusGroup(invoice.status) === "authorized",
    );
    const totalRevenue = sumAmounts(authorized);
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const linked = authorized.filter((invoice) => Boolean(invoice.client_id));
    const linkedRevenue = sumAmounts(linked);
    const attributed = linked.filter((invoice) => {
        const origin = invoice.client_id
            ? clientsById.get(invoice.client_id)?.last_origin
            : null;
        return Boolean(origin?.trim());
    });
    const attributedRevenue = sumAmounts(attributed);
    const origins = new Map<string, InvoiceRow[]>();
    const unattributed = authorized.filter((invoice) => {
        const origin = invoice.client_id
            ? clientsById.get(invoice.client_id)?.last_origin
            : null;
        return !origin?.trim();
    });

    for (const invoice of attributed) {
        const origin = invoice.client_id
            ? clientsById.get(invoice.client_id)?.last_origin?.trim()
            : null;
        if (!origin) continue;

        const group = origins.get(origin) ?? [];
        group.push(invoice);
        origins.set(origin, group);
    }

    const scheduledClientIds = new Set(
        schedules
            .map((schedule) => schedule.client_id)
            .filter((id): id is string => Boolean(id)),
    );
    const billedClientIds = new Set(
        authorized
            .map((invoice) => invoice.client_id)
            .filter((id): id is string => Boolean(id)),
    );
    const billedScheduledClients = [...scheduledClientIds].filter((id) =>
        billedClientIds.has(id),
    ).length;

    return {
        linked_invoices: linked.length,
        linked_revenue: roundMoney(linkedRevenue),
        linked_revenue_coverage: percentage(linkedRevenue, totalRevenue),
        attributed_revenue: roundMoney(attributedRevenue),
        attribution_coverage: percentage(attributedRevenue, totalRevenue),
        scheduled_clients: scheduledClientIds.size,
        billed_scheduled_clients: billedScheduledClients,
        schedule_to_billing_rate: percentage(
            billedScheduledClients,
            scheduledClientIds.size,
        ),
        by_origin: [
            ...origins.entries(),
            ...(unattributed.length > 0
                ? [["Sem origem atribuída", unattributed] as const]
                : []),
        ]
            .map(([origin, rows]) => {
                const revenue = sumAmounts(rows);
                return {
                    origin,
                    invoices: rows.length,
                    revenue: roundMoney(revenue),
                    percentage: percentage(revenue, totalRevenue),
                };
            })
            .sort((first, second) => second.revenue - first.revenue)
            .slice(0, 8),
    };
}

function statusGroup(
    status: string,
): FinancialDashboardData["by_status"][number]["status"] {
    const normalized = normalizeText(status).replace(/\s+/g, "");

    if (
        normalized.startsWith("autorizada") ||
        normalized.includes("cancelamentonegado") ||
        normalized.includes("cancelamentorejeitado")
    ) {
        return "authorized";
    }
    if (normalized === "cancelada") return "cancelled";
    if (normalized.includes("aguardando")) return "pending";
    if (normalized.includes("negada")) return "denied";
    return "other";
}

function periodKey(
    issuedAt: string,
    resolution: "day" | "week" | "month",
) {
    const date = new Date(issuedAt);
    const dateKey = date.toISOString().slice(0, 10);

    if (resolution === "day") return dateKey;
    if (resolution === "month") return dateKey.slice(0, 7);

    const monday = new Date(`${dateKey}T12:00:00Z`);
    const day = monday.getUTCDay();
    monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
    return monday.toISOString().slice(0, 10);
}

function periodLabel(
    period: string,
    resolution: "day" | "week" | "month",
) {
    if (resolution === "month") {
        return new Intl.DateTimeFormat("pt-BR", {
            month: "short",
            year: "2-digit",
            timeZone: "America/Sao_Paulo",
        }).format(new Date(`${period}-01T12:00:00-03:00`));
    }

    return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "America/Sao_Paulo",
    }).format(new Date(`${period}T12:00:00-03:00`));
}

function selectedNames(units: UnitRow[], unitIds: string[]) {
    if (unitIds.length === 0) return null;
    const selected = new Set(unitIds);
    return units.filter((unit) => selected.has(unit.id)).map((unit) => unit.name);
}

function sumAmounts(invoices: InvoiceRow[]) {
    return invoices.reduce(
        (total, invoice) => total + numeric(invoice.amount),
        0,
    );
}

function numeric(value: number | string | null | undefined) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function patientKey(invoice: InvoiceRow) {
    if (invoice.patient_code !== null) return `patient:${invoice.patient_code}`;
    if (invoice.client_id) return `client:${invoice.client_id}`;
    return `invoice:${invoice.source_invoice_id}`;
}

function percentage(value: number, total: number) {
    if (total <= 0) return null;
    return Number(((value / total) * 100).toFixed(1));
}

function averageMoney(total: number, count: number) {
    return count > 0 ? roundMoney(total / count) : null;
}

function roundMoney(value: number) {
    return Number(value.toFixed(2));
}

function normalizeText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .trim();
}

function saoPauloDate(value: string) {
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

function addCalendarDays(date: string, days: number) {
    const [year, month, day] = date.split("-").map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day + days));
    return cursor.toISOString().slice(0, 10);
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}
