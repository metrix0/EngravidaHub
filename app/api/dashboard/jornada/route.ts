// app/api/dashboard/jornada/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import {
    paidMediaPlatformFromOrigin,
    resolvePaidMediaAttribution,
    type PaidMediaAttributionEvidence,
    type PaidMediaPlatform,
} from "@/lib/ads/paidMediaAttribution";
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
import {
    isTrackedTintimSource,
    paidMediaPlatformFromTintimSource,
} from "@/lib/tintim/attribution";

const PAGE_SIZE = 1_000;
const ID_FILTER_BATCH_SIZE = 100;
const MAX_PIPELINE_ROWS = 50_000;
const CLINISYS_QUERY_CONCURRENCY = 2;
const CONVERSATION_PAGE_CONCURRENCY = 2;

type JourneyAttributionEvidence =
    | PaidMediaAttributionEvidence
    | "tintim";

type PipelineStageKey =
    | "paid_impressions"
    | "paid_clicks"
    | "tracked_whatsapp"
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
    acquisition_branches: PipelineAcquisitionBranch[];
    procedure_branches: PipelineProcedureBranch[];
    platform_breakdown: PipelinePlatformBreakdown[];
    audit: {
        platform_whatsapp_conversations: number;
        tracked_whatsapp_clients: number;
        measurement_ready: boolean;
        measurement_note: string | null;
        tracked_by_evidence: {
            evidence: JourneyAttributionEvidence;
            clients: number;
        }[];
        tracked_sources: {
            platform: PaidMediaPlatform;
            field:
                | "conversation_origin"
                | "client_origin"
                | "tintim_source"
                | "utm_source"
                | "click_id";
            source: string;
            clients: number;
            percentage: number;
        }[];
        whatsapp_coverage: WhatsappCoverage;
        whatsapp_origins: {
            origin: string;
            conversations: number;
            clients: number;
        }[];
        procedure_linkage: {
            tracked_clients: number;
            raw_events_read: number;
            schedule_rows_read: number;
            funnel_event_rows_read: number;
            deduped_source_events: number;
            eligible_source_events: number;
            linked_unique_clients: number;
            attended_unique_clients: number;
            scheduled_branch_total: number;
            attended_branch_total: number;
            invariant_ok: boolean;
        };
        cohort_start_date: string;
        cohort_end_date: string;
        matured_through: string;
        error: string | null;
    };
};

type PipelineAcquisitionBranch = {
    platform: PaidMediaPlatform;
    label: string;
    impressions: number;
    clicks: number;
    click_through_rate: number | null;
    tracked_clients: number;
    click_to_tracked_rate: number | null;
};

type PipelineProcedureBranch = {
    key: string;
    procedure_name: string;
    event_kind: string;
    scheduled_appointments: number;
    attended_appointments: number;
    schedule_to_attendance_rate: number | null;
    lost_appointments: number;
};

type PipelinePlatformBreakdown = {
    platform: PaidMediaPlatform;
    label: string;
    spend: number;
    impressions: number;
    whatsapp_clicks: number;
    platform_whatsapp_conversations: number;
    tracked_clients: number;
    scheduled_clients: number;
    attended_clients: number;
    invoiced_clients: number;
    authorized_clients: number;
    authorized_revenue: number;
};

type WhatsappConversationRow = {
    id: string;
    thread_id: string | null;
    client_id: string | null;
    started_at: string;
    origin: string | null;
    tunnel: string | null;
    unit_id: string | null;
    service_id: string | null;
    attendant_id: string | null;
};

type PipelineClientOriginRow = {
    unit_id: string | null;
    last_origin: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    gclid: string | null;
    gbraid: string | null;
    wbraid: string | null;
    fbclid: string | null;
    fbc: string | null;
    ctwa_clid: string | null;
    tracking_updated_at: string | null;
};

type JourneyAnalysisRow = {
    conversation_id: string;
    started_at: string;
    unit_id: string | null;
    service_id: string | null;
    attendant_id: string | null;
    outcome_events: unknown;
    objections: unknown;
    dropoff_happened: boolean | null;
    dropoff_moment: string | null;
    customer_start_intent: string | null;
    resolution_result: string | null;
    resolution_reasoning_category: string | null;
};

type WhatsappConversationSourceRow = WhatsappConversationRow & {
    clients: PipelineClientOriginRow | PipelineClientOriginRow[] | null;
};

type PaidWhatsappEntry = WhatsappConversationRow & {
    platform: PaidMediaPlatform;
    evidence: JourneyAttributionEvidence;
    source_field:
        | "conversation_origin"
        | "client_origin"
        | "tintim_source"
        | "utm_source"
        | "click_id";
    source_value: string;
};

type PaidWhatsappCohortEntry = {
    enteredAt: string;
    platform: PaidMediaPlatform;
    evidence: JourneyAttributionEvidence;
    sourceField: PaidWhatsappEntry["source_field"];
    sourceValue: string;
};

type TintimConversationAttributionRow = {
    conversation_id: string;
    source: string | null;
    platform: PaidMediaPlatform | null;
};

type WhatsappCoverage = {
    total_conversations: number;
    tracked_conversations: number;
    tracking_rate: number | null;
    google_conversations: number;
    meta_conversations: number;
    other_conversations: number;
    untracked_conversations: number;
};

type WhatsappCoverageCategory =
    | PaidMediaPlatform
    | "other"
    | "untracked";

type PipelineAdMetricRow = {
    platform: PaidMediaPlatform;
    campaign_name: string;
    impressions: number | string;
    clicks: number | string;
    spend: number | string;
    reported_conversions: number | string;
    reported_conversion_type: string | null;
    whatsapp_impressions?: number | string;
    whatsapp_clicks?: number | string;
    whatsapp_conversations?: number | string;
};

type PaidMediaTotals = {
    available: boolean;
    measurementReady: boolean;
    measurementNote: string | null;
    impressions: number;
    clicks: number;
    whatsappConversations: number;
    byPlatform: Map<
        PaidMediaPlatform,
        {
            spend: number;
            impressions: number;
            clicks: number;
            whatsappConversations: number;
        }
    >;
};

type PipelineProcedureEventSource =
    | "schedules"
    | "funnel_clinisys_events";

type PipelineProcedureEventRow = {
    source_table: PipelineProcedureEventSource;
    source_external_id: string | null;
    source_hash: string | null;
    client_id: string | null;
    created_in_source_at: string | null;
    created_at: string | null;
    scheduled_for: string;
    status: string | null;
    procedure_name: string | null;
    event_kind: string | null;
    unit_name: string | null;
};

type PipelineProcedureEventLoadResult = {
    events: PipelineProcedureEventRow[];
    scheduleRowsRead: number;
    funnelEventRowsRead: number;
    dedupedSourceEvents: number;
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

    try {
        const startDate = range.startDate ?? saoPauloDate(range.startAt);
        const endDate =
            range.endDate ??
            saoPauloDate(
                new Date(new Date(range.endAt).getTime() - 1).toISOString(),
            );
        const [paidMedia, whatsappData, analysisRows] = await Promise.all([
            loadPaidMediaTotals(startDate, endDate, request.signal),
            loadPaidWhatsappConversations(range, filters, request.signal),
            loadJourneyAnalysisRows(range, request.signal),
        ]);
        const payload = buildJourneyConversationMetrics({
            conversations: whatsappData.rows,
            analyses: analysisRows,
            filters,
        });
        const fullPipeline = await loadFullJourneyPipeline(
            range,
            filters,
            request.signal,
            paidMedia,
            whatsappData,
        ).catch((error) => {
            console.error("[dashboard/jornada] full pipeline failed", error);
            return emptyFullJourneyPipeline(
                range,
                filters,
                error instanceof Error
                    ? error.message
                    : "Falha ao carregar a jornada completa.",
            );
        });

        return NextResponse.json(
            {
                full_pipeline: fullPipeline,
                journey_funnel: payload.journey_funnel,
                dropoff_moments: payload.dropoff_moments,
                intent_paths: payload.intent_paths,
                objections: payload.objections,
                audit: payload.audit,
            },
            { headers: { "Cache-Control": "private, no-store" } },
        );
    } catch (error) {
        if (request.signal.aborted) return new NextResponse(null, { status: 499 });
        console.error("[dashboard/jornada] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar a jornada.",
            },
            { status: 500 },
        );
    }
}

async function loadJourneyAnalysisRows(
    range: DashboardDateRange,
    signal: AbortSignal,
) {
    const rows: JourneyAnalysisRow[] = [];

    async function loadPage(from: number) {
        const { data, error } = await supabase
            .from("conversation_analysis")
            .select(
                "conversation_id, started_at, unit_id, service_id, attendant_id, outcome_events, objections, dropoff_happened, dropoff_moment, customer_start_intent, resolution_result, resolution_reasoning_category",
            )
            .gte("started_at", range.startAt)
            .lt("started_at", range.endAt)
            .order("started_at", { ascending: true })
            .order("conversation_id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);

        if (error) throw error;
        return (data ?? []) as JourneyAnalysisRow[];
    }

    const firstPage = await loadPage(0);
    rows.push(...firstPage);

    if (firstPage.length === PAGE_SIZE) {
        for (
            let from = PAGE_SIZE;
            from < MAX_PIPELINE_ROWS;
            from += PAGE_SIZE * CONVERSATION_PAGE_CONCURRENCY
        ) {
            const offsets = Array.from(
                { length: CONVERSATION_PAGE_CONCURRENCY },
                (_, index) => from + index * PAGE_SIZE,
            ).filter((offset) => offset < MAX_PIPELINE_ROWS);
            const pages = await Promise.all(offsets.map(loadPage));

            for (const page of pages) rows.push(...page);
            if (pages.some((page) => page.length < PAGE_SIZE)) break;
        }
    }

    return rows;
}

function buildJourneyConversationMetrics({
    conversations,
    analyses,
    filters,
}: {
    conversations: WhatsappConversationSourceRow[];
    analyses: JourneyAnalysisRow[];
    filters: DashboardFilters;
}) {
    const conversationById = new Map(
        conversations.map((conversation) => [conversation.id, conversation]),
    );
    const base = analyses.flatMap((analysis) => {
        const conversation = conversationById.get(analysis.conversation_id);
        if (!conversation) return [];

        const client = Array.isArray(conversation.clients)
            ? conversation.clients[0]
            : conversation.clients;
        const effectiveUnitId =
            client?.unit_id ?? conversation.unit_id ?? analysis.unit_id;
        const effectiveServiceId =
            conversation.service_id ?? analysis.service_id;
        const effectiveAttendantId =
            conversation.attendant_id ?? analysis.attendant_id;

        if (
            filters.unitIds.length > 0 &&
            !filters.unitIds.includes(effectiveUnitId ?? "")
        ) return [];
        if (
            filters.serviceIds.length > 0 &&
            !filters.serviceIds.includes(effectiveServiceId ?? "")
        ) return [];
        if (
            filters.attendantIds.length > 0 &&
            !filters.attendantIds.includes(effectiveAttendantId ?? "")
        ) return [];
        if (
            filters.tunnels.length > 0 &&
            !filters.tunnels.includes(conversation.tunnel?.trim() || "__NULL__")
        ) return [];
        if (
            filters.origins.length > 0 &&
            !filters.origins.includes(conversation.origin?.trim() || "__NULL__")
        ) return [];

        return [{
            conversationId: analysis.conversation_id,
            clientKey:
                conversation.client_id ?? `conversation:${conversation.id}`,
            startedAt: analysis.started_at,
            outcomeEvents: arrayOrEmpty(analysis.outcome_events),
            objections: arrayOrEmpty(analysis.objections),
            dropoffHappened: analysis.dropoff_happened === true,
            dropoffMoment: analysis.dropoff_moment,
            customerStartIntent: analysis.customer_start_intent ?? "other",
            resolutionResult: analysis.resolution_result,
            resolutionReasoningCategory: analysis.resolution_reasoning_category,
        }];
    });

    const eventsByClient = new Map<
        string,
        Array<{ type: string; eventAt: number }>
    >();
    for (const row of base) {
        const events = eventsByClient.get(row.clientKey) ?? [];
        for (const rawEvent of row.outcomeEvents) {
            const event = asObject(rawEvent);
            const type = typeof event.type === "string" ? event.type.trim() : "";
            if (!type) continue;
            const rawEventAt =
                typeof event.event_at === "string" ? event.event_at : "";
            const parsedEventAt = /^\d{4}-\d{2}-\d{2}T/.test(rawEventAt)
                ? new Date(rawEventAt).getTime()
                : Number.NaN;
            events.push({
                type,
                eventAt: Number.isFinite(parsedEventAt)
                    ? parsedEventAt
                    : new Date(row.startedAt).getTime(),
            });
        }
        eventsByClient.set(row.clientKey, events);
    }

    const requested = firstStage(eventsByClient, ["information_requested"]);
    const answered = nextStage(eventsByClient, requested, ["information_answered"]);
    const priced = nextStage(eventsByClient, answered, ["price_presented"]);
    const offered = nextStage(eventsByClient, priced, ["consultation_offered"]);
    const scheduled = nextStage(eventsByClient, offered, [
        "appointment_scheduled",
        "appointment_rescheduled",
        "attendance_confirmed",
    ]);
    const started = new Set(base.map((row) => row.clientKey)).size;

    const journeyFunnel = [
        funnelStage("started", "Iniciou conversa", started, started, started, "#ddd6fe"),
        funnelStage("information_requested", "Pediu informação", requested.size, started, started, "#bbf7d0"),
        funnelStage("information_answered", "Informação respondida", answered.size, started, requested.size, "#bfdbfe"),
        funnelStage("price_presented", "Preço apresentado", priced.size, started, answered.size, "#c4b5fd"),
        funnelStage("consultation_offered", "Consulta oferecida", offered.size, started, priced.size, "#fed7aa"),
        funnelStage("appointment_scheduled", "Agendamento realizado", scheduled.size, started, offered.size, "#fbcfe8"),
    ];

    const dropoffCounts = new Map<string, number>();
    const intentCounts = new Map<
        string,
        { resolved: number; partial: number; notResolved: number; abandoned: number }
    >();
    const objectionConversations = new Map<string, Set<string>>();
    const conversationsWithObjections = new Set<string>();

    for (const row of base) {
        if (row.dropoffHappened && row.dropoffMoment) {
            dropoffCounts.set(
                row.dropoffMoment,
                (dropoffCounts.get(row.dropoffMoment) ?? 0) + 1,
            );
        }

        const abandoned =
            row.dropoffHappened ||
            row.resolutionReasoningCategory === "customer_abandoned";
        const intent = intentCounts.get(row.customerStartIntent) ?? {
            resolved: 0,
            partial: 0,
            notResolved: 0,
            abandoned: 0,
        };
        if (abandoned) intent.abandoned += 1;
        if (!abandoned && row.resolutionResult === "resolved") intent.resolved += 1;
        if (
            !abandoned &&
            row.resolutionResult !== null &&
            row.resolutionResult !== "resolved"
        ) intent.partial += 1;
        if (!abandoned && row.resolutionResult === "not_resolved") intent.notResolved += 1;
        intentCounts.set(row.customerStartIntent, intent);

        const uniqueTypes = new Set(
            row.objections
                .map((value) => asObject(value))
                .map((value) =>
                    typeof value.type === "string" ? value.type.trim() : "",
                )
                .filter(Boolean),
        );
        for (const type of uniqueTypes) {
            conversationsWithObjections.add(row.conversationId);
            const conversationIds = objectionConversations.get(type) ?? new Set();
            conversationIds.add(row.conversationId);
            objectionConversations.set(type, conversationIds);
        }
    }

    const totalDropoffs = [...dropoffCounts.values()].reduce(
        (sum, value) => sum + value,
        0,
    );
    const dropoffMoments = [...dropoffCounts]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([moment, count]) => ({
            moment,
            label: dropoffLabel(moment),
            count,
            percentage: integerPercentage(count, totalDropoffs),
        }));
    const intentPaths = [...intentCounts]
        .map(([intent, counts]) => ({
            intent: intentLabel(intent),
            resolved: counts.resolved,
            partial: counts.partial,
            not_resolved: counts.notResolved,
            abandoned: counts.abandoned,
        }))
        .sort(
            (left, right) =>
                right.resolved + right.partial + right.not_resolved + right.abandoned -
                (left.resolved + left.partial + left.not_resolved + left.abandoned),
        );
    const objections = [...objectionConversations]
        .map(([type, conversationIds]) => ({
            type,
            label: objectionLabel(type),
            value: conversationIds.size,
            percentage: integerPercentage(
                conversationIds.size,
                conversationsWithObjections.size,
            ),
        }))
        .sort((left, right) => right.value - left.value);

    return {
        journey_funnel: journeyFunnel,
        dropoff_moments: dropoffMoments,
        intent_paths: intentPaths,
        objections,
        audit: {
            conversations: base.length,
            clients: started,
            conversations_with_objections: conversationsWithObjections.size,
        },
    };
}

function firstStage(
    eventsByClient: Map<string, Array<{ type: string; eventAt: number }>>,
    eventTypes: string[],
) {
    const accepted = new Set(eventTypes);
    const result = new Map<string, number>();
    for (const [clientKey, events] of eventsByClient) {
        const times = events
            .filter((event) => accepted.has(event.type))
            .map((event) => event.eventAt);
        if (times.length > 0) result.set(clientKey, Math.min(...times));
    }
    return result;
}

function nextStage(
    eventsByClient: Map<string, Array<{ type: string; eventAt: number }>>,
    previousStage: Map<string, number>,
    eventTypes: string[],
) {
    const accepted = new Set(eventTypes);
    const result = new Map<string, number>();
    for (const [clientKey, previousAt] of previousStage) {
        const times = (eventsByClient.get(clientKey) ?? [])
            .filter((event) => accepted.has(event.type) && event.eventAt >= previousAt)
            .map((event) => event.eventAt);
        if (times.length > 0) result.set(clientKey, Math.min(...times));
    }
    return result;
}

function funnelStage(
    key: string,
    name: string,
    value: number,
    started: number,
    previous: number,
    fill: string,
) {
    return {
        key,
        name,
        value,
        percentage: integerPercentage(value, started),
        relative_percentage: integerPercentage(value, previous),
        fill,
    };
}

function integerPercentage(value: number, total: number) {
    return total > 0 ? Math.round((value * 100) / total) : null;
}

function dropoffLabel(moment: string) {
    const labels: Record<string, string> = {
        after_price: "Após preço",
        after_consultation_online: "Após apresentação da consulta online",
        after_unit_presented: "Após unidade apresentada",
        after_schedule_options: "Após opções de agendamento",
        after_payment_info: "Após informação de pagamento",
        after_medical_question: "Após pergunta médica",
        after_delay: "Após demora no atendimento",
    };
    return labels[moment] ?? "Desconhecido";
}

function intentLabel(intent: string) {
    const labels: Record<string, string> = {
        information: "Informação",
        schedule: "Agendamento",
        reschedule: "Reagendamento",
        confirmation: "Confirmação",
        price: "Preço",
        treatment: "Tratamento",
    };
    return (
        labels[intent] ??
        intent
            .replace(/_/g, " ")
            .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("pt-BR"))
    );
}

function objectionLabel(type: string) {
    const labels: Record<string, string> = {
        price: "Preço",
        distance: "Distância",
        online_consultation: "Consulta online",
        time_availability: "Disponibilidade de horário",
        trust: "Confiança",
        medical_uncertainty: "Incerteza médica",
        partner_or_family: "Parceiro ou família",
        already_treating_elsewhere: "Tratamento em outro local",
    };
    return labels[type] ?? "Outra";
}

async function loadFullJourneyPipeline(
    range: DashboardDateRange,
    filters: DashboardFilters,
    signal: AbortSignal,
    paidMedia: PaidMediaTotals,
    whatsappData: Awaited<ReturnType<typeof loadPaidWhatsappConversations>>,
): Promise<FullJourneyPipeline> {
    const startDate = range.startDate ?? saoPauloDate(range.startAt);
    const endDate =
        range.endDate ??
        saoPauloDate(
            new Date(new Date(range.endAt).getTime() - 1).toISOString(),
        );
    const whatsappEntries = whatsappData.paidEntries;
    const cohort = new Map<string, PaidWhatsappCohortEntry>();

    for (const entry of whatsappEntries) {
        const clientId = normalizeClientId(entry.client_id);
        if (!clientId) continue;
        const current = cohort.get(clientId);
        if (!current || entry.started_at < current.enteredAt) {
            cohort.set(clientId, {
                enteredAt: entry.started_at,
                platform: entry.platform,
                evidence: entry.evidence,
                sourceField: entry.source_field,
                sourceValue: entry.source_value,
            });
        }
    }

    const clientIds = [...cohort.keys()];
    const [procedureEventLoad, invoices] = await Promise.all([
        loadPipelineProcedureEvents(
            clientIds,
            startDate,
            endDate,
            signal,
        ),
        loadPipelineInvoices(clientIds, signal),
    ]);
    const procedureEvents = procedureEventLoad.events;

    // Main pipeline cards count unique clients. Procedure rows count every
    // deduplicated qualifying appointment, so one tracked WhatsApp client may
    // legitimately appear in multiple procedure rows (and more than once for
    // the same procedure when they have separate appointments).
    const eligibleProcedureEvents = procedureEvents.flatMap((event) => {
        const clientId = normalizeClientId(event.client_id);
        if (!clientId) return [];

        const cohortEntry = cohort.get(clientId);
        if (!cohortEntry) return [];
        if (!procedureEventBelongsToCohort(event, cohortEntry)) return [];

        return [{ ...event, client_id: clientId }];
    });
    const scheduledClients = new Set(
        eligibleProcedureEvents.flatMap((event) =>
            event.client_id ? [event.client_id] : [],
        ),
    );
    const attendedAtByClient = new Map<string, string>();
    let attendedProcedureEvents = 0;

    for (const event of eligibleProcedureEvents) {
        const clientId = event.client_id;
        if (
            !clientId ||
            !scheduleShowedUp(normalizeScheduleStatus(event.status))
        ) {
            continue;
        }

        attendedProcedureEvents += 1;
        const current = attendedAtByClient.get(clientId);
        if (!current || event.scheduled_for < current) {
            attendedAtByClient.set(clientId, event.scheduled_for);
        }
    }

    const procedureBranches = buildProcedureBranches(
        eligibleProcedureEvents,
    );
    assertProcedurePipelineIntegrity({
        trackedClients: cohort.size,
        scheduledClients: scheduledClients.size,
        attendedClients: attendedAtByClient.size,
        scheduledProcedureEvents: eligibleProcedureEvents.length,
        attendedProcedureEvents,
        procedureBranches,
    });

    const invoicedClients = new Set<string>();
    const authorizedClients = new Set<string>();
    let invoicedAmount = 0;
    let authorizedAmount = 0;

    for (const invoice of invoices) {
        const clientId = invoice.client_id;
        if (!clientId) continue;
        if (!attendedAtByClient.has(clientId) || !cohort.has(clientId)) {
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

    const platformBreakdown = buildPlatformBreakdown({
        paidMedia,
        cohort,
        scheduledClients,
        attendedClients: new Set(attendedAtByClient.keys()),
        invoices,
    });

    return buildFullJourneyPipeline({
        available: true,
        adsAvailable: paidMedia.available,
        filtersApplied: hasOperationalFilters(filters),
        startDate,
        endDate,
        impressions: paidMedia.impressions,
        clicks: paidMedia.clicks,
        platformWhatsappConversations: paidMedia.whatsappConversations,
        whatsappClients: cohort.size,
        measurementReady: paidMedia.measurementReady,
        measurementNote: paidMedia.measurementNote,
        trackedByEvidence: buildEvidenceBreakdown(cohort),
        trackedSources: buildTrackedSourceBreakdown(cohort),
        whatsappCoverage: whatsappData.coverage,
        whatsappOrigins: buildWhatsappOriginBreakdown(whatsappEntries),
        procedureLinkage: {
            tracked_clients: cohort.size,
            raw_events_read:
                procedureEventLoad.scheduleRowsRead +
                procedureEventLoad.funnelEventRowsRead,
            schedule_rows_read: procedureEventLoad.scheduleRowsRead,
            funnel_event_rows_read: procedureEventLoad.funnelEventRowsRead,
            deduped_source_events: procedureEventLoad.dedupedSourceEvents,
            eligible_source_events: eligibleProcedureEvents.length,
            linked_unique_clients: scheduledClients.size,
            attended_unique_clients: attendedAtByClient.size,
            scheduled_branch_total: procedureBranches.reduce(
                (sum, branch) => sum + branch.scheduled_appointments,
                0,
            ),
            attended_branch_total: procedureBranches.reduce(
                (sum, branch) => sum + branch.attended_appointments,
                0,
            ),
            invariant_ok: true,
        },
        scheduledClients: scheduledClients.size,
        attendedClients: attendedAtByClient.size,
        invoicedClients: invoicedClients.size,
        authorizedClients: authorizedClients.size,
        invoicedAmount,
        authorizedAmount,
        procedureBranches,
        platformBreakdown,
        error: null,
    });
}

function procedureEventBelongsToCohort(
    event: PipelineProcedureEventRow,
    cohortEntry: PaidWhatsappCohortEntry,
) {
    const effectiveCreatedAt = procedureEventCreatedAt(event);
    if (!effectiveCreatedAt) return false;

    return (
        saoPauloDate(effectiveCreatedAt) >=
        saoPauloDate(cohortEntry.enteredAt)
    );
}

function procedureEventCreatedAt(event: PipelineProcedureEventRow) {
    return event.created_in_source_at ?? event.created_at;
}

function buildProcedureBranches(
    events: PipelineProcedureEventRow[],
): PipelineProcedureBranch[] {
    const outcomes = new Map<
        string,
        {
            key: string;
            procedureName: string;
            eventKind: string;
            scheduledAppointments: number;
            attendedAppointments: number;
        }
    >();

    for (const event of events) {
        const clientId = normalizeClientId(event.client_id);
        if (!clientId) continue;

        const procedureName = pipelineProcedureName(event);
        const key = normalizeText(procedureName);
        const outcome = outcomes.get(key) ?? {
            key,
            procedureName,
            eventKind: event.event_kind?.trim() || "procedure",
            scheduledAppointments: 0,
            attendedAppointments: 0,
        };
        outcome.scheduledAppointments += 1;
        if (scheduleShowedUp(normalizeScheduleStatus(event.status))) {
            outcome.attendedAppointments += 1;
        }
        outcomes.set(key, outcome);
    }

    return [...outcomes.values()]
        .map((outcome) => ({
            key: outcome.key,
            procedure_name: outcome.procedureName,
            event_kind: outcome.eventKind,
            scheduled_appointments: outcome.scheduledAppointments,
            attended_appointments: outcome.attendedAppointments,
            schedule_to_attendance_rate: percentage(
                outcome.attendedAppointments,
                outcome.scheduledAppointments,
            ),
            lost_appointments: Math.max(
                0,
                outcome.scheduledAppointments - outcome.attendedAppointments,
            ),
        }))
        .sort(
            (first, second) =>
                second.scheduled_appointments - first.scheduled_appointments ||
                first.procedure_name.localeCompare(second.procedure_name, "pt-BR"),
        );
}


function assertProcedurePipelineIntegrity({
    trackedClients,
    scheduledClients,
    attendedClients,
    scheduledProcedureEvents,
    attendedProcedureEvents,
    procedureBranches,
}: {
    trackedClients: number;
    scheduledClients: number;
    attendedClients: number;
    scheduledProcedureEvents: number;
    attendedProcedureEvents: number;
    procedureBranches: PipelineProcedureBranch[];
}) {
    const branchScheduled = procedureBranches.reduce(
        (sum, branch) => sum + branch.scheduled_appointments,
        0,
    );
    const branchAttended = procedureBranches.reduce(
        (sum, branch) => sum + branch.attended_appointments,
        0,
    );
    const invalidBranch = procedureBranches.some(
        (branch) =>
            branch.attended_appointments > branch.scheduled_appointments,
    );

    if (
        scheduledClients > trackedClients ||
        attendedClients > scheduledClients ||
        scheduledProcedureEvents < scheduledClients ||
        attendedProcedureEvents < attendedClients ||
        attendedProcedureEvents > scheduledProcedureEvents ||
        branchScheduled !== scheduledProcedureEvents ||
        branchAttended !== attendedProcedureEvents ||
        invalidBranch
    ) {
        throw new Error(
            [
                "Inconsistent procedure pipeline",
                `tracked_clients=${trackedClients}`,
                `scheduled_clients=${scheduledClients}`,
                `attended_clients=${attendedClients}`,
                `scheduled_procedure_events=${scheduledProcedureEvents}`,
                `attended_procedure_events=${attendedProcedureEvents}`,
                `branch_scheduled=${branchScheduled}`,
                `branch_attended=${branchAttended}`,
            ].join("; "),
        );
    }
}

function normalizeClientId(value: string | null | undefined) {
    const normalized = value?.trim().toLocaleLowerCase("en-US");
    return normalized || null;
}

async function loadPaidMediaTotals(
    startDate: string,
    endDate: string,
    signal: AbortSignal,
): Promise<PaidMediaTotals> {
    const measuredRows = await loadPipelineAdRows({
        select:
            "platform, campaign_name, impressions, clicks, spend, reported_conversions, reported_conversion_type, whatsapp_impressions, whatsapp_clicks, whatsapp_conversations",
        startDate,
        endDate,
        signal,
    });

    if (measuredRows.error && isMissingAdsTable(measuredRows.error)) {
        return emptyPaidMediaTotals(false);
    }
    if (
        measuredRows.error &&
        !isMissingWhatsappMeasurementColumns(measuredRows.error)
    ) throw measuredRows.error;

    let rows = measuredRows.rows;
    let measurementReady = !measuredRows.error;

    if (measuredRows.error) {
        const fallback = await loadPipelineAdRows({
            select:
                "platform, campaign_name, impressions, clicks, spend, reported_conversions, reported_conversion_type",
            startDate,
            endDate,
            signal,
        });
        if (fallback.error) throw fallback.error;
        rows = fallback.rows;
        measurementReady = false;
    }

    const totals = emptyPaidMediaTotals(true);
    totals.measurementReady = measurementReady;
    totals.measurementNote = null;

    for (const row of rows) {
        const current = totals.byPlatform.get(row.platform);
        if (!current) continue;
        const hasStoredWhatsappMeasurement =
            measurementReady &&
            (numeric(row.whatsapp_impressions) > 0 ||
                numeric(row.whatsapp_clicks) > 0 ||
                numeric(row.whatsapp_conversations) > 0);
        const impressions = hasStoredWhatsappMeasurement
            ? numeric(row.whatsapp_impressions)
            : fallbackWhatsappImpressions(row);
        const clicks = hasStoredWhatsappMeasurement
            ? numeric(row.whatsapp_clicks)
            : fallbackWhatsappClicks(row);
        const conversations = hasStoredWhatsappMeasurement
            ? numeric(row.whatsapp_conversations)
            : fallbackWhatsappConversations(row);

        current.spend += numeric(row.spend);
        current.impressions += impressions;
        current.clicks += clicks;
        current.whatsappConversations += conversations;
        totals.impressions += impressions;
        totals.clicks += clicks;
        totals.whatsappConversations += conversations;
    }

    totals.impressions = Math.trunc(totals.impressions);
    totals.clicks = Math.trunc(totals.clicks);
    totals.whatsappConversations = roundMetric(totals.whatsappConversations);
    return totals;
}

async function loadPipelineAdRows({
    select,
    startDate,
    endDate,
    signal,
}: {
    select: string;
    startDate: string;
    endDate: string;
    signal: AbortSignal;
}) {
    const rows: PipelineAdMetricRow[] = [];
    for (let from = 0; from < MAX_PIPELINE_ROWS; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("ad_daily_metrics")
            .select(select)
            .in("platform", ["meta_ads", "google_ads"])
            .gte("metric_date", startDate)
            .lte("metric_date", endDate)
            .order("metric_date", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);
        if (error) return { rows: [] as PipelineAdMetricRow[], error };
        const page = (data ?? []) as unknown as PipelineAdMetricRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }
    return { rows, error: null };
}

async function loadPaidWhatsappConversations(
    range: DashboardDateRange,
    filters: DashboardFilters,
    signal: AbortSignal,
) {
    const rows: WhatsappConversationSourceRow[] = [];
    const tintimAttributionPromise =
        loadTintimConversationAttribution(range, filters, signal);

    async function loadPage(from: number) {
        const query = supabase
            .from("conversations")
            .select(
                "id, thread_id, client_id, started_at, origin, tunnel, unit_id, service_id, attendant_id, clients!conversations_client_id_fkey(unit_id, last_origin, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, gbraid, wbraid, fbclid, fbc, ctwa_clid, tracking_updated_at)",
            )
            .eq("channel", "WhatsApp")
            .gte("started_at", range.startAt)
            .lt("started_at", range.endAt)
            .order("started_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
        const { data, error } = await query.abortSignal(signal);
        if (error) throw error;
        return (data ?? []) as WhatsappConversationSourceRow[];
    }

    const firstPage = await loadPage(0);
    rows.push(...firstPage);
    if (firstPage.length === PAGE_SIZE) {
        for (
            let from = PAGE_SIZE;
            from < MAX_PIPELINE_ROWS;
            from += PAGE_SIZE * CONVERSATION_PAGE_CONCURRENCY
        ) {
            const offsets = Array.from(
                { length: CONVERSATION_PAGE_CONCURRENCY },
                (_, index) => from + index * PAGE_SIZE,
            ).filter((offset) => offset < MAX_PIPELINE_ROWS);
            const pages = await Promise.all(offsets.map(loadPage));
            for (const page of pages) rows.push(...page);
            if (pages.some((page) => page.length < PAGE_SIZE)) break;
        }
    }

    const tintimByConversation = await tintimAttributionPromise;
    const selectedOrigins = new Set(filters.origins.map(normalizeText));
    const paidEntries: PaidWhatsappEntry[] = [];
    const coverageByConversation = new Map<string, WhatsappCoverageCategory>();

    for (const conversation of rows) {
        const conversationOrigin = conversation.origin?.trim();
        const client = Array.isArray(conversation.clients)
            ? conversation.clients[0]
            : conversation.clients;

        if (
            filters.unitIds.length > 0 &&
            !filters.unitIds.includes(conversation.unit_id ?? "")
        ) continue;
        if (
            filters.serviceIds.length > 0 &&
            !filters.serviceIds.includes(conversation.service_id ?? "")
        ) continue;
        if (
            filters.attendantIds.length > 0 &&
            !filters.attendantIds.includes(conversation.attendant_id ?? "")
        ) continue;
        if (
            filters.tunnels.length > 0 &&
            !filters.tunnels.includes(conversation.tunnel?.trim() || "__NULL__")
        ) continue;

        const directPlatform =
            paidMediaPlatformFromOrigin(conversationOrigin) ??
            paidMediaPlatformFromTintimSource(conversationOrigin);
        const tintimAttribution = tintimByConversation.get(conversation.id) ?? null;
        const clientAttribution = resolvePaidMediaAttribution(client);
        const trackingIsNear = trackingIsNearConversation(
            client?.tracking_updated_at,
            conversation.started_at,
        );
        const attribution = directPlatform
            ? { platform: directPlatform, evidence: "origin" as const }
            : tintimAttribution?.platform
              ? { platform: tintimAttribution.platform, evidence: "tintim" as const }
              : tintimAttribution
                ? null
                : trackingIsNear
                  ? clientAttribution
                  : null;
        const clientOrigin = client?.last_origin?.trim();
        const origin =
            (attribution
                ? ((directPlatform
                      ? conversationOrigin
                      : attribution.evidence === "tintim" && tintimAttribution
                        ? tintimAttributionSource(tintimAttribution)
                        : (
                                paidMediaPlatformFromOrigin(clientOrigin) ??
                                paidMediaPlatformFromTintimSource(clientOrigin)
                            ) === attribution.platform
                          ? clientOrigin
                          : null) ?? attributionEvidenceLabel(attribution))
                : conversationOrigin ?? clientOrigin ?? client?.utm_source?.trim()) ??
            null;

        if (
            selectedOrigins.size > 0 &&
            !selectedOrigins.has(normalizeText(origin ?? ""))
        ) continue;

        const coverageKey =
            conversation.thread_id ?? conversation.client_id ?? conversation.id;
        const coverageCategory =
            attribution?.platform ??
            ((hasTintimTrackingEvidence(tintimAttribution) ||
            hasConversationTrackingEvidence({
                conversationOrigin,
                client,
                trackingIsNear,
            }))
                ? "other"
                : "untracked");
        coverageByConversation.set(
            coverageKey,
            mergeCoverageCategory(
                coverageByConversation.get(coverageKey),
                coverageCategory,
            ),
        );

        if (!attribution) continue;
        const attributionSource = resolveAttributionSource({
            directPlatform,
            conversationOrigin,
            client,
            tintimAttribution,
            attribution,
        });
        if (!attributionSource) continue;

        paidEntries.push({
            ...conversation,
            origin,
            platform: attribution.platform,
            evidence: attribution.evidence,
            source_field: attributionSource.field,
            source_value: attributionSource.value,
        });
    }

    return {
        rows,
        paidEntries,
        coverage: buildWhatsappCoverage(coverageByConversation),
    };
}

async function loadTintimConversationAttribution(
    range: DashboardDateRange,
    filters: DashboardFilters,
    signal: AbortSignal,
) {
    const { data, error } = await supabase
        .rpc(
            "dashboard_tintim_conversation_attribution_v1",
            executiveRpcParams(
                { startAt: range.startAt, endAt: range.endAt },
                filters,
            ),
        )
        .abortSignal(signal);
    const byConversation = new Map<string, TintimConversationAttributionRow>();

    if (error) {
        console.warn(
            "[dashboard/jornada] TinTim attribution unavailable; using existing tracking evidence",
            { code: error.code, message: error.message },
        );
        return byConversation;
    }

    for (const rawValue of arrayOrEmpty(data)) {
        const value = asObject(rawValue);
        if (typeof value.conversation_id !== "string") continue;
        byConversation.set(value.conversation_id, normalizeTintimAttribution(value));
    }
    return byConversation;
}

async function loadPipelineProcedureEvents(
    clientIds: string[],
    startDate: string,
    endDate: string,
    signal: AbortSignal,
): Promise<PipelineProcedureEventLoadResult> {
    if (clientIds.length === 0) {
        return {
            events: [],
            scheduleRowsRead: 0,
            funnelEventRowsRead: 0,
            dedupedSourceEvents: 0,
        };
    }

    const endExclusiveDate = addDaysToDateString(endDate, 1);
    const sourceBatches = await mapWithConcurrency(
        chunk(clientIds, ID_FILTER_BATCH_SIZE),
        CLINISYS_QUERY_CONCURRENCY,
        async (ids) => {
            const [scheduleRows, funnelEventRows] = await Promise.all([
                loadScheduleProcedureRows(
                    ids,
                    startDate,
                    endExclusiveDate,
                    signal,
                ),
                loadFunnelProcedureRows(
                    ids,
                    startDate,
                    endExclusiveDate,
                    signal,
                ),
            ]);
            return { scheduleRows, funnelEventRows };
        },
    );
    const scheduleRows = sourceBatches.flatMap(
        (batch) => batch.scheduleRows,
    );
    const funnelEventRows = sourceBatches.flatMap(
        (batch) => batch.funnelEventRows,
    );
    const events = dedupePipelineProcedureEvents([
        ...scheduleRows,
        ...funnelEventRows,
    ]);

    return {
        events,
        scheduleRowsRead: scheduleRows.length,
        funnelEventRowsRead: funnelEventRows.length,
        dedupedSourceEvents: events.length,
    };
}

async function loadScheduleProcedureRows(
    clientIds: string[],
    startDate: string,
    endExclusiveDate: string,
    signal: AbortSignal,
) {
    const rows: PipelineProcedureEventRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("schedules")
            .select(
                "source_external_id, source_hash, client_id, created_in_source_at, created_at, scheduled_for, status, procedure_name, unit_name",
            )
            .in("client_id", clientIds)
            .or(
                procedureCreationDateFilter(startDate, endExclusiveDate),
            )
            .order("created_at", { ascending: true })
            .order("source_hash", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);
        if (error) throw error;

        const rawPage = (data ?? []) as Array<
            Omit<
                PipelineProcedureEventRow,
                "source_table" | "event_kind"
            >
        >;
        const page = rawPage.map((row) => ({
            ...row,
            source_table: "schedules" as const,
            event_kind: null,
        }));
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadFunnelProcedureRows(
    clientIds: string[],
    startDate: string,
    endExclusiveDate: string,
    signal: AbortSignal,
) {
    const rows: PipelineProcedureEventRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("funnel_clinisys_events")
            .select(
                "source_external_id, source_hash, client_id, created_in_source_at, created_at, scheduled_for, status, procedure_name, event_kind, unit_name",
            )
            .in("client_id", clientIds)
            .or(
                procedureCreationDateFilter(startDate, endExclusiveDate),
            )
            .order("created_at", { ascending: true })
            .order("source_hash", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);
        if (error) throw error;

        const rawPage = (data ?? []) as Array<
            Omit<PipelineProcedureEventRow, "source_table">
        >;
        const page = rawPage.map((row) => ({
            ...row,
            source_table: "funnel_clinisys_events" as const,
        }));
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

function procedureCreationDateFilter(
    startDate: string,
    endExclusiveDate: string,
) {
    return [
        `and(created_in_source_at.gte.${startDate},created_in_source_at.lt.${endExclusiveDate})`,
        `and(created_in_source_at.is.null,created_at.gte.${startDate},created_at.lt.${endExclusiveDate})`,
    ].join(",");
}

function addDaysToDateString(value: string, days: number) {
    const date = new Date(`${value}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function dedupePipelineProcedureEvents(
    events: PipelineProcedureEventRow[],
) {
    const deduped: PipelineProcedureEventRow[] = [];
    const indexByIdentity = new Map<string, number>();

    for (const event of events) {
        const identities = pipelineProcedureEventIdentities(event);
        const existingIndex = identities
            .map((identity) => indexByIdentity.get(identity))
            .find((index): index is number => index !== undefined);

        if (existingIndex === undefined) {
            const index = deduped.length;
            deduped.push(event);
            for (const identity of identities) {
                indexByIdentity.set(identity, index);
            }
            continue;
        }

        const merged = mergePipelineProcedureEvents(
            deduped[existingIndex],
            event,
        );
        deduped[existingIndex] = merged;
        for (const identity of [
            ...pipelineProcedureEventIdentities(merged),
            ...identities,
        ]) {
            indexByIdentity.set(identity, existingIndex);
        }
    }

    return deduped;
}

function pipelineProcedureEventIdentities(
    event: PipelineProcedureEventRow,
) {
    const identities: string[] = [];
    const externalId = nullableText(event.source_external_id);
    const sourceHash = nullableText(event.source_hash);
    const clientId = normalizeClientId(event.client_id);
    const procedureName = normalizeText(event.procedure_name);
    const unitName = normalizeText(event.unit_name);
    const effectiveCreatedAt = procedureEventCreatedAt(event);
    const createdDate = effectiveCreatedAt
        ? saoPauloDate(effectiveCreatedAt)
        : "";

    if (externalId) identities.push(`external:${externalId}`);
    if (sourceHash) identities.push(`hash:${sourceHash}`);
    if (clientId && event.scheduled_for) {
        identities.push(
            [
                "fallback",
                clientId,
                event.scheduled_for,
                procedureName,
                unitName,
                createdDate,
            ].join(":"),
        );
    }

    if (identities.length === 0) {
        identities.push(
            [
                "row",
                event.source_table,
                event.scheduled_for,
                procedureName,
                createdDate,
            ].join(":"),
        );
    }

    return identities;
}

function mergePipelineProcedureEvents(
    current: PipelineProcedureEventRow,
    candidate: PipelineProcedureEventRow,
): PipelineProcedureEventRow {
    const currentAttended = scheduleShowedUp(
        normalizeScheduleStatus(current.status),
    );
    const candidateAttended = scheduleShowedUp(
        normalizeScheduleStatus(candidate.status),
    );
    const preferredStatus = candidateAttended && !currentAttended
        ? candidate.status
        : current.status ?? candidate.status;
    const preferredProcedureName = chooseProcedureName(
        current.procedure_name,
        candidate.procedure_name,
    );

    return {
        source_table:
            current.source_table === "funnel_clinisys_events" ||
            candidate.source_table !== "funnel_clinisys_events"
                ? current.source_table
                : candidate.source_table,
        source_external_id:
            current.source_external_id ?? candidate.source_external_id,
        source_hash: current.source_hash ?? candidate.source_hash,
        client_id: current.client_id ?? candidate.client_id,
        created_in_source_at: earlierNullableDate(
            current.created_in_source_at,
            candidate.created_in_source_at,
        ),
        created_at: earlierNullableDate(
            current.created_at,
            candidate.created_at,
        ),
        scheduled_for:
            current.scheduled_for <= candidate.scheduled_for
                ? current.scheduled_for
                : candidate.scheduled_for,
        status: preferredStatus,
        procedure_name: preferredProcedureName,
        event_kind: current.event_kind ?? candidate.event_kind,
        unit_name: current.unit_name ?? candidate.unit_name,
    };
}

function chooseProcedureName(
    current: string | null,
    candidate: string | null,
) {
    const currentName = current?.trim() ?? "";
    const candidateName = candidate?.trim() ?? "";
    if (!currentName) return candidateName || null;
    if (!candidateName) return currentName;
    return candidateName.length > currentName.length
        ? candidateName
        : currentName;
}

function earlierNullableDate(
    current: string | null,
    candidate: string | null,
) {
    if (!current) return candidate;
    if (!candidate) return current;
    return current <= candidate ? current : candidate;
}

async function loadPipelineInvoices(
    clientIds: string[],
    signal: AbortSignal,
) {
    if (clientIds.length === 0) return [];
    const pages = await mapWithConcurrency(
        chunk(clientIds, ID_FILTER_BATCH_SIZE),
        CLINISYS_QUERY_CONCURRENCY,
        async (ids) => {
            const rows: PipelineInvoiceRow[] = [];
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
            return rows;
        },
    );
    return pages.flat();
}

function pipelineProcedureName(event: PipelineProcedureEventRow) {
    const name = event.procedure_name?.trim().replace(/\s+/g, " ");
    if (name) return name;
    return event.event_kind === "evaluation"
        ? "Avaliação"
        : "Procedimento não informado";
}

function buildFullJourneyPipeline(values: {
    available: boolean;
    adsAvailable: boolean;
    filtersApplied: boolean;
    startDate: string;
    endDate: string;
    impressions: number;
    clicks: number;
    platformWhatsappConversations: number;
    whatsappClients: number;
    measurementReady: boolean;
    measurementNote: string | null;
    trackedByEvidence: FullJourneyPipeline["audit"]["tracked_by_evidence"];
    trackedSources: FullJourneyPipeline["audit"]["tracked_sources"];
    whatsappCoverage: WhatsappCoverage;
    whatsappOrigins: FullJourneyPipeline["audit"]["whatsapp_origins"];
    procedureLinkage: FullJourneyPipeline["audit"]["procedure_linkage"];
    scheduledClients: number;
    attendedClients: number;
    invoicedClients: number;
    authorizedClients: number;
    invoicedAmount: number;
    authorizedAmount: number;
    procedureBranches: PipelineProcedureBranch[];
    platformBreakdown: PipelinePlatformBreakdown[];
    error: string | null;
}): FullJourneyPipeline {
    const stages: PipelineStage[] = [
        stage("tracked_whatsapp", "WhatsApp rastreado", values.whatsappClients),
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
        acquisition_branches: values.platformBreakdown.map((platform) => ({
            platform: platform.platform,
            label: platform.label,
            impressions: platform.impressions,
            clicks: platform.whatsapp_clicks,
            click_through_rate: percentage(
                platform.whatsapp_clicks,
                platform.impressions,
            ),
            tracked_clients: platform.tracked_clients,
            click_to_tracked_rate: percentage(
                platform.tracked_clients,
                platform.whatsapp_clicks,
            ),
        })),
        procedure_branches: values.procedureBranches,
        platform_breakdown: values.platformBreakdown,
        transitions: [
            transition("whatsapp_to_schedule", "Rastreado → agenda", values.whatsappClients, values.scheduledClients, false, true),
            transition("schedule_to_attendance", "Agenda → presença", values.scheduledClients, values.attendedClients, false, true),
            transition("attendance_to_invoice", "Presença → R$", values.attendedClients, values.invoicedClients, false, true),
            transition("invoice_to_authorized", "R$ → liberado", values.invoicedClients, values.authorizedClients, false, true),
        ],
        audit: {
            platform_whatsapp_conversations: values.platformWhatsappConversations,
            tracked_whatsapp_clients: values.whatsappClients,
            measurement_ready: values.measurementReady,
            measurement_note: values.measurementNote,
            tracked_by_evidence: values.trackedByEvidence,
            tracked_sources: values.trackedSources,
            whatsapp_coverage: values.whatsappCoverage,
            whatsapp_origins: values.whatsappOrigins,
            procedure_linkage: values.procedureLinkage,
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
        saoPauloDate(new Date(new Date(range.endAt).getTime() - 1).toISOString());
    return buildFullJourneyPipeline({
        available: false,
        adsAvailable: false,
        filtersApplied: hasOperationalFilters(filters),
        startDate,
        endDate,
        impressions: 0,
        clicks: 0,
        platformWhatsappConversations: 0,
        whatsappClients: 0,
        measurementReady: false,
        measurementNote: null,
        trackedByEvidence: [],
        trackedSources: [],
        whatsappCoverage: emptyWhatsappCoverage(),
        whatsappOrigins: [],
        procedureLinkage: {
            tracked_clients: 0,
            raw_events_read: 0,
            schedule_rows_read: 0,
            funnel_event_rows_read: 0,
            deduped_source_events: 0,
            eligible_source_events: 0,
            linked_unique_clients: 0,
            attended_unique_clients: 0,
            scheduled_branch_total: 0,
            attended_branch_total: 0,
            invariant_ok: false,
        },
        scheduledClients: 0,
        attendedClients: 0,
        invoicedClients: 0,
        authorizedClients: 0,
        invoicedAmount: 0,
        authorizedAmount: 0,
        procedureBranches: [],
        platformBreakdown: [],
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

function buildEvidenceBreakdown(
    cohort: Map<string, PaidWhatsappCohortEntry>,
): FullJourneyPipeline["audit"]["tracked_by_evidence"] {
    const counts = new Map<JourneyAttributionEvidence, number>();
    for (const entry of cohort.values()) {
        counts.set(entry.evidence, (counts.get(entry.evidence) ?? 0) + 1);
    }
    return (["tintim", "origin", "utm_source", "click_id"] as const)
        .map((evidence) => ({
            evidence,
            clients: counts.get(evidence) ?? 0,
        }))
        .filter((item) => item.clients > 0);
}

function hasConversationTrackingEvidence({
    conversationOrigin,
    client,
    trackingIsNear,
}: {
    conversationOrigin: string | null | undefined;
    client: PipelineClientOriginRow | null;
    trackingIsNear: boolean;
}) {
    if (conversationOrigin?.trim()) return true;
    if (!trackingIsNear || !client) return false;
    return Boolean(
        client.last_origin?.trim() ||
        client.utm_source?.trim() ||
        client.utm_medium?.trim() ||
        client.utm_campaign?.trim() ||
        client.utm_content?.trim() ||
        client.utm_term?.trim() ||
        client.gclid || client.gbraid || client.wbraid ||
        client.fbclid || client.fbc || client.ctwa_clid,
    );
}

function mergeCoverageCategory(
    current: WhatsappCoverageCategory | undefined,
    next: WhatsappCoverageCategory,
): WhatsappCoverageCategory {
    if (!current) return next;
    if (current === "google_ads" || current === "meta_ads") return current;
    if (next === "google_ads" || next === "meta_ads") return next;
    if (current === "other" || next === "other") return "other";
    return "untracked";
}

function buildWhatsappCoverage(
    coverageByConversation: Map<string, WhatsappCoverageCategory>,
): WhatsappCoverage {
    let googleConversations = 0;
    let metaConversations = 0;
    let otherConversations = 0;
    let untrackedConversations = 0;
    for (const category of coverageByConversation.values()) {
        if (category === "google_ads") googleConversations += 1;
        else if (category === "meta_ads") metaConversations += 1;
        else if (category === "other") otherConversations += 1;
        else untrackedConversations += 1;
    }
    const trackedConversations =
        googleConversations + metaConversations + otherConversations;
    const totalConversations = coverageByConversation.size;
    return {
        total_conversations: totalConversations,
        tracked_conversations: trackedConversations,
        tracking_rate: percentage(trackedConversations, totalConversations),
        google_conversations: googleConversations,
        meta_conversations: metaConversations,
        other_conversations: otherConversations,
        untracked_conversations: untrackedConversations,
    };
}

function emptyWhatsappCoverage(): WhatsappCoverage {
    return {
        total_conversations: 0,
        tracked_conversations: 0,
        tracking_rate: null,
        google_conversations: 0,
        meta_conversations: 0,
        other_conversations: 0,
        untracked_conversations: 0,
    };
}

function buildTrackedSourceBreakdown(
    cohort: Map<string, PaidWhatsappCohortEntry>,
): FullJourneyPipeline["audit"]["tracked_sources"] {
    const sources = new Map<
        string,
        {
            platform: PaidMediaPlatform;
            field: PaidWhatsappEntry["source_field"];
            source: string;
            clients: number;
        }
    >();
    for (const entry of cohort.values()) {
        const key = [entry.platform, entry.sourceField, normalizeText(entry.sourceValue)].join(":");
        const current = sources.get(key) ?? {
            platform: entry.platform,
            field: entry.sourceField,
            source: entry.sourceValue,
            clients: 0,
        };
        current.clients += 1;
        sources.set(key, current);
    }
    return [...sources.values()]
        .map((source) => ({
            ...source,
            percentage: percentage(source.clients, cohort.size) ?? 0,
        }))
        .sort(
            (first, second) =>
                second.clients - first.clients ||
                first.source.localeCompare(second.source, "pt-BR"),
        );
}

function buildPlatformBreakdown({
    paidMedia,
    cohort,
    scheduledClients,
    attendedClients,
    invoices,
}: {
    paidMedia: PaidMediaTotals;
    cohort: Map<string, PaidWhatsappCohortEntry>;
    scheduledClients: Set<string>;
    attendedClients: Set<string>;
    invoices: PipelineInvoiceRow[];
}): PipelinePlatformBreakdown[] {
    const outcomes = new Map(
        (["google_ads", "meta_ads"] as const).map((platform) => [
            platform,
            {
                tracked: new Set<string>(),
                scheduled: new Set<string>(),
                attended: new Set<string>(),
                invoiced: new Set<string>(),
                authorized: new Set<string>(),
                authorizedRevenue: 0,
            },
        ]),
    );

    for (const [clientId, entry] of cohort) {
        const outcome = outcomes.get(entry.platform);
        if (!outcome) continue;
        outcome.tracked.add(clientId);
        if (scheduledClients.has(clientId)) outcome.scheduled.add(clientId);
        if (attendedClients.has(clientId)) outcome.attended.add(clientId);
    }

    for (const invoice of invoices) {
        const clientId = invoice.client_id;
        if (!clientId || !attendedClients.has(clientId)) continue;
        const entry = cohort.get(clientId);
        if (!entry) continue;
        const outcome = outcomes.get(entry.platform);
        if (!outcome) continue;
        outcome.invoiced.add(clientId);
        if (invoiceStatusIsAuthorized(invoice.status)) {
            outcome.authorized.add(clientId);
            outcome.authorizedRevenue += numeric(invoice.amount);
        }
    }

    return (["google_ads", "meta_ads"] as const).map((platform) => {
        const media = paidMedia.byPlatform.get(platform)!;
        const outcome = outcomes.get(platform)!;
        return {
            platform,
            label: platform === "google_ads" ? "Google Ads" : "Meta Ads",
            spend: roundMoney(media.spend),
            impressions: Math.trunc(media.impressions),
            whatsapp_clicks: Math.trunc(media.clicks),
            platform_whatsapp_conversations: roundMetric(media.whatsappConversations),
            tracked_clients: outcome.tracked.size,
            scheduled_clients: outcome.scheduled.size,
            attended_clients: outcome.attended.size,
            invoiced_clients: outcome.invoiced.size,
            authorized_clients: outcome.authorized.size,
            authorized_revenue: roundMoney(outcome.authorizedRevenue),
        };
    });
}

function emptyPaidMediaTotals(available: boolean): PaidMediaTotals {
    return {
        available,
        measurementReady: false,
        measurementNote: null,
        impressions: 0,
        clicks: 0,
        whatsappConversations: 0,
        byPlatform: new Map([
            ["google_ads", { spend: 0, impressions: 0, clicks: 0, whatsappConversations: 0 }],
            ["meta_ads", { spend: 0, impressions: 0, clicks: 0, whatsappConversations: 0 }],
        ]),
    };
}

function fallbackWhatsappImpressions(row: PipelineAdMetricRow) {
    if (row.platform === "google_ads") return numeric(row.impressions);
    return fallbackMetaWhatsappCampaign(row) ? numeric(row.impressions) : 0;
}

function fallbackWhatsappClicks(row: PipelineAdMetricRow) {
    if (row.platform === "google_ads") return numeric(row.clicks);
    return fallbackMetaWhatsappCampaign(row) ? numeric(row.clicks) : 0;
}

function fallbackWhatsappConversations(row: PipelineAdMetricRow) {
    return isMetaMessagingResult(row.reported_conversion_type)
        ? numeric(row.reported_conversions)
        : 0;
}

function fallbackMetaWhatsappCampaign(row: PipelineAdMetricRow) {
    if (isMetaMessagingResult(row.reported_conversion_type)) return true;
    const campaign = normalizeText(row.campaign_name);
    return (
        /(^| )(direct|whatsapp|whats app|wpp)( |$)/.test(campaign) ||
        campaign.includes("clique para whatsapp")
    );
}

function isMetaMessagingResult(value: string | null) {
    const normalized = normalizeText(value);
    return (
        normalized.includes("messaging conversation started") ||
        normalized.includes("messaging_conversation_started")
    );
}

function normalizeTintimAttribution(
    value: Record<string, unknown>,
): TintimConversationAttributionRow {
    const platform =
        value.platform === "google_ads" || value.platform === "meta_ads"
            ? value.platform
            : null;
    return {
        conversation_id: String(value.conversation_id),
        source: nullableText(value.source),
        platform,
    };
}

function tintimAttributionSource(attribution: TintimConversationAttributionRow) {
    return (
        attribution.source ??
        (attribution.platform === "google_ads" ? "Google Ads" : "Meta Ads")
    );
}

function hasTintimTrackingEvidence(
    attribution: TintimConversationAttributionRow | null,
) {
    return Boolean(
        attribution?.platform || isTrackedTintimSource(attribution?.source),
    );
}

function trackingIsNearConversation(
    trackingUpdatedAt: string | null | undefined,
    conversationStartedAt: string,
) {
    if (!trackingUpdatedAt) return false;
    const trackingTime = new Date(trackingUpdatedAt).getTime();
    const conversationTime = new Date(conversationStartedAt).getTime();
    if (!Number.isFinite(trackingTime) || !Number.isFinite(conversationTime)) {
        return false;
    }
    return Math.abs(trackingTime - conversationTime) <= 7 * 86_400_000;
}

function resolveAttributionSource({
    directPlatform,
    conversationOrigin,
    client,
    tintimAttribution,
    attribution,
}: {
    directPlatform: PaidMediaPlatform | null;
    conversationOrigin: string | null | undefined;
    client: PipelineClientOriginRow | null;
    tintimAttribution: TintimConversationAttributionRow | null;
    attribution: {
        platform: PaidMediaPlatform;
        evidence: JourneyAttributionEvidence;
    };
}): { field: PaidWhatsappEntry["source_field"]; value: string } | null {
    if (directPlatform && conversationOrigin?.trim()) {
        return { field: "conversation_origin", value: conversationOrigin.trim() };
    }
    if (attribution.evidence === "tintim" && tintimAttribution) {
        return { field: "tintim_source", value: tintimAttributionSource(tintimAttribution) };
    }
    if (attribution.evidence === "origin" && client?.last_origin?.trim()) {
        return { field: "client_origin", value: client.last_origin.trim() };
    }
    if (attribution.evidence === "utm_source" && client?.utm_source?.trim()) {
        return { field: "utm_source", value: client.utm_source.trim() };
    }
    if (attribution.evidence !== "click_id" || !client) return null;

    const identifiers = attribution.platform === "google_ads"
        ? ([
              ["gclid", client.gclid],
              ["gbraid", client.gbraid],
              ["wbraid", client.wbraid],
          ] as const)
        : ([
              ["ctwa_clid", client.ctwa_clid],
              ["fbclid", client.fbclid],
              ["fbc", client.fbc],
          ] as const);
    const availableIdentifiers = identifiers
        .filter(([, value]) => Boolean(value))
        .map(([field]) => field);
    return availableIdentifiers.length > 0
        ? { field: "click_id", value: availableIdentifiers.join(" + ") }
        : null;
}

function attributionEvidenceLabel(attribution: {
    platform: PaidMediaPlatform;
    evidence: JourneyAttributionEvidence;
}) {
    const platform = attribution.platform === "google_ads" ? "Google" : "Meta";
    const evidence = attribution.evidence === "tintim"
        ? "TinTim"
        : attribution.evidence === "utm_source"
          ? "UTM"
          : attribution.evidence === "click_id"
            ? "ID de clique"
            : "Origem";
    return `${platform} · ${evidence}`;
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

function isMissingWhatsappMeasurementColumns(error: {
    code?: string;
    message?: string;
}) {
    return (
        error.code === "42703" ||
        error.code === "PGRST204" ||
        Boolean(error.message?.includes("whatsapp_"))
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

function roundMetric(value: number) {
    return Number(value.toFixed(4));
}

function nullableText(value: unknown) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
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

function saoPauloDate(value: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await mapper(items[index]);
        }
    }
    await Promise.all(
        Array.from(
            { length: Math.min(Math.max(1, concurrency), items.length) },
            worker,
        ),
    );
    return results;
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
}

function arrayOrEmpty(value: unknown) {
    return Array.isArray(value) ? value : [];
}
