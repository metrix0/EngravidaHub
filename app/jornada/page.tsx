// app/jornada/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import {
    ArrowRight,
    BadgeCheck,
    CalendarCheck2,
    CircleDollarSign,
    HelpCircle,
    MessageCircle,
    MousePointerClick,
    ReceiptText,
    UserCheck,
} from "lucide-react";
import { FaGoogle, FaMeta } from "react-icons/fa6";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Funnel,
    FunnelChart,
    LabelList,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import {
    applyArrayParams,
    applyCalendarDateParams,
} from "@/components/ui/CalendarButton";
import {
    Card,
    DashboardHeader,
    InfoTooltip,
    MainFilters,
    PercentageBar,
    SidePanel,
    Skeleton,
} from "@/components";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import { CUSTOMER_START_INTENT_LABELS } from "@/lib/conversationAnalysisLabels";
import type { FiltersResponse } from "@/types";

type JourneyDashboardData = {
    full_pipeline: FullJourneyPipeline;
    journey_funnel: {
        key: string;
        name: string;
        value: number;
        percentage: number | null;
        relative_percentage: number | null;
        fill: string;
    }[];
    dropoff_moments: {
        moment: string;
        label: string;
        count: number;
        percentage: number | null;
    }[];
    intent_paths: {
        intent: string;
        resolved: number;
        partial: number;
        not_resolved: number;
        abandoned: number;
    }[];
    objections: {
        type: string;
        label: string;
        value: number;
        percentage: number | null;
    }[];
    audit?: {
        conversations: number;
        clients: number;
        conversations_with_objections: number;
    } | null;
};

type PipelineStageKey =
    | "paid_impressions"
    | "paid_clicks"
    | "whatsapp"
    | "tracked_whatsapp"
    | "scheduled"
    | "attended"
    | "invoiced"
    | "authorized";

type TrackedWhatsappSourceField =
    | "conversation_origin"
    | "client_origin"
    | "utm_source"
    | "click_id";

type FullJourneyPipeline = {
    available: boolean;
    ads_available: boolean;
    ads_scope_global: boolean;
    filters_applied: boolean;
    currency_code: string;
    stages: {
        key: PipelineStageKey;
        label: string;
        value: number;
        secondary_value: number | null;
        secondary_kind: "count" | "currency" | null;
        secondary_label: string | null;
    }[];
    transitions: {
        key: string;
        label: string;
        rate: number | null;
        from_value: number;
        to_value: number;
        lost: number | null;
        estimated: boolean;
    }[];
    platform_breakdown: {
        platform: "google_ads" | "meta_ads";
        label: string;
        spend: number;
        whatsapp_clicks: number;
        platform_whatsapp_conversations: number;
        tracked_clients: number;
        scheduled_clients: number;
        attended_clients: number;
        invoiced_clients: number;
        authorized_clients: number;
        authorized_revenue: number;
    }[];
    audit: {
        platform_whatsapp_conversations: number;
        tracked_whatsapp_clients: number;
        measurement_ready: boolean;
        measurement_note: string | null;
        tracked_by_evidence: {
            evidence: "origin" | "utm_source" | "click_id";
            clients: number;
        }[];
        tracked_sources: {
            platform: "google_ads" | "meta_ads";
            field: TrackedWhatsappSourceField;
            source: string;
            clients: number;
            percentage: number;
        }[];
        whatsapp_coverage: {
            total_conversations: number;
            tracked_conversations: number;
            tracking_rate: number | null;
            google_conversations: number;
            meta_conversations: number;
            other_conversations: number;
            untracked_conversations: number;
        };
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

const EMPTY_PIPELINE: FullJourneyPipeline = {
    available: false,
    ads_available: false,
    ads_scope_global: true,
    filters_applied: false,
    currency_code: "BRL",
    stages: [],
    transitions: [],
    platform_breakdown: [],
    audit: {
        platform_whatsapp_conversations: 0,
        tracked_whatsapp_clients: 0,
        measurement_ready: false,
        measurement_note: null,
        tracked_by_evidence: [],
        tracked_sources: [],
        whatsapp_coverage: {
            total_conversations: 0,
            tracked_conversations: 0,
            tracking_rate: null,
            google_conversations: 0,
            meta_conversations: 0,
            other_conversations: 0,
            untracked_conversations: 0,
        },
        whatsapp_origins: [],
        cohort_start_date: "",
        cohort_end_date: "",
        matured_through: "",
        error: null,
    },
};

const EMPTY_DATA: JourneyDashboardData = {
    full_pipeline: EMPTY_PIPELINE,
    journey_funnel: [],
    dropoff_moments: [],
    intent_paths: [],
    objections: [],
    audit: null,
};

export default function JourneyPage() {
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [data, setData] = useState<JourneyDashboardData | null>(null);
    const hasDataRef = useRef(false);
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [attendantIds, setAttendantIds] = useState<string[]>([]);
    const [tunnelValues, setTunnelValues] = useState<string[]>([]);
    const [originValues, setOriginValues] = useState<string[]>([]);
    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("yesterday");
    const [loadingFilters, setLoadingFilters] = useState(true);
    const [loadingData, setLoadingData] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        async function loadFilters() {
            try {
                const response = await fetch(
                    "/api/dashboard/filters?entities=units,attendants,tunnels,origins",
                );
                const json: FiltersResponse = await response.json();
                setFilters(json);
            } finally {
                setLoadingFilters(false);
            }
        }

        void loadFilters();
    }, []);

    useEffect(() => {
        if (!dateFilterReady) return;

        const controller = new AbortController();

        async function loadData() {
            if (hasDataRef.current) setIsRefreshing(true);
            else setLoadingData(true);

            try {
                const params = new URLSearchParams();
                applyCalendarDateParams({
                    params,
                    selectedRange,
                    selectedPreset: period,
                });
                applyArrayParams(params, {
                    unit_ids: unitIds,
                    attendant_ids: attendantIds,
                    tunnels: tunnelValues,
                    origins: originValues,
                });

                const response = await fetch(
                    `/api/dashboard/jornada?${params.toString()}`,
                    { signal: controller.signal },
                );
                const json = await response.json();

                if (!response.ok) {
                    console.error("[jornada] failed to load dashboard", json);
                    setData(EMPTY_DATA);
                    return;
                }

                setData({
                    full_pipeline:
                        json.full_pipeline &&
                        Array.isArray(json.full_pipeline.stages) &&
                        Array.isArray(json.full_pipeline.transitions)
                            ? json.full_pipeline
                            : EMPTY_PIPELINE,
                    journey_funnel: Array.isArray(json.journey_funnel)
                        ? json.journey_funnel
                        : [],
                    dropoff_moments: Array.isArray(json.dropoff_moments)
                        ? json.dropoff_moments
                        : [],
                    intent_paths: Array.isArray(json.intent_paths)
                        ? json.intent_paths
                        : [],
                    objections: Array.isArray(json.objections)
                        ? json.objections
                        : [],
                    audit: json.audit ?? null,
                });
                hasDataRef.current = true;
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("[jornada] failed to load dashboard", error);
            } finally {
                if (!controller.signal.aborted) {
                    setLoadingData(false);
                    setIsRefreshing(false);
                }
            }
        }

        const debounceId = window.setTimeout(() => {
            void loadData();
        }, 150);

        return () => {
            window.clearTimeout(debounceId);
            controller.abort();
        };
    }, [
        unitIds,
        attendantIds,
        tunnelValues,
        originValues,
        period,
        selectedRange,
        dateFilterReady,
    ]);

    if (loadingFilters || loadingData) {
        return (
            <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
                <SidePanel />
                <section className="min-w-0 flex-1 px-8 py-8">
                    <JourneySkeleton />
                </section>
            </main>
        );
    }

    if (!data) {
        return (
            <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
                <SidePanel />
                <section className="min-w-0 flex-1 px-8 py-8">Nenhum dado encontrado.</section>
            </main>
        );
    }

    const current = data;

    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel />
            <section className="min-w-0 flex-1 px-8 py-8">
                <DashboardHeader
                    title="Jornada"
                    description="Entenda o caminho dos clientes ao longo do atendimento"
                    period={period}
                    setPeriod={setPeriod}
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                    storageManaged
                    storageReady={dateFilterReady}
                />

                <div className="mb-8 flex justify-end gap-3">
                    <MainFilters
                        units={filters?.units}
                        attendants={filters?.attendants}
                        tunnels={filters?.tunnels}
                        origins={filters?.origins}
                        unitValues={unitIds}
                        setUnitValues={setUnitIds}
                        attendantValues={attendantIds}
                        setAttendantValues={setAttendantIds}
                        tunnelValues={tunnelValues}
                        setTunnelValues={setTunnelValues}
                        originValues={originValues}
                        setOriginValues={setOriginValues}
                    />
                </div>

                {isRefreshing ? (
                    <JourneyBodySkeleton />
                ) : (
                    <div className="overflow-x-hidden pb-12">
                        <section className="mb-6 grid grid-cols-[1.7fr_0.8fr] gap-5">
                            <JourneyFunnelCard data={current} />
                            <DropoffCard data={current} />
                        </section>
                        <section className="grid grid-cols-[1.5fr_0.9fr] gap-5">
                            <IntentPathsCard data={current} />
                            <ObjectionsCard data={current} />
                        </section>
                        <section className="mt-6 min-w-0 max-w-full">
                            <FullJourneyPipelineCard data={current} />
                        </section>
                        <section className="mt-6 min-w-0 max-w-full">
                            <WhatsappCoverageCard
                                pipeline={current.full_pipeline}
                            />
                        </section>
                        <section className="mt-6 min-w-0 max-w-full">
                            <TrackedWhatsappSourcesCard
                                pipeline={current.full_pipeline}
                            />
                        </section>
                    </div>
                )}
            </section>
        </main>
    );
}

const PIPELINE_STAGE_STYLE: Record<
    PipelineStageKey,
    { accent: string; soft: string; eyebrow: string }
> = {
    paid_impressions: {
        accent: "#0866ff",
        soft: "#eaf2ff",
        eyebrow: "Aquisição",
    },
    paid_clicks: {
        accent: "#1683ff",
        soft: "#e5f1ff",
        eyebrow: "Aquisição",
    },
    whatsapp: {
        accent: "#16a66a",
        soft: "#e8fbf1",
        eyebrow: "Plataforma",
    },
    tracked_whatsapp: {
        accent: "#0f9f94",
        soft: "#e6f8f6",
        eyebrow: "CRM",
    },
    scheduled: {
        accent: "#8b5cf6",
        soft: "#f1ebff",
        eyebrow: "Conversão",
    },
    attended: {
        accent: "#0f9f94",
        soft: "#e6f8f6",
        eyebrow: "Clínica",
    },
    invoiced: {
        accent: "#d98916",
        soft: "#fff3df",
        eyebrow: "Receita",
    },
    authorized: {
        accent: "#0f9f61",
        soft: "#e6f8ef",
        eyebrow: "Receita",
    },
};

function FullJourneyPipelineCard({ data }: { data: JourneyDashboardData }) {
    const pipeline = data.full_pipeline;
    const clinicalTransitions = pipeline.transitions.filter(
        (transition) =>
            !transition.estimated &&
            transition.key !== "paid_ctr" &&
            transition.rate !== null,
    );
    const bottleneck = clinicalTransitions.reduce<
        FullJourneyPipeline["transitions"][number] | null
    >((current, transition) => {
        if (!current) return transition;
        return (transition.rate ?? Infinity) < (current.rate ?? Infinity)
            ? transition
            : current;
    }, null);
    const trackedWhatsappStage = pipeline.stages.find(
        (stage) => stage.key === "tracked_whatsapp",
    );
    const authorizedStage = pipeline.stages.find(
        (stage) => stage.key === "authorized",
    );
    const endToEndRate = calculateRate(
        authorizedStage?.value ?? 0,
        trackedWhatsappStage?.value ?? 0,
    );

    return (
        <Card className="min-w-0 overflow-hidden p-0">
            <div className="border-b border-slate-100 bg-white px-6 py-5">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-slate-900">
                            Jornada completa
                        </h2>
                        <InfoTooltip
                            text={buildPipelineSourceTooltip(pipeline)}
                            portal
                            widthClassName="w-[560px]"
                        >
                            <HelpCircle size={16} className="text-slate-400" />
                        </InfoTooltip>
                    </div>
                </div>
            </div>

            {pipeline.audit.error ? (
                <div className="border-b border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">
                    A jornada completa não pôde ser carregada: {pipeline.audit.error}
                </div>
            ) : null}

            {!pipeline.ads_available ? (
                <div className="border-b border-amber-100 bg-amber-50 px-6 py-3 text-sm text-amber-800">
                    Sem dados de Meta ou Google Ads neste período. As etapas do WhatsApp em diante continuam válidas.
                </div>
            ) : null}

            {pipeline.filters_applied ? (
                <div className="border-b border-blue-100 bg-blue-50 px-6 py-3 text-xs text-blue-800">
                    A medição das plataformas permanece global; os filtros selecionados valem do WhatsApp rastreado em diante.
                </div>
            ) : null}

            <div className="px-6 py-6">
                {pipeline.stages.length === 0 ? (
                    <EmptyCardMessage message="Nenhum dado rastreável no período." />
                ) : (
                    <div className="w-full overflow-x-auto pb-4">
                        <div className="flex min-w-max items-stretch">
                            {pipeline.stages.map((stage, index) => {
                                const transition = pipeline.transitions[index];
                                return (
                                    <div
                                        key={stage.key}
                                        className="flex shrink-0 items-stretch"
                                    >
                                        <PipelineStageCard stage={stage} />
                                        {transition ? (
                                            <PipelineTransitionCard
                                                transition={transition}
                                            />
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 md:grid-cols-3">
                    <PipelineInsight
                        label="Maior gargalo clínico"
                        value={
                            bottleneck
                                ? formatRate(bottleneck.rate)
                                : "—"
                        }
                        detail={
                            bottleneck
                                ? `${bottleneck.label}${
                                      bottleneck.lost === null
                                          ? ""
                                          : ` · ${bottleneck.lost} clientes não avançaram`
                                  }`
                                : "Sem base suficiente"
                        }
                    />
                    <PipelineInsight
                        label="Conversão ponta a ponta"
                        value={formatRate(endToEndRate)}
                        detail="WhatsApp rastreado → liberado"
                    />
                    <PipelineInsight
                        label="Receita liberada"
                        value={formatPipelineCurrency(
                            authorizedStage?.secondary_value ?? 0,
                            pipeline.currency_code,
                        )}
                        detail={`Desfechos observados até ${formatPipelineDate(
                            pipeline.audit.matured_through,
                        )}`}
                    />
                </div>
            </div>
        </Card>
    );
}

const TRACKED_WHATSAPP_PLATFORM_STYLE = {
    google_ads: {
        label: "Google Ads",
        color: "#d97706",
    },
    meta_ads: {
        label: "Meta Ads",
        color: "#0866ff",
    },
} as const;

const WHATSAPP_COVERAGE_STYLE = {
    meta_ads: {
        label: "Meta Ads",
        color: "#0866ff",
    },
    google_ads: {
        label: "Google Ads",
        color: "#d97706",
    },
    other: {
        label: "Outras origens",
        color: "#8b5cf6",
    },
    untracked: {
        label: "Não rastreadas",
        color: "#94a3b8",
    },
} as const;

type WhatsappCoverageChartItem = {
    key: keyof typeof WHATSAPP_COVERAGE_STYLE;
    label: string;
    value: number;
    percentage: number | null;
    color: string;
};

function WhatsappCoverageCard({
    pipeline,
}: {
    pipeline: FullJourneyPipeline;
}) {
    const coverage =
        pipeline.audit.whatsapp_coverage ??
        EMPTY_PIPELINE.audit.whatsapp_coverage;
    const chartData: WhatsappCoverageChartItem[] = [
        {
            key: "meta_ads",
            ...WHATSAPP_COVERAGE_STYLE.meta_ads,
            value: coverage.meta_conversations,
            percentage: calculateRate(
                coverage.meta_conversations,
                coverage.total_conversations,
            ),
        },
        {
            key: "google_ads",
            ...WHATSAPP_COVERAGE_STYLE.google_ads,
            value: coverage.google_conversations,
            percentage: calculateRate(
                coverage.google_conversations,
                coverage.total_conversations,
            ),
        },
        {
            key: "other",
            ...WHATSAPP_COVERAGE_STYLE.other,
            value: coverage.other_conversations,
            percentage: calculateRate(
                coverage.other_conversations,
                coverage.total_conversations,
            ),
        },
        {
            key: "untracked",
            ...WHATSAPP_COVERAGE_STYLE.untracked,
            value: coverage.untracked_conversations,
            percentage: calculateRate(
                coverage.untracked_conversations,
                coverage.total_conversations,
            ),
        },
    ];

    return (
        <Card className="min-w-0">
            <h2 className="text-lg font-bold">
                Cobertura das conversas no WhatsApp
            </h2>

            {coverage.total_conversations === 0 ? (
                <div className="mt-5">
                    <EmptyCardMessage message="Nenhuma conversa no período." />
                </div>
            ) : (
                <div className="mt-4 grid grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(260px,0.9fr)_minmax(320px,1.1fr)] lg:gap-10">
                    <div className="relative h-[270px] min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    dataKey="value"
                                    nameKey="label"
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={68}
                                    outerRadius={98}
                                    paddingAngle={2}
                                    stroke="none"
                                    isAnimationActive={false}
                                >
                                    {chartData.map((item) => (
                                        <Cell
                                            key={item.key}
                                            fill={item.color}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    content={
                                        <WhatsappCoverageTooltip />
                                    }
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-bold text-slate-800">
                                {coverage.total_conversations.toLocaleString(
                                    "pt-BR",
                                )}
                            </span>
                            <span className="mt-1 text-xs font-medium text-slate-500">
                                total de conversas
                            </span>
                        </div>
                    </div>

                    <div className="min-w-0">
                        <div className="mb-3 flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
                            <span className="text-sm font-medium text-slate-600">
                                Conversas rastreadas
                            </span>
                            <div className="text-right">
                                <div className="font-bold text-slate-800">
                                    {coverage.tracked_conversations.toLocaleString(
                                        "pt-BR",
                                    )}
                                </div>
                                <div className="text-xs text-slate-500">
                                    {formatRate(coverage.tracking_rate)} do total
                                </div>
                            </div>
                        </div>

                        <div className="divide-y divide-slate-100">
                            {chartData.map((item) => (
                                <div
                                    key={item.key}
                                    className="flex items-center justify-between gap-4 py-3"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <span
                                            className="h-2.5 w-2.5 rounded-full"
                                            style={{
                                                backgroundColor: item.color,
                                            }}
                                        />
                                        <span className="text-sm font-medium text-slate-700">
                                            {item.label}
                                        </span>
                                    </div>
                                    <div className="flex items-baseline gap-3">
                                        <span className="font-bold text-slate-800">
                                            {item.value.toLocaleString("pt-BR")}
                                        </span>
                                        <span className="w-12 text-right text-xs text-slate-500">
                                            {formatRate(item.percentage)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}

function WhatsappCoverageTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: { payload?: WhatsappCoverageChartItem }[];
}) {
    const item = payload?.[0]?.payload;
    if (!active || !item) return null;

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="flex items-center gap-2">
                <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: item.color }}
                />
                <span className="font-semibold text-slate-800">
                    {item.label}
                </span>
            </div>
            <div className="mt-2 text-sm text-slate-600">
                {item.value.toLocaleString("pt-BR")} ·{" "}
                {formatRate(item.percentage)}
            </div>
        </div>
    );
}

function TrackedWhatsappSourcesCard({
    pipeline,
}: {
    pipeline: FullJourneyPipeline;
}) {
    const sources = pipeline.audit.tracked_sources ?? [];
    const groupedSources = new Map<string, TrackedWhatsappChartSource>();

    for (const source of sources) {
        const evidence = trackedSourceEvidence(source.field);
        const key = [
            source.platform,
            evidence,
            source.source.trim().toLocaleLowerCase("pt-BR"),
        ].join(":");
        const current = groupedSources.get(key);
        if (current) {
            current.clients += source.clients;
            continue;
        }

        groupedSources.set(key, {
            platform: source.platform,
            source: source.source,
            evidence,
            clients: source.clients,
            percentage: 0,
            key,
            label: trackedSourceAxisLabel(source.source, evidence),
        });
    }

    const totalClients = [...groupedSources.values()].reduce(
        (sum, source) => sum + source.clients,
        0,
    );
    const chartData = [...groupedSources.values()]
        .map((source) => ({
            ...source,
            percentage: calculateRate(source.clients, totalClients) ?? 0,
        }))
        .sort(
            (first, second) =>
                second.clients - first.clients ||
                first.source.localeCompare(second.source, "pt-BR"),
        );
    const chartHeight = Math.max(280, chartData.length * 30 + 40);

    return (
        <Card className="min-w-0">
            <div className="mb-5">
                <h2 className="text-lg font-bold">
                    De onde vem o WhatsApp rastreado
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-500">
                    <LegendDot
                        color={TRACKED_WHATSAPP_PLATFORM_STYLE.google_ads.color}
                        label="Google Ads"
                    />
                    <LegendDot
                        color={TRACKED_WHATSAPP_PLATFORM_STYLE.meta_ads.color}
                        label="Meta Ads"
                    />
                </div>
            </div>

            {chartData.length === 0 ? (
                <EmptyCardMessage message="Nenhum cliente rastreado no período." />
            ) : (
                <div className="w-full" style={{ height: chartHeight }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={chartData}
                            layout="vertical"
                            barCategoryGap="24%"
                            margin={{ left: 0, right: 20 }}
                        >
                            <CartesianGrid
                                strokeDasharray="4 4"
                                stroke="#e2e8f0"
                                horizontal={false}
                            />
                            <XAxis
                                type="number"
                                allowDecimals={false}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                            />
                            <YAxis
                                type="category"
                                dataKey="label"
                                width={220}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                                tickFormatter={(value: string) =>
                                    shortenChartLabel(value, 38)
                                }
                            />
                            <Tooltip
                                content={<TrackedWhatsappSourceTooltip />}
                                cursor={false}
                            />
                            <Bar
                                dataKey="clients"
                                name="Clientes únicos"
                                radius={[0, 7, 7, 0]}
                                isAnimationActive={false}
                            >
                                {chartData.map((source) => (
                                    <Cell
                                        key={source.key}
                                        fill={
                                            TRACKED_WHATSAPP_PLATFORM_STYLE[
                                                source.platform
                                            ].color
                                        }
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

type TrackedWhatsappSourceEvidence = "UTM" | "Origem" | "ID de clique";

type TrackedWhatsappChartSource = {
    platform: "google_ads" | "meta_ads";
    source: string;
    evidence: TrackedWhatsappSourceEvidence;
    clients: number;
    percentage: number;
    key: string;
    label: string;
};

function TrackedWhatsappSourceTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: { payload?: TrackedWhatsappChartSource }[];
}) {
    const source = payload?.[0]?.payload;
    if (!active || !source) return null;

    const platform = TRACKED_WHATSAPP_PLATFORM_STYLE[source.platform];

    return (
        <div className="max-w-[340px] rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="font-semibold text-slate-800">{source.source}</div>
            <div className="mt-2 space-y-1.5 text-xs text-slate-500">
                <div className="flex items-center justify-between gap-6">
                    <span>Classificação</span>
                    <span
                        className="font-semibold"
                        style={{ color: platform.color }}
                    >
                        {platform.label}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-6">
                    <span>Clientes únicos</span>
                    <span className="font-semibold text-slate-700">
                        {source.clients.toLocaleString("pt-BR")} ·{" "}
                        {formatRate(source.percentage)}
                    </span>
                </div>
            </div>
        </div>
    );
}

function trackedSourceEvidence(
    field: TrackedWhatsappSourceField,
): TrackedWhatsappSourceEvidence {
    if (field === "utm_source") return "UTM";
    if (field === "click_id") return "ID de clique";
    return "Origem";
}

function trackedSourceAxisLabel(
    source: string,
    evidence: TrackedWhatsappSourceEvidence,
) {
    if (evidence === "UTM") return `${source} (UTM)`;
    if (evidence === "Origem") return `${source} (Origem)`;
    return source;
}

function shortenChartLabel(value: string, maximumLength: number) {
    if (value.length <= maximumLength) return value;
    return `${value.slice(0, maximumLength - 1)}…`;
}

function PipelineStageCard({
    stage,
}: {
    stage: FullJourneyPipeline["stages"][number];
}) {
    const style = PIPELINE_STAGE_STYLE[stage.key];

    return (
        <div
            className="relative flex min-h-[190px] w-[168px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
            title={`${stage.label}: ${stage.value.toLocaleString("pt-BR")}`}
        >
            <span
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: style.accent }}
            />
            <div className="flex items-start justify-between gap-3">
                <span
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ backgroundColor: style.soft, color: style.accent }}
                >
                    <PipelineStageIcon stageKey={stage.key} />
                </span>
                <span
                    className="rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.13em]"
                    style={{ backgroundColor: style.soft, color: style.accent }}
                >
                    {style.eyebrow}
                </span>
            </div>

            <div className="mt-5 text-xs font-semibold text-slate-500">
                {stage.label}
            </div>
            <div className="mt-1 text-[28px] font-black tracking-tight text-slate-900">
                {formatPipelineStageValue(stage)}
            </div>
            <div className="mt-auto min-h-5 pt-3 text-[11px] font-medium text-slate-500">
                {formatPipelineSecondary(stage)}
            </div>
        </div>
    );
}

function PipelineTransitionCard({
    transition,
}: {
    transition: FullJourneyPipeline["transitions"][number];
}) {
    return (
        <div className="flex w-[118px] flex-col items-center justify-center px-2 text-center">
            <span
                className={`rounded-full border px-2.5 py-1 text-xs font-black ${
                    transition.rate === null
                        ? "border-slate-200 bg-slate-50 text-slate-400"
                        : "border-blue-100 bg-blue-50 text-blue-700"
                }`}
                title={
                    transition.estimated
                        ? "Estimativa de cobertura: compara eventos agregados da plataforma com clientes únicos identificados no CRM."
                        : undefined
                }
            >
                {transition.estimated && transition.rate !== null ? "~" : ""}
                {formatRate(transition.rate)}
            </span>
            <div className="my-3 flex w-full items-center">
                <span className="h-px flex-1 bg-gradient-to-r from-slate-200 to-blue-300" />
                <ArrowRight size={15} className="shrink-0 text-blue-400" />
            </div>
            <span className="min-h-8 text-[10px] font-bold leading-4 text-slate-500">
                {transition.label}
            </span>
            <span className="mt-1 h-4 text-[10px] text-slate-400">
                {transition.lost === null
                    ? transition.estimated
                        ? "bases distintas"
                        : ""
                    : `−${transition.lost} clientes`}
            </span>
        </div>
    );
}

function PipelineStageIcon({ stageKey }: { stageKey: PipelineStageKey }) {
    if (stageKey === "paid_impressions") {
        return (
            <span className="flex items-center gap-1">
                <FaMeta size={14} />
                <FaGoogle size={14} />
            </span>
        );
    }
    if (stageKey === "paid_clicks") return <MousePointerClick size={20} />;
    if (stageKey === "whatsapp") return <MessageCircle size={20} />;
    if (stageKey === "tracked_whatsapp") return <UserCheck size={20} />;
    if (stageKey === "scheduled") return <CalendarCheck2 size={20} />;
    if (stageKey === "attended") return <UserCheck size={20} />;
    if (stageKey === "invoiced") return <ReceiptText size={20} />;
    if (stageKey === "authorized") return <BadgeCheck size={20} />;
    return <CircleDollarSign size={20} />;
}

function PipelineInsight({
    label,
    value,
    detail,
}: {
    label: string;
    value: string;
    detail: string;
}) {
    return (
        <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                {label}
            </div>
            <div className="mt-1 text-lg font-black text-slate-800">{value}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{detail}</div>
        </div>
    );
}

function JourneyFunnelCard({ data }: { data: JourneyDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <h2 className="text-lg font-bold">Jornada na Conversa</h2>
            </div>

            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(245px,0.65fr)] items-center gap-5">
                <div className="h-[330px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <FunnelChart
                            margin={{ top: 10, right: 64, bottom: 10, left: 6 }}
                        >
                            <Tooltip />
                            <Funnel
                                dataKey="value"
                                data={data.journey_funnel}
                                isAnimationActive={false}
                            >
                                <LabelList
                                    position="right"
                                    fill="#334155"
                                    stroke="none"
                                    dataKey="value"
                                />
                                {data.journey_funnel.map((item) => (
                                    <Cell key={item.key} fill={item.fill} />
                                ))}
                            </Funnel>
                        </FunnelChart>
                    </ResponsiveContainer>
                </div>

                <div className="space-y-4">
                    {data.journey_funnel.map((item) => (
                        <div
                            key={item.key}
                            className="flex items-center justify-between gap-1 border-b border-slate-100 pb-2 text-sm last:border-b-0"
                        >
                            <div className="flex min-w-0 items-center gap-3">
                                <span
                                    className="h-3 w-3 shrink-0 rounded-full"
                                    style={{ backgroundColor: item.fill }}
                                />
                                <span className="truncate font-medium text-slate-700" title={item.name}>
                                    {item.name}
                                </span>
                            </div>
                            <div className="grid grid-cols-[48px_52px] items-center gap-1">
                                <span className="text-right text-xs font-bold text-slate-500">
                                    {formatRate(item.relative_percentage)}
                                </span>
                                <span className="text-right text-xs font-medium text-slate-500">
                                    ({formatRate(item.percentage)})
                                </span>
                            </div>
                        </div>
                    ))}

                </div>
            </div>
        </Card>
    );
}

function DropoffCard({ data }: { data: JourneyDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Pontos de abandono</h2>
                    <InfoTooltip text="Base: abandonos observáveis">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
            </div>

            <div className="space-y-7">
                {data.dropoff_moments.map((item, index) => (
                    <div key={item.moment} className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple text-xs font-bold text-white">
                            {index + 1}
                        </span>
                        <div className="w-full">
                            <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">{item.label}</span>
                                <span className="font-bold text-slate-700">
                                    {formatRate(item.percentage)}
                                </span>
                            </div>
                            <PercentageBar value={item.percentage ?? 0} color="purple" />
                        </div>
                    </div>
                ))}
                {data.dropoff_moments.length === 0 && (
                    <EmptyCardMessage message="Nenhum abandono com evidência no período." />
                )}
            </div>
        </Card>
    );
}

function IntentPathsCard({ data }: { data: JourneyDashboardData }) {
    const chartData = data.intent_paths.map((item) => ({
        ...item,
        intent: translateIntent(item.intent),
    }));

    return (
        <Card>
            <div className="mb-5">
                <h2 className="text-lg font-bold">
                    Resultados por intenção inicial
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-500">
                    <LegendDot color="green" label="Resolvida" />
                    <LegendDot color="orange" label="Parcial" />
                    <LegendDot color="slate-500" label="Não resolvida" />
                    <LegendDot color="red" label="Abandonou" />
                </div>
            </div>

            <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={chartData}
                        barCategoryGap="28%"
                        margin={{ left: 10 }}
                    >
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis
                            dataKey="intent"
                            tick={{ fontSize: 12 }}
                            stroke="#94a3b8"
                            interval={0}
                            angle={-18}
                            textAnchor="end"
                            height={65}
                        />
                        <YAxis
                            width={58}
                            tick={{ fontSize: 12 }}
                            stroke="#94a3b8"
                            label={{
                                value: "Conversas",
                                angle: -90,
                                position: "insideLeft",
                                fontSize: 12,
                                fill: "#64748b",
                            }}
                        />
                        <Tooltip content={<IntentPathsTooltip />} cursor={false} />
                        <Bar dataKey="resolved" name="Resolvida" stackId="result" fill="var(--color-green)" />
                        <Bar dataKey="partial" name="Parcial" stackId="result" fill="var(--color-orange)" />
                        <Bar dataKey="not_resolved" name="Não resolvida" stackId="result" fill="#64748b" />
                        <Bar dataKey="abandoned" name="Abandonou" stackId="result" fill="var(--color-red)" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function ObjectionsCard({ data }: { data: JourneyDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Principais objeções</h2>
                    <InfoTooltip
                        text={`Base: ${
                            data.audit?.conversations_with_objections ?? 0
                        } conversas com objeções observáveis`}
                    >
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
            </div>

            <div className="space-y-4">
                {data.objections.map((item, index) => (
                    <div key={item.type} className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple text-xs font-bold text-white">
                            {index + 1}
                        </span>
                        <div className="w-full">
                            <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">{item.label}</span>
                                <span className="font-bold text-slate-700">
                                    {formatRate(item.percentage)}
                                </span>
                            </div>
                            <PercentageBar value={item.percentage ?? 0} color="purple" />
                        </div>
                    </div>
                ))}
                {data.objections.length === 0 && (
                    <EmptyCardMessage message="Nenhuma objeção com evidência no período." />
                )}
            </div>
        </Card>
    );
}

function EmptyCardMessage({ message }: { message: string }) {
    return (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
            {message}
        </div>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    const resolvedColors: Record<string, string> = {
        "slate-500": "#64748b",
        "bg-slate-400": "#94a3b8",
        "bg-emerald-500": "#10b981",
        "bg-amber-500": "#f59e0b",
        "bg-violet-500": "#8b5cf6",
        "bg-teal-500": "#14b8a6",
    };
    const backgroundColor = color.startsWith("#")
        ? color
        : resolvedColors[color] ?? `var(--color-${color})`;

    return (
        <div className="flex items-center gap-2">
            <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor }}
            />
            <span>{label}</span>
        </div>
    );
}

function JourneySkeleton() {
    return (
        <>
            <div className="mb-8 flex items-start justify-between">
                <div><Skeleton className="h-9 w-[180px]" /><Skeleton className="mt-3 h-4 w-[420px]" /></div>
                <Skeleton className="h-12 w-[310px]" />
            </div>
            <div className="mb-8 flex justify-end gap-3">
                <Skeleton className="h-12 w-[220px]" /><Skeleton className="h-12 w-[220px]" /><Skeleton className="h-12 w-[220px]" /><Skeleton className="h-12 w-[220px]" />
            </div>
            <JourneyBodySkeleton />
        </>
    );
}

function JourneyBodySkeleton() {
    return (
        <>
            <section className="mb-6 grid grid-cols-[1.6fr_0.8fr] gap-5">
                <Card><Skeleton className="mb-6 h-6 w-[35%]" /><Skeleton className="h-[280px] w-full" /></Card>
                <Card><Skeleton className="mb-6 h-6 w-[45%]" /><div className="space-y-5">{Array.from({ length: 4 }).map((_, index) => (<Skeleton key={index} className="h-8 w-full" />))}</div></Card>
            </section>
            <section className="mb-6 grid grid-cols-[1.5fr_0.9fr] gap-5">
                <Card><Skeleton className="mb-6 h-6 w-[45%]" /><Skeleton className="h-[260px] w-full" /></Card>
                <Card><Skeleton className="mb-6 h-6 w-[45%]" /><div className="space-y-5">{Array.from({ length: 5 }).map((_, index) => (<Skeleton key={index} className="h-8 w-full" />))}</div></Card>
            </section>
            <section className="mb-6 min-w-0">
                <Card className="min-w-0 overflow-hidden">
                    <div className="flex items-start justify-between">
                        <div>
                            <Skeleton className="h-7 w-[330px]" />
                            <Skeleton className="mt-3 h-4 w-[420px]" />
                        </div>
                        <Skeleton className="h-16 w-[170px] rounded-xl" />
                    </div>
                    <div className="mt-7 overflow-x-auto pb-4">
                        <div className="flex min-w-max gap-4">
                                {Array.from({ length: 5 }).map((_, index) => (
                                    <div key={index} className="flex shrink-0 items-center gap-4">
                                        <Skeleton className="h-[190px] w-[168px] rounded-2xl" />
                                        {index < 4 ? (
                                            <Skeleton className="h-10 w-[90px]" />
                                        ) : null}
                                    </div>
                                ))}
                        </div>
                    </div>
                </Card>
            </section>
            <section className="mb-6 min-w-0">
                <Card>
                    <Skeleton className="h-6 w-[330px]" />
                    <div className="mt-5 grid grid-cols-1 items-center gap-6 lg:grid-cols-2 lg:gap-10">
                        <Skeleton className="mx-auto h-[220px] w-[220px] rounded-full" />
                        <div className="space-y-3">
                            <Skeleton className="h-14 w-full rounded-xl" />
                            {Array.from({ length: 4 }).map((_, index) => (
                                <Skeleton
                                    key={index}
                                    className="h-10 w-full"
                                />
                            ))}
                        </div>
                    </div>
                </Card>
            </section>
            <section className="mb-6 min-w-0">
                <Card>
                    <Skeleton className="h-6 w-[310px]" />
                    <div className="mt-3 flex gap-5">
                        <Skeleton className="h-3 w-[90px]" />
                        <Skeleton className="h-3 w-[80px]" />
                    </div>
                    <Skeleton className="mt-5 h-[420px] w-full" />
                </Card>
            </section>
        </>
    );
}

type ChartTooltipPayloadItem = { dataKey: string; value: string | number; color?: string };

function translateIntent(value: string) {
    const key = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return CUSTOMER_START_INTENT_LABELS[key] ?? value;
}

function IntentPathsTooltip({ active, payload, label }: { active?: boolean; payload?: ChartTooltipPayloadItem[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const labels: Record<string, string> = { resolved: "Resolvida", partial: "Parcial", not_resolved: "Não resolvida", abandoned: "Abandono" };
    const colors: Record<string, string> = { resolved: "var(--color-green)", partial: "var(--color-orange)", not_resolved: "#64748b", abandoned: "var(--color-red)" };
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="mb-3 text-sm font-semibold text-slate-800">{label}</div>
            <div className="space-y-2 text-sm">
                {payload.map((item) => (<div key={item.dataKey} className="flex items-center justify-between gap-6"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[item.dataKey] ?? "#94a3b8" }} /><span style={{ color: colors[item.dataKey] ?? "#475569" }}>{labels[item.dataKey] ?? item.dataKey}</span></div><span className="font-semibold" style={{ color: colors[item.dataKey] ?? "#334155" }}>{item.value}</span></div>))}
            </div>
        </div>
    );
}

function formatRate(value: number | null): string {
    return value === null ? "—" : `${value}%`;
}

function calculateRate(value: number, total: number) {
    if (total <= 0) return null;
    return Number(((value / total) * 100).toFixed(1));
}

function buildPipelineSourceTooltip(pipeline: FullJourneyPipeline) {
    const stages = new Map(
        pipeline.stages.map((stage) => [stage.key, stage]),
    );
    const count = (key: PipelineStageKey) =>
        (stages.get(key)?.value ?? 0).toLocaleString("pt-BR");
    const money = (key: PipelineStageKey) =>
        formatPipelineCurrency(
            stages.get(key)?.secondary_value ?? 0,
            pipeline.currency_code,
        );

    return [
        `Impressões pagas ${count("paid_impressions")} — dados das APIs Meta e Google Ads para campanhas e ações elegíveis ao WhatsApp.`,
        `Cliques pagos ${count("paid_clicks")} — dados das APIs Meta e Google Ads para cliques elegíveis ao WhatsApp.`,
        `Conversas WhatsApp ${count("whatsapp")} — ações de conversa reportadas pelas próprias plataformas de anúncios.`,
        `WhatsApp rastreado ${count("tracked_whatsapp")} — clientes únicos identificados pela Origem paga da conversa. Se a Origem estiver vazia, usamos a UTM ou o ID de clique salvo no cliente somente quando esse rastreamento foi atualizado até 7 dias antes ou depois do início da conversa.`,
        `Agendaram ${count("scheduled")} — clientes dessa coorte com agendamento importado do CliniSys após a entrada pelo WhatsApp.`,
        `Compareceram ${count("attended")} — clientes agendados com presença confirmada pelo status do CliniSys.`,
        `Faturados ${count("invoiced")} · ${money("invoiced")} — clientes presentes com nota emitida no CliniSys após a entrada paga.`,
        `Liberados ${count("authorized")} · ${money("authorized")} — notas dessa coorte com autorização fiscal confirmada no CliniSys.`,
    ].join("\n");
}

function formatPipelineSecondary(
    stage: FullJourneyPipeline["stages"][number],
) {
    if (stage.secondary_value === null || !stage.secondary_kind) {
        return stage.key === "paid_impressions"
            ? ""
            : stage.key === "paid_clicks"
              ? "cliques elegíveis"
              : stage.key === "whatsapp"
                ? "ações reportadas pelas plataformas"
                : stage.key === "tracked_whatsapp"
                  ? "clientes únicos identificados"
              : stage.key === "scheduled"
                ? "clientes únicos"
                : stage.key === "attended"
                  ? "clientes únicos"
                  : "";
    }

    const value =
        stage.secondary_kind === "currency"
            ? formatPipelineCurrency(stage.secondary_value, "BRL")
            : stage.secondary_value.toLocaleString("pt-BR");
    return `${value}${stage.secondary_label ? ` ${stage.secondary_label}` : ""}`;
}

function formatPipelineStageValue(
    stage: FullJourneyPipeline["stages"][number],
) {
    if (stage.key === "paid_impressions" && stage.value >= 1_000_000) {
        return `${Math.round(stage.value / 1_000_000).toLocaleString("pt-BR")}m`;
    }

    return stage.value.toLocaleString("pt-BR");
}

function formatPipelineCurrency(value: number, currencyCode: string) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: currencyCode || "BRL",
        notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
        maximumFractionDigits: Math.abs(value) >= 100_000 ? 1 : 2,
    }).format(value);
}

function formatPipelineDate(value: string) {
    if (!value) return "—";
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value;
}
