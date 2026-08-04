// components/dashboard/InstagramConversationInsights.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FaInstagram } from "react-icons/fa6";
import {
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
import Skeleton from "@/components/ui/Skeleton";

const INSTAGRAM_PINK = "#ec4899";
const INSTAGRAM_DARK_PINK = "#be185d";
const INSTAGRAM_LIGHT_PINK = "#f9a8d4";
const WHATSAPP_GREEN = "#22c55e";

type InstagramInsightMode = "analysis" | "share";

type InstagramAnalysisData = {
    conversations_total: number;
    conversations_analyzed: number;
    analysis_coverage_rate: number | null;
    resolution_rate: number | null;
    resolution_observed: number;
    satisfaction_rate: number | null;
    satisfaction_observed: number;
    average_first_human_response_seconds: number | null;
    attendant_quality_score: number | null;
    attendant_quality_observed: number;
    daily_evolution: {
        date: string;
        date_iso: string;
        conversations: number;
        resolution_rate: number | null;
        satisfaction_rate: number | null;
        attendant_quality_score: number | null;
    }[];
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
        const debounceId = window.setTimeout(() => {
            void loadInstagramInsights();
        }, 120);

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

        return () => {
            window.clearTimeout(debounceId);
            controller.abort();
        };
    }, [mode, period, selectedRange.end, selectedRange.start]);

    if (loading) return <InstagramInsightsSkeleton />;

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
        <InstagramAnalysisCard data={data as InstagramAnalysisData} />
    ) : (
        <InstagramShareCard data={data as InstagramShareData} />
    );
}

function InstagramAnalysisCard({ data }: { data: InstagramAnalysisData }) {
    return (
        <Card className="mb-8 min-w-0 overflow-hidden border-pink-100">
            <InsightHeader title="Análise das conversas do Instagram" />

            <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                <MetricBox
                    label="Conversas analisadas"
                    value={data.conversations_analyzed.toLocaleString("pt-BR")}
                    detail={`${formatPercent(data.analysis_coverage_rate)} de ${data.conversations_total.toLocaleString("pt-BR")}`}
                />
                <MetricBox
                    label="Resolução"
                    value={formatPercent(data.resolution_rate)}
                    detail={`${data.resolution_observed.toLocaleString("pt-BR")} observadas`}
                />
                <MetricBox
                    label="Satisfação"
                    value={formatPercent(data.satisfaction_rate)}
                    detail={`${data.satisfaction_observed.toLocaleString("pt-BR")} observadas`}
                />
                <MetricBox
                    label="Qualidade do atendimento"
                    value={formatScore(data.attendant_quality_score)}
                    detail={`${data.attendant_quality_observed.toLocaleString("pt-BR")} avaliadas`}
                />
            </div>

            {data.daily_evolution.length === 0 ? (
                <EmptyMessage message="Nenhuma conversa do Instagram analisada no período." />
            ) : (
                <div className="mt-6 h-[290px] min-w-0">
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
                            <Tooltip content={<AnalysisTooltip />} />
                            <Bar
                                yAxisId="count"
                                dataKey="conversations"
                                name="Analisadas"
                                fill={INSTAGRAM_LIGHT_PINK}
                                radius={[5, 5, 0, 0]}
                                maxBarSize={30}
                                isAnimationActive={false}
                            />
                            <Line
                                yAxisId="rate"
                                type="monotone"
                                dataKey="resolution_rate"
                                name="Resolução"
                                stroke={INSTAGRAM_DARK_PINK}
                                strokeWidth={2.5}
                                dot={false}
                                connectNulls
                                isAnimationActive={false}
                            />
                            <Line
                                yAxisId="rate"
                                type="monotone"
                                dataKey="satisfaction_rate"
                                name="Satisfação"
                                stroke={INSTAGRAM_PINK}
                                strokeWidth={2.5}
                                strokeDasharray="6 4"
                                dot={false}
                                connectNulls
                                isAnimationActive={false}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}

            <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-500">
                <Legend color={INSTAGRAM_LIGHT_PINK} label="Conversas analisadas" />
                <Legend color={INSTAGRAM_DARK_PINK} label="Resolução" />
                <Legend color={INSTAGRAM_PINK} label="Satisfação" dashed />
            </div>
        </Card>
    );
}

function InstagramShareCard({ data }: { data: InstagramShareData }) {
    return (
        <Card className="mb-8 min-w-0 overflow-hidden border-pink-100">
            <InsightHeader
                title="Participação do Instagram nas conversas"
                description="Percentual diário entre Instagram e WhatsApp. Quanto maior o valor de Participação, maior a conversão entre Instagram e Whatsapp"
            />

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
                        <Legend color={INSTAGRAM_PINK} label="Instagram" />
                        <Legend color={WHATSAPP_GREEN} label="WhatsApp" />
                        <Legend
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

function AnalysisTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ name?: string; value?: number | null; dataKey?: string }>;
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
        <div className="min-w-[180px] rounded-xl border border-pink-100 bg-white px-4 py-3 shadow-lg">
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

function Legend({
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

function InstagramInsightsSkeleton() {
    return (
        <Card className="mb-8 border-pink-100">
            <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9" />
                <div className="space-y-2">
                    <Skeleton className="h-5 w-[280px]" />
                    <Skeleton className="h-3 w-[420px]" />
                </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-[88px] w-full" />
                ))}
            </div>
            <Skeleton className="mt-6 h-[270px] w-full" />
        </Card>
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
