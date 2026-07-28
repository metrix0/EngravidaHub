// app/api/dashboard/financeiro/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { resolvePaidMediaPlatform } from "@/lib/ads/paidMediaAttribution";
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
    PaidMediaKpis,
} from "@/types";

const PAGE_SIZE = 1_000;
const ID_FILTER_BATCH_SIZE = 100;

const MEDIA_BUDGET_CITIES = [
    { key: "sao_paulo", city: "São Paulo", monthlyBudget: 70_000, aliases: ["sao paulo", "sp"] },
    { key: "rio_de_janeiro", city: "Rio de Janeiro", monthlyBudget: 45_000, aliases: ["rio de janeiro", "rj"] },
    { key: "salvador", city: "Salvador", monthlyBudget: 35_000, aliases: ["salvador", "ssa"] },
    { key: "brasilia", city: "Brasília", monthlyBudget: 35_000, aliases: ["brasilia", "bsb"] },
    { key: "juiz_de_fora", city: "Juiz de Fora", monthlyBudget: 30_000, aliases: ["juiz de fora", "jf", "jdf"] },
    { key: "belo_horizonte", city: "Belo Horizonte", monthlyBudget: 30_000, aliases: ["belo horizonte", "bh"] },
    { key: "manaus", city: "Manaus", monthlyBudget: 25_000, aliases: ["manaus", "mao"] },
    { key: "vitoria", city: "Vitória", monthlyBudget: 30_000, aliases: ["vitoria", "vix"] },
    { key: "bauru", city: "Bauru", monthlyBudget: 20_000, aliases: ["bauru", "bau"] },
    { key: "campinas", city: "Campinas", monthlyBudget: 10_000, aliases: ["campinas", "cpq"] },
] as const;

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
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    gclid: string | null;
    gbraid: string | null;
    wbraid: string | null;
    fbclid: string | null;
    fbc: string | null;
    ctwa_clid: string | null;
};

type AdMetricRow = {
    platform: "google_ads" | "meta_ads";
    account_id: string;
    account_name: string;
    campaign_id: string;
    campaign_name: string;
    metric_date: string;
    currency_code: string;
    impressions: number | string;
    clicks: number | string;
    spend: number | string;
    reported_conversions: number | string;
    reported_conversion_value: number | string;
    reported_conversion_type: string | null;
    synced_at: string;
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
        const [
            units,
            doctors,
            currentInvoices,
            previousInvoices,
            currentAdMetrics,
            previousAdMetrics,
            lastSyncedAt,
            lastAdsSyncedAt,
        ] = await Promise.all([
            loadUnits(),
            loadDoctors(),
            loadInvoices(range.startAt, range.endAt, filters),
            loadInvoices(
                range.previousStartAt,
                range.previousEndAt,
                filters,
            ),
            loadAdMetrics(range.startAt, range.endAt),
            loadAdMetrics(range.previousStartAt, range.previousEndAt),
            loadLastSyncedAt(),
            loadLastAdsSyncedAt(),
        ]);

        const selectedUnitNames = selectedNames(units, filters.unitIds);
        const comparisonAvailable =
            filters.unitIds.length === 0 && filters.categories.length === 0;
        const [schedules, previousSchedules] = await Promise.all([
            loadSchedules(
                range.startAt,
                range.endAt,
                selectedUnitNames,
            ),
            comparisonAvailable && previousAdMetrics.length > 0
                ? loadSchedules(
                      range.previousStartAt,
                      range.previousEndAt,
                      selectedUnitNames,
                  )
                : Promise.resolve([]),
        ]);
        const clientIds = Array.from(
            new Set(
                [
                    ...currentInvoices.map((invoice) => invoice.client_id),
                    ...previousInvoices.map((invoice) => invoice.client_id),
                    ...schedules.map((schedule) => schedule.client_id),
                    ...previousSchedules.map(
                        (schedule) => schedule.client_id,
                    ),
                ]
                    .filter((id): id is string => Boolean(id)),
            ),
        );
        const clients = await loadClients(clientIds);
        const currentKpis = buildKpis(currentInvoices);
        const previousKpis = buildKpis(previousInvoices);
        const currentAds = buildPaidMediaMetrics({
            adMetrics: currentAdMetrics,
            invoices: currentInvoices,
            schedules,
            clients,
            startAt: range.startAt,
            endAt: range.endAt,
            comparisonAvailable,
        });
        const previousAds = buildPaidMediaMetrics({
            adMetrics: previousAdMetrics,
            invoices: previousInvoices,
            schedules: previousSchedules,
            clients,
            startAt: range.previousStartAt,
            endAt: range.previousEndAt,
            comparisonAvailable,
        });
        const mediaByCity = buildMediaBudgetByCity({
            adMetrics: currentAdMetrics,
            schedules,
            invoices: currentInvoices,
            clients,
            units,
            selectedUnitIds: filters.unitIds,
            startAt: range.startAt,
            endAt: range.endAt,
        });

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
            ads: {
                has_data: currentAdMetrics.length > 0,
                comparison_available: comparisonAvailable,
                kpis: currentAds.kpis,
                previous_kpis: previousAds.kpis,
                evolution: currentAds.evolution,
                by_platform: currentAds.byPlatform,
                top_campaigns: currentAds.topCampaigns,
                by_city: mediaByCity.rows,
                unmatched_city_spend: mediaByCity.unmatchedSpend,
                last_synced_at: lastAdsSyncedAt,
            },
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
            .select(
                "id, last_origin, last_tunnel, utm_source, utm_medium, utm_campaign, gclid, gbraid, wbraid, fbclid, fbc, ctwa_clid",
            )
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

async function loadAdMetrics(startAt: string, endAt: string) {
    const rows: AdMetricRow[] = [];
    const startDate = saoPauloDate(startAt);
    const endDate = saoPauloDate(
        new Date(new Date(endAt).getTime() - 1).toISOString(),
    );

    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("ad_daily_metrics")
            .select(
                "platform, account_id, account_name, campaign_id, campaign_name, metric_date, currency_code, impressions, clicks, spend, reported_conversions, reported_conversion_value, reported_conversion_type, synced_at",
            )
            .gte("metric_date", startDate)
            .lte("metric_date", endDate)
            .order("metric_date", { ascending: true })
            .order("platform", { ascending: true })
            .order("account_id", { ascending: true })
            .order("campaign_id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            if (isMissingAdsTable(error)) return [];
            throw error;
        }

        const page = (data ?? []) as AdMetricRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadLastAdsSyncedAt() {
    const { data, error } = await supabase
        .from("ad_daily_metrics")
        .select("synced_at")
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        if (isMissingAdsTable(error)) return null;
        throw error;
    }
    return typeof data?.synced_at === "string" ? data.synced_at : null;
}

function isMissingAdsTable(error: { code?: string; message?: string }) {
    return (
        error.code === "42P01" ||
        error.code === "PGRST205" ||
        Boolean(error.message?.includes("ad_daily_metrics"))
    );
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

function buildPaidMediaMetrics({
    adMetrics,
    invoices,
    schedules,
    clients,
    startAt,
    endAt,
    comparisonAvailable,
}: {
    adMetrics: AdMetricRow[];
    invoices: InvoiceRow[];
    schedules: ScheduleRow[];
    clients: ClientAttributionRow[];
    startAt: string;
    endAt: string;
    comparisonAvailable: boolean;
}) {
    const durationDays = Math.ceil(
        (new Date(endAt).getTime() - new Date(startAt).getTime()) /
            (24 * 60 * 60 * 1_000),
    );
    const resolution =
        durationDays <= 45 ? "day" : durationDays <= 180 ? "week" : "month";
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const outcomes = new Map<
        AdMetricRow["platform"],
        {
            revenue: number;
            schedules: number;
            billedPatients: Set<string>;
            revenueByPeriod: Map<string, number>;
        }
    >([
        [
            "google_ads",
            {
                revenue: 0,
                schedules: 0,
                billedPatients: new Set<string>(),
                revenueByPeriod: new Map<string, number>(),
            },
        ],
        [
            "meta_ads",
            {
                revenue: 0,
                schedules: 0,
                billedPatients: new Set<string>(),
                revenueByPeriod: new Map<string, number>(),
            },
        ],
    ]);

    if (comparisonAvailable) {
        for (const invoice of invoices) {
            if (
                statusGroup(invoice.status) !== "authorized" ||
                !invoice.client_id
            ) {
                continue;
            }

            const platform = resolveClientAdPlatform(
                clientsById.get(invoice.client_id),
            );
            if (!platform) continue;

            const outcome = outcomes.get(platform)!;
            const revenue = numeric(invoice.amount);
            const period = periodKey(invoice.issued_at, resolution);
            outcome.revenue += revenue;
            outcome.billedPatients.add(invoice.client_id);
            outcome.revenueByPeriod.set(
                period,
                (outcome.revenueByPeriod.get(period) ?? 0) + revenue,
            );
        }

        for (const schedule of schedules) {
            if (!schedule.client_id) continue;
            const platform = resolveClientAdPlatform(
                clientsById.get(schedule.client_id),
            );
            if (platform) outcomes.get(platform)!.schedules += 1;
        }
    }

    const totalOutcome = {
        revenue: [...outcomes.values()].reduce(
            (total, outcome) => total + outcome.revenue,
            0,
        ),
        schedules: [...outcomes.values()].reduce(
            (total, outcome) => total + outcome.schedules,
            0,
        ),
        billedPatients: new Set(
            [...outcomes.values()].flatMap((outcome) => [
                ...outcome.billedPatients,
            ]),
        ),
    };
    const kpis = summarizePaidMedia(
        adMetrics,
        totalOutcome,
        comparisonAvailable,
    );
    const byPlatform = (["google_ads", "meta_ads"] as const)
        .map((platform) => {
            const metrics = adMetrics.filter(
                (metric) => metric.platform === platform,
            );
            const outcome = outcomes.get(platform)!;
            const summary = summarizePaidMedia(
                metrics,
                outcome,
                comparisonAvailable,
            );

            return {
                platform,
                label: adPlatformLabel(platform),
                ...summary,
            };
        })
        .filter(
            (item) =>
                item.spend > 0 ||
                item.impressions > 0 ||
                item.clicks > 0 ||
                item.reported_conversions > 0,
        );
    const evolutionBuckets = new Map<
        string,
        {
            spend: number;
            google_spend: number;
            meta_spend: number;
            attributed_revenue: number;
        }
    >();

    for (const metric of adMetrics) {
        const period = periodKey(
            `${metric.metric_date}T12:00:00Z`,
            resolution,
        );
        const bucket = evolutionBuckets.get(period) ?? {
            spend: 0,
            google_spend: 0,
            meta_spend: 0,
            attributed_revenue: 0,
        };
        const spend = numeric(metric.spend);
        bucket.spend += spend;
        if (metric.platform === "google_ads") bucket.google_spend += spend;
        if (metric.platform === "meta_ads") bucket.meta_spend += spend;
        evolutionBuckets.set(period, bucket);
    }

    if (comparisonAvailable) {
        for (const outcome of outcomes.values()) {
            for (const [period, revenue] of outcome.revenueByPeriod) {
                const bucket = evolutionBuckets.get(period) ?? {
                    spend: 0,
                    google_spend: 0,
                    meta_spend: 0,
                    attributed_revenue: 0,
                };
                bucket.attributed_revenue += revenue;
                evolutionBuckets.set(period, bucket);
            }
        }
    }

    return {
        kpis,
        evolution: [...evolutionBuckets.entries()]
            .sort(([first], [second]) => first.localeCompare(second))
            .map(([period, values]) => ({
                period,
                label: periodLabel(period, resolution),
                spend: roundMoney(values.spend),
                google_spend: roundMoney(values.google_spend),
                meta_spend: roundMoney(values.meta_spend),
                attributed_revenue: comparisonAvailable
                    ? roundMoney(values.attributed_revenue)
                    : null,
            })),
        byPlatform,
        topCampaigns: buildTopAdCampaigns(adMetrics),
    };
}

function summarizePaidMedia(
    metrics: AdMetricRow[],
    outcome: {
        revenue: number;
        schedules: number;
        billedPatients: Set<string>;
    },
    comparisonAvailable: boolean,
): PaidMediaKpis {
    const spend = metrics.reduce(
        (total, metric) => total + numeric(metric.spend),
        0,
    );
    const impressions = metrics.reduce(
        (total, metric) => total + numeric(metric.impressions),
        0,
    );
    const clicks = metrics.reduce(
        (total, metric) => total + numeric(metric.clicks),
        0,
    );
    const reportedConversions = metrics.reduce(
        (total, metric) =>
            total + numeric(metric.reported_conversions),
        0,
    );
    const attributedRevenue = comparisonAvailable
        ? roundMoney(outcome.revenue)
        : null;
    const scheduleCount = comparisonAvailable ? outcome.schedules : null;
    const billedPatients = comparisonAvailable
        ? outcome.billedPatients.size
        : null;

    return {
        spend: roundMoney(spend),
        attributed_revenue: attributedRevenue,
        return_on_spend:
            attributedRevenue !== null
                ? ratio(attributedRevenue, spend)
                : null,
        schedules: scheduleCount,
        billed_patients: billedPatients,
        cost_per_schedule:
            scheduleCount !== null ? moneyPer(spend, scheduleCount) : null,
        cost_per_billed_patient:
            billedPatients !== null ? moneyPer(spend, billedPatients) : null,
        impressions: Math.trunc(impressions),
        clicks: Math.trunc(clicks),
        click_through_rate: percentage(clicks, impressions),
        cost_per_click: moneyPer(spend, clicks),
        reported_conversions: roundMetric(reportedConversions),
        cost_per_reported_conversion: moneyPer(
            spend,
            reportedConversions,
        ),
    };
}

function buildTopAdCampaigns(
    metrics: AdMetricRow[],
): FinancialDashboardData["ads"]["top_campaigns"] {
    const campaigns = new Map<
        string,
        {
            platform: AdMetricRow["platform"];
            account_id: string;
            account_name: string;
            campaign_id: string;
            campaign_name: string;
            spend: number;
            impressions: number;
            clicks: number;
            reported_conversions: number;
        }
    >();

    for (const metric of metrics) {
        const key = [
            metric.platform,
            metric.account_id,
            metric.campaign_id,
        ].join(":");
        const campaign = campaigns.get(key) ?? {
            platform: metric.platform,
            account_id: metric.account_id,
            account_name: metric.account_name,
            campaign_id: metric.campaign_id,
            campaign_name: metric.campaign_name,
            spend: 0,
            impressions: 0,
            clicks: 0,
            reported_conversions: 0,
        };
        campaign.account_name = metric.account_name;
        campaign.campaign_name = metric.campaign_name;
        campaign.spend += numeric(metric.spend);
        campaign.impressions += numeric(metric.impressions);
        campaign.clicks += numeric(metric.clicks);
        campaign.reported_conversions += numeric(
            metric.reported_conversions,
        );
        campaigns.set(key, campaign);
    }

    return [...campaigns.values()]
        .map((campaign) => ({
            platform: campaign.platform,
            platform_label: adPlatformLabel(campaign.platform),
            account_id: campaign.account_id,
            account_name: campaign.account_name,
            campaign_id: campaign.campaign_id,
            campaign_name: campaign.campaign_name,
            spend: roundMoney(campaign.spend),
            impressions: Math.trunc(campaign.impressions),
            clicks: Math.trunc(campaign.clicks),
            click_through_rate: percentage(
                campaign.clicks,
                campaign.impressions,
            ),
            cost_per_click: moneyPer(campaign.spend, campaign.clicks),
            reported_conversions: roundMetric(
                campaign.reported_conversions,
            ),
            cost_per_reported_conversion: moneyPer(
                campaign.spend,
                campaign.reported_conversions,
            ),
        }))
        .sort(
            (first, second) =>
                second.spend - first.spend ||
                second.reported_conversions - first.reported_conversions,
        )
        .slice(0, 10);
}

function buildMediaBudgetByCity({
    adMetrics,
    schedules,
    invoices,
    clients,
    units,
    selectedUnitIds,
    startAt,
    endAt,
}: {
    adMetrics: AdMetricRow[];
    schedules: ScheduleRow[];
    invoices: InvoiceRow[];
    clients: ClientAttributionRow[];
    units: UnitRow[];
    selectedUnitIds: string[];
    startAt: string;
    endAt: string;
}) {
    const unitByName = new Map(
        units.map((unit) => [normalizeCampaignMatchText(unit.name), unit]),
    );
    const selectedUnitIdSet = new Set(selectedUnitIds);
    const visibleCities = MEDIA_BUDGET_CITIES.filter((city) => {
        if (selectedUnitIds.length === 0) return true;
        const unit = unitByName.get(normalizeCampaignMatchText(city.city));
        return Boolean(unit && selectedUnitIdSet.has(unit.id));
    });
    const visibleCityKeys = new Set(visibleCities.map((city) => city.key));
    const accumulators = new Map(
        visibleCities.map((city) => [
            city.key,
            {
                spend: 0,
                googleSpend: 0,
                metaSpend: 0,
                campaignKeys: new Set<string>(),
                campaignNames: new Map<string, string>(),
            },
        ]),
    );
    let unmatchedSpend = 0;

    for (const metric of adMetrics) {
        const spend = numeric(metric.spend);
        const city = matchMediaBudgetCity(metric.campaign_name);

        if (!city) {
            if (selectedUnitIds.length === 0) unmatchedSpend += spend;
            continue;
        }
        if (!visibleCityKeys.has(city.key)) continue;

        const accumulator = accumulators.get(city.key);
        if (!accumulator) continue;

        accumulator.spend += spend;
        if (metric.platform === "google_ads") accumulator.googleSpend += spend;
        else accumulator.metaSpend += spend;
        const campaignKey = [
            metric.platform,
            metric.account_id,
            metric.campaign_id,
        ].join(":");
        accumulator.campaignKeys.add(campaignKey);
        accumulator.campaignNames.set(
            campaignKey,
            metric.campaign_name?.trim() || "Campanha sem nome",
        );
    }

    const scheduleCounts = new Map<string, number>();
    const paidScheduleClients = new Map<string, Set<string>>();
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    for (const schedule of schedules) {
        const key = normalizeCampaignMatchText(schedule.unit_name);
        if (!key) continue;
        scheduleCounts.set(key, (scheduleCounts.get(key) ?? 0) + 1);
        if (
            schedule.client_id &&
            resolveClientAdPlatform(clientsById.get(schedule.client_id))
        ) {
            const current = paidScheduleClients.get(key) ?? new Set<string>();
            current.add(schedule.client_id);
            paidScheduleClients.set(key, current);
        }
    }

    const attributedRevenue = new Map<string, number>();
    const attributedPatients = new Map<string, Set<string>>();
    for (const invoice of invoices) {
        if (
            !invoice.client_id ||
            statusGroup(invoice.status) !== "authorized" ||
            !resolveClientAdPlatform(clientsById.get(invoice.client_id))
        ) {
            continue;
        }
        const key = normalizeCampaignMatchText(invoice.unit_name);
        if (!key) continue;
        attributedRevenue.set(
            key,
            (attributedRevenue.get(key) ?? 0) + numeric(invoice.amount),
        );
        const patients = attributedPatients.get(key) ?? new Set<string>();
        patients.add(invoice.client_id);
        attributedPatients.set(key, patients);
    }

    const periodDays = Math.max(
        1,
        Math.ceil(
            (new Date(endAt).getTime() - new Date(startAt).getTime()) /
                (24 * 60 * 60 * 1_000),
        ),
    );

    return {
        rows: visibleCities.map((city) => {
            const accumulator = accumulators.get(city.key) ?? {
                spend: 0,
                googleSpend: 0,
                metaSpend: 0,
                campaignKeys: new Set<string>(),
                campaignNames: new Map<string, string>(),
            };
            const unit = unitByName.get(normalizeCampaignMatchText(city.city));
            const schedulesForCity =
                scheduleCounts.get(normalizeCampaignMatchText(city.city)) ?? 0;
            const paidSchedulesForCity =
                paidScheduleClients.get(
                    normalizeCampaignMatchText(city.city),
                )?.size ?? 0;
            const attributedRevenueForCity =
                attributedRevenue.get(
                    normalizeCampaignMatchText(city.city),
                ) ?? 0;
            const attributedPatientsForCity =
                attributedPatients.get(
                    normalizeCampaignMatchText(city.city),
                )?.size ?? 0;
            const averageDailySpend = accumulator.spend / periodDays;
            const monthlyProjection = averageDailySpend * 30;

            return {
                key: city.key,
                unit_id: unit?.id ?? null,
                city: city.city,
                monthly_budget: roundMoney(city.monthlyBudget),
                spend: roundMoney(accumulator.spend),
                google_spend: roundMoney(accumulator.googleSpend),
                meta_spend: roundMoney(accumulator.metaSpend),
                average_daily_spend: roundMoney(averageDailySpend),
                monthly_projection: roundMoney(monthlyProjection),
                remaining_to_budget: roundMoney(
                    city.monthlyBudget - monthlyProjection,
                ),
                pace_percentage:
                    city.monthlyBudget > 0
                        ? roundMetric(
                              (monthlyProjection / city.monthlyBudget) * 100,
                          )
                        : null,
                schedules: schedulesForCity,
                cost_per_schedule:
                    schedulesForCity > 0
                        ? roundMoney(accumulator.spend / schedulesForCity)
                        : null,
                paid_schedules: paidSchedulesForCity,
                cost_per_paid_schedule:
                    paidSchedulesForCity > 0
                        ? roundMoney(
                              accumulator.spend / paidSchedulesForCity,
                          )
                        : null,
                attributed_revenue: roundMoney(
                    attributedRevenueForCity,
                ),
                attributed_patients: attributedPatientsForCity,
                real_roas:
                    accumulator.spend > 0
                        ? roundMetric(
                              attributedRevenueForCity /
                                  accumulator.spend,
                          )
                        : null,
                matched_campaigns: accumulator.campaignKeys.size,
                matched_campaign_names: [...accumulator.campaignNames.values()]
                    .sort((first, second) =>
                        first.localeCompare(second, "pt-BR"),
                    ),
            };
        }),
        unmatchedSpend: roundMoney(unmatchedSpend),
    };
}

function matchMediaBudgetCity(campaignName: string | null | undefined) {
    const normalizedCampaign = normalizeCampaignMatchText(campaignName);
    if (!normalizedCampaign) return null;
    const paddedCampaign = ` ${normalizedCampaign} `;

    for (const city of MEDIA_BUDGET_CITIES) {
        for (const alias of city.aliases) {
            const normalizedAlias = normalizeCampaignMatchText(alias);
            if (
                normalizedAlias &&
                paddedCampaign.includes(` ${normalizedAlias} `)
            ) {
                return city;
            }
        }
    }

    return null;
}

function normalizeCampaignMatchText(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function resolveClientAdPlatform(
    client: ClientAttributionRow | undefined,
): AdMetricRow["platform"] | null {
    return resolvePaidMediaPlatform(client);
}

function adPlatformLabel(platform: AdMetricRow["platform"]) {
    return platform === "google_ads" ? "Google Ads" : "Meta Ads";
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

function roundMetric(value: number) {
    return Number(value.toFixed(4));
}

function ratio(value: number, total: number) {
    if (total <= 0) return null;
    return Number((value / total).toFixed(2));
}

function moneyPer(value: number, total: number) {
    if (total <= 0) return null;
    return roundMoney(value / total);
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
