// components/dashboard/MessengerConversationInsights.tsx
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
import { FaFacebookF } from "react-icons/fa6";
import {
    Area,
    AreaChart,
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
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
import Skeleton from "@/components/ui/Skeleton";

const MESSENGER_BLUE = "#1683ff";
const MESSENGER_DARK_BLUE = "#0866ff";
const MESSENGER_LIGHT_BLUE = "#93c5fd";
const MESSENGER_PURPLE = "#8b5cf6";
const RESOLVED_GREEN = "#10b981";
const AMBER = "#f59e0b";
const WHATSAPP_GREEN = "#22c55e";

type MessengerInsightMode = "analysis" | "share";

type MessengerAnalysisData = {
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
    }[];
};

type MessengerShareData = {
    total_conversations: number;
    messenger_conversations: number;
    whatsapp_conversations: number;
    messenger_percentage: number | null;
    daily_evolution: {
        date: string;
        date_iso: string;
        total_conversations: number;
        messenger_conversations: number;
        whatsapp_conversations: number;
        messenger_percentage: number | null;
    }[];
};

type Props = {
    mode: MessengerInsightMode;
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
};

export default function MessengerConversationInsights({
    mode,
    period,
    selectedRange,
}: Props) {
    const [data, setData] = useState<
        MessengerAnalysisData | MessengerShareData | null
    >(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const debounceId = window.setTimeout(() => {
            void loadMessengerInsights();
        }, 120);

        async function loadMessengerInsights() {
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
                        ? "/api/dashboard/messenger-analysis"
                        : "/api/dashboard/messenger-share";
                const response = await fetch(
                    `${endpoint}?${params.toString()}`,
                    {
                        cache: "no-store",
                        signal: controller.signal,
                    },
                );
                const json = (await response.json()) as
                    | MessengerAnalysisData
                    | MessengerShareData
                    | { error?: string };

                if (!response.ok) {
                    throw new Error(
                        "error" in json && json.error
                            ? json.error
                            : "Falha ao carregar dados do Messenger.",
                    );
                }

                setData(json as MessengerAnalysisData | MessengerShareData);
            } catch (loadError) {
                if (controller.signal.aborted) return;
                console.error("[messenger-insights] load failed", loadError);
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Falha ao carregar dados do Messenger.",
                );
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        return () => {
            window.clearTimeout(debounceId);
            controller.abort();
        };
    }, [mode, period, selectedRange.end, selectedRange.start]);

    if (loading) return <MessengerInsightsSkeleton mode={mode} />;

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
        <MessengerAnalysisSection data={data as MessengerAnalysisData} />
    ) : (
        <MessengerShareCard data={data as MessengerShareData} />
    );
}

function MessengerAnalysisSection({ data }: { data: MessengerAnalysisData }) {
    return (
        <div className="mb-8 min-w-0 space-y-5">
            <div className="px-1">
                <InsightHeader
                    title="Análise das conversas do Messenger"
                    description="Indicadores extraídos exclusivamente das conversas cujo canal é Facebook Messenger."
                />
            </div>

            <HorizontalScroller scrollAmount={360}>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<MessageCircle size={26} />}
                        label="Conversas analisadas"
                        currentValue={data.conversations_analyzed}
                        formatter={(value: number) => value.toLocaleString("pt-BR")}
                        color="blue"
                        tooltipText={`${formatPercent(data.analysis_coverage_rate)} de cobertura entre ${data.conversations_total.toLocaleString("pt-BR")} conversas do Messenger. ${data.notable_count.toLocaleString("pt-BR")} foram marcadas como notáveis.`}
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
                        color="blue"
                        tooltipText={`${data.attendant_quality_observed.toLocaleString("pt-BR")} conversas com qualidade geral avaliada.`}
                    />
                </div>
            </HorizontalScroller>

            <MessengerEvolutionCard data={data} />
        </div>
    );
}

function MessengerEvolutionCard({ data }: { data: MessengerAnalysisData }) {
    return (
        <Card className="min-w-0 overflow-hidden border-blue-100">
            <ChartHeader
                title="Evolução diária do Messenger"
                description="Volume analisado e evolução das taxas de resolução, satisfação e abandono."
            />

            {data.daily_evolution.length === 0 ? (
                <EmptyMessage message="Nenhuma conversa do Messenger analisada no período." />
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
                                        id="messengerConversationFill"
                                        x1="0"
                                        y1="0"
                                        x2="0"
                                        y2="1"
                                    >
                                        <stop
                                            offset="5%"
                                            stopColor={MESSENGER_BLUE}
                                            stopOpacity={0.24}
                                        />
                                        <stop
                                            offset="95%"
                                            stopColor={MESSENGER_BLUE}
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
                                    stroke={MESSENGER_BLUE}
                                    strokeWidth={3}
                                    fill="url(#messengerConversationFill)"
                                    isAnimationActive={false}
                                />
                                <Line
                                    yAxisId="rate"
                                    type="monotone"
                                    dataKey="resolution_rate"
                                    name="Resolução"
                                    stroke={MESSENGER_PURPLE}
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
                                    strokeWidth={3}
                                    dot={{ r: 3 }}
                                    connectNulls
                                    isAnimationActive={false}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-500">
                        <Legend color={MESSENGER_BLUE} label="Conversas analisadas" />
                        <Legend color={MESSENGER_PURPLE} label="Resolução" />
                        <Legend color={RESOLVED_GREEN} label="Satisfação" />
                        <Legend color={AMBER} label="Abandono" />
                    </div>
                </>
            )}
        </Card>
    );
}

function MessengerShareCard({ data }: { data: MessengerShareData }) {
    return (
        <Card className="mb-8 min-w-0 overflow-hidden border-blue-100">
            <InsightHeader
                title="Participação do Messenger nas conversas"
                description="Percentual diário entre Messenger e WhatsApp. Quanto maior o valor de participação, maior o peso do Messenger entre esses canais."
            />

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MetricBox
                    label="Participação do Messenger"
                    value={formatPercent(data.messenger_percentage)}
                    detail="do total de conversas"
                />
                <MetricBox
                    label="Messenger"
                    value={data.messenger_conversations.toLocaleString("pt-BR")}
                    detail="conversas no período"
                />
                <MetricBox
                    label="WhatsApp"
                    value={data.whatsapp_conversations.toLocaleString("pt-BR")}
                    detail="conversas no período"
                />
            </div>

            {data.daily_evolution.length === 0 ? (
                <EmptyMessage message="Nenhuma conversa de Messenger ou WhatsApp no período." />
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
                                    dataKey="messenger_percentage"
                                    name="Participação do Messenger"
                                    fill={MESSENGER_LIGHT_BLUE}
                                    stroke={MESSENGER_DARK_BLUE}
                                    radius={[5, 5, 0, 0]}
                                    maxBarSize={34}
                                    isAnimationActive={false}
                                />
                                <Line
                                    yAxisId="count"
                                    type="monotone"
                                    dataKey="messenger_conversations"
                                    name="Messenger"
                                    stroke={MESSENGER_BLUE}
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
                        <Legend color={MESSENGER_BLUE} label="Messenger" />
                        <Legend color={WHATSAPP_GREEN} label="WhatsApp" />
                        <Legend
                            color={MESSENGER_DARK_BLUE}
                            label="Participação do Messenger"
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
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <FaFacebookF size={19} aria-hidden="true" />
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
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
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
                            ? formatCount(item.value ?? null)
                            : formatPercent(item.value ?? null)
                    }
                />
            ))}
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
        payload?: MessengerShareData["daily_evolution"][number];
    }>;
    label?: string;
}) {
    const point = payload?.[0]?.payload;
    if (!active || !point) return null;

    return (
        <ChartTooltip title={label ?? ""}>
            <TooltipRow
                label="Messenger"
                value={point.messenger_conversations.toLocaleString("pt-BR")}
            />
            <TooltipRow
                label="WhatsApp"
                value={point.whatsapp_conversations.toLocaleString("pt-BR")}
            />
            <TooltipRow
                label="Participação"
                value={formatPercent(point.messenger_percentage)}
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
        <div className="min-w-[190px] max-w-[300px] rounded-xl border border-blue-100 bg-white px-4 py-3 shadow-lg">
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

function Legend({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <span
                className="h-0.5 w-5"
                style={{ backgroundColor: color }}
            />
            <span>{label}</span>
        </div>
    );
}

function EmptyMessage({ message }: { message: string }) {
    return (
        <div className="mt-6 rounded-xl border border-dashed border-blue-200 px-5 py-10 text-center text-sm text-slate-400">
            {message}
        </div>
    );
}

function MessengerInsightsSkeleton({ mode }: { mode: MessengerInsightMode }) {
    if (mode === "share") {
        return (
            <Card className="mb-8 border-blue-100">
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

function formatDuration(value: number | null) {
    if (value === null || !Number.isFinite(value)) return "—";
    const seconds = Math.max(0, Math.round(value));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3_600) return `${Math.round(seconds / 60)} min`;

    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.round((seconds % 3_600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

function formatCount(value: number | null) {
    if (value === null || !Number.isFinite(value)) return "—";
    return value.toLocaleString("pt-BR");
}
