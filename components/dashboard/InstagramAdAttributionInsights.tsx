"use client";

import { useEffect, useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
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

const COLORS = [
    "#ec4899",
    "#a855f7",
    "#1683ff",
    "#10b981",
    "#f59e0b",
    "#06b6d4",
    "#fb7185",
    "#64748b",
];
const ATTRIBUTED_COLOR = "#ec4899";
const UNATTRIBUTED_COLOR = "#cbd5e1";

type DistributionRow = {
    key: string;
    label: string;
    count: number;
    percentage: number | null;
};

type InstagramAttributionData = {
    available: boolean;
    total_clients: number;
    attributed_clients: number;
    unattributed_clients: number;
    attribution_rate: number | null;
    campaign_distribution: DistributionRow[];
    top_ads: Array<
        DistributionRow & {
            campaign_name: string | null;
        }
    >;
};

type Props = {
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
};

export default function InstagramAdAttributionInsights({
    period,
    selectedRange,
}: Props) {
    const [data, setData] = useState<InstagramAttributionData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const debounceId = window.setTimeout(() => {
            void loadData();
        }, 120);

        async function loadData() {
            setLoading(true);
            setError(null);

            try {
                const params = new URLSearchParams();
                applyCalendarDateParams({
                    params,
                    selectedRange,
                    selectedPreset: period,
                });
                const response = await fetch(
                    `/api/dashboard/instagram-attribution?${params.toString()}`,
                    {
                        cache: "no-store",
                        signal: controller.signal,
                    },
                );
                const json = (await response.json()) as
                    | InstagramAttributionData
                    | { error?: string };

                if (!response.ok) {
                    throw new Error(
                        "error" in json && json.error
                            ? json.error
                            : "Falha ao carregar atribuição do Instagram.",
                    );
                }

                setData(json as InstagramAttributionData);
            } catch (loadError) {
                if (controller.signal.aborted) return;
                console.error("[instagram-attribution] load failed", loadError);
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Falha ao carregar atribuição do Instagram.",
                );
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        return () => {
            window.clearTimeout(debounceId);
            controller.abort();
        };
    }, [period, selectedRange.end, selectedRange.start]);

    if (loading) return <AttributionSkeleton />;

    if (error) {
        return (
            <Card className="border-rose-100 bg-rose-50/30">
                <p className="text-sm font-medium text-rose-700">{error}</p>
            </Card>
        );
    }

    if (!data || !data.available) return null;

    const coverageData = [
        {
            key: "attributed",
            label: "Atribuídos",
            count: data.attributed_clients,
            percentage: data.attribution_rate,
        },
        {
            key: "unattributed",
            label: "Não atribuídos",
            count: data.unattributed_clients,
            percentage:
                data.total_clients > 0
                    ? Number(
                          (
                              (data.unattributed_clients / data.total_clients) *
                              100
                          ).toFixed(1),
                      )
                    : null,
        },
    ].filter((row) => row.count > 0);

    const campaignRows = data.campaign_distribution
        .filter((row) => row.key !== "__unattributed__")
        .slice(0, 8);

    return (
        <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
            <Card className="min-w-0 overflow-hidden border-pink-100">
                <div className="mb-4">
                    <h3 className="text-lg font-bold text-slate-800">
                        Origem paga dos clientes
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                        Clientes do Instagram no período com referral de anúncio capturado pelo Zernio.
                    </p>
                </div>

                {data.total_clients === 0 ? (
                    <EmptyState text="Nenhum cliente do Instagram no período." />
                ) : (
                    <div className="grid min-h-[290px] grid-cols-1 items-center gap-4 sm:grid-cols-[210px_minmax(0,1fr)]">
                        <div className="relative h-[210px]">
                            <ResponsiveContainer width="100%" height="100%" debounce={150}>
                                <PieChart>
                                    <Pie
                                        data={coverageData}
                                        dataKey="count"
                                        nameKey="label"
                                        innerRadius={58}
                                        outerRadius={84}
                                        paddingAngle={2}
                                        isAnimationActive={false}
                                    >
                                        {coverageData.map((row) => (
                                            <Cell
                                                key={row.key}
                                                fill={
                                                    row.key === "attributed"
                                                        ? ATTRIBUTED_COLOR
                                                        : UNATTRIBUTED_COLOR
                                                }
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(value: number | string, _name, item) => [
                                            `${Number(value).toLocaleString("pt-BR")} clientes (${formatPercent(item.payload?.percentage)})`,
                                            item.payload?.label ?? "",
                                        ]}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                                <span className="text-2xl font-bold text-slate-800">
                                    {formatPercent(data.attribution_rate)}
                                </span>
                                <span className="text-xs text-slate-400">
                                    atribuídos
                                </span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {coverageData.map((row) => (
                                <div key={row.key}>
                                    <div className="flex items-center justify-between gap-4 text-sm">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span
                                                className="h-3 w-3 shrink-0 rounded-full"
                                                style={{
                                                    backgroundColor:
                                                        row.key === "attributed"
                                                            ? ATTRIBUTED_COLOR
                                                            : UNATTRIBUTED_COLOR,
                                                }}
                                            />
                                            <span className="truncate text-slate-600">
                                                {row.label}
                                            </span>
                                        </div>
                                        <strong className="shrink-0 text-slate-700">
                                            {row.count.toLocaleString("pt-BR")}
                                        </strong>
                                    </div>
                                    <div className="ml-5 mt-1 text-xs text-slate-400">
                                        {formatPercent(row.percentage)} dos clientes
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Card>

            <Card className="min-w-0 overflow-hidden border-pink-100">
                <div className="mb-4">
                    <h3 className="text-lg font-bold text-slate-800">
                        Clientes por campanha
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                        Última campanha atribuída de cada cliente no período.
                    </p>
                </div>

                {campaignRows.length === 0 ? (
                    <EmptyState text="Ainda não há campanhas atribuídas neste período." />
                ) : (
                    <div
                        className="w-full min-w-0"
                        style={{ height: Math.max(250, campaignRows.length * 46 + 70) }}
                    >
                        <ResponsiveContainer width="100%" height="100%" debounce={150}>
                            <BarChart
                                data={campaignRows}
                                layout="vertical"
                                margin={{ top: 4, right: 28, bottom: 8, left: 4 }}
                            >
                                <CartesianGrid
                                    strokeDasharray="4 4"
                                    stroke="#e2e8f0"
                                    horizontal={false}
                                />
                                <XAxis
                                    type="number"
                                    allowDecimals={false}
                                    stroke="#94a3b8"
                                    tick={{ fontSize: 11 }}
                                />
                                <YAxis
                                    type="category"
                                    dataKey="label"
                                    width={150}
                                    stroke="#94a3b8"
                                    tick={{ fontSize: 11 }}
                                />
                                <Tooltip
                                    formatter={(value: number | string, _name, item) => [
                                        `${Number(value).toLocaleString("pt-BR")} clientes (${formatPercent(item.payload?.percentage)})`,
                                        "Clientes",
                                    ]}
                                />
                                <Bar
                                    dataKey="count"
                                    fill={ATTRIBUTED_COLOR}
                                    radius={[0, 7, 7, 0]}
                                    isAnimationActive={false}
                                >
                                    {campaignRows.map((row, index) => (
                                        <Cell
                                            key={row.key}
                                            fill={COLORS[index % COLORS.length]}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </Card>
        </div>
    );
}

function AttributionSkeleton() {
    return (
        <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
                <Card key={index} className="border-pink-100">
                    <Skeleton className="h-6 w-[42%]" />
                    <Skeleton className="mt-2 h-3 w-[68%]" />
                    <Skeleton className="mt-5 h-[290px] w-full rounded-2xl" />
                </Card>
            ))}
        </div>
    );
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="flex min-h-[250px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 text-center text-sm text-slate-400">
            {text}
        </div>
    );
}

function formatPercent(value: number | null | undefined) {
    if (value === null || value === undefined) return "—";
    return `${value.toLocaleString("pt-BR", {
        maximumFractionDigits: 1,
    })}%`;
}
