"use client";

import { HelpCircle } from "lucide-react";
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

import { Card, InfoTooltip } from "@/components";
import {
    AD_EVENT_TYPE_LABELS,
    AD_EVENT_TYPES,
    AD_PLATFORM_LABELS,
    AD_PLATFORMS,
    type AdEventType,
    type AdPlatform,
} from "@/types/ad-event";

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
};

type Props = { widgetId: string; data: EventsData };

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
    return null;
}

function getDailyKey(platform: AdPlatform, eventType: AdEventType) {
    const platformKey = platform === "Meta Ads" ? "meta_ads" : "google_ads";
    return `${platformKey}_${eventType}`;
}

function EventsByDayCard({ data }: { data: EventsData }) {
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
                            <Bar key={bar.key} dataKey={bar.key} name={bar.label} stackId="events" fill={bar.color} />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function EventsByTypeCard({ data }: { data: EventsData }) {
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
                        <Pie data={data.by_type} dataKey="count" nameKey="label" innerRadius={58} outerRadius={86}>
                            {data.by_type.map((item) => <Cell key={item.event_type} fill={EVENT_TYPE_CHART_COLORS[item.event_type]} />)}
                        </Pie>
                        <Tooltip />
                    </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-2xl font-bold text-slate-900">{data.kpis.total_events.toLocaleString("pt-BR")}</div>
                    <div className="text-xs text-slate-500">tentativas</div>
                </div>
            </div>
            <div className="mt-5 space-y-3 text-sm">
                {data.by_type.map((item) => (
                    <div key={item.event_type} className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: EVENT_TYPE_CHART_COLORS[item.event_type] }} /><span className="text-slate-600">{item.label}</span></div>
                        <span className="font-semibold text-slate-700">{item.count} ({formatRate(item.percentage)})</span>
                    </div>
                ))}
            </div>
        </Card>
    );
}

function ClickIdRatesCard({ data }: { data: EventsData }) {
    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Parâmetros de clique</h2>
                <InfoTooltip text="Meta usa a presença de IP do cliente. Google usa a presença de GClid. A base é o total de eventos da respectiva plataforma após os filtros.">
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
            </div>
            <div className="space-y-4">
                <RateBox icon={<FaMeta size={18} />} label="% IP Meta" value={data.kpis.fbclid_rate} count={data.kpis.fbclid_events} colorClass="text-blue-600" barClass="bg-blue-600" />
                <RateBox icon={<FaGoogle size={17} />} label="% GClid" value={data.kpis.gclid_rate} count={data.kpis.gclid_events} colorClass="text-amber-600" barClass="bg-amber-500" />
            </div>
        </Card>
    );
}
function RateBox({ icon, label, value, count, colorClass, barClass }: { icon: React.ReactNode; label: string; value: number | null; count: number; colorClass: string; barClass: string }) {
    return <div className="rounded-2xl py-4"><div className="mb-3 flex items-center justify-between"><div className={`flex items-center gap-2 text-sm font-bold ${colorClass}`}>{icon}<span>{label}</span></div><span className="text-xs font-semibold text-slate-500">{count.toLocaleString("pt-BR")} eventos</span></div><div className="mb-2 text-3xl font-bold text-slate-950">{formatRate(value)}</div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${barClass}`} style={{ width: `${value === null ? 0 : Math.min(100, Math.max(0, value))}%` }} /></div></div>;
}
function formatRate(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${value}%`; }
