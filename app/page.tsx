// app/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Calendar,
    Clock,
    HelpCircle,
    MessageCircle,
    ShieldCheck,
    Smile,
} from "lucide-react";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    Pie,
    PieChart,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
    ZAxis,
} from "recharts";

import {
    applyArrayParams,
    applyCalendarDateParams,
} from "@/components/ui/CalendarButton";
import {
    Card,
    DashboardHeader,
    DashboardFilterBar,
    DashboardFilterBarSkeleton,
    HorizontalScroller,
    InfoTooltip,
    KpiCard,
    MainFilters,
    PercentageBar,
    PercentageValue,
    SidePanel,
    Skeleton,
} from "@/components";
import type { ExecutiveDashboardData, FiltersResponse } from "@/types";
import ExecutiveScheduleTable from "@/components/dashboard/ExecutiveScheduleTable";
import InstagramConversationInsights from "@/components/dashboard/InstagramConversationInsights";
import MessengerConversationInsights from "@/components/dashboard/MessengerConversationInsights";
import DashboardCallInsights from "@/components/dashboard/DashboardCallInsights";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import {
    getNormalizedUrlOptionNames,
    readUrlFilterValues,
    replaceUrlFilterParams,
    resolveUrlOptionValues,
} from "@/lib/dashboard/urlFilterParams";

export default function ExecutiveDashboardPage() {
    const [data, setData] = useState<ExecutiveDashboardData | null>(null);
    const hasDataRef = useRef(false);
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [attendantIds, setAttendantIds] = useState<string[]>([]);
    const [tunnelValues, setTunnelValues] = useState<string[]>([]);
    const [originValues, setOriginValues] = useState<string[]>([]);
    const [urlFiltersReady, setUrlFiltersReady] = useState(false);
    const initialUnitUrlValuesRef = useRef<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [wordMapLoading, setWordMapLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("current_month", undefined, {
        syncUrl: true,
    });

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);

        initialUnitUrlValuesRef.current = readUrlFilterValues(params, [
            "unit",
            "units",
            "unit_id",
            "unit_ids",
        ]);
        setAttendantIds(
            readUrlFilterValues(params, [
                "attendant",
                "attendants",
                "attendant_id",
                "attendant_ids",
            ]),
        );
        setTunnelValues(
            readUrlFilterValues(params, ["tunnel", "tunnels"]),
        );
        setOriginValues(
            readUrlFilterValues(params, ["origin", "origins"]),
        );
    }, []);

    const normalizedUnitUrlValues = useMemo(
        () =>
            getNormalizedUrlOptionNames(
                unitIds,
                filters?.units ?? [],
            ),
        [filters?.units, unitIds],
    );

    useEffect(() => {
        if (!urlFiltersReady || !dateFilterReady) return;

        replaceUrlFilterParams([
            {
                key: "unit",
                value: normalizedUnitUrlValues,
                aliases: ["units", "unit_id", "unit_ids"],
            },
            {
                key: "attendant",
                value: attendantIds,
                aliases: [
                    "attendants",
                    "attendant_id",
                    "attendant_ids",
                ],
            },
            {
                key: "tunnel",
                value: tunnelValues,
                aliases: ["tunnels"],
            },
            {
                key: "origin",
                value: originValues,
                aliases: ["origins"],
            },
        ]);
    }, [
        attendantIds,
        dateFilterReady,
        originValues,
        tunnelValues,
        normalizedUnitUrlValues,
        urlFiltersReady,
    ]);

    useEffect(() => {
        if (!dateFilterReady) return;
        const controller = new AbortController();

        async function loadFilters() {
            try {
                const response = await fetch(
                    "/api/dashboard/filters?entities=units,attendants,tunnels,origins",
                    { signal: controller.signal },
                );
                if (!response.ok) {
                    throw new Error("Falha ao carregar filtros do dashboard.");
                }
                const json: FiltersResponse = await response.json();
                setFilters(json);
                setUnitIds(
                    resolveUrlOptionValues(
                        initialUnitUrlValuesRef.current,
                        json.units ?? [],
                    ),
                );
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("[dashboard] filters failed", error);
            } finally {
                if (!controller.signal.aborted) {
                    setUrlFiltersReady(true);
                }
            }
        }

        void loadFilters();
        return () => controller.abort();
    }, [dateFilterReady]);

    useEffect(() => {
        if (!dateFilterReady || !urlFiltersReady) return;

        const controller = new AbortController();

        async function loadDashboard() {
            if (hasDataRef.current) setIsRefreshing(true);
            else setLoading(true);

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
                    `/api/dashboard/executivo?${params.toString()}`,
                    {
                        cache: "no-store",
                        signal: controller.signal,
                    },
                );
                const json = (await response.json()) as ExecutiveDashboardData & {
                    error?: string;
                };

                if (!response.ok) {
                    throw new Error(json.error ?? "Falha ao carregar dashboard.");
                }

                hasDataRef.current = true;
                setData(json);
                setWordMapLoading(true);
                void loadWordMap(params);
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("[dashboard] load failed", error);
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                    setIsRefreshing(false);
                }
            }
        }

        async function loadWordMap(params: URLSearchParams) {
            const wordParams = new URLSearchParams(params);
            wordParams.set("section", "word_map");

            try {
                const response = await fetch(
                    `/api/dashboard/executivo?${wordParams.toString()}`,
                    {
                        cache: "default",
                        signal: controller.signal,
                    },
                );
                const json = (await response.json()) as {
                    word_map?: ExecutiveDashboardData["word_map"];
                };
                if (!response.ok || !json.word_map) return;

                setData((current) =>
                    current
                        ? { ...current, word_map: json.word_map! }
                        : current,
                );
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("[dashboard] word map failed", error);
            } finally {
                if (!controller.signal.aborted) setWordMapLoading(false);
            }
        }

        const debounceId = window.setTimeout(() => {
            void loadDashboard();
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
        urlFiltersReady,
    ]);

    if (!dateFilterReady || !urlFiltersReady || loading) {
        return (
            <main className="flex h-full w-full md:h-screen md:w-screen overflow-x-hidden overflow-y-scroll bg-white text-slate-900">
                <SidePanel />
                <section className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
                    <DashboardHeader title="Dashboard" description="Acompanhe os principais indicadores de atendimento" period={period} setPeriod={setPeriod} selectedRange={selectedRange} setSelectedRange={setSelectedRange} storageManaged storageReady />
                    <DashboardFilterBarSkeleton widths={["w-[230px]", "w-[230px]", "w-[150px]"]} />
                    <DashboardBodySkeleton />
                </section>
            </main>
        );
    }

    if (!data) {
        return (
            <main className="min-h-screen bg-white p-8 text-slate-900">
                Nenhum dado encontrado.
            </main>
        );
    }

    const averageResponseMinutes = secondsToMinutes(
        data.kpis.average_first_human_response_seconds,
    );
    const previousAverageResponseMinutes = secondsToMinutes(
        data.previous_kpis.average_first_human_response_seconds,
    );
    const rawAverageResponseMinutes = secondsToMinutes(
        data.kpis.raw_average_first_human_response_seconds,
    );
    const medianResponseMinutes = secondsToMinutes(
        data.kpis.median_first_human_response_seconds,
    );
    const p90ResponseMinutes = secondsToMinutes(
        data.kpis.p90_first_human_response_seconds,
    );

    return (
        <main className="flex h-full w-full md:h-screen md:w-screen overflow-x-hidden overflow-y-scroll bg-white text-slate-900">
            <SidePanel />
            <section className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
                <DashboardHeader
                    title="Dashboard"
                    description="Acompanhe os principais indicadores de atendimento"
                    period={period}
                    setPeriod={setPeriod}
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                    storageManaged
                    storageReady={dateFilterReady}
                />

                <DashboardFilterBar>
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
                </DashboardFilterBar>

                {isRefreshing ? (
                    <DashboardBodySkeleton />
                ) : (
                    <div className="min-w-0 max-w-full overflow-x-hidden pb-12">
                        <section className="mb-6 grid grid-cols-1 gap-5">
                            <HorizontalScroller scrollAmount={400}>
                                <div className="min-w-[260px]">
                                    <KpiCard
                                        icon={<MessageCircle size={26} />}
                                        label="Conversas analisadas"
                                        currentValue={data.kpis.conversations_analyzed}
                                        previousValue={data.previous_kpis.conversations_analyzed}
                                        formatter={(value: number) => value.toLocaleString("pt-BR")}
                                        color="blue"
                                    />
                                </div>

                                <div className="min-w-[260px]">
                                    <KpiCard
                                        icon={<ShieldCheck size={26} />}
                                        label="Resolução real"
                                        currentValue={data.kpis.real_resolution_rate}
                                        previousValue={data.previous_kpis.real_resolution_rate}
                                        suffix="%"
                                        color="green"
                                    />
                                </div>

                                <div className="min-w-[260px]">
                                    <KpiCard
                                        icon={<Smile size={26} />}
                                        label="Clientes satisfeitos"
                                        currentValue={data.kpis.clear_satisfaction_rate}
                                        previousValue={data.previous_kpis.clear_satisfaction_rate}
                                        suffix="%"
                                        color="purple"
                                    />
                                </div>

                                <div className="min-w-[260px]">
                                    <KpiCard
                                        icon={<Calendar size={26} />}
                                        label="Taxa agendamentos"
                                        currentValue={data.kpis.scheduling_rate}
                                        previousValue={data.previous_kpis.scheduling_rate}
                                        suffix="%"
                                        tooltipText="Informação adquirida pelo Clinisys"
                                        color="purple"
                                    />
                                </div>

                                <div className="min-w-[260px]">
                                    <KpiCard
                                        icon={<Clock size={26} />}
                                        label="1ª resposta humana"
                                        currentValue={averageResponseMinutes}
                                        previousValue={previousAverageResponseMinutes}
                                        suffix=" min"
                                        tooltipText={responseTimingTooltip({
                                            filteredMeanMinutes: averageResponseMinutes,
                                            rawMeanMinutes: rawAverageResponseMinutes,
                                            medianMinutes: medianResponseMinutes,
                                            p90Minutes: p90ResponseMinutes,
                                            included:
                                                data.kpis.first_human_response_included_in_average,
                                            observed: data.kpis.first_human_response_observed,
                                            eligible: data.kpis.first_human_response_eligible,
                                            excludedOverTwoHours:
                                                data.kpis.first_human_response_excluded_over_2h,
                                            botHandoffToAttendant:
                                                data.response_anchor_breakdown.bot_handoff_to_attendant,
                                            pendingClientToAttendant:
                                                data.response_anchor_breakdown.pending_client_to_attendant,
                                        })}
                                        color="orange"
                                        positiveDirection="down"
                                    />
                                </div>
                            </HorizontalScroller>
                        </section>

                        <section className="mb-6 min-w-0 max-w-full">
                            <DailyEvolutionCard data={data} />
                        </section>

                        <section className="mb-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
                            <ConversationGoalsCard data={data} />
                            <DropoffCard data={data} />
                        </section>

                        <section className="mb-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
                            <ScheduleEvolutionCard data={data} />
                            <ScheduleCreationEvolutionCard data={data} />
                        </section>

                        <section className="mb-6 min-w-0 max-w-full">
                            <ExecutiveScheduleTable
                                data={data.schedule_unit_table}
                            />
                        </section>

                        <section className="mb-6 grid min-w-0 max-w-full grid-cols-1 gap-5 2xl:grid-cols-[1.35fr_1fr]">
                            <UnitEfficiencyMapCard data={data} />
                            <UnitViewCard data={data} />
                        </section>

                        <section className="grid min-w-0 max-w-full grid-cols-1 gap-5 xl:grid-cols-2">
                            <WordMapCard
                                data={data}
                                loading={wordMapLoading}
                            />
                            <UnitWordCorrelationCard
                                data={data}
                                loading={wordMapLoading}
                            />
                        </section>

                        <section className="mt-6 min-w-0 max-w-full">
                            <InstagramConversationInsights
                                mode="analysis"
                                period={period}
                                selectedRange={selectedRange}
                            />
                        </section>

                        <section className="mt-6 min-w-0 max-w-full">
                            <MessengerConversationInsights
                                mode="analysis"
                                period={period}
                                selectedRange={selectedRange}
                            />
                        </section>

                        <section className="mt-6 min-w-0 max-w-full">
                            <DashboardCallInsights
                                period={period}
                                selectedRange={selectedRange}
                            />
                        </section>
                    </div>
                )}
            </section>
        </main>
    );
}

function DailyEvolutionCard({ data }: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <h2 className="text-lg font-bold">Evolução de conversas</h2>
                <div className="mt-3 flex items-center gap-6 text-xs text-slate-500">
                    <LegendDot color="bg-blue-500" label="Conversas" />
                    <LegendDot color="bg-emerald-500" label="Resolução (%)" />
                    <LegendDot color="bg-violet-500" label="Satisfação (%)" />
                </div>
            </div>

            <div className="h-[290px]">
                <ResponsiveContainer width="100%" height="100%" debounce={200}>
                    <AreaChart data={data.daily_evolution}>
                        <defs>
                            <linearGradient id="conversationFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#1683ff" stopOpacity={0.22} />
                                <stop offset="95%" stopColor="#1683ff" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <YAxis
                            yAxisId="conversations"
                            tick={{ fontSize: 12 }}
                            stroke="#94a3b8"
                            allowDecimals={false}
                        />
                        <YAxis
                            yAxisId="percentage"
                            hide
                            orientation="right"
                            domain={[0, 100]}
                            ticks={[0, 25, 50, 75, 100]}
                            tick={{ fontSize: 12 }}
                            tickFormatter={(value: number) => String(value) + "%"}
                            stroke="#94a3b8"
                            width={44}
                        />
                        <Tooltip content={<DailyEvolutionTooltip />} />
                        <Area
                            type="monotone"
                            dataKey="conversations"
                            yAxisId="conversations"
                            stroke="#1683ff"
                            strokeWidth={3}
                            fill="url(#conversationFill)"
                        />
                        <Line
                            type="monotone"
                            dataKey="resolution_rate"
                            yAxisId="percentage"
                            stroke="#10b981"
                            strokeWidth={3}
                            dot={{ r: 4 }}
                        />
                        <Line
                            type="monotone"
                            dataKey="satisfaction_rate"
                            yAxisId="percentage"
                            stroke="#8b5cf6"
                            strokeWidth={3}
                            dot={{ r: 4 }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function ScheduleEvolutionCard({ data }: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <h2 className="text-lg font-bold">
                    Agendamentos no período
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                    <LegendDot color="bg-blue-500" label="Agendamentos únicos" />
                    <LegendDot color="bg-rose-500" label="Cancelados" />
                    <LegendDot color="bg-amber-500" label="Reagendados" />
                </div>
            </div>

            <div className="h-[290px]">
                <ResponsiveContainer width="100%" height="100%" debounce={200}>
                    <BarChart
                        data={data.schedule_evolution}
                        margin={{ top: 18, right: 8, bottom: 0, left: 0 }}
                        barCategoryGap="24%"
                    >
                        <CartesianGrid
                            strokeDasharray="4 4"
                            stroke="#e2e8f0"
                        />
                        <XAxis
                            dataKey="date"
                            tick={{ fontSize: 12 }}
                            stroke="#94a3b8"
                            minTickGap={24}
                        />
                        <YAxis
                            tick={{ fontSize: 12 }}
                            stroke="#94a3b8"
                            allowDecimals={false}
                            domain={[
                                0,
                                (maximum: number) =>
                                    Math.max(1, Math.ceil(maximum * 1.18)),
                            ]}
                        />
                        <Tooltip
                            content={<ScheduleEvolutionTooltip />}
                            cursor={{ fill: "#f8fafc" }}
                        />
                        <Bar
                            dataKey="unique_total"
                            fill="#1683ff"
                            shape={<ScheduleOverlayBar />}
                            isAnimationActive={false}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function ScheduleCreationEvolutionCard({
    data,
}: {
    data: ExecutiveDashboardData;
}) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Marcações por dia</h2>
                    <InfoTooltip text="Mostra quantos agendamentos foram criados no CliniSys em cada dia do período, independentemente da data marcada para a consulta.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
                <div className="mt-3 flex items-center gap-6 text-xs text-slate-500">
                    <LegendDot color="bg-cyan-500" label="Marcações realizadas" />
                </div>
            </div>

            <div className="h-[290px]">
                <ResponsiveContainer width="100%" height="100%" debounce={200}>
                    <BarChart
                        data={data.schedule_creation_evolution}
                        margin={{ top: 18, right: 8, bottom: 0, left: 0 }}
                        barCategoryGap="24%"
                    >
                        <CartesianGrid
                            strokeDasharray="4 4"
                            stroke="#e2e8f0"
                        />
                        <XAxis
                            dataKey="date"
                            tick={{ fontSize: 12 }}
                            stroke="#94a3b8"
                            minTickGap={24}
                        />
                        <YAxis
                            tick={{ fontSize: 12 }}
                            stroke="#94a3b8"
                            allowDecimals={false}
                            domain={[
                                0,
                                (maximum: number) =>
                                    Math.max(1, Math.ceil(maximum * 1.18)),
                            ]}
                        />
                        <Tooltip
                            content={<ScheduleCreationEvolutionTooltip />}
                            cursor={{ fill: "#f8fafc" }}
                        />
                        <Bar
                            dataKey="total"
                            fill="#06b6d4"
                            shape={<ScheduleCreationBar />}
                            isAnimationActive={false}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function DropoffCard({ data }: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Momentos de perda mais comuns</h2>
                    <InfoTooltip text="Somente abandonos com evidência de mensagem. A porcentagem usa como base apenas os abandonos observáveis do período.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
            </div>

            <div className="space-y-7">
                {data.dropoff_moments.map((item, index) => (
                    <div key={item.moment} className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-xs font-bold text-white">
                            {index + 1}
                        </span>
                        <div className="w-full">
                            <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">{item.label}</span>
                                <span className="font-bold text-slate-700">
                                    {item.percentage === null ? "—" : `${item.percentage}%`}
                                </span>
                            </div>
                            <PercentageBar value={item.percentage ?? 0} color="purple" />
                        </div>
                    </div>
                ))}

            </div>
        </Card>
    );
}

function ConversationGoalsCard({ data }: { data: ExecutiveDashboardData }) {
    const colors = ["#8b5cf6", "#1683ff", "#10b981", "#f97316", "#06b6d4"];

    return (
        <Card>
            <div className="mb-4 flex items-center gap-2">
                <h2 className="text-lg font-bold">Objetivo das conversas</h2>
                <InfoTooltip text="Participação de cada objetivo no total de conversas analisadas do período.">
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
            </div>

            <div className="grid grid-cols-[180px_1fr] items-center gap-4">
                <div className="relative h-48">
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <PieChart>
                            <Pie
                                data={data.conversation_goals}
                                dataKey="percentage"
                                nameKey="label"
                                innerRadius={52}
                                outerRadius={82}
                            >
                                {data.conversation_goals.map((_, index) => (
                                    <Cell key={index} fill={colors[index % colors.length]} />
                                ))}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <div className="text-xl font-bold">
                            {data.kpis.conversations_analyzed.toLocaleString("pt-BR")}
                        </div>
                        <div className="text-xs text-slate-500">conversas</div>
                    </div>
                </div>

                <div className="space-y-3">
                    {data.conversation_goals.map((item, index) => (
                        <div key={item.goal} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                                <span
                                    className="h-3 w-3 rounded-full"
                                    style={{ backgroundColor: colors[index % colors.length] }}
                                />
                                <span className="text-slate-600">{item.label}</span>
                            </div>
                            <span className="font-medium text-slate-600">
                                {item.percentage === null ? "—" : `${item.percentage}%`}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}

function UnitViewCard({ data }: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Visão por unidade</h2>
                <InfoTooltip text="No-show = Faltou ÷ (Compareceu + Faltou). Pendentes, cancelados e remarcados ficam fora dessa taxa.">
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
            </div>

            <div className="overflow-hidden rounded-xl">
                <div className="grid grid-cols-5 bg-slate-50 px-2 py-3 text-xs font-bold text-slate-500">
                    <div>Unidade</div>
                    <div>Resolução</div>
                    <div>Satisfação</div>
                    <div>Agendamentos únicos</div>
                    <div>No-show</div>
                </div>

                {data.by_unit.map((unit) => (
                    <div
                        key={unit.unit_id ?? unit.unit_name}
                        className="grid grid-cols-5 border-t border-slate-100 px-2 py-3 text-sm"
                    >
                        <div className="font-medium text-slate-600">{unit.unit_name}</div>
                        <div title={`Base observável: ${unit.resolution_observed}`}>
                            <PercentageValue value={unit.resolution_rate} greenFrom={70} orangeFrom={40} />
                        </div>
                        <div title={`Base observável: ${unit.satisfaction_observed}`}>
                            <PercentageValue value={unit.satisfaction_rate} greenFrom={70} orangeFrom={40} />
                        </div>
                        <div title="Clientes únicos com agendamento no CliniSys; registros repetidos e reagendamentos do mesmo paciente não aumentam a contagem.">
                            <span className="font-semibold text-slate-700">
                                {unit.unique_appointments_count.toLocaleString("pt-BR")}
                            </span>
                        </div>
                        <div title={`Faltas: ${unit.no_show} · base observada: ${unit.outcomes_observed}`}>
                            <NoShowValue value={unit.no_show_rate} />
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}

function UnitEfficiencyMapCard({
    data,
}: {
    data: ExecutiveDashboardData;
}) {
    const rows = data.by_unit.flatMap((unit) => {
        const normalizedUnitName = normalizeUnitName(unit.unit_name);
        if (
            normalizedUnitName === "campinas" ||
            normalizedUnitName === "sem unidade"
        ) {
            return [];
        }
        if (unit.raw_conversations <= 0 || unit.resolution_rate === null) {
            return [];
        }
        return [
            {
                unit: unit.unit_name,
                resolution_rate: unit.resolution_rate,
                real_schedule_rate: Number(
                    (
                        (unit.unique_appointments_count /
                            unit.raw_conversations) *
                        100
                    ).toFixed(1),
                ),
                conversations: unit.raw_conversations,
                appointments: unit.unique_appointments_count,
                no_show_rate: unit.no_show_rate,
                fill: unitEfficiencyColor(unit.no_show_rate),
            },
        ];
    });
    const averageResolution = average(
        rows.map((row) => row.resolution_rate),
    );
    const averageScheduling = average(
        rows.map((row) => row.real_schedule_rate),
    );
    const minimumResolution = Math.min(
        25,
        ...rows.map((row) => row.resolution_rate),
    );
    const maximumResolution = Math.max(
        75,
        ...rows.map((row) => row.resolution_rate),
    );
    const resolutionDomain: [number, number] = [
        minimumResolution < 25
            ? Math.max(
                  0,
                  Math.floor((minimumResolution - 5) / 5) * 5,
              )
            : 25,
        maximumResolution > 75
            ? Math.min(
                  100,
                  Math.ceil((maximumResolution + 5) / 5) * 5,
              )
            : 75,
    ];
    const maximumScheduling = Math.max(
        10,
        ...rows.map((row) => row.real_schedule_rate),
    );

    return (
        <Card>
            <div className="mb-4">
                <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold">
                            Mapa de eficiência das unidades
                        </h2>
                    <InfoTooltip text="Cruza a resolução com clientes únicos agendados no CliniSys divididos por todas as conversas da unidade no período. Reagendamentos e registros repetidos do mesmo paciente não inflam a taxa. O tamanho representa o volume total de conversas e a cor representa o no-show.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                <LegendDot color="bg-emerald-500" label="No-show ≤ 5%" />
                <LegendDot color="bg-amber-500" label="No-show 5–10%" />
                <LegendDot color="bg-rose-500" label="No-show > 10%" />
                <span>Bolha maior = mais conversas</span>
            </div>

            {rows.length === 0 ? (
                <div className="flex h-[280px] items-center justify-center text-sm text-slate-400">
                    Sem base suficiente por unidade neste período.
                </div>
            ) : (
                <div className="h-[390px]">
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <ScatterChart
                            margin={{ top: 20, right: 24, bottom: 28, left: 8 }}
                        >
                            <CartesianGrid
                                strokeDasharray="4 4"
                                stroke="#e2e8f0"
                            />
                            <XAxis
                                type="number"
                                dataKey="resolution_rate"
                                name="Resolução"
                                unit="%"
                                domain={resolutionDomain}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                                label={{
                                    value: "Resolução real (%)",
                                    position: "insideBottom",
                                    offset: -16,
                                    fontSize: 12,
                                    fill: "#64748b",
                                }}
                            />
                            <YAxis
                                type="number"
                                dataKey="real_schedule_rate"
                                name="Agendamento real"
                                unit="%"
                                domain={[
                                    0,
                                    Math.ceil(maximumScheduling * 1.15),
                                ]}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                                label={{
                                    value: "Agendamentos por conversa (%)",
                                    angle: -90,
                                    position: "insideLeft",
                                    dy: 44,
                                    fontSize: 12,
                                    fill: "#64748b",
                                }}
                            />
                            <ZAxis
                                type="number"
                                dataKey="conversations"
                                range={[90, 650]}
                            />
                            <ReferenceLine
                                x={averageResolution}
                                stroke="#94a3b8"
                                strokeDasharray="5 5"
                            />
                            <ReferenceLine
                                y={averageScheduling}
                                stroke="#94a3b8"
                                strokeDasharray="5 5"
                            />
                            <Tooltip
                                cursor={{ strokeDasharray: "4 4" }}
                                content={<UnitEfficiencyTooltip />}
                            />
                            <Scatter
                                data={rows}
                                shape={<UnitEfficiencyBubble />}
                                isAnimationActive={false}
                            />
                        </ScatterChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

type UnitEfficiencyBubbleProps = {
    cx?: number;
    cy?: number;
    size?: number;
    payload?: {
        unit?: string;
        fill?: string;
    };
};

function UnitEfficiencyBubble({
    cx = 0,
    cy = 0,
    size = 90,
    payload,
}: UnitEfficiencyBubbleProps) {
    const radius = Math.max(7, Math.sqrt(Math.max(size, 1) / Math.PI));
    const label = unitAbbreviation(payload?.unit ?? "");
    const color = payload?.fill ?? "#94a3b8";

    return (
        <g>
            <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={color}
                fillOpacity={0.82}
                stroke={color}
                strokeWidth={1.5}
            />
            <text
                x={cx}
                y={cy - radius - 6}
                textAnchor="middle"
                fill="#334155"
                fontSize={10}
                fontWeight={800}
                style={{
                    paintOrder: "stroke",
                    stroke: "white",
                    strokeWidth: 3,
                }}
            >
                {label}
            </text>
        </g>
    );
}

function unitAbbreviation(unitName: string) {
    const normalized = normalizeUnitName(unitName);
    const abbreviations: Record<string, string> = {
        "sao paulo": "SP",
        "rio de janeiro": "RJ",
        salvador: "SA",
        brasilia: "BR",
        "juiz de fora": "JF",
        "belo horizonte": "BH",
        manaus: "MA",
        vitoria: "VI",
        bauru: "BA",
    };

    return (
        abbreviations[normalized] ??
        normalized
            .split(/\s+/)
            .filter((part) => part.length > 2)
            .slice(0, 2)
            .map((part) => part[0]?.toLocaleUpperCase("pt-BR"))
            .join("")
            .slice(0, 2)
    );
}

function normalizeUnitName(unitName: string) {
    return unitName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLocaleLowerCase("pt-BR");
}

function WordMapCard({
    data,
    loading,
}: {
    data: ExecutiveDashboardData;
    loading: boolean;
}) {
    const words = data.word_map?.words ?? [];
    const maximum = Math.max(1, ...words.map((word) => word.mentions));
    const minimum = Math.min(maximum, ...words.map((word) => word.mentions));
    const palette = ["#0866ff", "#1683ff", "#8b5cf6", "#0f9f94", "#d97706"];

    return (
        <Card>
            <h2 className="text-lg font-bold">Mapa de palavras</h2>

            {loading ? (
                <Skeleton className="mt-5 h-[300px] w-full rounded-2xl" />
            ) : words.length === 0 ? (
                <div className="flex h-[300px] items-center justify-center text-sm text-slate-400">
                    Nenhuma palavra disponível neste período.
                </div>
            ) : (
                <div className="flex min-h-[300px] flex-wrap content-center items-center justify-center gap-x-4 gap-y-3 px-3 py-6 text-center">
                    {words.map((word, index) => {
                        const scale =
                            maximum === minimum
                                ? 0.5
                                : (word.mentions - minimum) /
                                  (maximum - minimum);
                        return (
                            <span
                                key={word.word}
                                className="cursor-default font-bold leading-none"
                                style={{
                                    color: palette[index % palette.length],
                                    fontSize: `${14 + scale * 24}px`,
                                    opacity: 0.68 + scale * 0.32,
                                }}
                                title={`${word.mentions.toLocaleString("pt-BR")} citações em ${word.conversations.toLocaleString("pt-BR")} conversas`}
                            >
                                {word.word}
                            </span>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

function UnitWordCorrelationCard({
    data,
    loading,
}: {
    data: ExecutiveDashboardData;
    loading: boolean;
}) {
    const words = (data.word_map?.words ?? []).slice(0, 6);
    const units = data.word_map?.by_unit ?? [];
    const maximum = Math.max(
        1,
        ...units.flatMap((unit) => unit.words.map((word) => word.mentions)),
    );

    return (
        <Card>
            <h2 className="text-lg font-bold">Palavras por unidade</h2>

            {loading ? (
                <Skeleton className="mt-5 h-[300px] w-full rounded-2xl" />
            ) : words.length === 0 || units.length === 0 ? (
                <div className="flex h-[300px] items-center justify-center text-sm text-slate-400">
                    Nenhuma correlação disponível neste período.
                </div>
            ) : (
                <div className="mt-5 overflow-x-auto rounded-xl border border-slate-100">
                    <div className="min-w-[620px]">
                        <div
                            className="grid items-center gap-2 bg-slate-50 px-3 py-3 text-[10px] font-bold text-slate-500"
                            style={{
                                gridTemplateColumns: `minmax(130px, 1.25fr) repeat(${words.length}, minmax(66px, 1fr))`,
                            }}
                        >
                            <span>Unidade</span>
                            {words.map((word) => (
                                <span key={word.word} className="truncate text-center" title={word.word}>
                                    {word.word}
                                </span>
                            ))}
                        </div>

                        {units.map((unit) => {
                            const byWord = new Map(
                                unit.words.map((word) => [word.word, word]),
                            );
                            return (
                                <div
                                    key={unit.unit_id ?? unit.unit_name}
                                    className="grid items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-xs"
                                    style={{
                                        gridTemplateColumns: `minmax(130px, 1.25fr) repeat(${words.length}, minmax(66px, 1fr))`,
                                    }}
                                >
                                    <span className="truncate font-semibold text-slate-700" title={unit.unit_name}>
                                        {unit.unit_name}
                                    </span>
                                    {words.map((word) => {
                                        const value = byWord.get(word.word)?.mentions ?? 0;
                                        const intensity = value / maximum;
                                        return (
                                            <span
                                                key={word.word}
                                                className="rounded-lg px-2 py-2 text-center font-bold"
                                                style={{
                                                    backgroundColor: `rgba(22, 131, 255, ${0.06 + intensity * 0.76})`,
                                                    color: intensity > 0.5 ? "#ffffff" : "#334155",
                                                }}
                                                title={`${unit.unit_name}: ${value.toLocaleString("pt-BR")} citações de “${word.word}”`}
                                            >
                                                {value.toLocaleString("pt-BR")}
                                            </span>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </Card>
    );
}

function UnitEfficiencyTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: Array<{
        payload?: {
            unit?: string;
            resolution_rate?: number;
            real_schedule_rate?: number;
            conversations?: number;
            appointments?: number;
            no_show_rate?: number | null;
        };
    }>;
}) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs shadow-lg">
            <div className="mb-2 text-sm font-bold text-slate-800">
                {row.unit}
            </div>
            <div className="space-y-1 text-slate-600">
                <div>Resolução: {formatPercent(row.resolution_rate)}</div>
                <div>
                    Agendamentos por conversa:{" "}
                    {formatPercent(row.real_schedule_rate)}
                </div>
                <div>
                    {Number(row.appointments ?? 0).toLocaleString("pt-BR")} agendamentos ·{" "}
                    {Number(row.conversations ?? 0).toLocaleString("pt-BR")} conversas
                </div>
                <div>No-show: {formatPercent(row.no_show_rate)}</div>
            </div>
        </div>
    );
}

function unitEfficiencyColor(noShowRate: number | null) {
    if (noShowRate === null) return "#94a3b8";
    if (noShowRate <= 5) return "#10b981";
    if (noShowRate <= 10) return "#f59e0b";
    return "#f43f5e";
}

function average(values: number[]) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value: number | null | undefined) {
    return value === null || value === undefined
        ? "—"
        : `${value.toLocaleString("pt-BR", {
              maximumFractionDigits: 1,
          })}%`;
}

function NoShowValue({ value }: { value: number | null }) {
    if (value === null) {
        return <span className="font-bold text-slate-400">—</span>;
    }

    const color =
        value <= 5
            ? "var(--color-green)"
            : value <= 10
              ? "var(--color-orange)"
              : "var(--color-brand)";

    return (
        <span className="font-bold" style={{ color }}>
            {value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
        </span>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full ${color}`} />
            <span>{label}</span>
        </div>
    );
}

function DashboardSkeleton() {
    return (
        <>
            <div className="mb-8 flex items-start justify-between">
                <div>
                    <Skeleton className="h-9 w-[320px]" />
                    <Skeleton className="mt-3 h-4 w-[260px]" />
                </div>
                <Skeleton className="h-12 w-[310px]" />
            </div>
            <div className="mb-8 flex justify-end gap-3">
                {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-12 w-[220px]" />
                ))}
            </div>
            <DashboardBodySkeleton />
        </>
    );
}

function DashboardBodySkeleton() {
    return (
        <>
            <section className="mb-6 grid grid-cols-1 gap-5">
                <HorizontalScroller scrollAmount={400}>
                    {Array.from({ length: 5 }).map((_, index) => (
                        <div key={index} className="min-w-[260px]">
                            <Card>
                                <div className="flex items-center gap-5 overflow-hidden">
                                    <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
                                    <div className="min-w-0 flex-1">
                                        <Skeleton className="h-3 w-[55%]" />
                                        <Skeleton className="mt-3 h-8 w-[40%]" />
                                        <Skeleton className="mt-3 h-3 w-[75%]" />
                                    </div>
                                </div>
                            </Card>
                        </div>
                    ))}
                </HorizontalScroller>
            </section>

            <section className="mb-6 min-w-0 max-w-full">
                <DashboardChartSkeleton heightClassName="h-[290px]" />
            </section>

            <section className="mb-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
                <Card>
                    <Skeleton className="mb-5 h-6 w-[38%]" />
                    <div className="grid grid-cols-[180px_1fr] items-center gap-4">
                        <Skeleton className="h-48 w-48 rounded-full" />
                        <div className="space-y-4">
                            {Array.from({ length: 5 }).map((_, index) => (
                                <Skeleton key={index} className="h-4 w-full" />
                            ))}
                        </div>
                    </div>
                </Card>
                <Card>
                    <Skeleton className="mb-6 h-6 w-[48%]" />
                    <div className="space-y-7">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} className="flex items-center gap-3">
                                <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
                                <div className="min-w-0 flex-1">
                                    <Skeleton className="h-4 w-[58%]" />
                                    <Skeleton className="mt-2 h-2 w-full rounded-full" />
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </section>

            <section className="mb-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
                <DashboardChartSkeleton heightClassName="h-[290px]" />
                <DashboardChartSkeleton heightClassName="h-[290px]" />
            </section>

            <section className="mb-6 min-w-0 max-w-full">
                <DashboardTableSkeleton columns={5} rows={7} />
            </section>

            <section className="mb-6 grid min-w-0 max-w-full grid-cols-1 gap-5 2xl:grid-cols-[1.35fr_1fr]">
                <DashboardChartSkeleton heightClassName="h-[390px]" />
                <DashboardTableSkeleton columns={5} rows={6} />
            </section>

            <section className="grid min-w-0 max-w-full grid-cols-1 gap-5 xl:grid-cols-2">
                <Card>
                    <Skeleton className="h-6 w-[34%]" />
                    <Skeleton className="mt-5 h-[300px] w-full rounded-2xl" />
                </Card>
                <Card>
                    <Skeleton className="h-6 w-[38%]" />
                    <Skeleton className="mt-5 h-[300px] w-full rounded-xl" />
                </Card>
            </section>

            <div className="mt-6">
                <DashboardChannelSkeleton />
            </div>
            <div className="mt-6">
                <DashboardChannelSkeleton />
            </div>
            <div className="mt-6">
                <DashboardChannelSkeleton compact />
            </div>
        </>
    );
}

function DashboardChartSkeleton({
    heightClassName,
}: {
    heightClassName: string;
}) {
    return (
        <Card>
            <Skeleton className="h-6 w-[36%]" />
            <div className="mt-3 flex gap-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className={`mt-5 w-full ${heightClassName}`} />
        </Card>
    );
}

function DashboardTableSkeleton({
    columns,
    rows,
}: {
    columns: number;
    rows: number;
}) {
    return (
        <Card>
            <Skeleton className="mb-5 h-6 w-[32%]" />
            <div className="overflow-hidden rounded-xl border border-slate-100">
                <div
                    className="grid gap-4 bg-slate-50 px-3 py-3"
                    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                >
                    {Array.from({ length: columns }).map((_, index) => (
                        <Skeleton key={index} className="h-3 w-[72%]" />
                    ))}
                </div>
                {Array.from({ length: rows }).map((_, rowIndex) => (
                    <div
                        key={rowIndex}
                        className="grid gap-4 border-t border-slate-100 px-3 py-3"
                        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                    >
                        {Array.from({ length: columns }).map((_, columnIndex) => (
                            <Skeleton key={columnIndex} className="h-4 w-[76%]" />
                        ))}
                    </div>
                ))}
            </div>
        </Card>
    );
}

function DashboardChannelSkeleton({ compact = false }: { compact?: boolean }) {
    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3 px-1">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <div className="min-w-0 flex-1">
                    <Skeleton className="h-5 w-[250px] max-w-[62%]" />
                    <Skeleton className="mt-2 h-3 w-[420px] max-w-[82%]" />
                </div>
            </div>
            <div className="flex gap-5 overflow-hidden">
                {Array.from({ length: compact ? 3 : 4 }).map((_, index) => (
                    <Skeleton
                        key={index}
                        className="h-[118px] min-w-[250px] flex-1 rounded-2xl"
                    />
                ))}
            </div>
            <Skeleton className={`${compact ? "h-[280px]" : "h-[340px]"} w-full rounded-2xl`} />
            {!compact ? (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                    <Skeleton className="h-[320px] w-full rounded-2xl" />
                    <Skeleton className="h-[320px] w-full rounded-2xl" />
                </div>
            ) : null}
        </div>
    );
}

type ChartTooltipPayloadItem = {
    dataKey: string;
    value: string | number | null;
    color?: string;
    payload?: Record<string, unknown>;
};

function DailyEvolutionTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: ChartTooltipPayloadItem[];
    label?: string;
}) {
    if (!active || !payload?.length) return null;

    const labels: Record<string, string> = {
        conversations: "Conversas",
        resolution_rate: "Resolução",
        satisfaction_rate: "Satisfação",
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="mb-3 text-sm font-semibold text-slate-800">{label}</div>
            <div className="mt-2 space-y-2 text-sm">
                {payload.map((item) => (
                    <div key={item.dataKey} className="flex items-center justify-between gap-6">
                        <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                            <span style={{ color: item.color }}>{labels[item.dataKey] ?? item.dataKey}</span>
                        </div>
                        <span className="font-semibold" style={{ color: item.color }}>
                            {item.value === null ? "—" : item.value}
                            {item.value !== null && item.dataKey.includes("rate") ? "%" : ""}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ScheduleEvolutionTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: ChartTooltipPayloadItem[];
    label?: string;
}) {
    if (!active || !payload?.length) return null;

    const row = payload[0]?.payload ?? {};
    const total = typeof row.unique_total === "number" ? row.unique_total : 0;
    const cancelled =
        typeof row.unique_cancelled === "number" ? row.unique_cancelled : 0;
    const rescheduled =
        typeof row.unique_rescheduled === "number" ? row.unique_rescheduled : 0;

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="mb-3 text-sm font-semibold text-slate-800">
                {label}
            </div>
            <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-6">
                    <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                        <span className="text-slate-600">Agendamentos únicos</span>
                    </div>
                    <span className="font-semibold text-slate-800">
                        {total.toLocaleString("pt-BR")}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-6">
                    <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                        <span className="text-slate-600">Cancelados</span>
                    </div>
                    <span className="font-semibold text-slate-800">
                        {cancelled.toLocaleString("pt-BR")}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-6">
                    <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                        <span className="text-slate-600">Reagendados</span>
                    </div>
                    <span className="font-semibold text-slate-800">
                        {rescheduled.toLocaleString("pt-BR")}
                    </span>
                </div>
            </div>
        </div>
    );
}

function ScheduleCreationEvolutionTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: ChartTooltipPayloadItem[];
    label?: string;
}) {
    if (!active || !payload?.length) return null;

    const total = Number(payload[0]?.value ?? 0);

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="mb-3 text-sm font-semibold text-slate-800">
                {label}
            </div>
            <div className="flex items-center justify-between gap-6 text-sm">
                <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-cyan-500" />
                    <span className="text-slate-600">Marcações realizadas</span>
                </div>
                <span className="font-semibold text-slate-800">
                    {total.toLocaleString("pt-BR")}
                </span>
            </div>
        </div>
    );
}

type ScheduleCreationBarProps = {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    payload?: {
        total?: number;
    };
};

function ScheduleCreationBar({
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    payload,
}: ScheduleCreationBarProps) {
    const total = Math.max(Number(payload?.total ?? 0), 0);

    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={6}
                fill="#06b6d4"
            />
            <text
                x={x + width / 2}
                y={y - 7}
                textAnchor="middle"
                fill="#334155"
                fontSize={11}
                fontWeight={700}
            >
                {total.toLocaleString("pt-BR")}
            </text>
        </g>
    );
}

type ScheduleOverlayBarProps = {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    payload?: {
        unique_total?: number;
        unique_cancelled?: number;
        unique_rescheduled?: number;
    };
};

function ScheduleOverlayBar({
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    payload,
}: ScheduleOverlayBarProps) {
    const total = Math.max(Number(payload?.unique_total ?? 0), 0);
    const cancelled = Math.min(
        Math.max(Number(payload?.unique_cancelled ?? 0), 0),
        total,
    );
    const rescheduled = Math.min(
        Math.max(Number(payload?.unique_rescheduled ?? 0), 0),
        total,
    );
    const cancelledHeight = total > 0 ? (height * cancelled) / total : 0;
    const rescheduledHeight = total > 0 ? (height * rescheduled) / total : 0;
    const cancelledWidth = Math.max(8, Math.min(width * 0.5, 18));
    const rescheduledWidth = Math.max(6, Math.min(width * 0.3, 11));

    return (
        <g>
            <rect x={x} y={y} width={width} height={height} rx={6} fill="#1683ff" />
            {cancelled > 0 ? (
                <rect
                    x={x + (width - cancelledWidth) / 2}
                    y={y + height - cancelledHeight}
                    width={cancelledWidth}
                    height={cancelledHeight}
                    rx={Math.min(4, cancelledWidth / 2)}
                    fill="#f43f5e"
                />
            ) : null}
            {rescheduled > 0 ? (
                <rect
                    x={x + width - rescheduledWidth - 1}
                    y={y + height - rescheduledHeight}
                    width={rescheduledWidth}
                    height={rescheduledHeight}
                    rx={Math.min(3, rescheduledWidth / 2)}
                    fill="#f59e0b"
                />
            ) : null}
            <text
                x={x + width / 2}
                y={y - 7}
                textAnchor="middle"
                fill="#334155"
                fontSize={11}
                fontWeight={700}
            >
                {total.toLocaleString("pt-BR")}
            </text>
        </g>
    );
}

function secondsToMinutes(value: number | null): number | null {
    return value === null ? null : Math.round(value / 60);
}

function responseTimingTooltip({
    filteredMeanMinutes,
    rawMeanMinutes,
    medianMinutes,
    p90Minutes,
    included,
    observed,
    eligible,
    excludedOverTwoHours,
    botHandoffToAttendant,
    pendingClientToAttendant,
}: {
    filteredMeanMinutes: number | null;
    rawMeanMinutes: number | null;
    medianMinutes: number | null;
    p90Minutes: number | null;
    included: number;
    observed: number;
    eligible: number;
    excludedOverTwoHours: number;
    botHandoffToAttendant: number;
    pendingClientToAttendant: number;
}): string {
    return [
        `Média sem respostas acima de 2h: ${formatMinutes(filteredMeanMinutes)}`,
        `Média bruta: ${formatMinutes(rawMeanMinutes)}`,
        `Mediana: ${formatMinutes(medianMinutes)}`,
        `P90: ${formatMinutes(p90Minutes)}`,
        `Base da média: ${included.toLocaleString("pt-BR")} de ${observed.toLocaleString("pt-BR")} respostas observadas`,
        `${eligible.toLocaleString("pt-BR")} conversas elegíveis`,
        `${excludedOverTwoHours.toLocaleString("pt-BR")} respostas acima de 2h removidas`,
        "",
        "Origem da 1ª resposta observada:",
        `Bot handoff → atendente: ${botHandoffToAttendant.toLocaleString("pt-BR")}`,
        `Mensagem pendente do cliente → atendente: ${pendingClientToAttendant.toLocaleString("pt-BR")}`,
    ].join("\n");
}

function formatMinutes(value: number | null): string {
    return value === null ? "—" : `${value.toLocaleString("pt-BR")} min`;
}
