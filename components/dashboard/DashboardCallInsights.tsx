// components/dashboard/DashboardCallInsights.tsx
"use client";

import { useEffect, useState } from "react";
import {
    HelpCircle,
    Minus,
    PhoneCall,
    ThumbsDown,
    ThumbsUp,
} from "lucide-react";
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
import HorizontalScroller from "@/components/ui/HorizontalScroller";
import InfoTooltip from "@/components/ui/InfoTooltip";
import KpiCard from "@/components/ui/KpiCard";
import Skeleton from "@/components/ui/Skeleton";
import { CLIENT_CALL_CLOSURE_OPTIONS } from "@/lib/clients/callTracking";
import { readUrlFilterValues } from "@/lib/dashboard/urlFilterParams";

type Props = {
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
};

type CallDashboardData = {
    total: number;
    good: number;
    neutral: number;
    bad: number;
    good_rate: number;
    neutral_rate: number;
    bad_rate: number;
    daily_evolution: Array<{
        date: string;
        date_iso: string;
        good: number;
        neutral: number;
        bad: number;
    }>;
};

const VOLUME = "#94a3b8";
const GOOD = "#0fbb73";
const NEUTRAL = "#1683ff";
const BAD = "#e43535";

const FINAL_TAG_EXPLANATION = [
    `Final bom: ${labelsForTone("positive")}.`,
    `Final neutro: ${labelsForTone("neutral")}.`,
    `Final ruim: ${labelsForTone("negative")}.`,
].join("\n");

export default function DashboardCallInsights({
    period,
    selectedRange,
}: Props) {
    const [data, setData] = useState<CallDashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const locationSearch =
        typeof window === "undefined" ? "" : window.location.search;

    useEffect(() => {
        const controller = new AbortController();
        const debounceId = window.setTimeout(() => {
            void loadCalls();
        }, 120);

        async function loadCalls() {
            setLoading(true);
            setError(null);

            try {
                const params = new URLSearchParams();
                applyCalendarDateParams({
                    params,
                    selectedRange,
                    selectedPreset: period,
                });

                const currentUrl = new URLSearchParams(locationSearch);
                const units = readUrlFilterValues(currentUrl, [
                    "unit",
                    "units",
                    "unit_id",
                    "unit_ids",
                ]);
                for (const unit of units) {
                    params.append("unit", unit);
                }

                const response = await fetch(
                    `/api/dashboard/calls?${params.toString()}`,
                    {
                        cache: "no-store",
                        signal: controller.signal,
                    },
                );
                const json = (await response.json()) as
                    | CallDashboardData
                    | { error?: string };

                if (!response.ok) {
                    throw new Error(
                        "error" in json && json.error
                            ? json.error
                            : "Falha ao carregar dados de ligações.",
                    );
                }

                setData(json as CallDashboardData);
            } catch (loadError) {
                if (controller.signal.aborted) return;
                console.error("[dashboard-calls] load failed", loadError);
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Falha ao carregar dados de ligações.",
                );
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        return () => {
            window.clearTimeout(debounceId);
            controller.abort();
        };
    }, [
        locationSearch,
        period,
        selectedRange.end,
        selectedRange.start,
    ]);

    if (loading) return <CallInsightsSkeleton />;

    if (error) {
        return (
            <Card className="border-red/20 bg-red-soft/20">
                <div className="text-sm font-medium text-red">{error}</div>
            </Card>
        );
    }

    if (!data) return null;

    const chartData = data.daily_evolution.map((item) => ({
        ...item,
        total: item.good + item.neutral + item.bad,
    }));

    return (
        <div className="min-w-0 space-y-5">
            <div className="px-1">
                <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-soft text-green">
                        <PhoneCall size={19} />
                    </span>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">
                            Ligações
                        </h2>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                            Resultados das ligações registradas no período, respeitando o filtro de unidade.
                        </p>
                    </div>
                </div>
            </div>

            <HorizontalScroller scrollAmount={360}>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<PhoneCall size={26} />}
                        label="Ligações realizadas"
                        currentValue={data.total}
                        formatter={(value: number) =>
                            value.toLocaleString("pt-BR")
                        }
                        color="green"
                    />
                </div>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<ThumbsUp size={26} />}
                        label="Final bom"
                        currentValue={data.good_rate}
                        suffix="%"
                        color="green"
                        tooltipText={`${data.good.toLocaleString("pt-BR")} ligações com final bom.`}
                    />
                </div>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<Minus size={26} />}
                        label="Final neutro"
                        currentValue={data.neutral_rate}
                        suffix="%"
                        color="blue"
                        tooltipText={`${data.neutral.toLocaleString("pt-BR")} ligações com final neutro.`}
                    />
                </div>
                <div className="min-w-[270px]">
                    <KpiCard
                        icon={<ThumbsDown size={26} />}
                        label="Final ruim"
                        currentValue={data.bad_rate}
                        suffix="%"
                        color="brand"
                        positiveDirection="down"
                        tooltipText={`${data.bad.toLocaleString("pt-BR")} ligações com final ruim.`}
                    />
                </div>
            </HorizontalScroller>

            <Card className="min-w-0 overflow-hidden">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">
                            Evolução das ligações
                        </h3>
                        <InfoTooltip
                            text={FINAL_TAG_EXPLANATION}
                            portal
                            fitContent
                        >
                            <HelpCircle size={15} className="text-slate-400" />
                        </InfoTooltip>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                        Volume diário de ligações com uma linha para cada tipo de final.
                    </p>
                </div>

                {data.total === 0 ? (
                    <div className="mt-6 rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center text-sm text-slate-400">
                        Nenhuma ligação registrada no período.
                    </div>
                ) : (
                    <>
                        <div className="mt-5 h-[300px] min-w-0">
                            <ResponsiveContainer
                                width="100%"
                                height="100%"
                                debounce={150}
                            >
                                <ComposedChart
                                    data={chartData}
                                    margin={{
                                        top: 8,
                                        right: 12,
                                        left: -8,
                                        bottom: 0,
                                    }}
                                    barCategoryGap="24%"
                                >
                                    <CartesianGrid
                                        strokeDasharray="4 4"
                                        stroke="#e2e8f0"
                                        vertical={false}
                                    />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 11 }}
                                        stroke="#94a3b8"
                                        minTickGap={22}
                                    />
                                    <YAxis
                                        allowDecimals={false}
                                        tick={{ fontSize: 11 }}
                                        stroke="#94a3b8"
                                    />
                                    <Tooltip content={<CallTooltip />} />
                                    <Bar
                                        dataKey="total"
                                        name="Volume de ligações"
                                        fill={VOLUME}
                                        fillOpacity={0.22}
                                        stroke={VOLUME}
                                        radius={[5, 5, 0, 0]}
                                        maxBarSize={44}
                                        isAnimationActive={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="good"
                                        name="Final bom"
                                        stroke={GOOD}
                                        strokeWidth={2.5}
                                        dot={{ r: 3 }}
                                        activeDot={{ r: 5 }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="neutral"
                                        name="Final neutro"
                                        stroke={NEUTRAL}
                                        strokeWidth={2.5}
                                        dot={{ r: 3 }}
                                        activeDot={{ r: 5 }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="bad"
                                        name="Final ruim"
                                        stroke={BAD}
                                        strokeWidth={2.5}
                                        dot={{ r: 3 }}
                                        activeDot={{ r: 5 }}
                                    />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-500">
                            <Legend color={VOLUME} label="Volume de ligações" />
                            <Legend color={GOOD} label="Final bom" />
                            <Legend color={NEUTRAL} label="Final neutro" />
                            <Legend color={BAD} label="Final ruim" />
                        </div>
                    </>
                )}
            </Card>
        </div>
    );
}

function labelsForTone(tone: "positive" | "neutral" | "negative") {
    return CLIENT_CALL_CLOSURE_OPTIONS.filter((option) => option.tone === tone)
        .map((option) => option.label)
        .join(", ");
}

function CallTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ name?: string; value?: number }>;
    label?: string;
}) {
    if (!active || !payload?.length) return null;

    return (
        <div className="min-w-[180px] rounded-xl border border-border bg-white px-4 py-3 shadow-lg">
            <div className="mb-2 text-xs font-bold text-slate-800">
                {label ?? ""}
            </div>
            <div className="space-y-1.5">
                {payload.map((item) => (
                    <div
                        key={item.name}
                        className="flex items-center justify-between gap-5 text-xs"
                    >
                        <span className="text-slate-500">{item.name}</span>
                        <span className="font-semibold text-slate-800">
                            {(item.value ?? 0).toLocaleString("pt-BR")}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function Legend({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
            />
            <span>{label}</span>
        </div>
    );
}

function CallInsightsSkeleton() {
    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3 px-1">
                <Skeleton className="h-9 w-9" />
                <div className="space-y-2">
                    <Skeleton className="h-5 w-[180px]" />
                    <Skeleton className="h-3 w-[320px]" />
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
