// apps/insights/src/app/eventos/page.tsx
"use client";

import {type ReactNode, useEffect, useState, useRef} from "react";
import {
    AlertTriangle,
    BarChart3,
    Calendar,
    HelpCircle,
    MessageCircleMore, Monitor,
    Send,
    UsersRound,
} from "lucide-react";
import {
    applyArrayParams,
    applyCalendarDateParams,

    type CalendarPresetValue,
    type DateRange,
} from "@engravida/components/ui/CalendarButton";
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
import {FaGoogle, FaMeta} from "react-icons/fa6";

import type {FiltersResponse} from "@engravida/types";
import {
    AD_EVENT_STATUS_LABELS,
    AD_EVENT_STATUSES,
    AD_EVENT_TYPE_LABELS,
    AD_EVENT_TYPES,
    AD_PLATFORM_LABELS,
    AD_PLATFORMS,
    type AdEventStatus,
    type AdEventType,
    type AdPlatform,
} from "@/types/ad-event";

import {
    DashboardHeader,
    MainFilters,
    Card,
    HorizontalScroller,
    InfoTooltip,
    KpiCard,
    SidePanel,
    Skeleton,
    Pagination,
} from "@engravida/components";

import AdvancedFilterButton from "@engravida/components/ui/AdvancedFilterButton";
import {ConversationPanel} from "@engravida/components/conversations/ConversationPanel";


type EventsDashboardData = {
    kpis: {
        total_events: number;
        sent_events: number;
        failed_events: number;
        fbclid_events: number;
        gclid_events: number;
        fbclid_rate: number;
        gclid_rate: number;
    };
    previous_kpis: {
        total_events: number;
        sent_events: number;
        failed_events: number;
        fbclid_events: number;
        gclid_events: number;
        fbclid_rate: number;
        gclid_rate: number;
    };
    by_platform: {
        platform: AdPlatform;
        count: number;
        percentage: number;
    }[];
    previous_by_platform: {
        platform: AdPlatform;
        count: number;
        percentage: number;
    }[];
    by_type: {
        event_type: AdEventType;
        label: string;
        count: number;
        percentage: number;
    }[];
    previous_by_type: {
        event_type: AdEventType;
        label: string;
        count: number;
        percentage: number;
    }[];
    by_status: {
        status: AdEventStatus;
        count: number;
        percentage: number;
    }[];
    daily: Record<string, string | number>[];
    recent: {
        id: string;
        conversation_id: string | null;
        date: string;
        client_name: string;
        phone: string;
        event_type: AdEventType;
        platform: string;
        status: AdEventStatus;
        parameters: string[];
    }[];
    recent_total: number;
    page: number;
    page_size: number;
};

const PAGE_SIZE = 20;

const DAILY_EVENT_COLORS: Record<string, string> = {
    meta_ads_lead: "#2563eb",
    meta_ads_schedule: "#639aeb",
    google_ads_lead: "#E29229",
    google_ads_schedule: "#e0a569",
};

const EVENT_TYPE_CHART_COLORS: Record<AdEventType, string> = {
    lead: "#8b5cf6",
    schedule: "#e83e8c",
};


export default function EventsPage() {
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [data, setData] = useState<EventsDashboardData | null>(null);

    const [eventValues, setEventValues] = useState<string[]>([]);
    const [platformValues, setPlatformValues] = useState<string[]>([]);
    const [statusValues, setStatusValues] = useState<string[]>([]);
    const [tunnelValues, setTunnelValues] = useState<string[]>([]);
    const [originValues, setOriginValues] = useState<string[]>([]);

    const [period, setPeriod] = useState<CalendarPresetValue | null>("yesterday");
    const [selectedRange, setSelectedRange] = useState<DateRange>({
        start: null,
        end: null,
    });

    const [selectedConversationId, setSelectedConversationId] = useState<
        string | null
    >(null);

    const [currentPage, setCurrentPage] = useState(1);

    const [loadingFilters, setLoadingFilters] = useState(true);
    const [loadingData, setLoadingData] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    function resetPageAndSet<T>(setter: (value: T) => void) {
        return (value: T) => {
            setCurrentPage(1);
            setter(value);
        };
    }

    useEffect(() => {
        async function loadFilters() {
            try {
                const response = await fetch(
                    "/api/dashboard/filters?entities=tunnels,origins"
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

            params.set("page", String(currentPage));
            params.set("page_size", String(PAGE_SIZE));

            applyCalendarDateParams({
                params,
                selectedRange,
                selectedPreset: period,
            });


            if (platformValues.length > 0) {
                params.set("platforms", platformValues.join(","));
            }

            if (eventValues.length > 0) {
                params.set("event_types", eventValues.join(","));
            }

            if (statusValues.length > 0) {
                params.set("statuses", statusValues.join(","));
            }

            applyArrayParams(params, {
                tunnels: tunnelValues,
                origins: originValues,
            });

            try {
                const response = await fetch(
                    `/api/dashboard/eventos?${params.toString()}`
                );
                const json: EventsDashboardData = await response.json();

                setData(json);
            } finally {
                setLoadingData(false);
                setIsRefreshing(false);
            }
        }

        loadData();
    }, [
        currentPage,
        platformValues,
        eventValues,
        statusValues,
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
                    <EventsSkeleton/>
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
                    title="Eventos"
                    description="Acompanhe os eventos enviados para as plataformas de anúncios"
                    period={period}
                    setPeriod={resetPageAndSet(setPeriod)}
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                />

                <div className="mb-8 flex justify-end gap-3">

                    <MainFilters
                        tunnels={filters?.tunnels}
                        origins={filters?.origins}
                        tunnelValues={tunnelValues}
                        setTunnelValues={resetPageAndSet(setTunnelValues)}
                        originValues={originValues}
                        setOriginValues={resetPageAndSet(setOriginValues)}
                    />

                    <AdvancedFilterButton
                        sections={[
                            {
                                id: "event",
                                title: "Evento",
                                values: eventValues,
                                onChange: resetPageAndSet(setEventValues),
                                options: AD_EVENT_TYPES.map((eventType) => ({
                                    label: AD_EVENT_TYPE_LABELS[eventType],
                                    value: eventType,
                                })),
                            },
                            {
                                id: "platform",
                                title: "Plataforma",
                                values: platformValues,
                                onChange: resetPageAndSet(setPlatformValues),
                                options: AD_PLATFORMS.map((platform) => ({
                                    label: AD_PLATFORM_LABELS[platform],
                                    value: platform,
                                })),
                            },
                            {
                                id: "status",
                                title: "Status",
                                values: statusValues,
                                onChange: resetPageAndSet(setStatusValues),
                                options: AD_EVENT_STATUSES.map((status) => ({
                                    label: AD_EVENT_STATUS_LABELS[status],
                                    value: status,
                                })),
                            },
                        ]}
                    />
                </div>

                {isRefreshing ? (
                    <EventsBodySkeleton/>
                ) : (
                    <div className="overflow-x-hidden pb-12">
                        <KpiSection data={data}/>

                        <section className="mb-6 grid grid-cols-[1.8fr_0.8fr_0.8fr] gap-5">
                            <EventsByDayCard data={data}/>
                            <EventsByTypeCard data={data}/>
                            <ClickIdRatesCard data={data}/>
                        </section>

                        <RecentEventsCard
                            data={data}
                            currentPage={currentPage}
                            onPageChange={setCurrentPage}
                            onSelectConversation={setSelectedConversationId}
                        />
                    </div>
                )}
            </section>

            <ConversationPanel
                conversationId={selectedConversationId}
                onClose={() => setSelectedConversationId(null)}
            />
        </main>
    );
}


function KpiSection({data}: { data: EventsDashboardData }) {

    return (
        <section className="mb-6 grid grid-cols-1 gap-5">
            <HorizontalScroller scrollAmount={400}>
                <div className="min-w-[260px]">
                    <KpiCard
                        icon={<Send size={26}/>}
                        label="Eventos enviados"
                        currentValue={data.kpis.total_events}
                        previousValue={data.previous_kpis.total_events}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="purple"
                    />
                </div>
                <div className="min-w-[260px]">
                    <KpiCard
                        icon={<FaMeta size={26} className="text-blue-600"/>}
                        label="Meta Ads"
                        currentValue={getPlatformCount(data, "Meta Ads")}
                        previousValue={getPreviousPlatformCount(data, "Meta Ads")}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="blue"
                    />
                </div>
                {/*<div className="min-w-[260px]">*/}
                {/*    <KpiCard*/}
                {/*        icon={<FaMeta size={26} className="text-blue-600" />}*/}
                {/*        label="FBClid"*/}
                {/*        currentValue={data.kpis.fbclid_events}*/}
                {/*        previousValue={data.previous_kpis.fbclid_events}*/}
                {/*        formatter={(value) => value.toLocaleString("pt-BR")}*/}
                {/*        color="blue"*/}
                {/*    />*/}
                {/*</div>*/}

                <div className="min-w-[260px]">
                    <KpiCard
                        icon={<FaGoogle size={24} className="text-amber-600"/>}
                        label="Google Ads"
                        currentValue={getPlatformCount(data, "Google Ads")}
                        previousValue={getPreviousPlatformCount(data, "Google Ads")}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="orange"
                    />
                </div>

                {/*<div className="min-w-[260px]">*/}
                {/*    <KpiCard*/}
                {/*        icon={<FaGoogle size={24} className="text-amber-600" />}*/}
                {/*        label="GClid"*/}
                {/*        currentValue={data.kpis.gclid_events}*/}
                {/*        previousValue={data.previous_kpis.gclid_events}*/}
                {/*        formatter={(value) => value.toLocaleString("pt-BR")}*/}
                {/*        color="orange"*/}
                {/*    />*/}
                {/*</div>*/}

                <div className="min-w-[260px]">
                    <KpiCard
                        icon={<UsersRound size={26}/>}
                        label="Qualified Lead"
                        currentValue={getTypeCount(data, "lead")}
                        previousValue={getPreviousTypeCount(data, "lead")}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="pink"
                    />
                </div>

                <div className="min-w-[260px]">
                    <KpiCard
                        icon={<Calendar size={26}/>}
                        label="Schedule"
                        currentValue={getTypeCount(data, "schedule")}
                        previousValue={getPreviousTypeCount(data, "schedule")}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="purple"
                    />
                </div>

                <div className="min-w-[260px]">
                    <KpiCard
                        icon={<AlertTriangle size={26}/>}
                        label="Falhas no envio"
                        currentValue={data.kpis.failed_events}
                        previousValue={data.previous_kpis.failed_events}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="orange"
                        positiveDirection="down"
                    />
                </div>
            </HorizontalScroller>
        </section>
    );
}

function EventsByDayCard({data}: { data: EventsDashboardData }) {
    const bars = AD_PLATFORMS.flatMap((platform) =>
        AD_EVENT_TYPES.map((eventType) => {
            const key = getDailyKey(platform, eventType);

            return {
                key,
                platform,
                eventType,
                eventLabel: AD_EVENT_TYPE_LABELS[eventType],
                color: DAILY_EVENT_COLORS[key] ?? "#64748b",
            };
        })
    );

    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">
                        Eventos enviados por dia
                    </h2>

                    <InfoTooltip text="Mostra a quantidade de eventos enviados por plataforma e tipo de evento.">
                        <HelpCircle size={16} className="text-slate-400"/>
                    </InfoTooltip>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    {bars.map((bar) => (
                        <LegendDot
                            key={bar.key}
                            color={bar.color}
                            platform={bar.platform}
                            label={bar.eventLabel}
                        />
                    ))}
                </div>
            </div>

            <div className="h-[285px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.daily} barCategoryGap="22%">
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0"/>

                        <XAxis
                            dataKey="date"
                            tick={{fontSize: 12}}
                            stroke="#94a3b8"
                        />

                        <YAxis tick={{fontSize: 12}} stroke="#94a3b8"/>

                        <Tooltip
                            content={<EventsByDayTooltip bars={bars}/>}
                            cursor={false}
                        />

                        {bars.map((bar) => (
                            <Bar
                                key={bar.key}
                                dataKey={bar.key}
                                stackId="events"
                                fill={bar.color}
                                radius={[0, 0, 0, 0]}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function EventsByTypeCard({data}: { data: EventsDashboardData }) {
    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Eventos por tipo</h2>

                <InfoTooltip text="Distribuição dos eventos derivados das análises.">
                    <HelpCircle size={16} className="text-slate-400"/>
                </InfoTooltip>
            </div>

            <div className="relative h-[215px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data.by_type}
                            dataKey="count"
                            nameKey="label"
                            innerRadius={58}
                            outerRadius={86}
                            paddingAngle={0}
                        >
                            {data.by_type.map((item) => (
                                <Cell
                                    key={item.event_type}
                                    fill={EVENT_TYPE_CHART_COLORS[item.event_type]}
                                />
                            ))}
                        </Pie>

                        <Tooltip/>
                    </PieChart>
                </ResponsiveContainer>

                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-2xl font-bold text-slate-900">
                        {data.kpis.total_events}
                    </div>
                    <div className="text-xs text-slate-500">Total</div>
                </div>
            </div>

            <div className="mt-5 space-y-3 text-sm">
                {data.by_type.map((item) => (
                    <ChartLegendRow
                        key={item.event_type}
                        color={EVENT_TYPE_CHART_COLORS[item.event_type]}
                        label={item.label}
                        value={`${item.count} (${item.percentage}%)`}
                    />
                ))}
            </div>
        </Card>
    );
}

function ClickIdRatesCard({data}: { data: EventsDashboardData }) {
    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Parâmetros de clique</h2>

                <InfoTooltip
                    text="Os eventos só são enviados para o Google caso haja gclid, gbraid ou wbraid. Porém o TinTim nos envia apenas gclid.">
                    <HelpCircle size={16} className="text-slate-400"/>
                </InfoTooltip>
            </div>

            <div className="space-y-4">
                <ClickIdRateBox
                    icon={<FaMeta size={18}/>}
                    label="% IP Meta"
                    value={data.kpis.fbclid_rate}
                    count={data.kpis.fbclid_events}
                    colorClass="text-blue-600"
                    barClass="bg-blue-600"
                    bgClass="bg-blue-50"
                />

                <ClickIdRateBox
                    icon={<FaGoogle size={17}/>}
                    label="% GClid"
                    value={data.kpis.gclid_rate}
                    count={data.kpis.gclid_events}
                    colorClass="text-amber-600"
                    barClass="bg-amber-500"
                    bgClass="bg-amber-50"
                />
            </div>
        </Card>
    );
}

function ClickIdRateBox({
                            icon,
                            label,
                            value,
                            count,
                            colorClass,
                            barClass,
                            bgClass,
                        }: {
    icon: ReactNode;
    label: string;
    value: number;
    count: number;
    colorClass: string;
    barClass: string;
    bgClass: string;
}) {
    return (
        <div className={`rounded-2xl ${bgClass} p-4`}>
            <div className="mb-3 flex items-center justify-between">
                <div className={`flex items-center gap-2 text-sm font-bold ${colorClass}`}>
                    {icon}
                    <span>{label}</span>
                </div>

                <span className="text-xs font-semibold text-slate-500">
                    {count.toLocaleString("pt-BR")} eventos
                </span>
            </div>

            <div className="mb-2 flex items-end justify-between">
                <span className="text-3xl font-bold text-slate-950">
                    {value}%
                </span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-white/80">
                <div
                    className={`h-full rounded-full ${barClass}`}
                    style={{width: `${Math.min(100, Math.max(0, value))}%`}}
                />
            </div>
        </div>
    );
}


function RecentEventsCard({
                              data,
                              currentPage,
                              onPageChange,
                              onSelectConversation,
                          }: {
    data: EventsDashboardData;
    currentPage: number;
    onPageChange: (page: number) => void;
    onSelectConversation: (conversationId: string) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(data.recent_total / PAGE_SIZE));

    const firstItem =
        data.recent_total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;

    const lastItem = Math.min(currentPage * PAGE_SIZE, data.recent_total);

    return (
        <Card>
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold">Eventos recentes</h2>
            </div>

            <div data-recent-events-card className="overflow-visible rounded-xl border border-slate-100">
                <div
                    className="grid grid-cols-[1fr_1fr_0.95fr_0.95fr_0.55fr_1.3fr_0.75fr_0.4fr] bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
                    <div>Data/Hora</div>
                    <div>Cliente</div>
                    <div>Telefone</div>
                    <div>Evento</div>
                    <div>Plataforma</div>
                    <div>Parâmetros</div>
                    <div>Status</div>
                    <div>Conversa</div>
                </div>

                {data.recent.map((event) => (
                    <div
                        key={event.id}
                        className="grid grid-cols-[1fr_1fr_0.95fr_0.95fr_0.55fr_1.3fr_0.75fr_0.4fr] items-center gap-2 border-t border-slate-100 px-4 py-4 text-sm"
                    >
                        <div
                            title={formatDateTime(event.date)}
                            className="truncate text-slate-600"
                        >
                            {formatDateTime(event.date)}
                        </div>

                        <div
                            title={event.client_name}
                            className="min-w-0 truncate font-medium text-slate-700"
                        >
                            {event.client_name}
                        </div>

                        <div title={event.phone} className="truncate text-slate-600">
                            {formatPhone(event.phone)}
                        </div>

                        <div>
                            <EventTypeBadge eventType={event.event_type}/>
                        </div>

                        <div className={"justify-center mr-2 flex"}>
                            <PlatformBadge platform={event.platform}/>
                        </div>

                        <div className="min-w-0">
                            <ParameterBadges parameters={event.parameters ?? []}/>
                        </div>

                        <div>
                            <EventStatusBadge status={event.status}/>
                        </div>

                        {event.conversation_id ? (
                            <button
                                type="button"
                                onClick={() => onSelectConversation(event.conversation_id!)}
                                className="flex w-full cursor-pointer items-center justify-center font-bold text-slate-500 transition-colors hover:text-slate-700"
                            >
                                <MessageCircleMore size={16} />
                            </button>
                        ) : (
                            <div className={"w-full flex justify-center"}>
                            <InfoTooltip text="Evento disparado por Clinisys" widthClassName={"w-55 text-center"}>
                                <div className="flex w-full items-center justify-center text-slate-500 ">
                                    <img src={"clinisys.png"} width={16} />
                                </div>
                            </InfoTooltip>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-5">
                <div className="text-sm text-slate-500">
                    Mostrando {firstItem} a {lastItem} de{" "}
                    {data.recent_total} eventos
                </div>

                <Pagination
                    totalPages={totalPages}
                    currentPage={currentPage}
                    onPageChange={onPageChange}
                />

                <button
                    type="button"
                    className="flex h-11 cursor-pointer items-center gap-3 rounded-xl px-4 text-sm text-slate-500"
                >
                    {PAGE_SIZE} por página
                </button>
            </div>
        </Card>
    );
}

function EventTypeBadge({eventType}: { eventType: AdEventType }) {
    const isSchedule = eventType === "schedule";

    return (
        <span
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-bold ${
                isSchedule ? "bg-pink-soft text-pink" : "bg-purple-soft text-purple"
            }`}
        >
            {AD_EVENT_TYPE_LABELS[eventType]}
        </span>
    );
}

function PlatformBadge({platform}: { platform: string }) {
    const platforms = platform
        .split(" + ")
        .sort((b, a) => a.localeCompare(b)) as AdPlatform[];

    return (
        <span className="inline-flex items-center gap-1.5">
            {platforms.map((singlePlatform) => {
                const isMeta = singlePlatform === "Meta Ads";

                return (
                    <span
                        key={singlePlatform}
                        className={`inline-flex items-center rounded-full px-2 py-1.5 text-xs font-bold ${
                            isMeta
                                ? "bg-blue-100/70 text-blue-600"
                                : "bg-amber-100/40 text-amber-600"
                        }`}
                    >
                        <PlatformIconTiny platform={singlePlatform}/>
                    </span>
                );
            })}
        </span>
    );
}

function ParameterBadges({parameters}: { parameters: string[] }) {
    const sorted = sortParameters(parameters);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [side, setSide] = useState<"left" | "right">("left");

    if (sorted.length === 0) {
        return <span className="text-xs font-medium text-slate-400">—</span>;
    }

    function handleMouseEnter() {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        const card = wrapper.closest("[data-recent-events-card]");
        if (!card) return;

        const wrapperRect = wrapper.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();

        const spaceRight = cardRect.right - wrapperRect.left;
        const popupWidth = 520;

        setSide(spaceRight < popupWidth ? "right" : "left");
    }

    return (
        <div
            ref={wrapperRef}
            onMouseEnter={handleMouseEnter}
            className="group cursor-pointer relative min-w-0 max-w-full"
        >
            <div className="flex min-w-0 max-w-full flex-nowrap gap-1.5 overflow-hidden">
                {sorted.map((parameter) => (
                    <ParameterBadge key={parameter} parameter={parameter}/>
                ))}
            </div>

            <div
                className={`pointer-events-none absolute top-full z-50 mt-2 hidden max-w-[520px] rounded-2xl border border-slate-100 bg-white p-3 shadow-xl group-hover:block ${
                    side === "right" ? "right-0" : "left-0"
                }`}
            >
                <div className="flex flex-nowrap gap-1.5 overflow-hidden whitespace-nowrap">
                    {sorted.map((parameter) => (
                        <ParameterBadge
                            key={`hover-${parameter}`}
                            parameter={parameter}
                            full
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function ParameterBadge({
                            parameter,
                            full = false,
                        }: {
    parameter: string;
    full?: boolean;
}) {
    const style = getParameterStyle(parameter);
    const label = getParameterLabel(parameter);

    return (
        <span
            className={`inline-flex shrink-0 truncate rounded-full px-2 py-1 text-[11px] font-bold ${style} ${
                full ? "max-w-none" : "max-w-[115px]"
            }`}
        >
            {label}
        </span>
    );
}

function sortParameters(parameters: string[]) {
    return [...parameters]
        .filter(Boolean)
        .sort((a, b) => {
            const aPriority = getParameterPriority(a);
            const bPriority = getParameterPriority(b);

            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }

            return getParameterLabel(a).localeCompare(getParameterLabel(b));
        });
}

function EventStatusBadge({status}: { status: AdEventStatus }) {
    const isSent = status === "sent";

    return (
        <span
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-bold ${
                isSent ? "bg-green-soft text-green" : "bg-red-soft text-red"
            }`}
        >
            {AD_EVENT_STATUS_LABELS[status]}
        </span>
    );
}

function LegendDot({
                       color,
                       platform,
                       label,
                   }: {
    color: string;
    platform: AdPlatform;
    label: string;
}) {
    return (
        <div className="flex items-center gap-1.5">
            <span style={{color}}>
                <PlatformIconTiny platform={platform}/>
            </span>

            <span>{label}</span>
        </div>
    );
}

function ChartLegendRow({
                            color,
                            label,
                            value,
                        }: {
    color: string;
    label: string;
    value: string;
}) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
                <span
                    className="h-3 w-3 rounded-full"
                    style={{backgroundColor: color}}
                />
                <span className="text-slate-600">{label}</span>
            </div>

            <span className="font-semibold text-slate-700">{value}</span>
        </div>
    );
}

function EventsByDayTooltip({
                                active,
                                payload,
                                label,
                                bars,
                            }: {
    active?: boolean;
    payload?: any[];
    label?: string;
    bars: {
        key: string;
        platform: AdPlatform;
        eventLabel: string;
        color: string;
    }[];
}) {
    if (!active || !payload?.length) return null;

    const barMap = new Map(bars.map((bar) => [bar.key, bar]));

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="mb-3 text-sm font-semibold text-slate-800">
                {label}
            </div>

            <div className="space-y-2 text-sm">
                {payload.map((item) => {
                    const bar = barMap.get(item.dataKey);

                    return (
                        <div
                            key={item.dataKey}
                            className="flex items-center justify-between gap-6"
                        >
                            <div className="flex items-center gap-2">
                                {bar ? (
                                    <span
                                        style={{
                                            color: bar?.color ?? "#94a3b8",
                                        }}
                                    >
                                        <PlatformIconTiny platform={bar.platform}/>
                                    </span>
                                ) : null}

                                <span
                                    style={{
                                        color: bar?.color ?? "#475569",
                                    }}
                                >
                                    {bar?.eventLabel ?? item.dataKey}
                                </span>
                            </div>

                            <span
                                className="font-semibold"
                                style={{
                                    color: bar?.color ?? "#334155",
                                }}
                            >
                                {item.value}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}


function PlatformIconTiny({platform}: { platform: AdPlatform }) {
    if (platform === "Meta Ads") {
        return <FaMeta size={14}/>;
    }

    if (platform === "Google Ads") {
        return <FaGoogle size={12}/>;
    }

    return <BarChart3 size={14}/>;
}

function getTypeCount(data: EventsDashboardData, eventType: AdEventType) {
    return (
        data.by_type.find((item) => item.event_type === eventType)?.count ?? 0
    );
}

function getPreviousTypeCount(data: EventsDashboardData, eventType: AdEventType) {
    return (
        data.previous_by_type.find((item) => item.event_type === eventType)
            ?.count ?? 0
    );
}

function getPreviousPlatformCount(
    data: EventsDashboardData,
    platform: AdPlatform
) {
    return (
        data.previous_by_platform.find((item) => item.platform === platform)
            ?.count ?? 0
    );
}

function getDailyKey(platform: string, eventType: string) {
    return `${slug(platform)}_${eventType}`;
}

function slug(value: string) {
    return value
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
}

function formatDateTime(value: string) {
    return new Date(value).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatPhone(phone: string) {
    return phone.split("+55")[1] ?? phone;
}

function EventsSkeleton() {
    return (
        <>
            <div className="mb-8 flex items-start justify-between">
                <div>
                    <Skeleton className="h-9 w-[180px]"/>
                    <Skeleton className="mt-3 h-4 w-[430px]"/>
                </div>

                <Skeleton className="h-12 w-[310px]"/>
            </div>

            <div className="mb-8 flex justify-end gap-3">
                <Skeleton className="h-12 w-[220px]"/>
                <Skeleton className="h-12 w-[220px]"/>
                <Skeleton className="h-12 w-[140px]"/>
            </div>

            <EventsBodySkeleton/>
        </>
    );
}

function EventsBodySkeleton() {
    return (
        <>
            <section className="mb-6 grid grid-cols-1 gap-5">
                <HorizontalScroller scrollAmount={400}>
                    {Array.from({length: 8}).map((_, index) => (
                        <div key={index} className="min-w-[260px]">
                            <Card>
                                <div className="flex items-center gap-5 overflow-hidden">
                                    <Skeleton className="h-14 w-14 shrink-0 rounded-full"/>

                                    <div className="min-w-0 flex-1">
                                        <Skeleton className="h-3 w-[65%]"/>
                                        <Skeleton className="mt-3 h-8 w-[45%]"/>
                                        <Skeleton className="mt-3 h-3 w-[75%]"/>
                                    </div>
                                </div>
                            </Card>
                        </div>
                    ))}
                </HorizontalScroller>
            </section>

            <section className="mb-6 grid grid-cols-[1.8fr_0.8fr_0.8fr] gap-5">
                <Card>
                    <Skeleton className="mb-6 h-6 w-[40%]"/>
                    <Skeleton className="h-[285px] w-full"/>
                </Card>

                <Card>
                    <Skeleton className="mb-6 h-6 w-[60%]"/>
                    <Skeleton className="h-[215px] w-full"/>
                </Card>

                <Card>
                    <Skeleton className="mb-6 h-6 w-[55%]"/>
                    <Skeleton className="h-[215px] w-full"/>
                </Card>
            </section>

            <Card>
                <Skeleton className="mb-5 h-6 w-[180px]"/>

                <div className="space-y-4">
                    {Array.from({length: 5}).map((_, index) => (
                        <Skeleton key={index} className="h-10 w-full"/>
                    ))}
                </div>
            </Card>
        </>
    );
}


function getPlatformCount(data: EventsDashboardData, platform: AdPlatform) {
    return (
        data.by_platform.find((item) => item.platform === platform)?.count ?? 0
    );
}

function getParameterPriority(parameter: string) {
    const normalized = normalizeParameter(parameter);

    if (normalized === "client_ip_address") return 0;

    if (normalized.includes("clid")) return 1;

    if (FIRST_PARAMETERS.includes(normalized)) return 2;

    if (SECOND_PARAMETERS.includes(normalized)) return 3;

    if (LAST_PARAMETERS.includes(normalized)) return 5;

    return 4;
}

function getParameterStyle(parameter: string) {
    const normalized = normalizeParameter(parameter);

    if (
        normalized === "client_ip_address"
    ) {
        return "bg-blue-soft text-blue";
    }
    if (
        normalized === "gclid"
    ) {
        return "bg-amber-100/50 text-amber-600";
    }


    if (FIRST_PARAMETERS.includes(normalized)) {
        return "bg-slate-100 text-slate-500";
    }

    return "bg-slate-100 text-slate-500 font-medium";
}

function getParameterLabel(parameter: string) {
    const normalized = normalizeParameter(parameter);

    const labels: Record<string, string> = {
        phone: "Telefone",
        external_id: "Identificação Externa",
        first_name: "Nome",
        last_name: "Sobrenome",

        client_ip_address: "IP",
        client_user_agent: "Agente usuário",
        fbc: "fbc",
        fbp: "fbp",
        state: "Estado",
        country: "País",

        email: "Email",

        fbclid: "fbclid",
        gclid: "gclid",
        gbraid: "gbraid",
        wbraid: "wbraid",
        ctwa_clid: "ctwa_clid",
    };

    return labels[normalized] ?? parameter;
}

function normalizeParameter(parameter: string) {
    return parameter.trim().toLowerCase();
}

const FIRST_PARAMETERS = [
    "client_ip_address",
    "client_user_agent",
    "state",
    "country",

    "fbclid",
    "fbc",
    "fbp",
    "ctwa_clid",

    "gclid",
    "gbraid",
    "wbraid",

    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
];

const SECOND_PARAMETERS = ["email"];

const LAST_PARAMETERS = [
    "phone",
    "external_id",
    "first_name",
    "last_name",
];

