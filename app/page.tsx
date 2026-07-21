// app/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
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
    LabelList,
    Line,
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
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import {
    Card,
    DashboardHeader,
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

export default function ExecutiveDashboardPage() {
    const [data, setData] = useState<ExecutiveDashboardData | null>(null);
    const hasDataRef = useRef(false);
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [attendantIds, setAttendantIds] = useState<string[]>([]);
    const [tunnelValues, setTunnelValues] = useState<string[]>([]);
    const [originValues, setOriginValues] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [period, setPeriod] = useState<CalendarPresetValue | null>("yesterday");
    const [selectedRange, setSelectedRange] = useState<DateRange>({
        start: null,
        end: null,
    });

    useEffect(() => {
        async function loadFilters() {
            const response = await fetch(
                "/api/dashboard/filters?entities=units,attendants,tunnels,origins",
            );
            const json: FiltersResponse = await response.json();
            setFilters(json);
        }

        void loadFilters();
    }, []);

    useEffect(() => {
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

        // React Strict Mode runs effects twice in development. Debouncing and
        // aborting the obsolete request prevents duplicate dashboard RPCs and
        // also collapses rapid filter changes into one database load.
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
    ]);

    if (loading) {
        return (
            <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
                <SidePanel />
                <section className="flex-1 px-8 py-8">
                    <DashboardSkeleton />
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
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel />
            <section className="flex-1 px-8 py-8">
                <DashboardHeader
                    title="Dashboard"
                    description="Acompanhe os principais indicadores de atendimento"
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
                    <DashboardBodySkeleton />
                ) : (
                    <div className="overflow-x-hidden pb-12">
                        <section className="mb-6 grid grid-cols-1 gap-5">
                            <HorizontalScroller scrollAmount={400}>
                                <div className="min-w-[260px]">
                                    <KpiCard
                                        icon={<MessageCircle size={26} />}
                                        label="Conversas analisadas"
                                        currentValue={data.kpis.conversations_analyzed}
                                        previousValue={data.previous_kpis.conversations_analyzed}
                                        formatter={(value) => value.toLocaleString("pt-BR")}
                                        color="purple"
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
                                        label="Clientes claramente satisfeitos"
                                        currentValue={data.kpis.clear_satisfaction_rate}
                                        previousValue={data.previous_kpis.clear_satisfaction_rate}
                                        suffix="%"
                                        color="blue"
                                    />
                                </div>

                                <div className="min-w-[260px]">
                                    <KpiCard
                                        icon={<Calendar size={26} />}
                                        label="Taxa de agendamento"
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
                                        label="1ª resposta humana média"
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

                        <section className="mb-6 grid grid-cols-[1.45fr_0.95fr] gap-5">
                            <DailyEvolutionCard data={data} />
                            <DropoffCard data={data} />
                        </section>

                        <section className="mb-6 grid grid-cols-[1.45fr_0.95fr] gap-5">
                            <ScheduleEvolutionCard data={data} />
                            <ScheduleUnitDistributionCard data={data} />
                        </section>

                        <section className="grid grid-cols-2 gap-5">
                            <ConversationGoalsCard data={data} />
                            <UnitViewCard data={data} />
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
                <h2 className="text-lg font-bold">Evolução diária</h2>
                <div className="mt-3 flex items-center gap-6 text-xs text-slate-500">
                    <LegendDot color="bg-blue-500" label="Conversas" />
                    <LegendDot color="bg-violet-500" label="Resolução (%)" />
                    <LegendDot color="bg-emerald-500" label="Satisfação (%)" />
                </div>
            </div>

            <div className="h-[290px]">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.daily_evolution}>
                        <defs>
                            <linearGradient id="conversationFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#1683ff" stopOpacity={0.22} />
                                <stop offset="95%" stopColor="#1683ff" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <Tooltip content={<DailyEvolutionTooltip />} />
                        <Area
                            type="monotone"
                            dataKey="conversations"
                            stroke="#1683ff"
                            strokeWidth={3}
                            fill="url(#conversationFill)"
                        />
                        <Line
                            type="monotone"
                            dataKey="resolution_rate"
                            stroke="#8b5cf6"
                            strokeWidth={3}
                            dot={{ r: 4 }}
                        />
                        <Line
                            type="monotone"
                            dataKey="satisfaction_rate"
                            stroke="#10b981"
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
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">
                        Agendamentos no período
                    </h2>
                    <InfoTooltip text="Cada barra azul é o total de consultas pela data marcada no CliniSys, incluindo canceladas e reagendadas. As barras menores mostram canceladas (vermelho) e reagendadas (amarelo), sobrepostas ao total na mesma escala.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                    <LegendDot color="bg-blue-500" label="Agendamentos" />
                    <LegendDot color="bg-rose-500" label="Cancelados" />
                    <LegendDot color="bg-amber-500" label="Reagendados" />
                </div>
            </div>

            <div className="h-[290px]">
                <ResponsiveContainer width="100%" height="100%">
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
                            dataKey="total"
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

function ScheduleUnitDistributionCard({
    data,
}: {
    data: ExecutiveDashboardData;
}) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">
                        Agendamentos por unidade
                    </h2>
                    <InfoTooltip text="Conta um registro por agendamento cuja data marcada está no período selecionado, agrupado pela unidade do CliniSys. Cancelados permanecem no total.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                    1 registro por agendamento · cancelados incluídos
                </p>
            </div>

            {data.schedules_by_unit.length === 0 ? (
                <div className="flex h-[290px] items-center justify-center text-sm text-slate-400">
                    Nenhum agendamento no período.
                </div>
            ) : (
                <div className="h-[335px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={data.schedules_by_unit}
                            layout="vertical"
                            margin={{ left: 8, right: 42 }}
                            barCategoryGap="24%"
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
                                domain={[
                                    0,
                                    (maximum: number) =>
                                        Math.max(
                                            1,
                                            Math.ceil(maximum * 1.18),
                                        ),
                                ]}
                            />
                            <YAxis
                                type="category"
                                dataKey="unit_name"
                                width={148}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                            />
                            <Tooltip
                                content={<ScheduleUnitTooltip />}
                                cursor={false}
                            />
                            <Bar
                                dataKey="count"
                                fill="#1683ff"
                                radius={[0, 7, 7, 0]}
                            >
                                <LabelList
                                    dataKey="count"
                                    position="right"
                                    fill="#334155"
                                    fontSize={11}
                                    fontWeight={700}
                                    formatter={formatChartCount}
                                />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
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
                <p className="mt-1 text-xs text-slate-500">
                    Base: abandonos com evidência
                </p>
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
                    <ResponsiveContainer width="100%" height="100%">
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
                <InfoTooltip text="Cada taxa usa a mesma definição e o mesmo denominador elegível do KPI principal. Passe o mouse para ver a base.">
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
            </div>

            <div className="overflow-hidden rounded-xl">
                <div className="grid grid-cols-4 bg-slate-50 px-2 py-3 text-xs font-bold text-slate-500">
                    <div>Unidade</div>
                    <div>Resolução</div>
                    <div>Satisfação</div>
                    <div>Agendamentos</div>
                </div>

                {data.by_unit.map((unit) => (
                    <div
                        key={unit.unit_id ?? unit.unit_name}
                        className="grid grid-cols-4 border-t border-slate-100 px-2 py-3 text-sm"
                    >
                        <div className="font-medium text-slate-600">{unit.unit_name}</div>
                        <div title={`Base observável: ${unit.resolution_observed}`}>
                            <PercentageValue value={unit.resolution_rate} greenFrom={70} orangeFrom={40} />
                        </div>
                        <div title={`Base observável: ${unit.satisfaction_observed}`}>
                            <PercentageValue value={unit.satisfaction_rate} greenFrom={70} orangeFrom={40} />
                        </div>
                        <div title="Agendamentos importados da agenda do CliniSys">
                            <span className="font-semibold text-slate-700">
                                {unit.appointments_count.toLocaleString("pt-BR")}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </Card>
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
            <section className="mb-6 grid grid-cols-[1.45fr_0.95fr] gap-5">
                <Card>
                    <div className="mb-5"><Skeleton className="h-6 w-[30%]" /><Skeleton className="mt-3 h-4 w-[55%]" /></div>
                    <Skeleton className="h-[290px] w-full" />
                </Card>
                <Card>
                    <Skeleton className="h-6 w-[55%]" /><Skeleton className="mt-3 h-4 w-[72%]" />
                    <div className="mt-7 space-y-6">{Array.from({ length: 4 }).map((_, index) => (<div key={index} className="grid grid-cols-[32px_minmax(0,1fr)_48px] items-center gap-3"><Skeleton className="h-8 w-8 rounded-full" /><div><Skeleton className="h-4 w-[72%]" /><Skeleton className="mt-2 h-2 w-full rounded-full" /></div><Skeleton className="h-4 w-10" /></div>))}</div>
                </Card>
            </section>
            <section className="mb-6 grid grid-cols-[1.45fr_0.95fr] gap-5">
                <Card><Skeleton className="h-6 w-[40%]" /><Skeleton className="mt-3 h-4 w-[62%]" /><Skeleton className="mt-5 h-[290px] w-full" /></Card>
                <Card><Skeleton className="h-6 w-[48%]" /><Skeleton className="mt-3 h-4 w-[52%]" /><div className="mt-6 space-y-4">{Array.from({ length: 6 }).map((_, index) => (<div key={index} className="grid grid-cols-[100px_1fr] items-center gap-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-5 w-full rounded" /></div>))}</div></Card>
            </section>
            <section className="grid grid-cols-2 gap-5">
                <Card><Skeleton className="mb-5 h-6 w-[45%]" /><div className="grid grid-cols-[180px_1fr] items-center gap-6"><Skeleton className="h-[170px] w-[170px] rounded-full" /><div className="space-y-4">{Array.from({ length: 4 }).map((_, index) => (<Skeleton key={index} className="h-4 w-full" />))}</div></div></Card>
                <Card><Skeleton className="mb-5 h-6 w-[35%]" /><div className="overflow-hidden rounded-xl border border-slate-100"><div className="grid grid-cols-4 gap-4 bg-slate-50 px-2 py-3">{Array.from({ length: 4 }).map((_, index) => (<Skeleton key={index} className="h-3 w-[70%]" />))}</div>{Array.from({ length: 4 }).map((_, rowIndex) => (<div key={rowIndex} className="grid grid-cols-4 gap-4 border-t border-slate-100 px-2 py-3">{Array.from({ length: 4 }).map((_, columnIndex) => (<Skeleton key={columnIndex} className="h-4 w-[72%]" />))}</div>))}</div></Card>
            </section>
        </>
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
    const total = typeof row.total === "number" ? row.total : 0;
    const cancelled =
        typeof row.cancelled === "number" ? row.cancelled : 0;
    const rescheduled =
        typeof row.rescheduled === "number" ? row.rescheduled : 0;

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="mb-3 text-sm font-semibold text-slate-800">
                {label}
            </div>
            <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-6">
                    <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                        <span className="text-slate-600">Agendamentos</span>
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

function ScheduleUnitTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: ChartTooltipPayloadItem[];
}) {
    if (!active || !payload?.length) return null;

    const row = payload[0]?.payload ?? {};
    const unitName =
        typeof row.unit_name === "string" ? row.unit_name : "Unidade";
    const count = typeof row.count === "number" ? row.count : 0;
    const percentage =
        typeof row.percentage === "number" ? row.percentage : null;

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="text-sm font-semibold text-slate-800">
                {unitName}
            </div>
            <div className="mt-2 text-sm text-slate-600">
                {count.toLocaleString("pt-BR")} agendamentos
                {percentage === null ? "" : ` · ${percentage}% do período`}
            </div>
        </div>
    );
}

type ScheduleOverlayBarProps = {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    payload?: {
        total?: number;
        cancelled?: number;
        rescheduled?: number;
    };
};

function ScheduleOverlayBar({
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    payload,
}: ScheduleOverlayBarProps) {
    const total = Math.max(Number(payload?.total ?? 0), 0);
    const cancelled = Math.min(
        Math.max(Number(payload?.cancelled ?? 0), 0),
        total,
    );
    const rescheduled = Math.min(
        Math.max(Number(payload?.rescheduled ?? 0), 0),
        total,
    );
    const cancelledHeight =
        total > 0 ? (height * cancelled) / total : 0;
    const rescheduledHeight =
        total > 0 ? (height * rescheduled) / total : 0;
    const cancelledY = y + height - cancelledHeight;
    const rescheduledY = y + height - rescheduledHeight;
    const compactOverlays = width < 12;
    const overlayGap = Math.max(1, Math.min(width * 0.08, 3));
    const regularOverlayWidth = Math.max(2, Math.min(width * 0.32, 10));
    const regularOverlaysWidth = regularOverlayWidth * 2 + overlayGap;
    const cancelledWidth = compactOverlays
        ? Math.max(1, width * 0.7)
        : regularOverlayWidth;
    const rescheduledWidth = compactOverlays
        ? Math.max(1, width * 0.36)
        : regularOverlayWidth;
    const cancelledX = compactOverlays
        ? x + (width - cancelledWidth) / 2
        : x + (width - regularOverlaysWidth) / 2;
    const rescheduledX = compactOverlays
        ? x + (width - rescheduledWidth) / 2
        : cancelledX + regularOverlayWidth + overlayGap;
    const cancelledRadius = Math.min(
        1.5,
        cancelledWidth / 4,
        cancelledHeight / 2,
    );
    const rescheduledRadius = Math.min(
        1.5,
        rescheduledWidth / 4,
        rescheduledHeight / 2,
    );

    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={6}
                fill="#1683ff"
            />
            {cancelledHeight > 0 ? (
                <rect
                    x={cancelledX}
                    y={cancelledY}
                    width={cancelledWidth}
                    height={cancelledHeight}
                    rx={cancelledRadius}
                    fill="#f43f5e"
                />
            ) : null}
            {rescheduledHeight > 0 ? (
                <rect
                    x={rescheduledX}
                    y={rescheduledY}
                    width={rescheduledWidth}
                    height={rescheduledHeight}
                    rx={rescheduledRadius}
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

function formatChartCount(value: unknown) {
    return Number(value ?? 0).toLocaleString("pt-BR");
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
