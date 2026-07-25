// app/eventos/page.tsx
"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
    AlertTriangle,
    BarChart3,
    Calendar,
    HelpCircle,
    MessageCircleMore,
    Send,
    UsersRound,
} from "lucide-react";
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
import { FaGoogle, FaMeta } from "react-icons/fa6";

import {
    applyArrayParams,
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import AdvancedFilterButton from "@/components/ui/AdvancedFilterButton";
import { ConversationPanel } from "@/components/conversations/ConversationPanel";
import {
    Card,
    DashboardHeader,
    HorizontalScroller,
    HoverBadgeList,
    type HoverBadgeListItem,
    InfoTooltip,
    KpiCard,
    MainFilters,
    Pagination,
    Skeleton,
} from "@/components";
import type { FiltersResponse } from "@/types";
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

type EventsDashboardData = {
    kpis: EventKpis;
    previous_kpis: EventKpis;
    by_platform: PlatformMetric[];
    previous_by_platform: PlatformMetric[];
    by_type: TypeMetric[];
    previous_by_type: TypeMetric[];
    by_status: {
        status: AdEventStatus;
        label?: string;
        count: number;
        percentage: number | null;
    }[];
    daily: Record<string, string | number>[];
    recent: RecentEvent[];
    recent_total: number;
    page: number;
    page_size: number;
};

type EventKpis = {
    total_events: number;
    sent_events: number;
    failed_events: number;
    fbclid_events: number;
    fbclid_rate: number | null;
    meta_ip_events?: number;
    meta_ip_rate?: number | null;
    gclid_events: number;
    gclid_rate: number | null;
    google_click_id_events?: number;
    google_click_id_rate?: number | null;
};

type PlatformMetric = {
    platform: AdPlatform;
    count: number;
    percentage: number | null;
};

type TypeMetric = {
    event_type: AdEventType;
    label: string;
    count: number;
    percentage: number | null;
};

type RecentEvent = {
    id: string;
    conversation_id: string | null;
    schedule_id?: string | null;
    date: string;
    client_name: string;
    phone: string;
    event_type: AdEventType;
    platform: string;
    platforms?: AdPlatform[];
    status: AdEventStatus;
    parameters: string[];
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
    const [sourceValues, setSourceValues] = useState<string[]>([]);
    const [tunnelValues, setTunnelValues] = useState<string[]>([]);
    const [originValues, setOriginValues] = useState<string[]>([]);
    const [period, setPeriod] = useState<CalendarPresetValue | null>("yesterday");
    const [selectedRange, setSelectedRange] = useState<DateRange>({
        start: null,
        end: null,
    });
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
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
                    "/api/dashboard/filters?entities=tunnels,origins",
                );
                const json: FiltersResponse = await response.json();
                setFilters(json);
            } finally {
                setLoadingFilters(false);
            }
        }

        void loadFilters();
    }, []);

    useEffect(() => {
        async function loadData() {
            if (data) setIsRefreshing(true);
            else setLoadingData(true);

            try {
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
                if (sourceValues.length > 0) {
                    params.set("sources", sourceValues.join(","));
                }
                applyArrayParams(params, {
                    tunnels: tunnelValues,
                    origins: originValues,
                });

                const response = await fetch(
                    `/api/dashboard/eventos?${params.toString()}`,
                );
                const json: EventsDashboardData = await response.json();

                if (!response.ok) {
                    throw new Error((json as any).error ?? "Falha ao carregar eventos.");
                }

                setData(json);
            } catch (error) {
                console.error("[eventos] load failed", error);
                setData(null);
            } finally {
                setLoadingData(false);
                setIsRefreshing(false);
            }
        }

        void loadData();
    }, [
        currentPage,
        platformValues,
        eventValues,
        statusValues,
        sourceValues,
        tunnelValues,
        originValues,
        period,
        selectedRange,
    ]);

    if (loadingFilters || loadingData) {
        return (
            <main className="scrollbar-hide h-full w-full overflow-y-auto bg-white text-slate-900">
                <section className="min-w-0 px-8 py-8">
                    <EventsSkeleton />
                </section>
            </main>
        );
    }

    return (
        <main className="scrollbar-hide h-full w-full overflow-y-auto bg-white text-slate-900">
            <section className="min-w-0 px-8 py-8">
                <DashboardHeader
                    title="Eventos"
                    description="Acompanhe os eventos enviados para as plataformas de anúncios"
                    period={period}
                    setPeriod={resetPageAndSet(setPeriod)}
                    selectedRange={selectedRange}
                    setSelectedRange={resetPageAndSet(setSelectedRange)}
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
                            {
                                id: "source",
                                title: "Origem do evento",
                                values: sourceValues,
                                onChange: resetPageAndSet(setSourceValues),
                                options: [
                                    { label: "Clinisys", value: "clinisys" },
                                    { label: "IA", value: "ai" },
                                ],
                            },
                        ]}
                    />
                </div>

                {isRefreshing ? (
                    <EventsBodySkeleton />
                ) : data ? (
                    <div className="overflow-x-hidden pb-12">
                        <KpiSection data={data} />
                        <section className="mb-6 grid grid-cols-[1.8fr_0.8fr_0.8fr] gap-5">
                            <EventsByDayCard data={data} />
                            <EventsByTypeCard data={data} />
                            <ClickIdRatesCard data={data} />
                        </section>
                        <RecentEventsCard
                            data={data}
                            currentPage={currentPage}
                            onPageChange={setCurrentPage}
                            onSelectConversation={setSelectedConversationId}
                        />
                    </div>
                ) : (
                    <Card>Nenhum dado encontrado.</Card>
                )}
            </section>

            <ConversationPanel
                conversationId={selectedConversationId}
                onClose={() => setSelectedConversationId(null)}
            />
        </main>
    );
}

function KpiSection({ data }: { data: EventsDashboardData }) {
    return (
        <section className="mb-6 grid grid-cols-1 gap-5">
            <HorizontalScroller scrollAmount={400}>
                <KpiContainer>
                    <KpiCard
                        icon={<Send size={26} />}
                        label="Eventos enviados com sucesso"
                        currentValue={data.kpis.sent_events}
                        previousValue={data.previous_kpis.sent_events}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="purple"
                    />
                </KpiContainer>
                <KpiContainer>
                    <KpiCard
                        icon={<FaMeta size={26} className="text-blue-600" />}
                        label="Meta Ads"
                        currentValue={getPlatformCount(data, "Meta Ads")}
                        previousValue={getPreviousPlatformCount(data, "Meta Ads")}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="blue"
                    />
                </KpiContainer>
                <KpiContainer>
                    <KpiCard
                        icon={<FaGoogle size={24} className="text-amber-600" />}
                        label="Google Ads"
                        currentValue={getPlatformCount(data, "Google Ads")}
                        previousValue={getPreviousPlatformCount(data, "Google Ads")}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="orange"
                    />
                </KpiContainer>
                <KpiContainer>
                    <KpiCard
                        icon={<UsersRound size={26} />}
                        label="Qualified Lead"
                        currentValue={getTypeCount(data, "lead")}
                        previousValue={getPreviousTypeCount(data, "lead")}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="pink"
                    />
                </KpiContainer>
                <KpiContainer>
                    <KpiCard
                        icon={<Calendar size={26} />}
                        label="Schedule"
                        currentValue={getTypeCount(data, "schedule")}
                        previousValue={getPreviousTypeCount(data, "schedule")}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="purple"
                    />
                </KpiContainer>
                <KpiContainer>
                    <KpiCard
                        icon={<AlertTriangle size={26} />}
                        label="Falhas no envio"
                        currentValue={data.kpis.failed_events}
                        previousValue={data.previous_kpis.failed_events}
                        formatter={(value) => value.toLocaleString("pt-BR")}
                        color="orange"
                        positiveDirection="down"
                    />
                </KpiContainer>
            </HorizontalScroller>
        </section>
    );
}

function KpiContainer({ children }: { children: ReactNode }) {
    return <div className="min-w-[260px]">{children}</div>;
}

function EventsByDayCard({ data }: { data: EventsDashboardData }) {
    const bars = AD_PLATFORMS.flatMap((platform) =>
        AD_EVENT_TYPES.map((eventType) => ({
            key: getDailyKey(platform, eventType),
            platform,
            eventType,
            label: `${AD_PLATFORM_LABELS[platform]} · ${AD_EVENT_TYPE_LABELS[eventType]}`,
            color: DAILY_EVENT_COLORS[getDailyKey(platform, eventType)] ?? "#64748b",
        })),
    );

    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Eventos enviados por dia</h2>
                    <InfoTooltip text="Mostra a quantidade de eventos enviados por plataforma e tipo de evento, agrupada no fuso America/Sao_Paulo.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    {bars.map((bar) => (
                        <div key={bar.key} className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: bar.color }} />
                            <span>{bar.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="h-[285px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.daily} barCategoryGap="22%">
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <Tooltip cursor={false} />
                        {bars.map((bar) => (
                            <Bar
                                key={bar.key}
                                dataKey={bar.key}
                                name={bar.label}
                                stackId="events"
                                fill={bar.color}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function EventsByTypeCard({ data }: { data: EventsDashboardData }) {
    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Eventos por tipo</h2>
                <InfoTooltip text="Distribuição dos eventos após os filtros atuais.">
                    <HelpCircle size={16} className="text-slate-400" />
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
                        >
                            {data.by_type.map((item) => (
                                <Cell
                                    key={item.event_type}
                                    fill={EVENT_TYPE_CHART_COLORS[item.event_type]}
                                />
                            ))}
                        </Pie>
                        <Tooltip />
                    </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-2xl font-bold text-slate-900">
                        {data.kpis.total_events.toLocaleString("pt-BR")}
                    </div>
                    <div className="text-xs text-slate-500">tentativas</div>
                </div>
            </div>

            <div className="mt-5 space-y-3 text-sm">
                {data.by_type.map((item) => (
                    <div key={item.event_type} className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span
                                className="h-3 w-3 rounded-full"
                                style={{ backgroundColor: EVENT_TYPE_CHART_COLORS[item.event_type] }}
                            />
                            <span className="text-slate-600">{item.label}</span>
                        </div>
                        <span className="font-semibold text-slate-700">
                            {item.count} ({formatRate(item.percentage)})
                        </span>
                    </div>
                ))}
            </div>
        </Card>
    );
}

function ClickIdRatesCard({ data }: { data: EventsDashboardData }) {

    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Parâmetros de clique</h2>
                <InfoTooltip text="Meta usa a presença de IP do cliente. Google usa a presença de GClid. A base é o total de eventos da respectiva plataforma após os filtros.">
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
            </div>

            <div className="space-y-4">
                <RateBox
                    icon={<FaMeta size={18} />}
                    label="% IP Meta"
                    value={data.kpis.fbclid_rate}
                    count={data.kpis.fbclid_events}
                    colorClass="text-blue-600"
                    barClass="bg-blue-600"
                />
                <RateBox
                    icon={<FaGoogle size={17} />}
                    label="% GClid"
                    value={data.kpis.gclid_rate}
                    count={data.kpis.gclid_events}
                    colorClass="text-amber-600"
                    barClass="bg-amber-500"
                />
            </div>
        </Card>
    );
}

function RateBox({
    icon,
    label,
    value,
    count,
    colorClass,
    barClass,
}: {
    icon: ReactNode;
    label: string;
    value: number | null;
    count: number;
    colorClass: string;
    barClass: string;
}) {
    return (
        <div className="rounded-2xl py-4">
            <div className="mb-3 flex items-center justify-between">
                <div className={`flex items-center gap-2 text-sm font-bold ${colorClass}`}>
                    {icon}
                    <span>{label}</span>
                </div>
                <span className="text-xs font-semibold text-slate-500">
                    {count.toLocaleString("pt-BR")} eventos
                </span>
            </div>
            <div className="mb-2 text-3xl font-bold text-slate-950">
                {formatRate(value)}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                    className={`h-full rounded-full ${barClass}`}
                    style={{ width: `${value === null ? 0 : Math.min(100, Math.max(0, value))}%` }}
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

            <div
                data-recent-events-card
                className="overflow-visible rounded-xl border border-slate-100"
            >
                <div className="grid grid-cols-[1fr_1fr_0.95fr_0.95fr_0.55fr_1.3fr_0.75fr_0.4fr] bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
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
                            <EventTypeBadge eventType={event.event_type} />
                        </div>

                        <div className="mr-2 flex justify-center">
                            <PlatformBadge platform={event.platform} />
                        </div>

                        <div className="min-w-0">
                            <ParameterBadges parameters={event.parameters ?? []} />
                        </div>

                        <div>
                            <EventStatusBadge status={event.status} />
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
                            <div className="flex w-full justify-center">
                                <InfoTooltip
                                    text="Evento disparado por Clinisys"
                                    widthClassName="w-55 text-center"
                                >
                                    <div className="flex w-full items-center justify-center text-slate-500">
                                        <img src="clinisys.png" width={16} alt="Clinisys" />
                                    </div>
                                </InfoTooltip>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-5">
                <div className="text-sm text-slate-500">
                    Mostrando {firstItem} a {lastItem} de {data.recent_total} eventos
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

function EventTypeBadge({ eventType }: { eventType: AdEventType }) {
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

function PlatformBadge({ platform }: { platform: string }) {
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
                        <PlatformIconTiny platform={singlePlatform} />
                    </span>
                );
            })}
        </span>
    );
}

function ParameterBadges({ parameters }: { parameters: string[] }) {
    const items: HoverBadgeListItem[] = sortParameters(parameters).map(
        (parameter) => ({
            key: parameter,
            label: getParameterLabel(parameter),
            className: getParameterStyle(parameter),
        }),
    );

    return (
        <HoverBadgeList
            items={items}
            emptyLabel="—"
            popupAlignContainerSelector="[data-recent-events-card]"
        />
    );
}

function sortParameters(parameters: string[]) {
    return [...parameters]
        .filter(Boolean)
        .sort((a, b) => {
            const aPriority = getParameterPriority(a);
            const bPriority = getParameterPriority(b);

            if (aPriority !== bPriority) return aPriority - bPriority;
            return getParameterLabel(a).localeCompare(getParameterLabel(b));
        });
}

function EventStatusBadge({ status }: { status: AdEventStatus }) {
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

function PlatformIconTiny({ platform }: { platform: AdPlatform }) {
    if (platform === "Meta Ads") return <FaMeta size={14} />;
    if (platform === "Google Ads") return <FaGoogle size={12} />;
    return <BarChart3 size={14} />;
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
    if (normalized === "client_ip_address") return "bg-blue-soft text-blue";
    if (normalized === "gclid") return "bg-amber-100/50 text-amber-600";
    if (FIRST_PARAMETERS.includes(normalized)) return "bg-slate-100 text-slate-500";
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
const LAST_PARAMETERS = ["phone", "external_id", "first_name", "last_name"];

function EventsSkeleton() {
    return (
        <>
            <div className="mb-8 flex items-start justify-between"><div><Skeleton className="h-9 w-[180px]" /><Skeleton className="mt-3 h-4 w-[430px]" /></div><Skeleton className="h-12 w-[310px]" /></div>
            <div className="mb-8 flex justify-end gap-3"><Skeleton className="h-12 w-[220px]" /><Skeleton className="h-12 w-[220px]" /><Skeleton className="h-12 w-[140px]" /></div>
            <EventsBodySkeleton />
        </>
    );
}

function EventsBodySkeleton() {
    return (
        <>
            <section className="mb-6 grid grid-cols-1 gap-5"><HorizontalScroller scrollAmount={400}>{Array.from({ length: 8 }).map((_, index) => (<div key={index} className="min-w-[260px]"><Card><div className="flex items-center gap-5 overflow-hidden"><Skeleton className="h-14 w-14 shrink-0 rounded-full" /><div className="min-w-0 flex-1"><Skeleton className="h-3 w-[65%]" /><Skeleton className="mt-3 h-8 w-[45%]" /><Skeleton className="mt-3 h-3 w-[75%]" /></div></div></Card></div>))}</HorizontalScroller></section>
            <section className="mb-6 grid grid-cols-[1.8fr_0.8fr_0.8fr] gap-5"><Card><Skeleton className="mb-6 h-6 w-[40%]" /><Skeleton className="h-[285px] w-full" /></Card><Card><Skeleton className="mb-6 h-6 w-[60%]" /><Skeleton className="h-[215px] w-full" /></Card><Card><Skeleton className="mb-6 h-6 w-[55%]" /><Skeleton className="h-[215px] w-full" /></Card></section>
            <Card><Skeleton className="mb-5 h-6 w-[180px]" /><div className="space-y-4">{Array.from({ length: 5 }).map((_, index) => (<Skeleton key={index} className="h-10 w-full" />))}</div></Card>
        </>
    );
}

function getPlatformCount(data: EventsDashboardData, platform: AdPlatform) {
    return data.by_platform.find((item) => item.platform === platform)?.count ?? 0;
}

function getPreviousPlatformCount(data: EventsDashboardData, platform: AdPlatform) {
    return data.previous_by_platform.find((item) => item.platform === platform)?.count ?? 0;
}

function getTypeCount(data: EventsDashboardData, eventType: AdEventType) {
    return data.by_type.find((item) => item.event_type === eventType)?.count ?? 0;
}

function getPreviousTypeCount(data: EventsDashboardData, eventType: AdEventType) {
    return data.previous_by_type.find((item) => item.event_type === eventType)?.count ?? 0;
}

function getDailyKey(platform: AdPlatform, eventType: AdEventType) {
    return `${platform.toLowerCase().replaceAll(" ", "_")}_${eventType}`;
}

function formatRate(value: number | null) {
    return value === null ? "—" : `${value}%`;
}

function formatDateTime(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
    }).format(new Date(value));
}

function formatPhone(value: string) {
    const digits = value.replace(/\D/g, "");
    if (digits.length === 13 && digits.startsWith("55")) {
        return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }
    if (digits.length === 11) {
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }
    return value || "—";
}
