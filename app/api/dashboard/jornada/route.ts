// app/api/dashboard/jornada/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { paidMediaPlatformFromOrigin } from "@/lib/ads/paidMediaAttribution";
import {
    executiveRpcParams,
    readDashboardFilters,
    resolveDashboardDateRange,
    type DashboardDateRange,
    type DashboardFilters,
} from "@/lib/dashboard/metrics";
import {
    normalizeScheduleStatus,
    scheduleShowedUp,
} from "@/lib/schedules/status";

const PAGE_SIZE = 1_000;
const ID_FILTER_BATCH_SIZE = 100;
const MAX_PIPELINE_ROWS = 50_000;

type PipelineStageKey =
    | "paid_impressions"
    | "paid_clicks"
    | "whatsapp"
    | "scheduled"
    | "attended"
    | "invoiced"
    | "authorized";

type PipelineStage = {
    key: PipelineStageKey;
    label: string;
    value: number;
    secondary_value: number | null;
    secondary_kind: "count" | "currency" | null;
    secondary_label: string | null;
};

type PipelineTransition = {
    key: string;
    label: string;
    rate: number | null;
    from_value: number;
    to_value: number;
    lost: number | null;
    estimated: boolean;
};

type FullJourneyPipeline = {
    available: boolean;
    ads_available: boolean;
    ads_scope_global: true;
    filters_applied: boolean;
    currency_code: string;
    stages: PipelineStage[];
    transitions: PipelineTransition[];
    audit: {
        whatsapp_conversations: number;
        whatsapp_clients: number;
        whatsapp_origins: {
            origin: string;
            conversations: number;
            clients: number;
        }[];
        cohort_start_date: string;
        cohort_end_date: string;
        matured_through: string;
        error: string | null;
    };
};

type WhatsappConversationRow = {
    id: string;
    client_id: string | null;
    started_at: string;
    origin: string | null;
};

type PipelineClientOriginRow = {
    last_origin: string | null;
};

type WhatsappConversationSourceRow = WhatsappConversationRow & {
    clients: PipelineClientOriginRow | PipelineClientOriginRow[] | null;
};

type PipelineScheduleRow = {
    client_id: string | null;
    created_in_source_at: string | null;
    scheduled_for: string;
    status: string | null;
};

type PipelineInvoiceRow = {
    source_invoice_id: number | string;
    client_id: string | null;
    issued_at: string;
    amount: number | string;
    status: string;
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);
    const filters = readDashboardFilters(searchParams);

    const [canonicalResult, fullPipeline] = await Promise.all([
        supabase
            .rpc(
                "dashboard_journey_metrics_v2",
                executiveRpcParams(
                    { startAt: range.startAt, endAt: range.endAt },
                    filters,
                ),
            )
            .abortSignal(request.signal),
        loadFullJourneyPipeline(range, filters, request.signal).catch(
            (error) => {
                console.error(
                    "[dashboard/jornada] full pipeline failed",
                    error,
                );
                return emptyFullJourneyPipeline(
                    range,
                    filters,
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar a jornada completa.",
                );
            },
        ),
    ]);

    if (canonicalResult.error) {
        console.error(
            "[dashboard/jornada] canonical metric RPC failed",
            canonicalResult.error,
        );
        return NextResponse.json(
            { error: canonicalResult.error.message },
            { status: 500 },
        );
    }

    const payload = asObject(canonicalResult.data);

    return NextResponse.json(
        {
            full_pipeline: fullPipeline,
            journey_funnel: arrayOrEmpty(payload.journey_funnel),
            dropoff_moments: arrayOrEmpty(payload.dropoff_moments),
            intent_paths: arrayOrEmpty(payload.intent_paths),
            objections: arrayOrEmpty(payload.objections),
            audit: payload.audit ?? null,
        },
        {
            headers: {
                "Cache-Control": "private, no-store",
            },
        },
    );
}

async function loadFullJourneyPipeline(
    range: DashboardDateRange,
    filters: DashboardFilters,
    signal: AbortSignal,
): Promise<FullJourneyPipeline> {
    const startDate = range.startDate ?? saoPauloDate(range.startAt);
    const endDate =
        range.endDate ??
        saoPauloDate(
            new Date(new Date(range.endAt).getTime() - 1).toISOString(),
        );
    const [paidMedia, whatsappConversations] = await Promise.all([
        loadPaidMediaTotals(startDate, endDate, signal),
        loadPaidWhatsappConversations(range, filters, signal),
    ]);
    const cohort = new Map<string, string>();

    for (const conversation of whatsappConversations) {
        if (!conversation.client_id) continue;
        const current = cohort.get(conversation.client_id);
        if (!current || conversation.started_at < current) {
            cohort.set(conversation.client_id, conversation.started_at);
        }
    }

    const clientIds = [...cohort.keys()];
    const [schedules, invoices] = await Promise.all([
        loadPipelineSchedules(clientIds, signal),
        loadPipelineInvoices(clientIds, signal),
    ]);
    const scheduledClients = new Set<string>();
    const attendedAtByClient = new Map<string, string>();

    for (const schedule of schedules) {
        const clientId = schedule.client_id;
        if (!clientId) continue;

        const enteredAt = cohort.get(clientId);
        if (!enteredAt) continue;

        const enteredDate = saoPauloDate(enteredAt);
        const createdDate =
            schedule.created_in_source_at ?? schedule.scheduled_for;
        if (!createdDate || createdDate < enteredDate) continue;

        scheduledClients.add(clientId);

        if (!scheduleShowedUp(normalizeScheduleStatus(schedule.status))) {
            continue;
        }
        if (schedule.scheduled_for < enteredDate) continue;

        const current = attendedAtByClient.get(clientId);
        if (!current || schedule.scheduled_for < current) {
            attendedAtByClient.set(clientId, schedule.scheduled_for);
        }
    }

    const invoicedClients = new Set<string>();
    const authorizedClients = new Set<string>();
    let invoicedAmount = 0;
    let authorizedAmount = 0;

    for (const invoice of invoices) {
        const clientId = invoice.client_id;
        if (!clientId) continue;

        const attendedDate = attendedAtByClient.get(clientId);
        if (!attendedDate || saoPauloDate(invoice.issued_at) < attendedDate) {
            continue;
        }

        const amount = numeric(invoice.amount);
        invoicedClients.add(clientId);
        invoicedAmount += amount;

        if (invoiceStatusIsAuthorized(invoice.status)) {
            authorizedClients.add(clientId);
            authorizedAmount += amount;
        }
    }

    return buildFullJourneyPipeline({
        available: true,
        adsAvailable: paidMedia.available,
        filtersApplied: hasOperationalFilters(filters),
        startDate,
        endDate,
        impressions: paidMedia.impressions,
        clicks: paidMedia.clicks,
        whatsappConversations: whatsappConversations.length,
        whatsappClients: cohort.size,
        whatsappOrigins: buildWhatsappOriginBreakdown(
            whatsappConversations,
        ),
        scheduledClients: scheduledClients.size,
        attendedClients: attendedAtByClient.size,
        invoicedClients: invoicedClients.size,
        authorizedClients: authorizedClients.size,
        invoicedAmount,
        authorizedAmount,
        error: null,
    });
}

async function loadPaidMediaTotals(
    startDate: string,
    endDate: string,
    signal: AbortSignal,
) {
    let impressions = 0;
    let clicks = 0;

    for (let from = 0; from < MAX_PIPELINE_ROWS; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("ad_daily_metrics")
            .select("platform, impressions, clicks")
            .in("platform", ["meta_ads", "google_ads"])
            .gte("metric_date", startDate)
            .lte("metric_date", endDate)
            .order("metric_date", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);

        if (error) {
            if (isMissingAdsTable(error)) {
                return { available: false, impressions: 0, clicks: 0 };
            }
            throw error;
        }

        const page = (data ?? []) as {
            impressions: number | string;
            clicks: number | string;
        }[];
        for (const row of page) {
            impressions += numeric(row.impressions);
            clicks += numeric(row.clicks);
        }
        if (page.length < PAGE_SIZE) break;
    }

    return { available: true, impressions, clicks };
}

async function loadPaidWhatsappConversations(
    range: DashboardDateRange,
    filters: DashboardFilters,
    signal: AbortSignal,
) {
    const rows: WhatsappConversationSourceRow[] = [];

    for (let from = 0; from < MAX_PIPELINE_ROWS; from += PAGE_SIZE) {
        let query = supabase
            .from("conversations")
            .select(
                "id, client_id, started_at, origin, clients!conversations_client_id_fkey(last_origin)",
            )
            .gte("started_at", range.startAt)
            .lt("started_at", range.endAt)
            .order("started_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (filters.unitIds.length > 0) {
            query = query.in("unit_id", filters.unitIds);
        }
        if (filters.serviceIds.length > 0) {
            query = query.in("service_id", filters.serviceIds);
        }
        if (filters.attendantIds.length > 0) {
            query = query.in("attendant_id", filters.attendantIds);
        }
        if (filters.tunnels.length > 0) {
            query = query.in("tunnel", filters.tunnels);
        }
        const { data, error } = await query.abortSignal(signal);
        if (error) throw error;

        const page = (data ?? []) as WhatsappConversationSourceRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    const selectedOrigins = new Set(filters.origins.map(normalizeText));

    return rows.flatMap((conversation) => {
        const conversationOrigin = conversation.origin?.trim();
        const client = Array.isArray(conversation.clients)
            ? conversation.clients[0]
            : conversation.clients;
        const clientOrigin = client?.last_origin?.trim();
        const origin = conversationOrigin || clientOrigin || null;

        if (!paidMediaPlatformFromOrigin(origin)) return [];
        if (
            selectedOrigins.size > 0 &&
            !selectedOrigins.has(normalizeText(origin ?? ""))
        ) {
            return [];
        }

        return [{ ...conversation, origin }];
    });
}

async function loadPipelineSchedules(
    clientIds: string[],
    signal: AbortSignal,
) {
    const rows: PipelineScheduleRow[] = [];

    for (const ids of chunk(clientIds, ID_FILTER_BATCH_SIZE)) {
        for (let from = 0; ; from += PAGE_SIZE) {
            const { data, error } = await supabase
                .from("schedules")
                .select(
                    "client_id, created_in_source_at, scheduled_for, status",
                )
                .in("client_id", ids)
                .order("scheduled_for", { ascending: true })
                .range(from, from + PAGE_SIZE - 1)
                .abortSignal(signal);

            if (error) throw error;
            const page = (data ?? []) as PipelineScheduleRow[];
            rows.push(...page);
            if (page.length < PAGE_SIZE) break;
        }
    }

    return rows;
}

async function loadPipelineInvoices(
    clientIds: string[],
    signal: AbortSignal,
) {
    const rows: PipelineInvoiceRow[] = [];

    for (const ids of chunk(clientIds, ID_FILTER_BATCH_SIZE)) {
        for (let from = 0; ; from += PAGE_SIZE) {
            const { data, error } = await supabase
                .from("clinisys_invoices")
                .select(
                    "source_invoice_id, client_id, issued_at, amount, status",
                )
                .in("client_id", ids)
                .order("issued_at", { ascending: true })
                .range(from, from + PAGE_SIZE - 1)
                .abortSignal(signal);

            if (error) throw error;
            const page = (data ?? []) as PipelineInvoiceRow[];
            rows.push(...page);
            if (page.length < PAGE_SIZE) break;
        }
    }

    return rows;
}

function buildFullJourneyPipeline(values: {
    available: boolean;
    adsAvailable: boolean;
    filtersApplied: boolean;
    startDate: string;
    endDate: string;
    impressions: number;
    clicks: number;
    whatsappConversations: number;
    whatsappClients: number;
    whatsappOrigins: FullJourneyPipeline["audit"]["whatsapp_origins"];
    scheduledClients: number;
    attendedClients: number;
    invoicedClients: number;
    authorizedClients: number;
    invoicedAmount: number;
    authorizedAmount: number;
    error: string | null;
}): FullJourneyPipeline {
    const stages: PipelineStage[] = [
        stage(
            "paid_impressions",
            "Impressões pagas",
            values.impressions,
        ),
        stage("paid_clicks", "Cliques pagos", values.clicks),
        stage(
            "whatsapp",
            "WhatsApp",
            values.whatsappClients,
            values.whatsappConversations,
            "count",
            "conversas",
        ),
        stage("scheduled", "Agendaram", values.scheduledClients),
        stage("attended", "Compareceram", values.attendedClients),
        stage(
            "invoiced",
            "Faturados",
            values.invoicedClients,
            roundMoney(values.invoicedAmount),
            "currency",
            "emitidos",
        ),
        stage(
            "authorized",
            "Liberados",
            values.authorizedClients,
            roundMoney(values.authorizedAmount),
            "currency",
            "autorizados",
        ),
    ];

    return {
        available: values.available,
        ads_available: values.adsAvailable,
        ads_scope_global: true,
        filters_applied: values.filtersApplied,
        currency_code: "BRL",
        stages,
        transitions: [
            transition(
                "paid_ctr",
                "CTR pago",
                values.impressions,
                values.clicks,
                false,
                false,
            ),
            transition(
                "click_to_whatsapp",
                "Clique → WhatsApp",
                values.clicks,
                values.whatsappClients,
                true,
                false,
            ),
            transition(
                "whatsapp_to_schedule",
                "WhatsApp → agenda",
                values.whatsappClients,
                values.scheduledClients,
                false,
                true,
            ),
            transition(
                "schedule_to_attendance",
                "Agenda → presença",
                values.scheduledClients,
                values.attendedClients,
                false,
                true,
            ),
            transition(
                "attendance_to_invoice",
                "Presença → R$",
                values.attendedClients,
                values.invoicedClients,
                false,
                true,
            ),
            transition(
                "invoice_to_authorized",
                "R$ → liberado",
                values.invoicedClients,
                values.authorizedClients,
                false,
                true,
            ),
        ],
        audit: {
            whatsapp_conversations: values.whatsappConversations,
            whatsapp_clients: values.whatsappClients,
            whatsapp_origins: values.whatsappOrigins,
            cohort_start_date: values.startDate,
            cohort_end_date: values.endDate,
            matured_through: saoPauloDate(new Date().toISOString()),
            error: values.error,
        },
    };
}

function emptyFullJourneyPipeline(
    range: DashboardDateRange,
    filters: DashboardFilters,
    error: string,
) {
    const startDate = range.startDate ?? saoPauloDate(range.startAt);
    const endDate =
        range.endDate ??
        saoPauloDate(
            new Date(new Date(range.endAt).getTime() - 1).toISOString(),
        );

    return buildFullJourneyPipeline({
        available: false,
        adsAvailable: false,
        filtersApplied: hasOperationalFilters(filters),
        startDate,
        endDate,
        impressions: 0,
        clicks: 0,
        whatsappConversations: 0,
        whatsappClients: 0,
        whatsappOrigins: [],
        scheduledClients: 0,
        attendedClients: 0,
        invoicedClients: 0,
        authorizedClients: 0,
        invoicedAmount: 0,
        authorizedAmount: 0,
        error,
    });
}

function stage(
    key: PipelineStageKey,
    label: string,
    value: number,
    secondaryValue: number | null = null,
    secondaryKind: PipelineStage["secondary_kind"] = null,
    secondaryLabel: string | null = null,
): PipelineStage {
    return {
        key,
        label,
        value,
        secondary_value: secondaryValue,
        secondary_kind: secondaryKind,
        secondary_label: secondaryLabel,
    };
}

function transition(
    key: string,
    label: string,
    fromValue: number,
    toValue: number,
    estimated: boolean,
    samePopulation: boolean,
): PipelineTransition {
    return {
        key,
        label,
        rate: percentage(toValue, fromValue),
        from_value: fromValue,
        to_value: toValue,
        lost:
            samePopulation && fromValue > 0
                ? Math.max(0, fromValue - toValue)
                : null,
        estimated,
    };
}

function invoiceStatusIsAuthorized(status: string) {
    const normalized = normalizeText(status).replace(/\s+/g, "");
    return (
        normalized.startsWith("autorizada") ||
        normalized.includes("cancelamentonegado") ||
        normalized.includes("cancelamentorejeitado")
    );
}

function buildWhatsappOriginBreakdown(
    conversations: WhatsappConversationRow[],
): FullJourneyPipeline["audit"]["whatsapp_origins"] {
    const origins = new Map<
        string,
        { origin: string; conversations: number; clients: Set<string> }
    >();

    for (const conversation of conversations) {
        const origin = conversation.origin?.trim();
        if (!origin) continue;

        const key = normalizeText(origin);
        const current = origins.get(key) ?? {
            origin,
            conversations: 0,
            clients: new Set<string>(),
        };
        current.conversations += 1;
        if (conversation.client_id) current.clients.add(conversation.client_id);
        origins.set(key, current);
    }

    return [...origins.values()]
        .map((origin) => ({
            origin: origin.origin,
            conversations: origin.conversations,
            clients: origin.clients.size,
        }))
        .sort(
            (first, second) =>
                second.clients - first.clients ||
                second.conversations - first.conversations ||
                first.origin.localeCompare(second.origin, "pt-BR"),
        );
}

function hasOperationalFilters(filters: DashboardFilters) {
    return (
        filters.unitIds.length > 0 ||
        filters.serviceIds.length > 0 ||
        filters.attendantIds.length > 0 ||
        filters.tunnels.length > 0 ||
        filters.origins.length > 0
    );
}

function isMissingAdsTable(error: { code?: string; message?: string }) {
    return (
        error.code === "42P01" ||
        error.code === "PGRST205" ||
        Boolean(error.message?.includes("ad_daily_metrics"))
    );
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

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
}

function arrayOrEmpty(value: unknown) {
    return Array.isArray(value) ? value : [];
}
