"use client";

import type { ReactNode } from "react";

import { BarChart3, HelpCircle, MessageCircleMore } from "lucide-react";
import { FaGoogle, FaMeta } from "react-icons/fa6";
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

import { Card, HoverBadgeList, type HoverBadgeListItem, InfoTooltip, Pagination } from "@/components";
import {
    AD_EVENT_STATUS_LABELS,
    AD_EVENT_TYPE_LABELS,
    AD_EVENT_TYPES,
    AD_PLATFORM_LABELS,
    AD_PLATFORMS,
    type AdEventStatus,
    type AdEventType,
    type AdPlatform,
} from "@/types/ad-event";


type RecentEvent = {
    id: string;
    conversation_id: string | null;
    date: string;
    client_name: string;
    phone: string;
    event_type: AdEventType;
    platform: string;
    platforms?: AdPlatform[];
    status: AdEventStatus;
    parameters: string[];
};

type EventsData = {
    kpis: {
        total_events: number;
        fbclid_events: number;
        fbclid_rate: number | null;
        gclid_events: number;
        gclid_rate: number | null;
    };
    by_type: Array<{ event_type: AdEventType; label: string; count: number; percentage: number | null }>;
    daily: Array<Record<string, string | number>>;
    recent: RecentEvent[];
    recent_total: number;
    page?: number;
    page_size?: number;
};

type EventsDashboardData = EventsData;

type Props = { widgetId: string; data: EventsData };

const PAGE_SIZE = 20;
const FIRST_PARAMETERS = ["client_ip_address","client_user_agent","state","country","fbclid","fbc","fbp","ctwa_clid","gclid","gbraid","wbraid","utm_source","utm_medium","utm_campaign","utm_content","utm_term"];
const SECOND_PARAMETERS = ["email"];
const LAST_PARAMETERS = ["phone","external_id","first_name","last_name"];

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

export default function ExactEventosDashboardGraphs({ widgetId, data }: Props) {
    if (widgetId === "eventos.eventos_dia") return <EventsByDayCard data={data} />;
    if (widgetId === "eventos.eventos_tipo") return <EventsByTypeCard data={data} />;
    if (widgetId === "eventos.parametros_clique") return <ClickIdRatesCard data={data} />;
    if (widgetId === "eventos.eventos_recentes") return <RecentEventsCard data={data} />;
    return null;
}

function getDailyKey(platform: AdPlatform, eventType: AdEventType) {
    return `${platform.toLowerCase().replaceAll(" ", "_")}_${eventType}`;
}

export function EventsByDayCard({ data }: { data: EventsDashboardData }) {
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

export function EventsByTypeCard({ data }: { data: EventsDashboardData }) {
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

export function ClickIdRatesCard({ data }: { data: EventsDashboardData }) {

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
function formatRate(value: number | null) {
    return value === null ? "—" : `${value}%`;
}


export function RecentEventsCard({
    data,
    currentPage,
    onPageChange,
    onSelectConversation,
}: {
    data: EventsDashboardData;
    currentPage?: number;
    onPageChange?: (page: number) => void;
    onSelectConversation?: (conversationId: string) => void;
}) {
    currentPage = currentPage ?? data.page ?? 1;
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
                                onClick={() => onSelectConversation?.(event.conversation_id!)}
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

                {onPageChange ? <Pagination totalPages={totalPages} currentPage={currentPage} onPageChange={onPageChange} /> : null}

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