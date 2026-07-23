// lib/ai/assistantPaidMediaTool.ts
import { supabase } from "@/lib";
import {
    paidMediaPlatformFromOrigin,
    paidMediaPlatformFromTrackingSource,
} from "@/lib/ads/paidMediaAttribution";
import {
    normalizeScheduleStatus,
    scheduleShowedUp,
} from "@/lib/schedules/status";

type JsonRecord = Record<string, unknown>;
type PaidMediaPlatform = "google_ads" | "meta_ads";
type PaidMediaPlatformFilter = PaidMediaPlatform | "all";

type AdMetricRow = {
    platform: PaidMediaPlatform;
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

type OutcomeInvoiceRow = {
    source_invoice_id: number | string;
    client_id: string | null;
    issued_at: string;
    amount: number | string;
    status: string;
};

type OutcomeScheduleRow = {
    client_id: string | null;
};

type ClientAttributionRow = {
    id: string;
    last_origin: string | null;
    utm_source: string | null;
    gclid: string | null;
    gbraid: string | null;
    wbraid: string | null;
    fbclid: string | null;
    fbc: string | null;
    ctwa_clid: string | null;
};

type JourneyConversationSourceRow = {
    client_id: string | null;
    started_at: string;
    origin: string | null;
    clients:
        | { last_origin: string | null }
        | Array<{ last_origin: string | null }>
        | null;
};

type PaidJourneyConversation = {
    client_id: string | null;
    started_at: string;
    origin: string;
    platform: PaidMediaPlatform;
};

type JourneyScheduleRow = {
    client_id: string | null;
    created_in_source_at: string | null;
    scheduled_for: string;
    status: string | null;
};

type JourneyInvoiceRow = {
    client_id: string | null;
    issued_at: string;
    amount: number | string;
    status: string;
};

type AttributedOutcome = {
    revenue: number;
    schedules: number;
    billedPatients: Set<string>;
    revenueEvents: Array<{ issuedAt: string; amount: number }>;
};

const PAGE_SIZE = 1_000;
const MAX_ROWS = 25_000;
const ID_FILTER_BATCH_SIZE = 100;
const TIME_ZONE = "America/Sao_Paulo";
const PLATFORMS: PaidMediaPlatform[] = ["google_ads", "meta_ads"];

export async function getPaidMediaOverview(args: JsonRecord) {
    const requestedFrom = validDateArg(args, "date_from") ?? dateDaysAgo(30);
    const requestedTo = validDateArg(args, "date_to") ?? todayInBrazil();
    const dateFrom = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
    const dateTo = requestedFrom <= requestedTo ? requestedTo : requestedFrom;
    const platform = platformArg(args.platform);
    const campaignLimit = integerArg(args.top_campaigns_limit, 10, 1, 20);
    const previousPeriod = precedingPeriod(dateFrom, dateTo);

    const [
        metrics,
        previousMetrics,
        invoices,
        previousInvoices,
        schedules,
        previousSchedules,
        paidConversations,
    ] = await Promise.all([
        loadAdMetrics(dateFrom, dateTo, platform),
        loadAdMetrics(
            previousPeriod.dateFrom,
            previousPeriod.dateTo,
            platform,
        ),
        loadOutcomeInvoices(dateFrom, dateTo),
        loadOutcomeInvoices(
            previousPeriod.dateFrom,
            previousPeriod.dateTo,
        ),
        loadOutcomeSchedules(dateFrom, dateTo),
        loadOutcomeSchedules(
            previousPeriod.dateFrom,
            previousPeriod.dateTo,
        ),
        loadPaidJourneyConversations(dateFrom, dateTo, platform),
    ]);

    const attributionClientIds = [
        ...invoices.map((invoice) => invoice.client_id),
        ...previousInvoices.map((invoice) => invoice.client_id),
        ...schedules.map((schedule) => schedule.client_id),
        ...previousSchedules.map((schedule) => schedule.client_id),
    ].filter((id): id is string => Boolean(id));
    const clients = await loadClientAttribution(attributionClientIds);
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const outcomes = buildAttributedOutcomes(
        invoices,
        schedules,
        clientsById,
        platform,
    );
    const previousOutcomes = buildAttributedOutcomes(
        previousInvoices,
        previousSchedules,
        clientsById,
        platform,
    );
    const currentSnapshot = buildPaidMediaSnapshot(
        metrics,
        outcomes,
        platform,
    );
    const previousSnapshot = buildPaidMediaSnapshot(
        previousMetrics,
        previousOutcomes,
        platform,
    );
    const cohort = buildJourneyCohort(paidConversations);
    const [journeySchedules, journeyInvoices] = await Promise.all([
        loadJourneySchedules([...cohort.keys()]),
        loadJourneyInvoices([...cohort.keys()]),
    ]);
    const pipeline = buildPaidJourneyPipeline({
        metrics,
        conversations: paidConversations,
        cohort,
        schedules: journeySchedules,
        invoices: journeyInvoices,
    });
    const lastSyncedAt = metrics.reduce<string | null>(
        (latest, row) =>
            !latest || row.synced_at > latest ? row.synced_at : latest,
        null,
    );

    return {
        output: {
            ok: true,
            source: {
                paid_media: "Google Ads API + Meta Marketing API",
                business_outcomes: "Agendamentos e NFS-e do CliniSys",
                whatsapp_attribution:
                    "Tag Origem da conversa; usa a Origem atual do cliente quando a conversa não possui a tag",
            },
            period: {
                date_from: dateFrom,
                date_to: dateTo,
                timezone: TIME_ZONE,
                platform:
                    platform === "all" ? "Google Ads + Meta Ads" : platformLabel(platform),
            },
            totals: currentSnapshot.totals,
            previous_period: {
                date_from: previousPeriod.dateFrom,
                date_to: previousPeriod.dateTo,
                totals: previousSnapshot.totals,
            },
            change_from_previous_period: buildSnapshotChanges(
                currentSnapshot.totals,
                previousSnapshot.totals,
            ),
            by_platform: currentSnapshot.byPlatform,
            top_campaigns: buildTopCampaigns(metrics, campaignLimit),
            evolution: buildPaidMediaEvolution(
                metrics,
                outcomes,
                dateFrom,
                dateTo,
            ),
            journey_pipeline: pipeline,
            coverage: {
                ad_metric_rows: metrics.length,
                invoices_read: invoices.length,
                schedules_read: schedules.length,
                paid_origin_conversations: paidConversations.length,
                ad_metrics_truncated: metrics.length >= MAX_ROWS,
                invoices_truncated: invoices.length >= MAX_ROWS,
                schedules_truncated: schedules.length >= MAX_ROWS,
                conversations_truncated: paidConversations.length >= MAX_ROWS,
                last_ads_synced_at: lastSyncedAt,
            },
            metric_definitions: {
                attributed_revenue:
                    "Soma das NFS-e autorizadas de clientes identificados como Google Ads ou Meta Ads; não é a receita declarada pelas plataformas.",
                return_on_spend:
                    "Receita atribuída do CliniSys dividida pelo investimento em mídia.",
                reported_conversions:
                    "Conversões informadas pelas próprias plataformas segundo a configuração de cada conta.",
                cost_per_schedule:
                    "Investimento dividido pelos agendamentos vinculados a clientes atribuídos à mídia paga.",
                click_to_whatsapp:
                    "Taxa aproximada: cliques são agregados pelas plataformas e WhatsApp conta clientes únicos pela tag Origem.",
                pipeline_cohort:
                    "Clientes que iniciaram conversa no período com Origem Google/Meta; cada etapa posterior exige o mesmo cliente e respeita a ordem cronológica.",
            },
        },
        cards: [],
    };
}

async function loadAdMetrics(
    dateFrom: string,
    dateTo: string,
    platform: PaidMediaPlatformFilter,
) {
    const rows: AdMetricRow[] = [];

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        let query = supabase
            .from("ad_daily_metrics")
            .select(
                "platform, account_name, campaign_id, campaign_name, metric_date, currency_code, impressions, clicks, spend, reported_conversions, reported_conversion_value, reported_conversion_type, synced_at",
            )
            .gte("metric_date", dateFrom)
            .lte("metric_date", dateTo)
            .order("metric_date", { ascending: true })
            .order("platform", { ascending: true })
            .order("campaign_id", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (platform !== "all") query = query.eq("platform", platform);

        const { data, error } = await query;
        if (error) {
            throw new Error(`Falha ao carregar mídia paga: ${error.message}`);
        }

        const page = (data ?? []) as AdMetricRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadOutcomeInvoices(dateFrom: string, dateTo: string) {
    const rows: OutcomeInvoiceRow[] = [];

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("clinisys_invoices")
            .select("source_invoice_id, client_id, issued_at, amount, status")
            .gte("issued_at", brazilDayBoundary(dateFrom))
            .lt("issued_at", brazilDayBoundary(addDays(dateTo, 1)))
            .order("issued_at", { ascending: true })
            .order("source_invoice_id", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            throw new Error(
                `Falha ao carregar faturamento atribuído: ${error.message}`,
            );
        }

        const page = (data ?? []) as OutcomeInvoiceRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadOutcomeSchedules(dateFrom: string, dateTo: string) {
    const rows: OutcomeScheduleRow[] = [];

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("schedules")
            .select("client_id")
            .gte("scheduled_for", dateFrom)
            .lte("scheduled_for", dateTo)
            .order("scheduled_for", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            throw new Error(
                `Falha ao carregar agendamentos atribuídos: ${error.message}`,
            );
        }

        const page = (data ?? []) as OutcomeScheduleRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadClientAttribution(clientIds: string[]) {
    const rows: ClientAttributionRow[] = [];
    const uniqueIds = [...new Set(clientIds)];

    for (const ids of chunk(uniqueIds, ID_FILTER_BATCH_SIZE)) {
        const { data, error } = await supabase
            .from("clients")
            .select(
                "id, last_origin, utm_source, gclid, gbraid, wbraid, fbclid, fbc, ctwa_clid",
            )
            .in("id", ids);

        if (error) {
            throw new Error(
                `Falha ao carregar atribuição dos clientes: ${error.message}`,
            );
        }
        rows.push(...((data ?? []) as ClientAttributionRow[]));
    }

    return rows;
}

async function loadPaidJourneyConversations(
    dateFrom: string,
    dateTo: string,
    platform: PaidMediaPlatformFilter,
) {
    const conversations: PaidJourneyConversation[] = [];

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("conversations")
            .select(
                "client_id, started_at, origin, clients!conversations_client_id_fkey(last_origin)",
            )
            .gte("started_at", brazilDayBoundary(dateFrom))
            .lt("started_at", brazilDayBoundary(addDays(dateTo, 1)))
            .order("started_at", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            throw new Error(
                `Falha ao carregar a entrada do WhatsApp: ${error.message}`,
            );
        }

        const page = (data ?? []) as unknown as JourneyConversationSourceRow[];
        for (const conversation of page) {
            const client = relationOne(conversation.clients);
            const origin =
                conversation.origin?.trim() ||
                client?.last_origin?.trim() ||
                "";
            const originPlatform = paidMediaPlatformFromOrigin(origin);

            if (!originPlatform) continue;
            if (platform !== "all" && originPlatform !== platform) continue;

            conversations.push({
                client_id: conversation.client_id,
                started_at: conversation.started_at,
                origin,
                platform: originPlatform,
            });
        }

        if (page.length < PAGE_SIZE) break;
    }

    return conversations;
}

async function loadJourneySchedules(clientIds: string[]) {
    const rows: JourneyScheduleRow[] = [];

    for (const ids of chunk(clientIds, ID_FILTER_BATCH_SIZE)) {
        for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
            const { data, error } = await supabase
                .from("schedules")
                .select(
                    "client_id, created_in_source_at, scheduled_for, status",
                )
                .in("client_id", ids)
                .order("scheduled_for", { ascending: true })
                .range(offset, offset + PAGE_SIZE - 1);

            if (error) {
                throw new Error(
                    `Falha ao carregar a jornada de agendamentos: ${error.message}`,
                );
            }

            const page = (data ?? []) as JourneyScheduleRow[];
            rows.push(...page);
            if (page.length < PAGE_SIZE) break;
        }
    }

    return rows;
}

async function loadJourneyInvoices(clientIds: string[]) {
    const rows: JourneyInvoiceRow[] = [];

    for (const ids of chunk(clientIds, ID_FILTER_BATCH_SIZE)) {
        for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
            const { data, error } = await supabase
                .from("clinisys_invoices")
                .select("client_id, issued_at, amount, status")
                .in("client_id", ids)
                .order("issued_at", { ascending: true })
                .range(offset, offset + PAGE_SIZE - 1);

            if (error) {
                throw new Error(
                    `Falha ao carregar a jornada de faturamento: ${error.message}`,
                );
            }

            const page = (data ?? []) as JourneyInvoiceRow[];
            rows.push(...page);
            if (page.length < PAGE_SIZE) break;
        }
    }

    return rows;
}

function buildAttributedOutcomes(
    invoices: OutcomeInvoiceRow[],
    schedules: OutcomeScheduleRow[],
    clientsById: Map<string, ClientAttributionRow>,
    platformFilter: PaidMediaPlatformFilter,
) {
    const outcomes = new Map<PaidMediaPlatform, AttributedOutcome>(
        PLATFORMS.map((platform) => [platform, emptyAttributedOutcome()]),
    );

    for (const invoice of invoices) {
        if (
            !invoice.client_id ||
            financialStatusGroup(invoice.status) !== "authorized"
        ) {
            continue;
        }

        const platform = resolveClientAdPlatform(
            clientsById.get(invoice.client_id),
        );
        if (!platform || !platformSelected(platform, platformFilter)) continue;

        const outcome = outcomes.get(platform)!;
        const amount = numeric(invoice.amount);
        outcome.revenue += amount;
        outcome.billedPatients.add(invoice.client_id);
        outcome.revenueEvents.push({
            issuedAt: invoice.issued_at,
            amount,
        });
    }

    for (const schedule of schedules) {
        if (!schedule.client_id) continue;
        const platform = resolveClientAdPlatform(
            clientsById.get(schedule.client_id),
        );
        if (!platform || !platformSelected(platform, platformFilter)) continue;
        outcomes.get(platform)!.schedules += 1;
    }

    return outcomes;
}

function buildPaidMediaSnapshot(
    metrics: AdMetricRow[],
    outcomes: Map<PaidMediaPlatform, AttributedOutcome>,
    platformFilter: PaidMediaPlatformFilter,
) {
    const selectedPlatforms = PLATFORMS.filter((platform) =>
        platformSelected(platform, platformFilter),
    );
    const totalOutcome = selectedPlatforms.reduce<AttributedOutcome>(
        (total, platform) => {
            const outcome = outcomes.get(platform)!;
            total.revenue += outcome.revenue;
            total.schedules += outcome.schedules;
            for (const clientId of outcome.billedPatients) {
                total.billedPatients.add(clientId);
            }
            total.revenueEvents.push(...outcome.revenueEvents);
            return total;
        },
        emptyAttributedOutcome(),
    );

    return {
        totals: summarizePaidMedia(metrics, totalOutcome),
        byPlatform: selectedPlatforms
            .map((platform) => ({
                platform,
                label: platformLabel(platform),
                ...summarizePaidMedia(
                    metrics.filter((metric) => metric.platform === platform),
                    outcomes.get(platform)!,
                ),
            }))
            .filter(
                (item) =>
                    item.spend > 0 ||
                    item.impressions > 0 ||
                    item.clicks > 0 ||
                    item.reported_conversions > 0,
            ),
    };
}

function summarizePaidMedia(
    metrics: AdMetricRow[],
    outcome: AttributedOutcome,
) {
    const spend = sumMetric(metrics, "spend");
    const impressions = sumMetric(metrics, "impressions");
    const clicks = sumMetric(metrics, "clicks");
    const reportedConversions = sumMetric(metrics, "reported_conversions");
    const reportedConversionValue = sumMetric(
        metrics,
        "reported_conversion_value",
    );

    return {
        spend: money(spend),
        attributed_revenue: money(outcome.revenue),
        return_on_spend: ratio(outcome.revenue, spend),
        schedules: outcome.schedules,
        billed_patients: outcome.billedPatients.size,
        cost_per_schedule: moneyPer(spend, outcome.schedules),
        cost_per_billed_patient: moneyPer(
            spend,
            outcome.billedPatients.size,
        ),
        impressions: Math.trunc(impressions),
        clicks: Math.trunc(clicks),
        click_through_rate: percentage(clicks, impressions),
        cost_per_click: moneyPer(spend, clicks),
        reported_conversions: roundMetric(reportedConversions),
        reported_conversion_value: money(reportedConversionValue),
        cost_per_reported_conversion: moneyPer(
            spend,
            reportedConversions,
        ),
        currency_codes: [...new Set(metrics.map((row) => row.currency_code))],
    };
}

function buildTopCampaigns(metrics: AdMetricRow[], limit: number) {
    const campaigns = new Map<
        string,
        {
            platform: PaidMediaPlatform;
            accountName: string;
            campaignName: string;
            spend: number;
            impressions: number;
            clicks: number;
            conversions: number;
            conversionValue: number;
            conversionTypes: Set<string>;
        }
    >();

    for (const metric of metrics) {
        const key = `${metric.platform}:${metric.campaign_id}`;
        const campaign = campaigns.get(key) ?? {
            platform: metric.platform,
            accountName: metric.account_name,
            campaignName: metric.campaign_name,
            spend: 0,
            impressions: 0,
            clicks: 0,
            conversions: 0,
            conversionValue: 0,
            conversionTypes: new Set<string>(),
        };
        campaign.accountName = metric.account_name;
        campaign.campaignName = metric.campaign_name;
        campaign.spend += numeric(metric.spend);
        campaign.impressions += numeric(metric.impressions);
        campaign.clicks += numeric(metric.clicks);
        campaign.conversions += numeric(metric.reported_conversions);
        campaign.conversionValue += numeric(metric.reported_conversion_value);
        if (metric.reported_conversion_type) {
            campaign.conversionTypes.add(metric.reported_conversion_type);
        }
        campaigns.set(key, campaign);
    }

    return [...campaigns.values()]
        .map((campaign) => ({
            platform: campaign.platform,
            platform_label: platformLabel(campaign.platform),
            account_name: campaign.accountName,
            campaign_name: campaign.campaignName,
            spend: money(campaign.spend),
            impressions: Math.trunc(campaign.impressions),
            clicks: Math.trunc(campaign.clicks),
            click_through_rate: percentage(
                campaign.clicks,
                campaign.impressions,
            ),
            cost_per_click: moneyPer(campaign.spend, campaign.clicks),
            reported_conversions: roundMetric(campaign.conversions),
            reported_conversion_value: money(campaign.conversionValue),
            reported_conversion_types: [...campaign.conversionTypes],
            cost_per_reported_conversion: moneyPer(
                campaign.spend,
                campaign.conversions,
            ),
        }))
        .sort(
            (first, second) =>
                second.spend - first.spend ||
                second.reported_conversions - first.reported_conversions,
        )
        .slice(0, limit);
}

function buildPaidMediaEvolution(
    metrics: AdMetricRow[],
    outcomes: Map<PaidMediaPlatform, AttributedOutcome>,
    dateFrom: string,
    dateTo: string,
) {
    const durationDays = calendarDaysBetween(dateFrom, dateTo) + 1;
    const resolution =
        durationDays <= 45 ? "day" : durationDays <= 180 ? "week" : "month";
    const buckets = new Map<
        string,
        {
            spend: number;
            googleSpend: number;
            metaSpend: number;
            attributedRevenue: number;
            impressions: number;
            clicks: number;
        }
    >();

    for (const metric of metrics) {
        const period = periodKey(metric.metric_date, resolution);
        const bucket = buckets.get(period) ?? emptyEvolutionBucket();
        const spend = numeric(metric.spend);
        bucket.spend += spend;
        bucket.impressions += numeric(metric.impressions);
        bucket.clicks += numeric(metric.clicks);
        if (metric.platform === "google_ads") bucket.googleSpend += spend;
        if (metric.platform === "meta_ads") bucket.metaSpend += spend;
        buckets.set(period, bucket);
    }

    for (const outcome of outcomes.values()) {
        for (const event of outcome.revenueEvents) {
            const period = periodKey(
                saoPauloDate(event.issuedAt),
                resolution,
            );
            const bucket = buckets.get(period) ?? emptyEvolutionBucket();
            bucket.attributedRevenue += event.amount;
            buckets.set(period, bucket);
        }
    }

    return [...buckets.entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([period, bucket]) => ({
            period,
            spend: money(bucket.spend),
            google_spend: money(bucket.googleSpend),
            meta_spend: money(bucket.metaSpend),
            attributed_revenue: money(bucket.attributedRevenue),
            impressions: Math.trunc(bucket.impressions),
            clicks: Math.trunc(bucket.clicks),
        }));
}

function buildJourneyCohort(conversations: PaidJourneyConversation[]) {
    const cohort = new Map<string, string>();

    for (const conversation of conversations) {
        if (!conversation.client_id) continue;
        const current = cohort.get(conversation.client_id);
        if (!current || conversation.started_at < current) {
            cohort.set(conversation.client_id, conversation.started_at);
        }
    }

    return cohort;
}

function buildPaidJourneyPipeline({
    metrics,
    conversations,
    cohort,
    schedules,
    invoices,
}: {
    metrics: AdMetricRow[];
    conversations: PaidJourneyConversation[];
    cohort: Map<string, string>;
    schedules: JourneyScheduleRow[];
    invoices: JourneyInvoiceRow[];
}) {
    const scheduledClients = new Set<string>();
    const attendedAtByClient = new Map<string, string>();

    for (const schedule of schedules) {
        if (!schedule.client_id) continue;
        const enteredAt = cohort.get(schedule.client_id);
        if (!enteredAt) continue;

        const enteredDate = saoPauloDate(enteredAt);
        const createdDate =
            schedule.created_in_source_at ?? schedule.scheduled_for;
        if (!createdDate || createdDate < enteredDate) continue;

        scheduledClients.add(schedule.client_id);

        if (!scheduleShowedUp(normalizeScheduleStatus(schedule.status))) {
            continue;
        }
        if (schedule.scheduled_for < enteredDate) continue;

        const current = attendedAtByClient.get(schedule.client_id);
        if (!current || schedule.scheduled_for < current) {
            attendedAtByClient.set(
                schedule.client_id,
                schedule.scheduled_for,
            );
        }
    }

    const invoicedClients = new Set<string>();
    const authorizedClients = new Set<string>();
    let invoicedAmount = 0;
    let authorizedAmount = 0;

    for (const invoice of invoices) {
        if (!invoice.client_id) continue;
        const attendedDate = attendedAtByClient.get(invoice.client_id);
        if (!attendedDate || saoPauloDate(invoice.issued_at) < attendedDate) {
            continue;
        }

        const amount = numeric(invoice.amount);
        invoicedClients.add(invoice.client_id);
        invoicedAmount += amount;

        if (financialStatusGroup(invoice.status) === "authorized") {
            authorizedClients.add(invoice.client_id);
            authorizedAmount += amount;
        }
    }

    const impressions = sumMetric(metrics, "impressions");
    const clicks = sumMetric(metrics, "clicks");
    const stages = [
        journeyStage("paid_impressions", "Impressões pagas", impressions),
        journeyStage("paid_clicks", "Cliques pagos", clicks),
        journeyStage(
            "whatsapp",
            "WhatsApp",
            cohort.size,
            conversations.length,
            "conversas",
        ),
        journeyStage("scheduled", "Agendaram", scheduledClients.size),
        journeyStage("attended", "Compareceram", attendedAtByClient.size),
        journeyStage(
            "invoiced",
            "Faturados",
            invoicedClients.size,
            money(invoicedAmount),
            "BRL emitidos",
        ),
        journeyStage(
            "authorized",
            "Liberados",
            authorizedClients.size,
            money(authorizedAmount),
            "BRL autorizados",
        ),
    ];

    return {
        stages,
        transitions: [
            journeyTransition("CTR pago", impressions, clicks, false),
            journeyTransition("Clique → WhatsApp", clicks, cohort.size, true),
            journeyTransition(
                "WhatsApp → agenda",
                cohort.size,
                scheduledClients.size,
                false,
            ),
            journeyTransition(
                "Agenda → presença",
                scheduledClients.size,
                attendedAtByClient.size,
                false,
            ),
            journeyTransition(
                "Presença → faturamento",
                attendedAtByClient.size,
                invoicedClients.size,
                false,
            ),
            journeyTransition(
                "Faturamento → liberado",
                invoicedClients.size,
                authorizedClients.size,
                false,
            ),
        ],
        whatsapp_origins: buildJourneyOriginBreakdown(conversations),
        matured_through: todayInBrazil(),
    };
}

function buildJourneyOriginBreakdown(
    conversations: PaidJourneyConversation[],
) {
    const origins = new Map<
        string,
        {
            origin: string;
            platform: PaidMediaPlatform;
            conversations: number;
            clients: Set<string>;
        }
    >();

    for (const conversation of conversations) {
        const key = normalizeText(conversation.origin);
        const group = origins.get(key) ?? {
            origin: conversation.origin,
            platform: conversation.platform,
            conversations: 0,
            clients: new Set<string>(),
        };
        group.conversations += 1;
        if (conversation.client_id) group.clients.add(conversation.client_id);
        origins.set(key, group);
    }

    return [...origins.values()]
        .map((origin) => ({
            origin: origin.origin,
            platform: origin.platform,
            conversations: origin.conversations,
            clients: origin.clients.size,
        }))
        .sort(
            (first, second) =>
                second.clients - first.clients ||
                second.conversations - first.conversations,
        );
}

function buildSnapshotChanges(
    current: ReturnType<typeof summarizePaidMedia>,
    previous: ReturnType<typeof summarizePaidMedia>,
) {
    return {
        spend: percentageChange(current.spend, previous.spend),
        attributed_revenue: percentageChange(
            current.attributed_revenue,
            previous.attributed_revenue,
        ),
        return_on_spend: percentageChange(
            current.return_on_spend,
            previous.return_on_spend,
        ),
        schedules: percentageChange(current.schedules, previous.schedules),
        billed_patients: percentageChange(
            current.billed_patients,
            previous.billed_patients,
        ),
        impressions: percentageChange(
            current.impressions,
            previous.impressions,
        ),
        clicks: percentageChange(current.clicks, previous.clicks),
        reported_conversions: percentageChange(
            current.reported_conversions,
            previous.reported_conversions,
        ),
    };
}

function resolveClientAdPlatform(
    client: ClientAttributionRow | undefined,
): PaidMediaPlatform | null {
    if (!client) return null;

    const origin = client.last_origin?.trim();
    if (origin) return paidMediaPlatformFromOrigin(origin);

    const sourcePlatform = paidMediaPlatformFromTrackingSource(
        client.utm_source,
    );
    if (sourcePlatform) return sourcePlatform;

    const hasGoogleClick = Boolean(
        client.gclid || client.gbraid || client.wbraid,
    );
    const hasMetaClick = Boolean(
        client.fbclid || client.fbc || client.ctwa_clid,
    );
    if (hasGoogleClick && !hasMetaClick) return "google_ads";
    if (hasMetaClick && !hasGoogleClick) return "meta_ads";
    return null;
}

function financialStatusGroup(status: string) {
    const normalized = normalizeText(status).replace(/\s+/g, "");

    if (
        normalized.startsWith("autorizada") ||
        normalized.includes("cancelamentonegado") ||
        normalized.includes("cancelamentorejeitado")
    ) {
        return "authorized" as const;
    }
    if (normalized === "cancelada") return "cancelled" as const;
    if (normalized.includes("aguardando")) return "pending" as const;
    if (normalized.includes("negada")) return "denied" as const;
    return "other" as const;
}

function journeyStage(
    key: string,
    label: string,
    value: number,
    secondaryValue: number | null = null,
    secondaryLabel: string | null = null,
) {
    return {
        key,
        label,
        value: Math.trunc(value),
        secondary_value: secondaryValue,
        secondary_label: secondaryLabel,
    };
}

function journeyTransition(
    label: string,
    fromValue: number,
    toValue: number,
    estimated: boolean,
) {
    return {
        label,
        rate: percentage(toValue, fromValue),
        from_value: Math.trunc(fromValue),
        to_value: Math.trunc(toValue),
        estimated,
    };
}

function platformArg(value: unknown): PaidMediaPlatformFilter {
    return value === "google_ads" || value === "meta_ads" ? value : "all";
}

function platformSelected(
    platform: PaidMediaPlatform,
    filter: PaidMediaPlatformFilter,
) {
    return filter === "all" || platform === filter;
}

function platformLabel(platform: PaidMediaPlatform) {
    return platform === "google_ads" ? "Google Ads" : "Meta Ads";
}

function sumMetric(
    rows: AdMetricRow[],
    key:
        | "spend"
        | "impressions"
        | "clicks"
        | "reported_conversions"
        | "reported_conversion_value",
) {
    return rows.reduce((total, row) => total + numeric(row[key]), 0);
}

function emptyAttributedOutcome(): AttributedOutcome {
    return {
        revenue: 0,
        schedules: 0,
        billedPatients: new Set<string>(),
        revenueEvents: [],
    };
}

function emptyEvolutionBucket() {
    return {
        spend: 0,
        googleSpend: 0,
        metaSpend: 0,
        attributedRevenue: 0,
        impressions: 0,
        clicks: 0,
    };
}

function periodKey(
    dateValue: string,
    resolution: "day" | "week" | "month",
) {
    const date = dateValue.slice(0, 10);
    if (resolution === "day") return date;
    if (resolution === "month") return date.slice(0, 7);

    const monday = new Date(`${date}T12:00:00Z`);
    const weekDay = monday.getUTCDay();
    monday.setUTCDate(monday.getUTCDate() - (weekDay === 0 ? 6 : weekDay - 1));
    return monday.toISOString().slice(0, 10);
}

function precedingPeriod(dateFrom: string, dateTo: string) {
    const durationDays = calendarDaysBetween(dateFrom, dateTo) + 1;
    const previousTo = addDays(dateFrom, -1);
    return {
        dateFrom: addDays(previousTo, -(durationDays - 1)),
        dateTo: previousTo,
    };
}

function calendarDaysBetween(first: string, second: string) {
    return Math.round(
        (Date.parse(`${second}T12:00:00Z`) -
            Date.parse(`${first}T12:00:00Z`)) /
            86_400_000,
    );
}

function percentageChange(
    current: number | null,
    previous: number | null,
) {
    if (current === null || previous === null || previous === 0) return null;
    return Math.round(((current - previous) / Math.abs(previous)) * 10_000) / 100;
}

function percentage(value: number, total: number) {
    return total > 0 ? Math.round((value / total) * 10_000) / 100 : null;
}

function ratio(value: number, total: number) {
    return total > 0 ? Math.round((value / total) * 100) / 100 : null;
}

function moneyPer(value: number, total: number) {
    return total > 0 ? money(value / total) : null;
}

function money(value: number) {
    return Math.round(value * 100) / 100;
}

function roundMetric(value: number) {
    return Math.round(value * 100) / 100;
}

function numeric(value: number | string | null | undefined) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
    if (!value) return null;
    return Array.isArray(value) ? value[0] ?? null : value;
}

function validDateArg(args: JsonRecord, key: string) {
    const value = typeof args[key] === "string" ? args[key] : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function integerArg(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
        ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
        : fallback;
}

function dateDaysAgo(days: number) {
    return addDays(todayInBrazil(), -(Math.max(1, days) - 1));
}

function todayInBrazil() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

function saoPauloDate(value: string) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(value));
}

function brazilDayBoundary(date: string) {
    return `${date}T00:00:00-03:00`;
}

function addDays(date: string, days: number) {
    const [year, month, day] = date.split("-").map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day + days, 12));
    return cursor.toISOString().slice(0, 10);
}

function normalizeText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}
