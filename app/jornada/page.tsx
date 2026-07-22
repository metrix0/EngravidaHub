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
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import {
    applyArrayParams,
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
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
    | "scheduled"
    | "attended"
    | "invoiced"
    | "authorized";

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

const EMPTY_PIPELINE: FullJourneyPipeline = {
    available: false,
    ads_available: false,
    ads_scope_global: true,
    filters_applied: false,
    currency_code: "BRL",
    stages: [],
    transitions: [],
    audit: {
        whatsapp_conversations: 0,
        whatsapp_clients: 0,
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
    const [period, setPeriod] = useState<CalendarPresetValue | null>("yesterday");
    const [selectedRange, setSelectedRange] = useState<DateRange>({
        start: null,
        end: null,
    });
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
            } finally {
                setLoadingData(false);
                setIsRefreshing(false);
            }
        }

        void loadData();
    }, [
        unitIds,
        attendantIds,
        tunnelValues,
        originValues,
        period,
        selectedRange,
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
                        <section className="mb-6 grid grid-cols-[1.55fr_0.85fr] gap-5">
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
        eyebrow: "Entrada",
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
    const whatsappStage = pipeline.stages.find(
        (stage) => stage.key === "whatsapp",
    );
    const authorizedStage = pipeline.stages.find(
        (stage) => stage.key === "authorized",
    );
    const endToEndRate = calculateRate(
        authorizedStage?.value ?? 0,
        whatsappStage?.value ?? 0,
    );

    return (
        <Card className="min-w-0 overflow-hidden p-0">
            <div className="border-b border-slate-100 bg-white px-6 py-5">
                <div className="flex items-start justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold text-slate-900">
                                Pipeline completo da jornada
                            </h2>
                            <InfoTooltip text="Meta + Google usam impressões e cliques agregados. O WhatsApp vem da tag Origem da conversa ou do cliente; daí em diante, cada cliente conta uma vez e só avança em ordem cronológica.">
                                <HelpCircle size={16} className="text-slate-400" />
                            </InfoTooltip>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                            Da impressão ao faturamento liberado · coorte iniciada no período
                        </p>
                    </div>

                    <div className="hidden shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-right lg:block">
                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                            Conversão ponta a ponta
                        </div>
                        <div className="mt-0.5 text-2xl font-black text-slate-900">
                            {formatRate(endToEndRate)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                            WhatsApp → liberado
                        </div>
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
                    Impressões e cliques permanecem globais de Meta + Google; os filtros selecionados valem do WhatsApp em diante.
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
                        label="Coorte rastreável"
                        value={`${(
                            whatsappStage?.value ?? 0
                        ).toLocaleString("pt-BR")} clientes`}
                        detail={formatWhatsappOrigins(pipeline)}
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

                <p className="mt-4 text-[11px] leading-5 text-slate-400">
                    Clique → WhatsApp é uma taxa aproximada: Meta + Google fornecem eventos agregados, enquanto WhatsApp conta clientes únicos pelas tags de Origem atribuídas a essas plataformas. As demais taxas usam a mesma coorte e respeitam a ordem cronológica.
                </p>
            </div>
        </Card>
    );
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
                {stage.value.toLocaleString("pt-BR")}
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
                        ? "Aproximada: compara cliques agregados com clientes únicos."
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
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Funil da jornada</h2>
                <InfoTooltip text="Cada etapa exige que o mesmo cliente tenha passado pela etapa anterior em ordem cronológica. Isso evita somar eventos fora de sequência.">
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
            </div>

            <div className="grid grid-cols-2 items-center gap-5">
                <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <FunnelChart>
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
                            <div className="grid grid-cols-[45px_48px_52px] items-center gap-1">
                                <span className="text-right font-bold text-slate-700">
                                    {item.value}
                                </span>
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
                    <InfoTooltip text="Somente abandonos com message_ids de evidência entram na métrica.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
                <p className="mt-1 text-xs text-slate-500">Base: abandonos observáveis</p>
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
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Caminhos por intenção inicial</h2>
                    <InfoTooltip text="Não resolvida e parcial são categorias separadas. Abandono só é contado quando há evidência de abandono.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-500">
                    <LegendDot color="green" label="Resolvida" />
                    <LegendDot color="orange" label="Parcial" />
                    <LegendDot color="slate-500" label="Não resolvida" />
                    <LegendDot color="red" label="Abandonou" />
                </div>
            </div>

            <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.intent_paths} barCategoryGap="28%">
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
                        <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
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
                    <InfoTooltip text="Cada conversa conta no máximo uma vez por tipo de objeção e precisa citar message_ids de evidência.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                    Base: {data.audit?.conversations_with_objections ?? 0} conversas com objeções observáveis
                </p>
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
                                    {item.value} · {formatRate(item.percentage)}
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
    const style = color === "slate-500"
        ? { backgroundColor: "#64748b" }
        : { backgroundColor: `var(--color-${color})` };

    return (
        <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={style} />
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
        </>
    );
}

type ChartTooltipPayloadItem = { dataKey: string; value: string | number; color?: string };

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

function formatPipelineSecondary(
    stage: FullJourneyPipeline["stages"][number],
) {
    if (stage.secondary_value === null || !stage.secondary_kind) {
        return stage.key === "paid_impressions"
            ? "exibições no período"
            : stage.key === "paid_clicks"
              ? "interações no anúncio"
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

function formatWhatsappOrigins(pipeline: FullJourneyPipeline) {
    const topOrigins = pipeline.audit.whatsapp_origins
        .slice(0, 2)
        .map(
            (origin) =>
                `${origin.origin}: ${origin.clients.toLocaleString("pt-BR")}`,
        );

    if (topOrigins.length > 0) return topOrigins.join(" · ");
    return `${pipeline.audit.whatsapp_conversations.toLocaleString(
        "pt-BR",
    )} conversas com Origem atribuída`;
}
