// app/api/dashboard/jornada/route.ts
import { getMatureJourneyRange, journeyProcedureKind } from "@/lib/funnel/fullJourney";
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
const FIRST_EVALUATION_PROCEDURES = {
    presencial: "1ª Avaliação de Reprodução Humana - presencial",
    online: "1ª Avaliação de Reprodução Humana - online",
} as const;

type EvaluationJourneyMode = keyof typeof FIRST_EVALUATION_PROCEDURES;

type JourneyAttributionEvidence =
    | PaidMediaAttributionEvidence
    | "tintim";

type PipelineStageKey =
    | "paid_impressions"
    | "paid_clicks"
    | "tracked_whatsapp"
    | "scheduled"
    | "attended"
    | "procedure_scheduled"
    | "procedure_attended"
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
    query_params?: string;
    additional_pipelines?: Array<{ key: string; pipeline: FullJourneyPipeline }>;
    instagram?: { clicks: number | null; chats: number; to_whatsapp: number; to_consultation: number; unlinked_chats: number };
    revenue_branches?: Array<{ kind: string; clients: number; amount: number }>;
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
            scheduled_clients: number;
            attended_clients: number;
            schedule_rate: number | null;
            attendance_rate: number | null;
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
        entry_clients_total?: number;
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
    invoiced_clients: number | null;
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
    platform: PaidMediaPlatform | null;
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
    identified_clients: number;
    paid_clients: number;
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
    | "funnel_clinisys_events"
    | "appointments";

type PipelineProcedureEventRow = {
    booking_channel?: string | null;
    booking_social_id?: string | null;
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

type EvaluationJourneyEventRow = {
    client_id: string | null;
    scheduled_for: string;
    created_in_source_at: string | null;
    procedure_name: string | null;
    status: string | null;
    event_kind: string | null;
    unit_name: string | null;
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const pipelineOnly = searchParams.get("full_pipeline_only") === "1";
    const range = pipelineOnly && !searchParams.has("start_date")
        ? resolveDashboardDateRange(new URLSearchParams(getMatureJourneyRange()))
        : resolveDashboardDateRange(searchParams);
    const filters = readDashboardFilters(searchParams);

    try {
        const startDate = range.startDate ?? saoPauloDate(range.startAt);
        const endDate =
            range.endDate ??
            saoPauloDate(
                new Date(new Date(range.endAt).getTime() - 1).toISOString(),
            );
        if (pipelineOnly) {
            const { data: prepared, error: preparedError } = await supabase.rpc(
                "dashboard_journey_prepared_v1",
                executiveRpcParams({ startAt: range.startAt, endAt: range.endAt }, filters),
            ).abortSignal(request.signal);
            if (!preparedError && prepared?.ready && Array.isArray(prepared.groups) && prepared.groups.length) {
                return NextResponse.json(
                    { full_pipeline: buildPreparedJourneyPipeline(prepared as PreparedJourneyRead, range, filters) },
                    { headers: { "Cache-Control": "private, no-store" } },
                );
            }
            console.warn("[dashboard/jornada] prepared pipeline unavailable; using existing path", preparedError?.code);
            const [paidMedia, candidateIds, social, instagramClicks] = await Promise.all([
                loadPaidMediaTotals(startDate, endDate, request.signal),
                loadPipelineCandidateIds(range, request.signal),
                loadInstagramJourney(range, filters, request.signal),
                loadInstagramDestinationClicks(startDate, endDate, request.signal),
            ]);
            for (const clientId of social.activeClients) candidateIds.add(clientId);
            const [history, sources] = await Promise.all([
                loadPaidWhatsappHistory([...candidateIds], range, filters, request.signal),
                loadJourneyOutcomes([...candidateIds], request.signal),
            ]);
            const paid = paidJourneyCohort(history.paidEntries);
            for (const [id, entry] of social.paidClients) {
                if (candidateIds.has(id) && (!paid.has(id) || entry.enteredAt < paid.get(id)!.enteredAt)) paid.set(id, entry);
            }
            for (const event of sources.procedureEventLoad.events) {
                const entry = event.booking_social_id ? social.paidProfiles.get(event.booking_social_id) : null;
                if (event.booking_channel === "Instagram" && event.client_id && entry && !paid.has(event.client_id)) paid.set(event.client_id, entry);
            }
            const whatsappIds = new Set(history.acceptedRows.flatMap(row => row.client_id ? [row.client_id] : []));
            const organicIds = new Set(history.organicClientIds);
            const untracked = new Map<string, PaidWhatsappCohortEntry>();
            for (const row of history.acceptedRows) {
                if (!row.client_id || paid.has(row.client_id) || organicIds.has(row.client_id)) continue;
                const entry = untracked.get(row.client_id);
                if (!entry || row.started_at < entry.enteredAt) untracked.set(row.client_id, nonPaidEntry(row.started_at));
            }
            const remaining = new Map<string, PaidWhatsappCohortEntry>();
            const earliestByClient = new Map<string, string>();
            function rememberDate(id: string | null, date: string | null) {
                if (id && date && (!earliestByClient.has(id) || date < earliestByClient.get(id)!)) earliestByClient.set(id, date);
            }
            for (const row of history.acceptedRows) rememberDate(row.client_id, row.started_at);
            for (const event of sources.procedureEventLoad.events) {
                rememberDate(event.client_id, procedureEventCreatedAt(event));
                rememberDate(event.client_id, event.scheduled_for);
            }
            for (const invoice of sources.invoices) rememberDate(invoice.client_id, invoice.issued_at);
            for (const client of sources.clients) {
                if (paid.has(client.id) || untracked.has(client.id)) continue;
                if (!whatsappIds.has(client.id)) {
                    if (filters.unitIds.length && !filters.unitIds.includes(client.unit_id ?? "")) continue;
                    if (filters.attendantIds.length || filters.serviceIds.length || filters.tunnels.length) continue;
                    if (filters.origins.length && !filters.origins.some(origin => normalizeText(origin) === normalizeText(client.last_origin))) continue;
                }
                const enteredAt = earliestByClient.get(client.id) ?? range.startAt;
                remaining.set(client.id, nonPaidEntry(enteredAt));
            }
            const paidWhatsappIds = new Set(history.acceptedRows.filter(row => row.client_id && paid.has(row.client_id) && row.started_at >= paid.get(row.client_id)!.enteredAt).map(row => row.client_id!));
            const [fullPipeline, untrackedPipeline, organicPipeline] = await Promise.all([
                loadFullJourneyPipeline(range, filters, request.signal, paidMedia, history, { cohort: paid, sources, entryClientIds: paidWhatsappIds }),
                loadFullJourneyPipeline(range, filters, request.signal, emptyPaidMediaTotals(false), history, { cohort: untracked, sources }),
                loadFullJourneyPipeline(range, filters, request.signal, emptyPaidMediaTotals(false), history, { cohort: remaining, sources }),
            ]);
            for (const branch of fullPipeline.acquisition_branches) {
                branch.tracked_clients = [...paidWhatsappIds].filter(id => paid.get(id)?.platform === branch.platform).length;
                branch.click_to_tracked_rate = percentage(branch.tracked_clients, branch.clicks);
            }
            untrackedPipeline.stages[0].label = "WhatsApp não rastreado";
            organicPipeline.stages[0].label = "Origem orgânica ou não rastreada";
            untrackedPipeline.acquisition_branches = [];
            organicPipeline.acquisition_branches = [];
            fullPipeline.additional_pipelines = [{ key: "untracked_whatsapp", pipeline: untrackedPipeline }, { key: "organic", pipeline: organicPipeline }];
            const directBookings = new Set(sources.procedureEventLoad.events.filter(event =>
                event.client_id && paid.has(event.client_id) && event.booking_channel === "Instagram" &&
                journeyProcedureKind(event) === "evaluation" && procedureEventBelongsToCohort(event, paid.get(event.client_id)!),
            ).map(event => event.client_id));
            fullPipeline.instagram = {
                clicks: instagramClicks, chats: social.paidProfiles.size,
                to_whatsapp: [...social.paidClients].filter(([id, entry]) => candidateIds.has(id) && history.acceptedRows.some(row => row.client_id === id && row.started_at >= entry.enteredAt)).length,
                to_consultation: directBookings.size,
                unlinked_chats: social.unlinkedPaidProfiles,
            };
            return NextResponse.json({ full_pipeline: fullPipeline }, { headers: { "Cache-Control": "private, no-store" } });
        }
        const [paidMedia, whatsappData, preparedAnalysis, evaluationJourneys] = await Promise.all([
            searchParams.get("summary_only") === "1"
                ? Promise.resolve(emptyPaidMediaTotals(false))
                : loadPaidMediaTotals(startDate, endDate, request.signal),
            loadPaidWhatsappConversations(range, filters, request.signal),
            loadPreparedConversationMetrics(range, filters, request.signal),
            loadEvaluationJourneyFunnels(range, filters, request.signal),
        ]);
        const payload = preparedAnalysis ?? buildJourneyConversationMetrics({
            conversations: whatsappData.rows,
            analyses: await loadJourneyAnalysisRows(range, request.signal),
            filters,
        });
        const fullPipeline = searchParams.get("summary_only") === "1"
            ? emptyFullJourneyPipeline(range, filters, "")
            : await loadFullJourneyPipeline(
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

        fullPipeline.query_params = searchParams.toString();
        if (searchParams.get("summary_only") === "1") {
            const cohort = new Map<string, PaidWhatsappCohortEntry>();
            for (const entry of whatsappData.paidEntries) {
                if (entry.client_id && !cohort.has(entry.client_id)) cohort.set(entry.client_id, {
                    enteredAt: entry.started_at, platform: entry.platform, evidence: entry.evidence,
                    sourceField: entry.source_field, sourceValue: entry.source_value,
                });
            }
            fullPipeline.audit.whatsapp_coverage = whatsappData.coverage;
            const scheduled = new Set<string>();
            const attended = new Set<string>();
            if (searchParams.get("source_conversions") === "1" && cohort.size) {
                const sources = await loadJourneyOutcomes([...cohort.keys()], request.signal);
                for (const event of sources.procedureEventLoad.events) {
                    const entry = event.client_id ? cohort.get(event.client_id) : null;
                    const created = procedureEventCreatedAt(event);
                    if (!event.client_id || !entry || !created || !procedureEventBelongsToCohort(event, entry)) continue;
                    if (pipelineCalendarDate(created) < startDate || pipelineCalendarDate(created) > endDate) continue;
                    scheduled.add(event.client_id);
                    if (scheduleShowedUp(normalizeScheduleStatus(event.status))) attended.add(event.client_id);
                }
            }
            fullPipeline.audit.tracked_sources = buildTrackedSourceBreakdown(cohort, scheduled, attended);
        }

        return NextResponse.json(
            {
                full_pipeline: fullPipeline,
                journey_funnel: payload.journey_funnel,
                evaluation_journeys: evaluationJourneys,
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


type PreparedJourneyGroup = {
    key: "paid" | "untracked_whatsapp" | "organic";
    clients: number | string;
    entry_clients: number | string;
    whatsapp_to_consultation: number | string;
    metrics: Record<string, number | string>;
    procedures: Array<{ key: string; procedure_name: string; event_kind: string; scheduled_appointments: number; attended_appointments: number }>;
    platforms?: Array<{ platform: PaidMediaPlatform; clients: number | string; entry_clients: number | string; metrics: Record<string, number | string> }>;
    sources?: Array<{ field: string; source: string; platform: PaidMediaPlatform; clients: number; percentage: number; scheduled_clients: number; attended_clients: number; schedule_rate: number | null; attendance_rate: number | null }>;
    evidence?: Array<{ evidence: JourneyAttributionEvidence; clients: number }>;
};
type PreparedJourneyRead = {
    ready: boolean;
    through: string;
    groups: PreparedJourneyGroup[];
    ads: Array<{ platform: PaidMediaPlatform | "instagram_direct"; spend: number | string; impressions: number | string; clicks: number | string; conversations: number | string }>;
    instagram?: { clicks: number | null; chats: number; unlinked_chats: number; to_whatsapp: number; to_consultation: number };
};
type PreparedAnalysisRead = {
    counts: Record<"started" | "requested" | "answered" | "priced" | "offered" | "scheduled", number>;
    dropoffs: Array<{ moment: string; n: number }>;
    intents: Array<{ intent: string; resolved: number; partial: number; not_resolved: number; abandoned: number }>;
    objections: Array<{ kind: string; n: number; abandoned: number }>;
    audit: { conversations: number; clients: number; conversations_with_objections: number };
};

async function loadPreparedConversationMetrics(range: DashboardDateRange, filters: DashboardFilters, signal: AbortSignal) {
    const { data, error } = await supabase.rpc(
        "dashboard_journey_analysis_prepared_v1",
        executiveRpcParams({ startAt: range.startAt, endAt: range.endAt }, filters),
    ).abortSignal(signal);
    if (error || !data || !data.counts || !Array.isArray(data.intents)) {
        console.warn("[dashboard/jornada] prepared analysis unavailable", error?.code);
        return null;
    }
    const result = data as PreparedAnalysisRead;
    const c = result.counts;
    const totalDropoffs = result.dropoffs.reduce((sum, row) => sum + row.n, 0);
    return {
        journey_funnel: [
            funnelStage("started", "Iniciou conversa", c.started, c.started, c.started, "#ddd6fe"),
            funnelStage("information_requested", "Pediu informação", c.requested, c.started, c.started, "#bbf7d0"),
            funnelStage("information_answered", "Informação respondida", c.answered, c.started, c.requested, "#bfdbfe"),
            funnelStage("price_presented", "Preço apresentado", c.priced, c.started, c.answered, "#c4b5fd"),
            funnelStage("consultation_offered", "Consulta oferecida", c.offered, c.started, c.priced, "#fed7aa"),
            funnelStage("appointment_scheduled", "Agendamento mencionado", c.scheduled, c.started, c.offered, "#fbcfe8"),
        ],
        dropoff_moments: result.dropoffs.sort((a, b) => b.n - a.n).slice(0, 5).map(row => ({
            moment: row.moment, label: dropoffLabel(row.moment), count: row.n,
            percentage: integerPercentage(row.n, totalDropoffs),
        })),
        intent_paths: result.intents.map(row => ({
            intent: intentLabel(row.intent), resolved: row.resolved, partial: row.partial,
            not_resolved: row.not_resolved, abandoned: row.abandoned,
        })).sort((a, b) =>
            (b.resolved + b.partial + b.not_resolved + b.abandoned) -
            (a.resolved + a.partial + a.not_resolved + a.abandoned)),
        objections: result.objections.map(row => ({
            type: row.kind, label: objectionLabel(row.kind), value: row.n,
            percentage: integerPercentage(row.n, result.audit.conversations_with_objections),
            abandonment_rate: integerPercentage(row.abandoned, row.n),
        })).sort((a, b) => b.value - a.value),
        audit: result.audit,
    };
}

function buildPreparedJourneyPipeline(
    prepared: PreparedJourneyRead,
    range: DashboardDateRange,
    filters: DashboardFilters,
): FullJourneyPipeline {
    const groups = new Map(prepared.groups.map(group => [group.key, group]));
    const adRows = new Map(prepared.ads.map(row => [row.platform, row]));
    const sum = (row: Record<string, number | string> | undefined, key: string) => numeric(row?.[key]);
    const group = (key: PreparedJourneyGroup["key"], text: string) => {
        const item = groups.get(key);
        if (!item) return emptyFullJourneyPipeline(range, filters, "Dados preparados indisponíveis.");
        const metric = (key: string) => sum(item.metrics, key);
        const platformBreakdown: PipelinePlatformBreakdown[] = key === "paid"
            ? (["google_ads", "meta_ads"] as const).map(platform => {
                const ad = adRows.get(platform);
                const source = item.platforms?.find(row => row.platform === platform);
                const platformMetric = (name: string) => sum(source?.metrics, name);
                return {
                    platform, label: platform === "meta_ads" ? "Meta Ads" : "Google Ads",
                    spend: numeric(ad?.spend), impressions: numeric(ad?.impressions),
                    whatsapp_clicks: numeric(ad?.clicks),
                    platform_whatsapp_conversations: numeric(ad?.conversations),
                    tracked_clients: numeric(source?.entry_clients),
                    scheduled_clients: platformMetric("scheduled"),
                    attended_clients: platformMetric("attended"),
                    invoiced_clients: null, // The prepared worker does not expose all invoice statuses.
                    authorized_clients: platformMetric("authorized"),
                    authorized_revenue: platformMetric("authorized_amount"),
                };
            }) : [];
        const rows: PipelineProcedureBranch[] = (item.procedures ?? []).map(row => ({
            key: row.key, procedure_name: row.procedure_name, event_kind: row.event_kind,
            scheduled_appointments: numeric(row.scheduled_appointments),
            attended_appointments: numeric(row.attended_appointments),
            schedule_to_attendance_rate: percentage(numeric(row.attended_appointments), numeric(row.scheduled_appointments)),
            lost_appointments: Math.max(0, numeric(row.scheduled_appointments) - numeric(row.attended_appointments)),
        }));
        const paidEntries = numeric(item.entry_clients);
        const clients = numeric(item.clients);
        const linked = metric("any_scheduled");
        const attended = metric("any_attended");
        const pipeline = buildFullJourneyPipeline({
            available: true,
            adsAvailable: prepared.ads.some(row => row.platform === "google_ads" || row.platform === "meta_ads"),
            filtersApplied: hasOperationalFilters(filters),
            startDate: range.startDate ?? saoPauloDate(range.startAt),
            endDate: range.endDate ?? saoPauloDate(new Date(new Date(range.endAt).getTime() - 1).toISOString()),
            impressions: numeric(adRows.get("google_ads")?.impressions) + numeric(adRows.get("meta_ads")?.impressions),
            clicks: numeric(adRows.get("google_ads")?.clicks) + numeric(adRows.get("meta_ads")?.clicks),
            platformWhatsappConversations: numeric(adRows.get("google_ads")?.conversations) + numeric(adRows.get("meta_ads")?.conversations),
            whatsappClients: paidEntries,
            measurementReady: true, measurementNote: null,
            trackedByEvidence: (item.evidence ?? []).filter(row => row.evidence).map(row => ({ evidence: row.evidence, clients: numeric(row.clients) })),
            trackedSources: (item.sources ?? []).filter(row => row.platform && row.field && row.source).map(row => ({
                platform: row.platform,
                field: row.field as FullJourneyPipeline["audit"]["tracked_sources"][number]["field"],
                source: row.source, clients: numeric(row.clients),
                percentage: numeric(row.percentage),
                scheduled_clients: numeric(row.scheduled_clients),
                attended_clients: numeric(row.attended_clients),
                schedule_rate: row.schedule_rate === null ? null : numeric(row.schedule_rate),
                attendance_rate: row.attendance_rate === null ? null : numeric(row.attendance_rate),
            })),
            whatsappCoverage: emptyWhatsappCoverage(),
            whatsappOrigins: [],
            procedureLinkage: {
                tracked_clients: clients,
                raw_events_read: metric("raw_schedule") + metric("raw_funnel"),
                schedule_rows_read: metric("raw_schedule"),
                funnel_event_rows_read: metric("raw_funnel"),
                deduped_source_events: metric("deduped"),
                eligible_source_events: metric("eligible"),
                linked_unique_clients: linked, attended_unique_clients: attended,
                scheduled_branch_total: rows.reduce((n, row) => n + row.scheduled_appointments, 0),
                attended_branch_total: rows.reduce((n, row) => n + row.attended_appointments, 0),
                invariant_ok: true,
            },
            entryClientsTotal: clients,
            whatsappToConsultationClients: numeric(item.whatsapp_to_consultation),
            scheduledClients: metric("scheduled"),
            attendedClients: metric("attended"),
            procedureScheduledClients: metric("procedure_scheduled"),
            procedureAttendedClients: metric("procedure_attended"),
            consultationToProcedureClients: metric("consultation_to_procedure"),
            revenueBranches: (["evaluation", "procedure"] as const).map(kind => ({
                kind, clients: metric(kind + "_revenue_clients"), amount: metric(kind + "_revenue"),
            })),
            invoicedClients: 0, authorizedClients: metric("authorized"),
            invoicedAmount: 0, authorizedAmount: metric("authorized_amount"),
            procedureBranches: rows, platformBreakdown, error: null,
        });
        if (key !== "paid") {
            pipeline.acquisition_branches = [];
            if (pipeline.stages[0]) {
                pipeline.stages[0].label = text;
            }
        }
        return pipeline;
    };
    const result = group("paid", "WhatsApp rastreado");
    result.additional_pipelines = [
        { key: "untracked_whatsapp", pipeline: group("untracked_whatsapp", "WhatsApp não rastreado") },
        { key: "organic", pipeline: group("organic", "Origem orgânica ou não rastreada") },
    ];
    result.instagram = prepared.instagram ?? { clicks: null, chats: 0, unlinked_chats: 0, to_whatsapp: 0, to_consultation: 0 };
    return result;
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

    // A later milestone also shows progress past earlier, unrecorded steps.
    const bookingEvents = ["appointment_scheduled", "appointment_rescheduled", "attendance_confirmed"];
    const offerEvents = ["consultation_offered", ...bookingEvents];
    const priceEvents = ["price_presented", ...offerEvents];
    const answerEvents = ["information_answered", ...priceEvents];
    const requestEvents = ["information_requested", ...answerEvents];
    const requested = firstStage(eventsByClient, requestEvents);
    const answered = firstStage(eventsByClient, answerEvents);
    const priced = firstStage(eventsByClient, priceEvents);
    const offered = firstStage(eventsByClient, offerEvents);
    const scheduled = firstStage(eventsByClient, bookingEvents);
    const started = new Set(base.map((row) => row.clientKey)).size;

    const journeyFunnel = [
        funnelStage("started", "Iniciou conversa", started, started, started, "#ddd6fe"),
        funnelStage("information_requested", "Pediu informação", requested.size, started, started, "#bbf7d0"),
        funnelStage("information_answered", "Informação respondida", answered.size, started, requested.size, "#bfdbfe"),
        funnelStage("price_presented", "Preço apresentado", priced.size, started, answered.size, "#c4b5fd"),
        funnelStage("consultation_offered", "Consulta oferecida", offered.size, started, priced.size, "#fed7aa"),
        funnelStage("appointment_scheduled", "Agendamento mencionado", scheduled.size, started, offered.size, "#fbcfe8"),
    ];

    const dropoffCounts = new Map<string, number>();
    const intentCounts = new Map<
        string,
        { resolved: number; partial: number; notResolved: number; abandoned: number }
    >();
    const objectionConversations = new Map<string, Set<string>>();
    const conversationsWithObjections = new Set<string>();
    const abandonedConversations = new Set<string>();

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
        if (abandoned) abandonedConversations.add(row.conversationId);
        const intent = intentCounts.get(row.customerStartIntent) ?? {
            resolved: 0,
            partial: 0,
            notResolved: 0,
            abandoned: 0,
        };
        if (abandoned) intent.abandoned += 1;
        else if (row.resolutionResult === "resolved") intent.resolved += 1;
        else if (row.resolutionResult === "partial") intent.partial += 1;
        else if (row.resolutionResult === "not_resolved") intent.notResolved += 1;
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
            abandonment_rate: integerPercentage(
                [...conversationIds].filter(id => abandonedConversations.has(id)).length,
                conversationIds.size,
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

async function loadEvaluationJourneyFunnels(
    range: DashboardDateRange,
    filters: DashboardFilters,
    signal: AbortSignal,
) {
    const startDate = range.startDate ?? saoPauloDate(range.startAt);
    const endDate =
        range.endDate ??
        saoPauloDate(
            new Date(new Date(range.endAt).getTime() - 1).toISOString(),
        );
    const selectedUnitNames = await loadEvaluationJourneyUnitNames(
        filters.unitIds,
        signal,
    );
    if (filters.unitIds.length > 0 && selectedUnitNames?.size === 0) {
        return emptyEvaluationJourneys();
    }

    const evaluationRows = await loadFirstEvaluationJourneyRows(
        startDate,
        endDate,
        signal,
    );
    const cohorts: Record<EvaluationJourneyMode, Map<string, string>> = {
        presencial: new Map(),
        online: new Map(),
    };

    for (const event of evaluationRows) {
        const clientId = normalizeClientId(event.client_id);
        const mode = evaluationJourneyMode(event.procedure_name);
        if (!clientId || !mode) continue;
        if (
            selectedUnitNames &&
            !selectedUnitNames.has(normalizeText(event.unit_name))
        ) {
            continue;
        }
        if (!scheduleShowedUp(normalizeScheduleStatus(event.status))) continue;

        const currentDate = cohorts[mode].get(clientId);
        if (!currentDate || event.scheduled_for < currentDate) {
            cohorts[mode].set(clientId, event.scheduled_for);
        }
    }

    const clientIds = [
        ...new Set(
            (["presencial", "online"] as EvaluationJourneyMode[]).flatMap(
                (mode) => [...cohorts[mode].keys()],
            ),
        ),
    ];
    if (clientIds.length === 0) return emptyEvaluationJourneys();

    const earliestEvaluationDate = (
        ["presencial", "online"] as EvaluationJourneyMode[]
    )
        .flatMap((mode) => [...cohorts[mode].values()])
        .sort()[0];
    const [procedureEvents, invoices] = await Promise.all([
        loadEvaluationJourneyProcedureRows(
            clientIds,
            earliestEvaluationDate,
            signal,
        ),
        loadPipelineInvoices(clientIds, signal),
    ]);
    const eventsByClient = new Map<string, EvaluationJourneyEventRow[]>();
    const invoicesByClient = new Map<string, PipelineInvoiceRow[]>();

    for (const event of procedureEvents) {
        const clientId = normalizeClientId(event.client_id);
        if (!clientId) continue;
        const rows = eventsByClient.get(clientId) ?? [];
        rows.push(event);
        eventsByClient.set(clientId, rows);
    }
    for (const invoice of invoices) {
        const clientId = normalizeClientId(invoice.client_id);
        if (!clientId) continue;
        const rows = invoicesByClient.get(clientId) ?? [];
        rows.push(invoice);
        invoicesByClient.set(clientId, rows);
    }

    return {
        presencial: buildEvaluationJourneyStages(
            "presencial",
            cohorts.presencial,
            eventsByClient,
            invoicesByClient,
        ),
        online: buildEvaluationJourneyStages(
            "online",
            cohorts.online,
            eventsByClient,
            invoicesByClient,
        ),
    };
}

async function loadFirstEvaluationJourneyRows(
    startDate: string,
    endDate: string,
    signal: AbortSignal,
) {
    const rows: EvaluationJourneyEventRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("funnel_clinisys_events")
            .select(
                "client_id, scheduled_for, created_in_source_at, procedure_name, status, event_kind, unit_name",
            )
            .eq("event_kind", "evaluation")
            .in("procedure_name", Object.values(FIRST_EVALUATION_PROCEDURES))
            .gte("scheduled_for", startDate)
            .lte("scheduled_for", endDate)
            .order("scheduled_for", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);
        if (error) throw error;

        const page = (data ?? []) as EvaluationJourneyEventRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadEvaluationJourneyProcedureRows(
    clientIds: string[],
    earliestEvaluationDate: string,
    signal: AbortSignal,
) {
    const pages = await mapWithConcurrency(
        chunk(clientIds, ID_FILTER_BATCH_SIZE),
        CLINISYS_QUERY_CONCURRENCY,
        async (ids) => {
            const rows: EvaluationJourneyEventRow[] = [];

            for (let from = 0; ; from += PAGE_SIZE) {
                const { data, error } = await supabase
                    .from("funnel_clinisys_events")
                    .select(
                        "client_id, scheduled_for, created_in_source_at, procedure_name, status, event_kind, unit_name",
                    )
                    .in("client_id", ids)
                    .eq("event_kind", "procedure")
                    .gte("scheduled_for", earliestEvaluationDate)
                    .order("scheduled_for", { ascending: true })
                    .range(from, from + PAGE_SIZE - 1)
                    .abortSignal(signal);
                if (error) throw error;

                const page = (data ?? []) as EvaluationJourneyEventRow[];
                rows.push(...page);
                if (page.length < PAGE_SIZE) break;
            }

            return rows;
        },
    );

    return pages.flat();
}

async function loadEvaluationJourneyUnitNames(
    unitIds: string[],
    signal: AbortSignal,
) {
    if (unitIds.length === 0) return null;

    const { data, error } = await supabase
        .from("units")
        .select("name")
        .in("id", unitIds)
        .abortSignal(signal);
    if (error) throw error;

    return new Set(
        (data ?? [])
            .map((unit) => normalizeText(unit.name))
            .filter(Boolean),
    );
}

function buildEvaluationJourneyStages(
    mode: EvaluationJourneyMode,
    cohort: Map<string, string>,
    eventsByClient: Map<string, EvaluationJourneyEventRow[]>,
    invoicesByClient: Map<string, PipelineInvoiceRow[]>,
) {
    let scheduled = 0;
    let attended = 0;
    let paid = 0;

    for (const [clientId, evaluationDate] of cohort) {
        const procedureEvents = (eventsByClient.get(clientId) ?? []).filter(
            (event) =>
                evaluationProcedureFollowsEvaluation(event, evaluationDate),
        );
        if (procedureEvents.length === 0) continue;
        scheduled += 1;

        const attendedEvents = procedureEvents.filter((event) =>
            scheduleShowedUp(normalizeScheduleStatus(event.status)),
        );
        if (attendedEvents.length === 0) continue;
        attended += 1;

        const firstAttendanceDate = attendedEvents
            .map((event) => event.scheduled_for)
            .sort()[0];
        const hasAuthorizedInvoice = (invoicesByClient.get(clientId) ?? []).some(
            (invoice) =>
                numeric(invoice.amount) > 0 &&
                invoiceStatusIsAuthorized(invoice.status) &&
                saoPauloDate(invoice.issued_at) >= firstAttendanceDate,
        );
        if (hasAuthorizedInvoice) paid += 1;
    }

    const evaluated = cohort.size;
    const evaluationLabel =
        mode === "presencial"
            ? "1ª Avaliação presencial"
            : "1ª Avaliação online";

    return [
        funnelStage(
            `${mode}_evaluation`,
            evaluationLabel,
            evaluated,
            evaluated,
            evaluated,
            "#ddd6fe",
        ),
        funnelStage(
            `${mode}_procedure_scheduled`,
            "Agendou procedimento",
            scheduled,
            evaluated,
            evaluated,
            "#bbf7d0",
        ),
        funnelStage(
            `${mode}_procedure_attended`,
            "Compareceu",
            attended,
            evaluated,
            scheduled,
            "#bfdbfe",
        ),
        funnelStage(
            `${mode}_paid`,
            "Pagou",
            paid,
            evaluated,
            attended,
            "#c4b5fd",
        ),
    ];
}

function evaluationProcedureFollowsEvaluation(
    event: EvaluationJourneyEventRow,
    evaluationDate: string,
) {
    const createdDate =
        event.created_in_source_at?.slice(0, 10) ?? event.scheduled_for;
    return (
        createdDate >= evaluationDate &&
        event.scheduled_for >= evaluationDate
    );
}

function evaluationJourneyMode(
    procedureName: string | null,
): EvaluationJourneyMode | null {
    const normalized = normalizeText(procedureName);
    if (
        normalized === normalizeText(FIRST_EVALUATION_PROCEDURES.presencial)
    ) {
        return "presencial";
    }
    if (normalized === normalizeText(FIRST_EVALUATION_PROCEDURES.online)) {
        return "online";
    }
    return null;
}

function emptyEvaluationJourneys() {
    const emptyEvents = new Map<string, EvaluationJourneyEventRow[]>();
    const emptyInvoices = new Map<string, PipelineInvoiceRow[]>();
    return {
        presencial: buildEvaluationJourneyStages(
            "presencial",
            new Map(),
            emptyEvents,
            emptyInvoices,
        ),
        online: buildEvaluationJourneyStages(
            "online",
            new Map(),
            emptyEvents,
            emptyInvoices,
        ),
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
    options?: { cohort: Map<string, PaidWhatsappCohortEntry>; sources: Awaited<ReturnType<typeof loadJourneyOutcomes>>; entryClientIds?: Set<string> },
): Promise<FullJourneyPipeline> {
    const startDate = range.startDate ?? saoPauloDate(range.startAt);
    const endDate =
        range.endDate ??
        saoPauloDate(
            new Date(new Date(range.endAt).getTime() - 1).toISOString(),
        );
    const whatsappEntries = whatsappData.paidEntries;
    const cohort = options?.cohort ?? paidJourneyCohort(whatsappEntries);

    const clientIds = [...cohort.keys()];
    const [procedureEventLoad, invoices] = options?.sources
        ? [options.sources.procedureEventLoad, options.sources.invoices] as const
        : await Promise.all([
        loadPipelineProcedureEvents(
            clientIds,
            "1900-01-01",
            saoPauloDate(new Date().toISOString()),
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

        return [{ ...event, client_id: clientId, event_kind: journeyProcedureKind(event),
            status: event.scheduled_for > saoPauloDate(new Date().toISOString()) ? "Não" : event.status }];
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

    const consultationEvents = eligibleProcedureEvents.filter((event) => event.event_kind === "evaluation");
    const treatmentEvents = eligibleProcedureEvents.filter((event) => event.event_kind === "procedure");
    const consultationClients = new Set(consultationEvents.map((event) => event.client_id));
    const treatmentClients = new Set(treatmentEvents.map((event) => event.client_id));
    const attendedConsultations = new Set(consultationEvents.filter(event => scheduleShowedUp(normalizeScheduleStatus(event.status))).map(event => event.client_id));
    const attendedTreatments = new Set(treatmentEvents.filter(event => scheduleShowedUp(normalizeScheduleStatus(event.status))).map(event => event.client_id));
    const revenueByKind = { evaluation: { clients: new Set<string>(), amount: 0 }, procedure: { clients: new Set<string>(), amount: 0 } };
    const attendanceByClient = new Map<string, typeof eligibleProcedureEvents>();
    for (const event of eligibleProcedureEvents) {
        if (!scheduleShowedUp(normalizeScheduleStatus(event.status))) continue;
        const events = attendanceByClient.get(event.client_id) ?? [];
        events.push(event);
        attendanceByClient.set(event.client_id, events);
    }
    for (const events of attendanceByClient.values()) events.sort((a, b) =>
        b.scheduled_for.localeCompare(a.scheduled_for) || (a.event_kind === "procedure" ? -1 : 1));
    const countedInvoices = new Set<string>();
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

        const invoiceId = String(invoice.source_invoice_id);
        if (countedInvoices.has(invoiceId)) continue;
        const invoiceDate = saoPauloDate(invoice.issued_at);
        if (invoiceDate > saoPauloDate(new Date().toISOString())) continue;
        const attendance = attendanceByClient.get(clientId)?.find(event => event.scheduled_for <= invoiceDate);
        if (!attendance || invoiceDate < pipelineCalendarDate(cohort.get(clientId)!.enteredAt)) continue;
        countedInvoices.add(invoiceId);
        const amount = numeric(invoice.amount);
        invoicedClients.add(clientId);
        invoicedAmount += amount;
        if (invoiceStatusIsAuthorized(invoice.status)) {
            authorizedClients.add(clientId);
            authorizedAmount += amount;
            const branch = revenueByKind[attendance.event_kind];
            branch.clients.add(clientId);
            branch.amount += amount;
        }
    }

    const platformBreakdown = buildPlatformBreakdown({
        paidMedia,
        cohort,
        scheduledClients,
        attendedClients: new Set(attendedAtByClient.keys()),
        invoices: [...new Map(invoices.filter(invoice => countedInvoices.has(String(invoice.source_invoice_id)))
            .map(invoice => [String(invoice.source_invoice_id), invoice])).values()],
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
        whatsappClients: options?.entryClientIds?.size ?? cohort.size,
        measurementReady: paidMedia.measurementReady,
        measurementNote: paidMedia.measurementNote,
        trackedByEvidence: buildEvidenceBreakdown(cohort),
        trackedSources: buildTrackedSourceBreakdown(cohort, scheduledClients, new Set(attendedAtByClient.keys())),
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
        entryClientsTotal: cohort.size,
        whatsappToConsultationClients: options?.entryClientIds ? [...consultationClients].filter(id => options.entryClientIds!.has(id)).length : consultationClients.size,
        scheduledClients: consultationClients.size,
        attendedClients: attendedConsultations.size,
        procedureScheduledClients: treatmentClients.size,
        procedureAttendedClients: attendedTreatments.size,
        consultationToProcedureClients: [...attendedConsultations].filter(id => treatmentClients.has(id)).length,
        revenueBranches: ["evaluation", "procedure"].map(kind => ({
            kind, clients: revenueByKind[kind as "evaluation" | "procedure"].clients.size,
            amount: roundMoney(revenueByKind[kind as "evaluation" | "procedure"].amount),
        })),
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
    const effectiveCreatedAt = procedureEventCreatedAt(event) ?? event.scheduled_for;
    if (!effectiveCreatedAt) return false;

    return (
        pipelineCalendarDate(effectiveCreatedAt) >= pipelineCalendarDate(cohortEntry.enteredAt) &&
        event.scheduled_for >= pipelineCalendarDate(cohortEntry.enteredAt)
    );
}

function pipelineCalendarDate(value: string) {
    // PostgreSQL DATE values are already local calendar dates.
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : saoPauloDate(value);
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
    clientIds?: string[],
) {
    const rows: WhatsappConversationSourceRow[] = [];
    const historicalTintim = clientIds ? loadHistoricalTintimAttribution(clientIds, signal)
        .catch(error => () => { throw error; }) : null;
    const tintimAttributionPromise =
        clientIds ? Promise.resolve(new Map<string, TintimConversationAttributionRow>())
            : loadTintimConversationAttribution(range, filters, signal);

    async function loadPage(from: number) {
        let query = supabase
            .from("conversations")
            .select(
                "id, thread_id, client_id, started_at, origin, tunnel, unit_id, service_id, attendant_id, clients!conversations_client_id_fkey(unit_id, last_origin, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, gbraid, wbraid, fbclid, fbc, ctwa_clid, tracking_updated_at)",
            )
            .eq("channel", "WhatsApp")
            .lt("started_at", range.endAt)
            .order("started_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
        query = clientIds ? query.in("client_id", clientIds) : query.gte("started_at", range.startAt);
        const { data, error } = await query.abortSignal(signal);
        if (error) throw error;
        return (data ?? []) as WhatsappConversationSourceRow[];
    }

    const firstPage = await loadPage(0);
    rows.push(...firstPage);
    if (firstPage.length === PAGE_SIZE) {
        for (
            let from = PAGE_SIZE;
            ;
            from += PAGE_SIZE * CONVERSATION_PAGE_CONCURRENCY
        ) {
            const offsets = Array.from(
                { length: CONVERSATION_PAGE_CONCURRENCY },
                (_, index) => from + index * PAGE_SIZE,
            );
            const pages = await Promise.all(offsets.map(loadPage));
            for (const page of pages) rows.push(...page);
            if (pages.some((page) => page.length < PAGE_SIZE)) break;
        }
    }

    const tintimByConversation = historicalTintim
        ? (await historicalTintim)(rows)
        : await tintimAttributionPromise;
    const selectedOrigins = new Set(filters.origins.map(normalizeText));
    const paidEntries: PaidWhatsappEntry[] = [];
    const acceptedRows: WhatsappConversationSourceRow[] = [];
    const organicClientIds = new Set<string>();
    const coverageByConversation = new Map<string, WhatsappCoverageCategory>();
    const identifiedClientIds = new Set<string>();
    const paidClientIds = new Set<string>();

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

        if (conversation.client_id) identifiedClientIds.add(conversation.client_id);
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

        acceptedRows.push({ ...conversation, origin });
        if (coverageCategory === "other" && conversation.client_id && !/^(?:|sem origem|nao informado|nao identificad[ao]|desconhecid[ao]|unknown|untracked|n a)$/.test(normalizeText(origin))) organicClientIds.add(conversation.client_id);
        if (!attribution) continue;
        const attributionSource = resolveAttributionSource({
            directPlatform,
            conversationOrigin,
            client,
            tintimAttribution,
            attribution,
        });
        if (!attributionSource) continue;
        if (conversation.client_id) paidClientIds.add(conversation.client_id);

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
        acceptedRows,
        organicClientIds: [...organicClientIds],
        paidEntries,
        coverage: buildWhatsappCoverage(coverageByConversation, identifiedClientIds.size, paidClientIds.size),
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

function nonPaidEntry(enteredAt: string): PaidWhatsappCohortEntry {
    return { enteredAt, platform: null, evidence: "origin", sourceField: "conversation_origin", sourceValue: "Orgânica ou não rastreada" };
}

function paidJourneyCohort(entries: PaidWhatsappEntry[]) {
    const cohort = new Map<string, PaidWhatsappCohortEntry>();
    for (const entry of entries) {
        const id = normalizeClientId(entry.client_id);
        if (!id || (cohort.has(id) && cohort.get(id)!.enteredAt <= entry.started_at)) continue;
        cohort.set(id, { enteredAt: entry.started_at, platform: entry.platform, evidence: entry.evidence, sourceField: entry.source_field, sourceValue: entry.source_value });
    }
    return cohort;
}

async function loadJourneyOutcomes(clientIds: string[], signal: AbortSignal) {
    const { data, error } = await supabase.rpc("dashboard_journey_outcomes_v1", {
        p_client_ids: clientIds, p_through: saoPauloDate(new Date().toISOString()),
    }).abortSignal(signal);
    if (error) throw error;
    const value = asObject(data);
    if (!Array.isArray(value.schedule_rows) || !Array.isArray(value.funnel_rows) || !Array.isArray(value.invoices) || !Array.isArray(value.clients)) throw new Error("Resposta de desfechos da jornada inválida.");
    const scheduleRows = value.schedule_rows as PipelineProcedureEventRow[];
    const funnelRows = value.funnel_rows as PipelineProcedureEventRow[];
    const events = dedupePipelineProcedureEvents([...scheduleRows, ...funnelRows]);
    return {
        clients: value.clients as Array<{ id: string; unit_id: string | null; last_origin: string | null }>,
        invoices: value.invoices as PipelineInvoiceRow[],
        procedureEventLoad: { events, scheduleRowsRead: scheduleRows.length, funnelEventRowsRead: funnelRows.length, dedupedSourceEvents: events.length },
    };
}

type InstagramJourneyProfile = { id: string; client_id: string | null; last_meta_ad_id: string | null; last_paid_attribution_at: string | null };
type InstagramJourneyRow = Omit<WhatsappConversationRow, "client_id"> & { instagram_user_id: string | null; instagram_users: InstagramJourneyProfile | InstagramJourneyProfile[] | null };
async function loadInstagramDestinationClicks(startDate: string, endDate: string, signal: AbortSignal) {
    let clicks = 0;
    let measured = false;
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase.from("ad_daily_instagram_direct_metrics")
            .select("account_id,adset_id,metric_date,link_clicks")
            .eq("destination_type", "INSTAGRAM_DIRECT").gte("metric_date", startDate).lte("metric_date", endDate)
            .order("metric_date").order("account_id").order("adset_id")
            .range(from, from + PAGE_SIZE - 1).abortSignal(signal);
        if (error) throw error;
        for (const row of data ?? []) { measured = true; clicks += numeric(row.link_clicks); }
        if ((data?.length ?? 0) < PAGE_SIZE) break;
    }
    return measured ? clicks : null;
}

async function loadInstagramJourney(range: DashboardDateRange, filters: DashboardFilters, signal: AbortSignal) {
    const select = "id,thread_id,instagram_user_id,started_at,origin,tunnel,unit_id,service_id,attendant_id,instagram_users!conversations_instagram_user_id_fkey(id,client_id,last_meta_ad_id,last_paid_attribution_at)";
    const { data: linked, error: linkError } = await supabase.from("instagram_users")
        .select("id,client_id,last_meta_ad_id,last_paid_attribution_at").not("client_id", "is", null).abortSignal(signal);
    if (linkError) throw linkError;
    const linkedProfiles = (linked ?? []) as InstagramJourneyProfile[];
    const rows: InstagramJourneyRow[] = [];
    for (const historical of [false, true]) {
        if (historical && !linkedProfiles.length) continue;
        for (let from = 0; ; from += PAGE_SIZE) {
            let query = supabase.from("conversations").select(select).eq("channel", "Instagram").lt("started_at", range.endAt);
            query = historical ? query.in("instagram_user_id", linkedProfiles.map(profile => profile.id)) : query.gte("started_at", range.startAt);
            const { data, error } = await query.order("started_at").order("id").range(from, from + PAGE_SIZE - 1).abortSignal(signal);
            if (error) throw error;
            rows.push(...(data ?? []) as unknown as InstagramJourneyRow[]);
            if ((data?.length ?? 0) < PAGE_SIZE) break;
        }
    }
    const referrals = new Map<string, string>();
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase.from("conversation_ad_attributions")
            .select("id,instagram_user_id,meta_ad_id,referral_received_at").eq("channel", "Instagram")
            .lt("referral_received_at", range.endAt).not("meta_ad_id", "is", null)
            .order("referral_received_at").order("id").range(from, from + PAGE_SIZE - 1).abortSignal(signal);
        if (error) throw error;
        for (const row of data ?? []) if (!referrals.has(row.instagram_user_id)) referrals.set(row.instagram_user_id, row.referral_received_at);
        if ((data?.length ?? 0) < PAGE_SIZE) break;
    }
    const activeClients = new Set<string>();
    const paidClients = new Map<string, PaidWhatsappCohortEntry>();
    const paidProfiles = new Map<string, PaidWhatsappCohortEntry>();
    const unlinked = new Set<string>();
    for (const row of rows) {
        if (!row.instagram_user_id) continue;
        if (filters.unitIds.length && !filters.unitIds.includes(row.unit_id ?? "")) continue;
        if (filters.serviceIds.length && !filters.serviceIds.includes(row.service_id ?? "")) continue;
        if (filters.attendantIds.length && !filters.attendantIds.includes(row.attendant_id ?? "")) continue;
        if (filters.tunnels.length && !filters.tunnels.includes(row.tunnel?.trim() || "__NULL__")) continue;
        if (filters.origins.length && !filters.origins.some(origin => normalizeText(origin) === normalizeText(row.origin))) continue;
        const profile = Array.isArray(row.instagram_users) ? row.instagram_users[0] : row.instagram_users;
        if (profile?.client_id && row.started_at >= range.startAt) activeClients.add(profile.client_id);
        const profilePaidAt = profile?.last_meta_ad_id && profile.last_paid_attribution_at && profile.last_paid_attribution_at < range.endAt ? profile.last_paid_attribution_at : null;
        const paidAt = referrals.get(row.instagram_user_id) ?? profilePaidAt;
        if (!paidAt) continue;
        const enteredAt = paidAt > row.started_at ? paidAt : row.started_at;
        const entry: PaidWhatsappCohortEntry = { enteredAt, platform: "meta_ads", evidence: "origin", sourceField: "conversation_origin", sourceValue: "Meta Ads · Instagram" };
        if (!paidProfiles.has(row.instagram_user_id) || enteredAt < paidProfiles.get(row.instagram_user_id)!.enteredAt) paidProfiles.set(row.instagram_user_id, entry);
        if (!profile?.client_id) unlinked.add(row.instagram_user_id);
        else if (!paidClients.has(profile.client_id) || enteredAt < paidClients.get(profile.client_id)!.enteredAt) paidClients.set(profile.client_id, entry);
    }
    return { activeClients, paidClients, paidProfiles, unlinkedPaidProfiles: unlinked.size };
}

async function loadPipelineCandidateIds(range: DashboardDateRange, signal: AbortSignal) {
    const ids = new Set<string>();
    const start = range.startDate ?? saoPauloDate(range.startAt);
    const end = range.endDate ?? saoPauloDate(range.endAt);
    await Promise.all(["conversations", "schedules", "funnel_clinisys_events", "appointments", "clinisys_invoices"].map(async table => {
        for (let from = 0; ; from += PAGE_SIZE) {
            let query = supabase.from(table).select("client_id");
            if (table === "conversations") query = query.eq("channel", "WhatsApp").gte("started_at", range.startAt).lt("started_at", range.endAt);
            else if (table === "appointments") query = query.or(`and(created_at.gte.${range.startAt},created_at.lt.${range.endAt}),and(starts_at.gte.${range.startAt},starts_at.lt.${range.endAt})`);
            else if (table === "clinisys_invoices") query = query.gte("issued_at", range.startAt).lt("issued_at", range.endAt);
            else query = query.or(`${procedureCreationDateFilter(start, addDaysToDateString(end, 1))},and(scheduled_for.gte.${start},scheduled_for.lte.${end})`);
            const { data, error } = await query.order(table === "clinisys_invoices" ? "source_invoice_id" : "id")
                .range(from, from + PAGE_SIZE - 1).abortSignal(signal);
            if (error) throw error;
            for (const row of data ?? []) if (row.client_id) ids.add(row.client_id);
            if ((data?.length ?? 0) < PAGE_SIZE) break;
        }
    }));
    return ids;
}

async function loadPaidWhatsappHistory(clientIds: string[], range: DashboardDateRange, filters: DashboardFilters, signal: AbortSignal) {
    const results = await mapWithConcurrency(chunk(clientIds, 250), CLINISYS_QUERY_CONCURRENCY,
        ids => loadPaidWhatsappConversations(range, filters, signal, ids));
    return {
        rows: results.flatMap(result => result.rows),
        acceptedRows: results.flatMap(result => result.acceptedRows),
        organicClientIds: [...new Set(results.flatMap(result => result.organicClientIds))],
        paidEntries: results.flatMap(result => result.paidEntries),
        coverage: emptyWhatsappCoverage(),
    };
}

async function loadHistoricalTintimAttribution(clientIds: string[], signal: AbortSignal) {
    const byClient = new Map<string, Array<{ id: number; occurred_at: string; source: string | null; platform: PaidMediaPlatform | null }>>();
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase.from("tintim_attribution_events")
            .select("id,client_id,occurred_at,source,platform").in("client_id", clientIds)
            .order("occurred_at").order("id").range(from, from + PAGE_SIZE - 1).abortSignal(signal);
        if (error) throw error;
        for (const row of data ?? []) {
            const events = byClient.get(row.client_id) ?? [];
            events.push(row);
            byClient.set(row.client_id, events);
        }
        if ((data?.length ?? 0) < PAGE_SIZE) break;
    }
    return (conversations: WhatsappConversationSourceRow[]) => {
    const result = new Map<string, TintimConversationAttributionRow>();
    for (const conversation of conversations) {
        const at = new Date(conversation.started_at).getTime();
        const nearest = (byClient.get(conversation.client_id ?? "") ?? [])
            .map(event => ({ event, distance: Math.abs(new Date(event.occurred_at).getTime() - at) }))
            .filter(match => match.distance <= 2 * 86_400_000)
            .sort((a, b) => a.distance - b.distance || Number(b.event.id) - Number(a.event.id))[0];
        if (nearest) result.set(conversation.id, normalizeTintimAttribution({ ...nearest.event, conversation_id: conversation.id }));
    }
    return result;
    };
}

async function loadHubAppointmentRows(clientIds: string[], signal: AbortSignal) {
    const rows: PipelineProcedureEventRow[] = [];
    const { data: clients, error: clientError } = await supabase.from("clients").select("id,phone,phone_identity").in("id", clientIds).abortSignal(signal);
    if (clientError) throw clientError;
    const byPhone = new Map<string, string | null>();
    const normalize = (value: string | null) => (value ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    for (const client of clients ?? []) for (const value of [client.phone, client.phone_identity]) {
        const phone = normalize(value);
        if (!phone) continue;
        byPhone.set(phone, byPhone.has(phone) && byPhone.get(phone) !== client.id ? null : client.id);
    }
    const phones = [...byPhone.keys()].flatMap(phone => [phone, "55" + phone, "+55" + phone]);
    const seen = new Set<string>();
    for (const phoneBatch of [null, ...chunk(phones, ID_FILTER_BATCH_SIZE)]) {
        for (let from = 0; ; from += PAGE_SIZE) {
            let query = supabase.from("appointments").select("id,client_id,source_external_id,created_at,starts_at,status,procedure_name,patient_phone,units(name)");
            query = phoneBatch ? query.is("client_id", null).in("patient_phone", phoneBatch) : query.in("client_id", clientIds);
            const { data, error } = await query.order("id").range(from, from + PAGE_SIZE - 1).abortSignal(signal);
            if (error) throw error;
            for (const row of data ?? []) {
                if (seen.has(row.id)) continue;
                const clientId = row.client_id ?? byPhone.get(normalize(row.patient_phone));
                if (!clientId) continue;
                seen.add(row.id);
                const unit = Array.isArray(row.units) ? row.units[0] : row.units;
                rows.push({
                    source_table: "appointments", source_external_id: row.source_external_id,
                    source_hash: row.source_external_id ? null : `hub:${row.id}`, client_id: clientId,
                    created_in_source_at: null, created_at: row.created_at, scheduled_for: saoPauloDate(row.starts_at),
                    status: ({ completed: "Atendido", confirmed: "Não", scheduled: "Não", cancelled: "Desmarcou", no_show: "Faltou" } as Record<string, string>)[row.status] ?? row.status,
                    procedure_name: row.procedure_name, event_kind: null, unit_name: unit?.name ?? null,
                });
            }
            if ((data?.length ?? 0) < PAGE_SIZE) break;
        }
    }
    return rows;
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
            const [scheduleRows, funnelEventRows, appointmentRows] = await Promise.all([
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
                loadHubAppointmentRows(ids, signal),
            ]);
            return { scheduleRows: [...scheduleRows, ...appointmentRows], funnelEventRows };
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
        ? pipelineCalendarDate(effectiveCreatedAt)
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
        booking_channel: current.booking_channel ?? candidate.booking_channel,
        booking_social_id: current.booking_social_id ?? candidate.booking_social_id,
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
    procedureScheduledClients?: number;
    procedureAttendedClients?: number;
    consultationToProcedureClients?: number;
    entryClientsTotal?: number;
    whatsappToConsultationClients?: number;
    revenueBranches?: Array<{ kind: string; clients: number; amount: number }>;
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
        stage("scheduled", "Agendaram Consulta", values.scheduledClients),
        stage("attended", "Compareceram", values.attendedClients),
        stage("procedure_scheduled", "Agendaram Procedimento", values.procedureScheduledClients ?? 0),
        stage("procedure_attended", "Compareceram", values.procedureAttendedClients ?? 0),
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
        revenue_branches: values.revenueBranches ?? [],
        platform_breakdown: values.platformBreakdown,
        transitions: [
            transition("whatsapp_to_schedule", "Rastreado → agenda", values.whatsappClients, values.whatsappToConsultationClients ?? values.scheduledClients, false, true),
            transition("schedule_to_attendance", "Agenda → presença", values.scheduledClients, values.attendedClients, false, true),
            transition("consultation_to_procedure", "Consulta → procedimento", values.attendedClients, values.consultationToProcedureClients ?? 0, false, true),
            transition("procedure_to_attendance", "Procedimento → presença", values.procedureScheduledClients ?? 0, values.procedureAttendedClients ?? 0, false, true),
        ],
        audit: {
            entry_clients_total: values.entryClientsTotal ?? values.whatsappClients,
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
    identifiedClients: number,
    paidClients: number,
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
        identified_clients: identifiedClients,
        paid_clients: paidClients,
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
        identified_clients: 0,
        paid_clients: 0,
        tracking_rate: null,
        google_conversations: 0,
        meta_conversations: 0,
        other_conversations: 0,
        untracked_conversations: 0,
    };
}

function buildTrackedSourceBreakdown(
    cohort: Map<string, PaidWhatsappCohortEntry>,
    scheduledClients: Set<string>,
    attendedClients: Set<string>,
): FullJourneyPipeline["audit"]["tracked_sources"] {
    const sources = new Map<
        string,
        {
            platform: PaidMediaPlatform;
            field: PaidWhatsappEntry["source_field"];
            source: string;
            clients: number;
            scheduled_clients: number;
            attended_clients: number;
        }
    >();
    for (const [clientId, entry] of cohort) {
        if (!entry.platform) continue;
        const key = [entry.platform, entry.sourceField, normalizeText(entry.sourceValue)].join(":");
        const current = sources.get(key) ?? {
            platform: entry.platform,
            field: entry.sourceField,
            source: entry.sourceValue,
            clients: 0,
            scheduled_clients: 0,
            attended_clients: 0,
        };
        current.clients += 1;
        if (scheduledClients.has(clientId)) current.scheduled_clients += 1;
        if (attendedClients.has(clientId)) current.attended_clients += 1;
        sources.set(key, current);
    }
    return [...sources.values()]
        .map((source) => ({
            ...source,
            percentage: percentage(source.clients, cohort.size) ?? 0,
            schedule_rate: percentage(source.scheduled_clients, source.clients),
            attendance_rate: percentage(source.attended_clients, source.clients),
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
        const outcome = entry.platform ? outcomes.get(entry.platform) : null;
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
        const outcome = entry.platform ? outcomes.get(entry.platform) : null;
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
