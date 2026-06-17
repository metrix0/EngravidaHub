// app/jornada/page.tsx
"use client";

import {useEffect, useState} from "react";
import {
    HelpCircle,
    MapPin,
    User,
} from "lucide-react";
import {
    applyArrayParams,
    applyCalendarDateParams,

    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
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

import type {FiltersResponse} from "@/types";

import {
    MainFilters,
    DashboardHeader,
    Card,
    FilterButton,
    InfoTooltip,
    PercentageBar,
    SidePanel,
    Skeleton,
} from "@/components";


type JourneyDashboardData = {
    journey_funnel: {
        key: string;
        name: string;
        value: number;
        percentage: number;
        relative_percentage: number;
        fill: string;
    }[];

    dropoff_moments: {
        moment: string;
        label: string;
        count: number;
        percentage: number;
    }[];

    intent_paths: {
        intent: string;
        resolved: number;
        partial: number;
        abandoned: number;
    }[];

    objections: {
        type: string;
        label: string;
        value: number;
        percentage: number;
    }[];
};

export default function JourneyPage() {
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [data, setData] = useState<JourneyDashboardData | null>(null);

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
                    "/api/dashboard/filters?entities=units,attendants,tunnels,origins"
                );
                const json: FiltersResponse = await response.json();

                setFilters(json);
            } finally {
                setLoadingFilters(false);
            }
        }

        loadFilters();
    }, []);

    useEffect(() => {
        async function loadData() {
            if (data) {
                setIsRefreshing(true);
            } else {
                setLoadingData(true);
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

            try {
                const response = await fetch(
                    `/api/dashboard/jornada?${params.toString()}`
                );

                const json = await response.json();

                if (!response.ok) {
                    console.error("[jornada] failed to load dashboard", json);

                    setData({
                        journey_funnel: [],
                        dropoff_moments: [],
                        intent_paths: [],
                        objections: [],
                    });

                    return;
                }

                setData({
                    journey_funnel: json.journey_funnel ?? [],
                    dropoff_moments: json.dropoff_moments ?? [],
                    intent_paths: json.intent_paths ?? [],
                    objections: json.objections ?? [],
                });
            } finally {
                setLoadingData(false);
                setIsRefreshing(false);
            }
        }

        loadData();
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
                <SidePanel/>

                <section className="flex-1 px-8 py-8">
                    <JourneySkeleton/>
                </section>
            </main>
        );
    }

    if (!data) {
        return (
            <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
                <SidePanel/>

                <section className="flex-1 px-8 py-8">
                    Nenhum dado encontrado.
                </section>
            </main>
        );
    }

    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel/>

            <section className="flex-1 px-8 py-8">
                <DashboardHeader
                    title="Jornada"
                    description="Entenda o caminho dos clientes ao longo do atendimento"
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
                    <JourneyBodySkeleton/>
                ) : (
                    <div className="overflow-x-hidden pb-12">
                        <section className="mb-6 grid grid-cols-[1.55fr_0.85fr] gap-5">
                            <JourneyFunnelCard data={data}/>
                            <DropoffCard data={data}/>
                        </section>

                        <section className="mb-6 grid grid-cols-[1.5fr_0.9fr] gap-5">
                            <IntentPathsCard data={data}/>
                            <ObjectionsCard data={data}/>
                        </section>
                    </div>
                )}
            </section>
        </main>
    );
}


function JourneyFunnelCard({data}: { data: JourneyDashboardData }) {
    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Funil da jornada</h2>

                <InfoTooltip
                    text="Este funil apenas apresentará a segunda etapa, se o cliente já tiver completado a primeira etapa, e assim por diante. Por exemplo, para aparecer a etapa 'Agendamento', o cliente precisa ter completado a etapa 'Consulta online' antes.">
                    <HelpCircle size={16} className="text-slate-400"/>
                </InfoTooltip>
            </div>

            <div className="grid grid-cols-2 items-center gap-5">
                <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <FunnelChart>
                            <Tooltip/>
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
                                    <Cell key={item.key} fill={item.fill}/>
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
                                    style={{backgroundColor: item.fill}}
                                />

                                <span className="min-w-0 font-medium text-slate-700 truncate" title={item.name}>
                                    {item.name}
                                </span>
                            </div>

                            <div className="grid grid-cols-[40px_40px_50px] items-center gap-1">
                                <span className="text-right font-bold text-slate-700">
                                    {item.value}
                                </span>

                                <span className="rounded-full text-right text-xs font-bold text-slate-500">
                                    {item.relative_percentage}%
                                </span>

                                <span className="rounded-full  text-right text-xs font-medium text-slate-500">
                                    ({item.percentage}%)
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}

function DropoffCard({data}: { data: JourneyDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Pontos de abandono</h2>

                    <InfoTooltip text="Mostra em quais momentos os clientes mais abandonaram a jornada.">
                        <HelpCircle size={16} className="text-slate-400"/>
                    </InfoTooltip>
                </div>
            </div>

            <div className="space-y-7">
                {data.dropoff_moments.map((item, index) => (
                    <div key={item.moment} className="flex items-center gap-3">
                        <span
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-purple text-xs font-bold text-white">
                            {index + 1}
                        </span>

                        <div className="w-full">
                            <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">
                                    {item.label}
                                </span>

                                <span className="font-bold text-slate-700">
                                    {item.percentage}%
                                </span>
                            </div>

                            <PercentageBar value={item.percentage} color="purple"/>
                        </div>
                    </div>
                ))}

                {data.dropoff_moments.length === 0 && (
                    <EmptyCardMessage message="Nenhum abandono encontrado no período."/>
                )}
            </div>
        </Card>
    );
}

function IntentPathsCard({data}: { data: JourneyDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">
                        Caminhos por intenção inicial
                    </h2>

                    <InfoTooltip text="Mostra o resultado das conversas agrupado pela intenção inicial do cliente.">
                        <HelpCircle size={16} className="text-slate-400"/>
                    </InfoTooltip>
                </div>

                <div className="mt-3 flex items-center gap-6 text-xs text-slate-500">
                    <LegendDot color="green" label="Resolvida"/>
                    <LegendDot color="orange" label="Parcial"/>
                    <LegendDot color="red" label="Abandonou"/>
                </div>
            </div>

            <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.intent_paths} barCategoryGap="28%">
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0"/>
                        <XAxis
                            dataKey="intent"
                            tick={{fontSize: 12}}
                            stroke="#94a3b8"
                            interval={0}
                            angle={-18}
                            textAnchor="end"
                            height={65}
                        />
                        <YAxis tick={{fontSize: 12}} stroke="#94a3b8"/>
                        <Tooltip content={<IntentPathsTooltip/>} cursor={false}/>

                        <Bar
                            dataKey="resolved"
                            stackId="result"
                            fill="var(--color-green)"
                        />
                        <Bar
                            dataKey="partial"
                            stackId="result"
                            fill="var(--color-orange)"
                        />
                        <Bar
                            dataKey="abandoned"
                            stackId="result"
                            fill="var(--color-red)"
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function ObjectionsCard({data}: { data: JourneyDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Principais objeções</h2>

                    <InfoTooltip
                        text="Mostra as objeções mais comuns dentro das conversas, como preço, disponibilidade ou incerteza médica.">
                        <HelpCircle size={16} className="text-slate-400"/>
                    </InfoTooltip>
                </div>

                <p className="mt-1 text-xs text-slate-500">
                    Base: conversas com objeções
                </p>
            </div>

            <div className="space-y-4">
                {data.objections.map((item, index) => (
                    <div key={item.type} className="flex items-center gap-3">
                        <span
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-purple text-xs font-bold text-white">
                            {index + 1}
                        </span>

                        <div className="w-full">
                            <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">
                                    {item.label}
                                </span>

                                <span className="font-bold text-slate-700">
                                    {item.value}
                                </span>
                            </div>

                            <PercentageBar value={item.percentage} color="purple"/>
                        </div>
                    </div>
                ))}

                {data.objections.length === 0 && (
                    <EmptyCardMessage message="Nenhuma objeção encontrada no período."/>
                )}
            </div>
        </Card>
    );
}

function EmptyCardMessage({message}: { message: string }) {
    return (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
            {message}
        </div>
    );
}

function LegendDot({
                       color,
                       label,
                   }: {
    color: string;
    label: string;
}) {
    return (
        <div className="flex items-center gap-2">
            <span
                className="h-3 w-3 rounded-full"
                style={{backgroundColor: `var(--color-${color})`}}
            />
            <span>{label}</span>
        </div>
    );
}

function JourneySkeleton() {
    return (
        <>
            <div className="mb-8 flex items-start justify-between">
                <div>
                    <Skeleton className="h-9 w-[180px]"/>
                    <Skeleton className="mt-3 h-4 w-[420px]"/>
                </div>

                <Skeleton className="h-12 w-[310px]"/>
            </div>

            <div className="mb-8 flex justify-end gap-3">
                <Skeleton className="h-12 w-[220px]"/>
                <Skeleton className="h-12 w-[220px]"/>
                <Skeleton className="h-12 w-[220px]"/>
            </div>

            <JourneyBodySkeleton/>
        </>
    );
}

function JourneyBodySkeleton() {
    return (
        <>
            <section className="mb-6 grid grid-cols-[1.6fr_0.8fr] gap-5">
                <Card>
                    <Skeleton className="mb-6 h-6 w-[35%]"/>
                    <Skeleton className="h-[280px] w-full"/>
                </Card>

                <Card>
                    <Skeleton className="mb-6 h-6 w-[45%]"/>
                    <div className="space-y-5">
                        {Array.from({length: 4}).map((_, index) => (
                            <Skeleton key={index} className="h-8 w-full"/>
                        ))}
                    </div>
                </Card>
            </section>

            <section className="mb-6 grid grid-cols-[1.5fr_0.9fr] gap-5">
                <Card>
                    <Skeleton className="mb-6 h-6 w-[45%]"/>
                    <Skeleton className="h-[260px] w-full"/>
                </Card>

                <Card>
                    <Skeleton className="mb-6 h-6 w-[45%]"/>
                    <div className="space-y-5">
                        {Array.from({length: 5}).map((_, index) => (
                            <Skeleton key={index} className="h-8 w-full"/>
                        ))}
                    </div>
                </Card>
            </section>
        </>
    );
}

function IntentPathsTooltip({
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
        resolved: "Resolvida",
        partial: "Parcial",
        abandoned: "Abandono",
    };

    const colors: Record<string, string> = {
        resolved: "var(--color-green)",
        partial: "var(--color-orange)",
        abandoned: "var(--color-red)",
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="mb-3 text-sm font-semibold text-slate-800">
                {label}
            </div>

            <div className="space-y-2 text-sm">
                {payload.map((item) => (
                    <div
                        key={item.dataKey}
                        className="flex items-center justify-between gap-6"
                    >
                        <div className="flex items-center gap-2">
                            <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{
                                    backgroundColor:
                                        colors[item.dataKey] ?? "#94a3b8",
                                }}
                            />

                            <span
                                style={{
                                    color: colors[item.dataKey] ?? "#475569",
                                }}
                            >
                                {labels[item.dataKey] ?? item.dataKey}
                            </span>
                        </div>

                        <span
                            className="font-semibold"
                            style={{
                                color: colors[item.dataKey] ?? "#334155",
                            }}
                        >
                            {item.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}


