// components/dashboard/InstagramConversationInsights.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
    BadgeCheck,
    CircleX,
    Clock,
    MessageCircle,
    ShieldCheck,
    Smile,
} from "lucide-react";
import { FaInstagram } from "react-icons/fa6";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Line,
    Pie,
    PieChart,
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import {
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import Card from "@/components/ui/Card";
import HorizontalScroller from "@/components/ui/HorizontalScroller";
import KpiCard from "@/components/ui/KpiCard";
import PercentageBar from "@/components/ui/PercentageBar";
import Skeleton from "@/components/ui/Skeleton";

const INSTAGRAM_PINK = "#ec4899";
const INSTAGRAM_DARK_PINK = "#be185d";
const INSTAGRAM_LIGHT_PINK = "#f9a8d4";
const INSTAGRAM_PURPLE = "#a855f7";
const AMBER = "#f59e0b";
const WHATSAPP_GREEN = "#22c55e";
const RESOLVED_GREEN = "#10b981";
const UNRESOLVED_ROSE = "#fb7185";
const DISTRIBUTION_COLORS = [
    INSTAGRAM_DARK_PINK,
    INSTAGRAM_PURPLE,
    RESOLVED_GREEN,
    AMBER,
    "#1683ff",
    "#06b6d4",
    UNRESOLVED_ROSE,
];

type InstagramInsightMode = "analysis" | "share";

type DistributionPoint = {
    key: string;
    label: string;
    count: number;
    percentage: number | null;
};

type QualityDimension = {
    key: string;
    label: string;
    score: number | null;
    observed: number;
};

type ResponseTimePoint = {
    key: string;
    label: string;
    seconds: number | null;
    observed: number;
};

type ObjectionPoint = {
    key: string;
    label: string;
    total: number;
    resolved: number;
    unresolved: number;
    resolution_rate: number | null;
};

type InstagramAnalysisData = {
    conversations_total: number;
    conversations_analyzed: number;
    analysis_coverage_rate: number | null;
    resolution_rate: number | null;
    resolution_observed: number;
    satisfaction_rate: number | null;
    satisfaction_observed: number;
    dropoff_rate: number | null;
    dropoff_count: number;
    notable_count: number;
    average_first_human_response_seconds: number | null;
    median_first_human_response_seconds: number | null;
    p90_first_human_response_seconds: number | null;
    first_human_response_observed: number;
    attendant_quality_score: number | null;
    attendant_quality_observed: number;
    daily_evolution: {
        date: string;
        date_iso: string;
        conversations: number;
        resolution_rate: number | null;
        satisfaction_rate: number | null;
        dropoff_rate: number | null;
        attendant_quality_score: number | null;
    }[];
    dropoff_moments: DistributionPoint[];
    dropoff_reasons: DistributionPoint[];
    customer_intents: DistributionPoint[];
    conversation_goals: DistributionPoint[];
    goal_statuses: DistributionPoint[];
    customer_final_states: DistributionPoint[];
    sentiments: DistributionPoint[];
    resolution_results: DistributionPoint[];
    resolution_reasons: DistributionPoint[];
    outcome_events: DistributionPoint[];
    quality_dimensions: QualityDimension[];
    response_times: ResponseTimePoint[];
    objections: ObjectionPoint[];
};

type InstagramShareData = {
    total_conversations: number;
    instagram_conversations: number;
    whatsapp_conversations: number;
    instagram_percentage: number | null;
    daily_evolution: {
        date: string;
        date_iso: string;
        total_conversations: number;
        instagram_conversations: number;
        whatsapp_conversations: number;
        instagram_percentage: number | null;
    }[];
};

type Props = {
    mode: InstagramInsightMode;
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
};

export default function InstagramConversationInsights({
    mode,
    period,
    selectedRange,
}: Props) {
    const [data, setData] = useState<
        InstagramAnalysisData | InstagramShareData | null
    >(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        async function loadInstagramInsights() {
            setLoading(true);
            setError(null);

            try {
                const params = new URLSearchParams();
                applyCalendarDateParams({
                    params,
                    selectedRange,
                    selectedPreset: period,
                });
                const endpoint =
                    mode === "analysis"
                        ? "/api/dashboard/instagram-analysis"
                        : "/api/dashboard/instagram-share";
                const response = await fetch(
                    `${endpoint}?${params.toString()}`,
                    {
                        cache: "no-store",
                        signal: controller.signal,
                    },
                );
                const json = (await response.json()) as
                    | InstagramAnalysisData
                    | InstagramShareData
                    | { error?: string };

                if (!response.ok) {
                    throw new Error(
                        "error" in json && json.error
                            ? json.error
                            : "Falha ao carregar dados do Instagram.",
                    );
                }

                setData(json as InstagramAnalysisData | InstagramShareData);
            } catch (loadError) {
                if (controller.signal.aborted) return;
                console.error("[instagram-insights] load failed", loadError);
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Falha ao carregar dados do Instagram.",
                );
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        void loadInstagramInsights();

        return () => {
            controller.abort();
        };
    }, [mode, period, selectedRange.end, selectedRange.start]);

    if (loading) return <InstagramInsightsSkeleton mode={mode} />;

    if (error) {
        return (
            <Card className="mb-8 border-rose-100 bg-rose-50/30">
                <div className="text-sm font-medium text-rose-700">
                    {error}
                </div>
            </Card>
        );
    }

    if (!data) return null;

    return mode === "analysis" ? (
        <InstagramAnalysisSection data={data as InstagramAnalysisData} />
    ) : (
        <InstagramShareCard data={data as InstagramShareData} />
    );
}

function InstagramAnalysisSection({ data }: { data: InstagramAnalysisData }) {
    return (
        <div className="mb-8 min-w-0 space-y-5">
            <div className="px-1">
                <InsightHeader
                    title="Análise das conversas do Instagram"
                    description="Indicadores e padrões extraídos exclusivamente das conversas cujo canal é Instagram."
                />
            </div>

            <HorizontalScroller scrollAmount={360}>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<MessageCircle size={26} />}
                        label="Conversas analisadas"
                        currentValue={data.conversations_analyzed}
                        formatter={(value: number) => value.toLocaleString("pt-BR")}
                        color="pink"
                        tooltipText={`${formatPercent(data.analysis_coverage_rate)} de cobertura entre ${data.conversations_total.toLocaleString("pt-BR")} conversas do Instagram. ${data.notable_count.toLocaleString("pt-BR")} foram marcadas como notáveis.`}
                    />
                </div>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<ShieldCheck size={26} />}
                        label="Resolução real"
                        currentValue={data.resolution_rate}
                        suffix="%"
                        color="green"
                        tooltipText={`Baseado em ${data.resolution_observed.toLocaleString("pt-BR")} conversas com resultado de resolução observável.`}
                    />
                </div>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<Smile size={26} />}
                        label="Clientes satisfeitos"
                        currentValue={data.satisfaction_rate}
                        suffix="%"
                        color="blue"
                        tooltipText={`Considera apenas sinais claros de satisfação ou insatisfação. ${data.satisfaction_observed.toLocaleString("pt-BR")} conversas observadas.`}
                    />
                </div>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<CircleX size={26} />}
                        label="Taxa de abandono"
                        currentValue={data.dropoff_rate}
                        suffix="%"
                        color="orange"
                        positiveDirection="down"
                        tooltipText={`${data.dropoff_count.toLocaleString("pt-BR")} conversas tiveram abandono detectado pela análise.`}
                    />
                </div>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<Clock size={26} />}
                        label="1ª resposta humana"
                        currentValue={data.average_first_human_response_seconds}
                        formatter={formatDuration}
                        color="purple"
                        positiveDirection="down"
                        tooltipText={`Média filtrada até 2 horas. Mediana: ${formatDuration(data.median_first_human_response_seconds)}. P90: ${formatDuration(data.p90_first_human_response_seconds)}. ${data.first_human_response_observed.toLocaleString("pt-BR")} respostas observadas.`}
                    />
                </div>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<BadgeCheck size={26} />}
                        label="Qualidade do atendimento"
                        currentValue={data.attendant_quality_score}
                        suffix="/100"
                        color="pink"
                        tooltipText={`${data.attendant_quality_observed.toLocaleString("pt-BR")} conversas com qualidade geral avaliada.`}
                    />
                </div>
            </HorizontalScroller>

            <AnalysisEvolutionCard data={data} />

            <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
                <RankedDistributionCard
                    title="Pontos de abandono"
                    description="Momento da conversa em que o cliente deixou de avançar."
                    data={data.dropoff_moments}
                />
                <DistributionBarCard
                    title="Motivos prováveis de abandono"
                    description="Categorias derivadas do motivo textual identificado pela análise."
                    data={data.dropoff_reasons}
                    color={AMBER}
                />
                <DonutDistributionCard
                    title="Estado final do cliente"
                    description="Como o cliente terminou a conversa analisada."
                    data={data.customer_final_states}
                    centerLabel="conversas"
                />
                <DonutDistributionCard
                    title="Resultado da resolução"
                    description="Distribuição entre resolvida, parcial e não resolvida."
                    data={data.resolution_results}
                    centerLabel="resultados"
                    colors={[RESOLVED_GREEN, AMBER, UNRESOLVED_ROSE]}
                />
                <RankedDistributionCard
                    title="Status do objetivo"
                    description="Quanto o objetivo principal da conversa foi atingido."
                    data={data.goal_statuses}
                    color="purple"
                />
                <ColumnDistributionCard
                    title="Intenção inicial"
                    description="O que o cliente buscava ao iniciar a conversa."
                    data={data.customer_intents}
                    color={INSTAGRAM_DARK_PINK}
                />
                <DonutDistributionCard
                    title="Objetivo da conversa"
                    description="Objetivo operacional identificado ao longo do atendimento."
                    data={data.conversation_goals}
                    centerLabel="conversas"
                />
                <DonutDistributionCard
                    title="Sentimento do cliente"
                    description="Sentimento predominante detectado na conversa."
                    data={data.sentiments}
                    centerLabel="análises"
                />
                <QualityDimensionsCard data={data.quality_dimensions} />
                <ObjectionsCard data={data.objections} />
            </div>
        </div>
    );
}

function AnalysisEvolutionCard({ data }: { data: InstagramAnalysisData }) {
    return (
        <Card className="min-w-0 overflow-hidden border-pink-100">
            <ChartHeader
                title="Evolução diária do Instagram"
                description="Volume analisado e evolução das taxas de resolução, satisfação e abandono."
            />

            {data.daily_evolution.length === 0 ? (
                <EmptyMessage message="Nenhuma conversa do Instagram analisada no período." />
            ) : (
                <>
                    <div className="mt-5 h-[310px] min-w-0">
                        <ResponsiveContainer width="100%" height="100%" debounce={150}>
                            <AreaChart
                                data={data.daily_evolution}
                                margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                            >
                                <defs>
                                    <linearGradient
                                        id="instagramConversationFill"
                                        x1="0"
                                        y1="0"
                                        x2="0"
                                        y2="1"
                                    >
                                        <stop
                                            offset="5%"
                                            stopColor={INSTAGRAM_PINK}
                                            stopOpacity={0.24}
                                        />
                                        <stop
                                            offset="95%"
                                            stopColor={INSTAGRAM_PINK}
                                            stopOpacity={0}
                                        />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid
                                    strokeDasharray="4 4"
                                    stroke="#e2e8f0"
                                />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 11 }}
                                    stroke="#94a3b8"
                                />
                                <YAxis
                                    yAxisId="count"
                                    allowDecimals={false}
                                    tick={{ fontSize: 11 }}
                                    stroke="#94a3b8"
                                />
                                <YAxis
                                    yAxisId="rate"
                                    orientation="right"
                                    domain={[0, 100]}
                                    tickFormatter={(value: number) => `${value}%`}
                                    tick={{ fontSize: 11 }}
                                    stroke="#94a3b8"
                                />
                                <Tooltip content={<AnalysisTooltip />} />
                                <Area
                                    yAxisId="count"
                                    type="monotone"
                                    dataKey="conversations"
                                    name="Analisadas"
                                    stroke={INSTAGRAM_PINK}
                                    strokeWidth={3}
                                    fill="url(#instagramConversationFill)"
                                    isAnimationActive={false}
                                />
                                <Line
                                    yAxisId="rate"
                                    type="monotone"
                                    dataKey="resolution_rate"
                                    name="Resolução"
                                    stroke={INSTAGRAM_PURPLE}
                                    strokeWidth={3}
                                    dot={{ r: 3 }}
                                    connectNulls
                                    isAnimationActive={false}
                                />
                                <Line
                                    yAxisId="rate"
                                    type="monotone"
                                    dataKey="satisfaction_rate"
                                    name="Satisfação"
                                    stroke={RESOLVED_GREEN}
                                    strokeWidth={3}
                                    dot={{ r: 3 }}
                                    connectNulls
                                    isAnimationActive={false}
                                />
                                <Line
                                    yAxisId="rate"
                                    type="monotone"
                                    dataKey="dropoff_rate"
                                    name="Abandono"
                                    stroke={AMBER}
                                    strokeWidth={2.5}
                                    strokeDasharray="6 4"
                                    dot={{ r: 3 }}
                                    connectNulls
                                    isAnimationActive={false}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-500">
                        <ChartLegend color={INSTAGRAM_PINK} label="Conversas analisadas" />
                        <ChartLegend color={INSTAGRAM_PURPLE} label="Resolução" />
                        <ChartLegend color={RESOLVED_GREEN} label="Satisfação" />
                        <ChartLegend color={AMBER} label="Abandono" dashed />
                    </div>
                </>
            )}
        </Card>
    );
}

function RankedDistributionCard({
    title,
    description,
    data,
    color = "purple",
}: {
    title: string;
    description: string;
    data: DistributionPoint[];
    color?: "brand" | "purple" | "orange" | "blue" | "green";
}) {
    return (
        <Card className="min-w-0 overflow-hidden border-pink-100">
            <ChartHeader title={title} description={description} />
            {data.length === 0 ? (
                <EmptyMessage message="Sem dados suficientes no período." />
            ) : (
                <div className="mt-5 space-y-6">
                    {data.map((item, index) => (
                        <div key={item.key} className="flex items-center gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500 text-xs font-bold text-white">
                                {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="mb-2 flex items-start justify-between gap-4 text-sm">
                                    <span className="min-w-0 font-medium text-slate-700">
                                        {item.label}
                                    </span>
                                    <span className="shrink-0 font-bold text-slate-700">
                                        {formatPercent(item.percentage)}
                                    </span>
                                </div>
                                <PercentageBar
                                    value={item.percentage ?? 0}
                                    color={color}
                                />
                                <div className="mt-1 text-right text-[11px] text-slate-400">
                                    {item.count.toLocaleString("pt-BR")} conversas
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}

function DonutDistributionCard({
    title,
    description,
    data,
    centerLabel,
    colors = DISTRIBUTION_COLORS,
}: {
    title: string;
    description: string;
    data: DistributionPoint[];
    centerLabel: string;
    colors?: string[];
}) {
    const total = data.reduce((sum, item) => sum + item.count, 0);

    return (
        <Card className="min-w-0 overflow-hidden border-pink-100">
            <ChartHeader title={title} description={description} />
            {data.length === 0 ? (
                <EmptyMessage message="Sem dados suficientes no período." />
            ) : (
                <div className="mt-4 grid grid-cols-1 items-center gap-4 sm:grid-cols-[190px_1fr]">
                    <div className="relative h-52">
                        <ResponsiveContainer width="100%" height="100%" debounce={150}>
                            <PieChart>
                                <Pie
                                    data={data}
                                    dataKey="count"
                                    nameKey="label"
                                    innerRadius={55}
                                    outerRadius={86}
                                    paddingAngle={2}
                                    isAnimationActive={false}
                                >
                                    {data.map((item, index) => (
                                        <Cell
                                            key={item.key}
                                            fill={colors[index % colors.length]}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip content={<DistributionTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                            <div className="text-xl font-bold text-slate-800">
                                {total.toLocaleString("pt-BR")}
                            </div>
                            <div className="text-xs text-slate-500">{centerLabel}</div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {data.map((item, index) => (
                            <div
                                key={item.key}
                                className="flex items-start justify-between gap-3 text-sm"
                            >
                                <div className="flex min-w-0 items-start gap-2">
                                    <span
                                        className="mt-1 h-3 w-3 shrink-0 rounded-full"
                                        style={{
                                            backgroundColor:
                                                colors[index % colors.length],
                                        }}
                                    />
                                    <span className="min-w-0 text-slate-600">
                                        {item.label}
                                    </span>
                                </div>
                                <span className="shrink-0 font-medium text-slate-600">
                                    {formatPercent(item.percentage)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Card>
    );
}

function ColumnDistributionCard({
    title,
    description,
    data,
    color,
}: {
    title: string;
    description: string;
    data: DistributionPoint[];
    color: string;
}) {
    return (
        <Card className="min-w-0 overflow-hidden border-pink-100">
            <ChartHeader title={title} description={description} />
            {data.length === 0 ? (
                <EmptyMessage message="Sem dados suficientes no período." />
            ) : (
                <div className="mt-4 h-[300px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%" debounce={150}>
                        <BarChart
                            data={data}
                            margin={{ top: 18, right: 8, left: -4, bottom: 45 }}
                            barCategoryGap="26%"
                        >
                            <CartesianGrid
                                strokeDasharray="4 4"
                                stroke="#e2e8f0"
                                vertical={false}
                            />
                            <XAxis
                                dataKey="label"
                                tick={{ fontSize: 10 }}
                                stroke="#94a3b8"
                                interval={0}
                                angle={-18}
                                textAnchor="end"
                                height={64}
                            />
                            <YAxis
                                allowDecimals={false}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                            />
                            <Tooltip
                                content={<DistributionTooltip />}
                                cursor={{ fill: "#f8fafc" }}
                            />
                            <Bar
                                dataKey="count"
                                name="Conversas"
                                fill={color}
                                radius={[6, 6, 0, 0]}
                                maxBarSize={48}
                                isAnimationActive={false}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

function DistributionBarCard({
    title,
    description,
    data,
    color,
}: {
    title: string;
    description: string;
    data: DistributionPoint[];
    color: string;
}) {
    const height = Math.max(250, data.length * 40 + 60);

    return (
        <Card className="min-w-0 overflow-hidden border-pink-100">
            <ChartHeader title={title} description={description} />
            {data.length === 0 ? (
                <EmptyMessage message="Sem dados suficientes no período." />
            ) : (
                <div className="mt-4 min-w-0" style={{ height }}>
                    <ResponsiveContainer width="100%" height="100%" debounce={150}>
                        <BarChart
                            data={data}
                            layout="vertical"
                            margin={{ top: 4, right: 18, left: 8, bottom: 4 }}
                        >
                            <CartesianGrid
                                strokeDasharray="4 4"
                                stroke="#f1f5f9"
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
                                width={180}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                                interval={0}
                            />
                            <Tooltip content={<DistributionTooltip />} />
                            <Bar
                                dataKey="count"
                                name="Conversas"
                                fill={color}
                                radius={[0, 6, 6, 0]}
                                maxBarSize={24}
                                isAnimationActive={false}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

function QualityDimensionsCard({ data }: { data: QualityDimension[] }) {
    return (
        <Card className="min-w-0 overflow-hidden border-pink-100">
            <ChartHeader
                title="Dimensões da qualidade"
                description="Média das notas atribuídas ao atendimento, em uma escala de 0 a 100."
            />
            {data.length === 0 ? (
                <EmptyMessage message="Sem avaliações de qualidade no período." />
            ) : (
                <div className="mt-3 h-[340px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%" debounce={150}>
                        <RadarChart
                            data={data}
                            outerRadius="70%"
                            margin={{ top: 12, right: 32, bottom: 12, left: 32 }}
                        >
                            <PolarGrid stroke="#e2e8f0" />
                            <PolarAngleAxis
                                dataKey="label"
                                tick={{ fontSize: 11, fill: "#64748b" }}
                            />
                            <PolarRadiusAxis
                                domain={[0, 100]}
                                tickCount={6}
                                tick={{ fontSize: 10, fill: "#94a3b8" }}
                            />
                            <Tooltip content={<QualityTooltip />} />
                            <Radar
                                dataKey="score"
                                name="Nota média"
                                stroke={INSTAGRAM_PURPLE}
                                fill={INSTAGRAM_PURPLE}
                                fillOpacity={0.22}
                                strokeWidth={2.5}
                                isAnimationActive={false}
                            />
                        </RadarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

function ObjectionsCard({ data }: { data: ObjectionPoint[] }) {
    const height = Math.max(260, data.length * 46 + 60);

    return (
        <Card className="min-w-0 overflow-hidden border-pink-100">
            <ChartHeader
                title="Objeções identificadas"
                description="Quantidade de objeções resolvidas e não resolvidas por tipo."
            />
            {data.length === 0 ? (
                <EmptyMessage message="Nenhuma objeção identificada no período." />
            ) : (
                <>
                    <div className="mt-4 min-w-0" style={{ height }}>
                        <ResponsiveContainer width="100%" height="100%" debounce={150}>
                            <BarChart
                                data={data}
                                layout="vertical"
                                margin={{ top: 4, right: 18, left: 8, bottom: 4 }}
                            >
                                <CartesianGrid
                                    strokeDasharray="4 4"
                                    stroke="#f1f5f9"
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
                                    width={190}
                                    tick={{ fontSize: 11 }}
                                    stroke="#94a3b8"
                                    interval={0}
                                />
                                <Tooltip content={<ObjectionTooltip />} />
                                <Bar
                                    dataKey="resolved"
                                    name="Resolvidas"
                                    stackId="objections"
                                    fill={RESOLVED_GREEN}
                                    maxBarSize={26}
                                    isAnimationActive={false}
                                />
                                <Bar
                                    dataKey="unresolved"
                                    name="Não resolvidas"
                                    stackId="objections"
                                    fill={UNRESOLVED_ROSE}
                                    radius={[0, 6, 6, 0]}
                                    maxBarSize={26}
                                    isAnimationActive={false}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-500">
                        <ChartLegend color={RESOLVED_GREEN} label="Resolvidas" />
                        <ChartLegend
                            color={UNRESOLVED_ROSE}
                            label="Não resolvidas"
                        />
                    </div>
                </>
            )}
        </Card>
    );
}

function InstagramShareCard({ data }: { data: InstagramShareData }) {
    return (
        <Card className="mb-8 min-w-0 overflow-hidden border-pink-100">
            <InsightHeader
                title="Participação do Instagram nas conversas"
                description="Comparação do volume de conversas entre Instagram e WhatsApp."
            />

            <div className="mt-3 inline-flex max-w-full rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                Informação: este indicador compara apenas o volume de conversas entre os canais. Não rastreia se uma conversa do Instagram virou uma conversa no WhatsApp.
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MetricBox
                    label="Participação do Instagram"
                    value={formatPercent(data.instagram_percentage)}
                    detail="do total de conversas"
                />
                <MetricBox
                    label="Instagram"
                    value={data.instagram_conversations.toLocaleString("pt-BR")}
                    detail="conversas no período"
                />
                <MetricBox
                    label="WhatsApp"
                    value={data.whatsapp_conversations.toLocaleString("pt-BR")}
                    detail="conversas no período"
                />
            </div>

            {data.daily_evolution.length === 0 ? (
                <EmptyMessage message="Nenhuma conversa de Instagram ou WhatsApp no período." />
            ) : (
                <>
                    <div className="mt-6 h-[300px] min-w-0">
                        <ResponsiveContainer width="100%" height="100%" debounce={150}>
                            <ComposedChart
                                data={data.daily_evolution}
                                margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                            >
                                <CartesianGrid
                                    strokeDasharray="4 4"
                                    stroke="#f1f5f9"
                                    vertical={false}
                                />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 11 }}
                                    stroke="#94a3b8"
                                />
                                <YAxis
                                    yAxisId="count"
                                    allowDecimals={false}
                                    tick={{ fontSize: 11 }}
                                    stroke="#94a3b8"
                                />
                                <YAxis
                                    yAxisId="rate"
                                    orientation="right"
                                    domain={[0, 100]}
                                    tickFormatter={(value: number) => `${value}%`}
                                    tick={{ fontSize: 11 }}
                                    stroke="#94a3b8"
                                />
                                <Tooltip content={<ShareTooltip />} />
                                <Bar
                                    yAxisId="rate"
                                    dataKey="instagram_percentage"
                                    name="Participação do Instagram"
                                    fill={INSTAGRAM_LIGHT_PINK}
                                    stroke={INSTAGRAM_DARK_PINK}
                                    radius={[5, 5, 0, 0]}
                                    maxBarSize={34}
                                    isAnimationActive={false}
                                />
                                <Line
                                    yAxisId="count"
                                    type="monotone"
                                    dataKey="instagram_conversations"
                                    name="Instagram"
                                    stroke={INSTAGRAM_PINK}
                                    strokeWidth={2.5}
                                    dot={false}
                                    connectNulls
                                    isAnimationActive={false}
                                />
                                <Line
                                    yAxisId="count"
                                    type="monotone"
                                    dataKey="whatsapp_conversations"
                                    name="WhatsApp"
                                    stroke={WHATSAPP_GREEN}
                                    strokeWidth={2.5}
                                    dot={false}
                                    connectNulls
                                    isAnimationActive={false}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-500">
                        <ChartLegend color={INSTAGRAM_PINK} label="Instagram" />
                        <ChartLegend color={WHATSAPP_GREEN} label="WhatsApp" />
                        <ChartLegend
                            color={INSTAGRAM_DARK_PINK}
                            label="Participação do Instagram"
                        />
                    </div>
                </>
            )}
        </Card>
    );
}

function InsightHeader({
    title,
    description,
}: {
    title: string;
    description?: string;
}) {
    return (
        <div>
            <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-50 text-pink-600">
                    <FaInstagram size={19} aria-hidden="true" />
                </span>
                <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            </div>
            {description ? (
                <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">
                    {description}
                </p>
            ) : null}
        </div>
    );
}

function ChartHeader({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    return (
        <div>
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
    );
}

function MetricBox({
    label,
    value,
    detail,
}: {
    label: string;
    value: string;
    detail: string;
}) {
    return (
        <div className="rounded-xl border border-pink-100 bg-pink-50/40 px-4 py-3">
            <div className="text-xs font-semibold text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                {value}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">{detail}</div>
        </div>
    );
}

type TooltipPayloadItem = {
    name?: string;
    value?: number | null;
    dataKey?: string;
    payload?: unknown;
};

function AnalysisTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: TooltipPayloadItem[];
    label?: string;
}) {
    if (!active || !payload?.length) return null;

    return (
        <ChartTooltip title={label ?? ""}>
            {payload.map((item) => (
                <TooltipRow
                    key={String(item.dataKey)}
                    label={item.name ?? ""}
                    value={
                        item.dataKey === "conversations"
                            ? Number(item.value ?? 0).toLocaleString("pt-BR")
                            : formatPercent(item.value ?? null)
                    }
                />
            ))}
        </ChartTooltip>
    );
}

function DistributionTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: TooltipPayloadItem[];
}) {
    const point = payload?.[0]?.payload as DistributionPoint | undefined;
    if (!active || !point) return null;

    return (
        <ChartTooltip title={point.label}>
            <TooltipRow
                label="Conversas"
                value={point.count.toLocaleString("pt-BR")}
            />
            <TooltipRow
                label="Participação"
                value={formatPercent(point.percentage)}
            />
        </ChartTooltip>
    );
}

function QualityTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: TooltipPayloadItem[];
}) {
    const point = payload?.[0]?.payload as QualityDimension | undefined;
    if (!active || !point) return null;

    return (
        <ChartTooltip title={point.label}>
            <TooltipRow label="Nota média" value={formatScore(point.score)} />
            <TooltipRow
                label="Avaliações"
                value={point.observed.toLocaleString("pt-BR")}
            />
        </ChartTooltip>
    );
}

function ObjectionTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: TooltipPayloadItem[];
}) {
    const point = payload?.[0]?.payload as ObjectionPoint | undefined;
    if (!active || !point) return null;

    return (
        <ChartTooltip title={point.label}>
            <TooltipRow label="Total" value={point.total.toLocaleString("pt-BR")} />
            <TooltipRow
                label="Resolvidas"
                value={point.resolved.toLocaleString("pt-BR")}
            />
            <TooltipRow
                label="Não resolvidas"
                value={point.unresolved.toLocaleString("pt-BR")}
            />
            <TooltipRow
                label="Taxa de resolução"
                value={formatPercent(point.resolution_rate)}
            />
        </ChartTooltip>
    );
}

function ShareTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{
        payload?: InstagramShareData["daily_evolution"][number];
    }>;
    label?: string;
}) {
    const point = payload?.[0]?.payload;
    if (!active || !point) return null;

    return (
        <ChartTooltip title={label ?? ""}>
            <TooltipRow
                label="Instagram"
                value={point.instagram_conversations.toLocaleString("pt-BR")}
            />
            <TooltipRow
                label="WhatsApp"
                value={point.whatsapp_conversations.toLocaleString("pt-BR")}
            />
            <TooltipRow
                label="Participação"
                value={formatPercent(point.instagram_percentage)}
            />
        </ChartTooltip>
    );
}

function ChartTooltip({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <div className="min-w-[190px] max-w-[300px] rounded-xl border border-pink-100 bg-white px-4 py-3 shadow-lg">
            <div className="mb-2 text-xs font-bold text-slate-800">{title}</div>
            <div className="space-y-1.5">{children}</div>
        </div>
    );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-5 text-xs">
            <span className="text-slate-500">{label}</span>
            <span className="font-semibold text-slate-800">{value}</span>
        </div>
    );
}

function ChartLegend({
    color,
    label,
    dashed = false,
}: {
    color: string;
    label: string;
    dashed?: boolean;
}) {
    return (
        <div className="flex items-center gap-2">
            <span
                className="h-0.5 w-5"
                style={{
                    backgroundColor: color,
                    backgroundImage: dashed
                        ? "linear-gradient(to right, transparent 35%, white 35%)"
                        : undefined,
                    backgroundSize: dashed ? "6px 2px" : undefined,
                }}
            />
            <span>{label}</span>
        </div>
    );
}

function EmptyMessage({ message }: { message: string }) {
    return (
        <div className="mt-6 rounded-xl border border-dashed border-pink-200 px-5 py-10 text-center text-sm text-slate-400">
            {message}
        </div>
    );
}

function InstagramInsightsSkeleton({ mode }: { mode: InstagramInsightMode }) {
    if (mode === "share") {
        return (
            <Card className="mb-8 border-pink-100">
                <div className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9" />
                    <div className="space-y-2">
                        <Skeleton className="h-5 w-[280px]" />
                        <Skeleton className="h-3 w-[420px]" />
                    </div>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                        <Skeleton key={index} className="h-[88px] w-full" />
                    ))}
                </div>
                <Skeleton className="mt-6 h-[270px] w-full" />
            </Card>
        );
    }

    return (
        <div className="mb-8 space-y-5">
            <div className="flex items-center gap-3 px-1">
                <Skeleton className="h-9 w-9" />
                <div className="space-y-2">
                    <Skeleton className="h-5 w-[280px]" />
                    <Skeleton className="h-3 w-[420px]" />
                </div>
            </div>
            <div className="flex gap-5 overflow-hidden">
                {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton
                        key={index}
                        className="h-[130px] min-w-[270px] flex-1"
                    />
                ))}
            </div>
            <Skeleton className="h-[370px] w-full" />
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-[340px] w-full" />
                ))}
            </div>
        </div>
    );
}

function formatPercent(value: number | null) {
    if (value === null || !Number.isFinite(value)) return "—";
    return `${value.toLocaleString("pt-BR", {
        minimumFractionDigits: value % 1 === 0 ? 0 : 1,
        maximumFractionDigits: 1,
    })}%`;
}

function formatScore(value: number | null) {
    if (value === null || !Number.isFinite(value)) return "—";
    return value.toLocaleString("pt-BR", {
        minimumFractionDigits: value % 1 === 0 ? 0 : 1,
        maximumFractionDigits: 1,
    });
}

function formatDuration(value: number | null) {
    if (value === null || !Number.isFinite(value)) return "—";
    const seconds = Math.max(0, Math.round(value));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3_600) return `${Math.round(seconds / 60)} min`;

    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.round((seconds % 3_600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}
