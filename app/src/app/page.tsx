// apps/insights/src/app/page.tsx
"use client";

import {useEffect, useState} from "react";
import {
    Calendar,
    Clock,
    HelpCircle,
    MapPin,
    MessageCircle,
    ShieldCheck,
    Smile,
    User,
} from "lucide-react";
import {
    applyArrayParams,
    applyCalendarDateParams,

    type CalendarPresetValue,
    type DateRange,
} from "@engravida/components/ui/CalendarButton";
import {
    Area,
    AreaChart,
    CartesianGrid,
    Cell,
    Line,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import type {ExecutiveDashboardData, FiltersResponse} from "@engravida/types";

import {
    MainFilters,
    Card,
    FilterButton,
    KpiCard,
    PercentageBar,
    PercentageValue,
    SidePanel,
    Skeleton,
    HorizontalScroller,
    DashboardHeader,
    InfoTooltip
} from "@engravida/components";


export default function ExecutiveDashboardPage() {
    const [data, setData] = useState<ExecutiveDashboardData | null>(null);
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
                "/api/dashboard/filters?entities=units,attendants,tunnels,origins"
            );
            const json: FiltersResponse = await response.json();

            setFilters(json);
        }

        loadFilters();
    }, []);

    useEffect(() => {
        async function loadDashboard() {
            if (data) {
                setIsRefreshing(true);
            } else {
                setLoading(true);
            }

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

            const response = await fetch(`/api/dashboard/executivo?${params.toString()}`);
            const json: ExecutiveDashboardData = await response.json();

            setData(json);
            setLoading(false);
            setIsRefreshing(false);
        }

        loadDashboard();
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
                <SidePanel/>

                <section className="flex-1 px-8 py-8">
                    <DashboardSkeleton/>
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

    const averageResponseMinutes =
        data.kpis.average_first_human_response_seconds === null
            ? null
            : Math.round(data.kpis.average_first_human_response_seconds / 60);

    const previousAverageResponseMinutes =
        data.previous_kpis.average_first_human_response_seconds === null
            ? null
            : Math.round(data.previous_kpis.average_first_human_response_seconds / 60);

    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel/>
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
                    <FilterButton
                        icon={<MapPin size={16}/>}
                        label="Todas as unidades"
                        values={unitIds}
                        onChange={setUnitIds}
                        options={filters?.units ?? []}
                        widthClassName="w-[230px]"
                    />

                    <FilterButton
                        icon={<User size={16}/>}
                        label="Todos os atendentes"
                        values={attendantIds}
                        onChange={setAttendantIds}
                        options={filters?.attendants ?? []}
                    />

                    <MainFilters
                        tunnels={filters?.tunnels}
                        origins={filters?.origins}
                        tunnelValues={tunnelValues}
                        setTunnelValues={setTunnelValues}
                        originValues={originValues}
                        setOriginValues={setOriginValues}
                    />
                </div>

                {isRefreshing ? (
                    <DashboardBodySkeleton/>
                ) : (<div className={"pb-12 overflow-x-hidden"}>
                    <section className="mb-6 grid grid-cols-1 gap-5">
                        <HorizontalScroller scrollAmount={400}>
                            <div className="min-w-[260px]">
                                <KpiCard
                                    icon={<MessageCircle size={26}/>}
                                    label="Conversas analisadas"
                                    currentValue={data.kpis.conversations_analyzed}
                                    previousValue={data.previous_kpis.conversations_analyzed}
                                    formatter={(value) => value.toLocaleString("pt-BR")}
                                    color="purple"
                                />
                            </div>

                            <div className="min-w-[260px]">
                                <KpiCard
                                    icon={<ShieldCheck size={26}/>}
                                    label="Resolução real"
                                    currentValue={data.kpis.real_resolution_rate}
                                    previousValue={data.previous_kpis.real_resolution_rate}
                                    suffix="%"
                                    color="green"
                                />
                            </div>

                            <div className="min-w-[260px]">
                                <KpiCard
                                    icon={<Smile size={26}/>}
                                    label="Clientes claramente satisfeitos"
                                    currentValue={data.kpis.clear_satisfaction_rate}
                                    previousValue={data.previous_kpis.clear_satisfaction_rate}
                                    suffix="%"
                                    color="blue"
                                />
                            </div>

                            <div className="min-w-[260px]">
                                <KpiCard
                                    icon={<Calendar size={26}/>}
                                    label="Taxa de agendamento"
                                    currentValue={data.kpis.scheduling_rate}
                                    previousValue={data.previous_kpis.scheduling_rate}
                                    suffix="%"
                                    color="purple"
                                />
                            </div>

                            <div className="min-w-[260px]">
                                <KpiCard
                                    icon={<Clock size={26}/>}
                                    label="1ª resposta humana média"
                                    currentValue={averageResponseMinutes ?? 0}
                                    previousValue={previousAverageResponseMinutes}
                                    suffix=" min"
                                    color="orange"
                                    positiveDirection="down"
                                />
                            </div>
                        </HorizontalScroller>
                    </section>

                    <section className="mb-6 grid grid-cols-[1.45fr_0.95fr] gap-5">
                        <Card>
                            <div className="mb-5 flex items-center justify-between">
                                <div>
                                    <h2 className="text-lg font-bold">Evolução diária</h2>

                                    <div className="mt-3 flex items-center gap-6 text-xs text-slate-500">
                                        <LegendDot color="bg-blue-500" label="Conversas"/>
                                        <LegendDot color="bg-violet-500" label="Resolução (%)"/>
                                        <LegendDot color="bg-emerald-500" label="Satisfação (%)"/>
                                    </div>
                                </div>

                            </div>

                            <div className="h-[290px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={data.daily_evolution}>
                                        <defs>
                                            <linearGradient
                                                id="conversationFill"
                                                x1="0"
                                                y1="0"
                                                x2="0"
                                                y2="1"
                                            >
                                                <stop offset="5%" stopColor="#1683ff" stopOpacity={0.22}/>
                                                <stop offset="95%" stopColor="#1683ff" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>

                                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0"/>
                                        <XAxis dataKey="date" tick={{fontSize: 12}} stroke="#94a3b8"/>
                                        <YAxis tick={{fontSize: 12}} stroke="#94a3b8"/>
                                        <Tooltip content={<DailyEvolutionTooltip/>}/>

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
                                            dot={{r: 4}}
                                        />

                                        <Line
                                            type="monotone"
                                            dataKey="satisfaction_rate"
                                            stroke="#10b981"
                                            strokeWidth={3}
                                            dot={{r: 4}}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>
                        <DropoffCard data={data}/>


                    </section>

                    <section className="grid grid-cols-2 gap-5">
                        <ConversationGoalsCard data={data}/>
                        <UnitViewCard data={data}/>
                    </section>


                </div>)}
            </section>
        </main>
    );
}


function DropoffCard({data}: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Momentos de perda mais comuns</h2>
                    <InfoTooltip
                        text="Mostra os pontos onde clientes mais abandonam conversas não resolvidas. Ajuda a identificar gargalos como preço, consulta online, demora no atendimento ou opções de agendamento.">
                        <HelpCircle size={16} className="text-slate-400"/>
                    </InfoTooltip></div>
                <p className="mt-1 text-xs text-slate-500">
                    Base: conversas não resolvidas
                </p>
            </div>

            <div className="space-y-7 ">
                {data.dropoff_moments.map((item, index) => (
                    <div key={item.moment} className={"flex gap-3 items-center h-full"}>
                        <span
                            className="flex h-6 w-6 items-center justify-center bg-violet-500 rounded-full text-xs font-bold text-white">{index + 1}</span>
                        <div className={" w-full"}>
                            <div className="mb-2  flex items-center justify-between text-sm">


                                <div className="flex items-center gap-3">
                                    <span className="font-medium text-slate-700">{item.label}</span>
                                </div>

                                <span className="font-bold text-slate-700">
                                    {item.percentage}%
                              </span>
                            </div>

                            <div className="">
                                <PercentageBar value={item.percentage} color="purple"/>
                            </div>
                        </div>
                    </div>

                ))}
            </div>
        </Card>
    );
}

function ConversationGoalsCard({data}: { data: ExecutiveDashboardData }) {
    const colors = ["#8b5cf6", "#1683ff", "#10b981", "#f97316", "#06b6d4"];

    return (
        <Card>
            <div className="mb-4 flex items-center gap-2">
                <h2 className="text-lg font-bold">Objetivo das conversas</h2>
                <InfoTooltip
                    text="Mostra qual era o objetivo principal das conversas analisadas no período. A porcentagem representa a participação de cada objetivo no total de conversas, como agendar consulta, confirmar presença, reagendar, explicar tratamento ou responder dúvidas.">
                    <HelpCircle size={16} className="text-slate-400"/>
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
                                    <Cell key={index} fill={colors[index % colors.length]}/>
                                ))}
                            </Pie>
                            <Tooltip/>
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
                    style={{backgroundColor: colors[index % colors.length]}}
                />
                                <span className="text-slate-600">{item.label}</span>
                            </div>

                            <span className="font-medium text-slate-600">
                {item.percentage}%
              </span>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}

function UnitViewCard({data}: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <h2 className="mb-5 text-lg font-bold">Visão por unidade</h2>

            <div className="overflow-hidden rounded-xl">
                <div className="grid grid-cols-4 bg-slate-50 px-2 py-3 text-xs font-bold text-slate-500">
                    <div>Unidade</div>
                    <div>Resolução</div>
                    <div>Satisfação</div>
                    <div>Agendamento</div>
                </div>

                {data.by_unit.map((unit) => (
                    <div
                        key={unit.unit_id ?? unit.unit_name}
                        className="grid grid-cols-4 border-t border-slate-100 px-2 py-3 text-sm"
                    >
                        <div className="font-medium text-slate-600">{unit.unit_name}</div>

                        <PercentageValue
                            value={unit.resolution_rate}
                            greenFrom={70}
                            orangeFrom={40}
                        />

                        <PercentageValue
                            value={unit.satisfaction_rate}
                            greenFrom={70}
                            orangeFrom={40}
                        />

                        <PercentageValue
                            value={unit.scheduling_rate}
                            greenFrom={45}
                            orangeFrom={35}
                        />
                    </div>
                ))}
            </div>
        </Card>
    );
}

function LegendDot({color, label}: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full ${color}`}/>
            <span>{label}</span>
        </div>
    );
}


function DashboardSkeleton() {
    return (
        <>
            <div className="mb-8 flex items-start justify-between">
                <div>
                    <Skeleton className="h-9 w-[320px]"/>
                    <Skeleton className="mt-3 h-4 w-[260px]"/>
                </div>

                <Skeleton className="h-12 w-[310px]"/>
            </div>

            <div className="mb-8 flex justify-end gap-3">
                <Skeleton className="h-12 w-[220px]"/>
                <Skeleton className="h-12 w-[220px]"/>
                <Skeleton className="h-12 w-[220px]"/>
            </div>

            <DashboardBodySkeleton/>
        </>
    );
}

function DashboardBodySkeleton() {
    return (<>
            <section className="mb-6 grid grid-cols-5 gap-5">
                {Array.from({length: 5}).map((_, index) => (
                    <Card key={index}>
                        <div className="flex items-center gap-5 overflow-hidden">
                            <Skeleton className="h-14 w-14 shrink-0 rounded-full"/>

                            <div className="min-w-0 flex-1">
                                <Skeleton className="h-3 w-[55%]"/>
                                <Skeleton className="mt-3 h-8 w-[40%]"/>
                                <Skeleton className="mt-3 h-3 w-[75%]"/>
                            </div>
                        </div>
                    </Card>
                ))}
            </section>

            <section className="mb-6 grid grid-cols-[1.45fr_0.95fr] gap-5">
                <Card>
                    <div className="mb-5 flex items-center justify-between gap-6">
                        <div className="min-w-0 flex-1">
                            <Skeleton className="h-6 w-[30%]"/>
                            <Skeleton className="mt-3 h-4 w-[55%]"/>
                        </div>

                        <Skeleton className="h-10 w-[18%] min-w-[110px] max-w-[150px]"/>
                    </div>

                    <Skeleton className="h-[290px] w-full"/>
                </Card>

                <Card>
                    <Skeleton className="mb-6 h-6 w-[45%]"/>

                    <div className="grid grid-cols-[38%_1fr] gap-4">
                        <Skeleton className="aspect-square w-full rounded-full"/>

                        <div className="min-w-0 space-y-4">
                            <Skeleton className="h-4 w-full"/>
                            <Skeleton className="h-4 w-[80%]"/>
                            <Skeleton className="h-4 w-[90%]"/>

                            <div className="pt-4">
                                <Skeleton className="h-11 w-full"/>
                            </div>

                            <Skeleton className="h-11 w-full"/>
                            <Skeleton className="h-11 w-full"/>
                        </div>
                    </div>
                </Card>
            </section>

            <section className="grid grid-cols-3 gap-5">
                {Array.from({length: 3}).map((_, index) => (
                    <Card key={index}>
                        <Skeleton className="mb-5 h-6 w-[45%]"/>

                        <div className="space-y-4">
                            <Skeleton className="h-8 w-full"/>
                            <Skeleton className="h-8 w-[92%]"/>
                            <Skeleton className="h-8 w-[84%]"/>
                            <Skeleton className="h-8 w-full"/>
                        </div>
                    </Card>
                ))}
            </section>
        </>
    )
}

function DailyEvolutionTooltip({
                                   active,
                                   payload,
                                   label,
                               }: {
    active?: boolean;
    payload?: any[];
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
            <div className="mb-3 text-sm font-semibold text-slate-800">
                {label}
            </div>

            <div className="space-y-2 text-sm mt-2">
                {payload.map((item) => (
                    <div
                        key={item.dataKey}
                        className="flex items-center justify-between gap-6"
                    >
                        <div className="flex items-center gap-2">
                            <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{backgroundColor: item.color}}
                            />

                            <span style={{color: item.color}}>
                                {labels[item.dataKey] ?? item.dataKey}
                            </span>
                        </div>

                        <span
                            className="font-semibold"
                            style={{color: item.color}}
                        >
                            {item.value}
                            {item.dataKey.includes("rate") ? "%" : ""}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

