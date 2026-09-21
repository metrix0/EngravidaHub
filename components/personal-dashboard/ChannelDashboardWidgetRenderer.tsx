"use client";

import { useEffect, useMemo, useState } from "react";
import {
    BadgeCheck,
    CircleX,
    Clock,
    Globe2,
    Minus,
    PanelsTopLeft,
    PhoneCall,
    ShieldCheck,
    Smile,
    ThumbsDown,
    ThumbsUp,
} from "lucide-react";
import { FaFacebookMessenger, FaInstagram } from "react-icons/fa6";
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
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { Card, KpiCard, Skeleton } from "@/components";
import {
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";

const requestCache = new Map<string, Promise<unknown>>();
const COLORS = ["#1683ff", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4", "#ef4444"];

type Props = {
    widgetId: string;
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
    unitNames?: string[];
};

type DistributionPoint = {
    key: string;
    label: string;
    count: number;
    percentage: number | null;
};

type InstagramAnalysisData = {
    conversations_total: number;
    conversations_analyzed: number;
    analysis_coverage_rate: number | null;
    resolution_rate: number | null;
    resolution_observed: number;
    satisfaction_rate: number | null;
    satisfaction_observed: number;
    dropoff_rate: number | null;
    dropoff_count: number;
    notable_count: number;
    average_first_human_response_seconds: number | null;
    median_first_human_response_seconds: number | null;
    p90_first_human_response_seconds: number | null;
    first_human_response_observed: number;
    attendant_quality_score: number | null;
    attendant_quality_observed: number;
    daily_evolution: Array<Record<string, string | number | null>>;
    dropoff_moments: DistributionPoint[];
    dropoff_reasons: DistributionPoint[];
    customer_intents: DistributionPoint[];
    conversation_goals: DistributionPoint[];
    goal_statuses: DistributionPoint[];
    customer_final_states: DistributionPoint[];
    sentiments: DistributionPoint[];
    resolution_results: DistributionPoint[];
    quality_dimensions: Array<{ key: string; label: string; score: number | null; observed: number }>;
    objections: Array<{ type: string; label: string; total: number; resolved: number; unresolved: number; resolution_rate: number | null }>;
};

type MessengerAnalysisData = {
    conversations_total: number;
    conversations_analyzed: number;
    analysis_coverage_rate: number | null;
    resolution_rate: number | null;
    resolution_observed: number;
    satisfaction_rate: number | null;
    satisfaction_observed: number;
    dropoff_rate: number | null;
    dropoff_count: number;
    notable_count: number;
    average_first_human_response_seconds: number | null;
    median_first_human_response_seconds: number | null;
    p90_first_human_response_seconds: number | null;
    first_human_response_observed: number;
    attendant_quality_score: number | null;
    attendant_quality_observed: number;
    daily_evolution: Array<Record<string, string | number | null>>;
};

type CallsData = {
    total: number;
    good: number;
    neutral: number;
    bad: number;
    good_rate: number;
    neutral_rate: number;
    bad_rate: number;
    daily_evolution: Array<{ date: string; date_iso: string; good: number; neutral: number; bad: number }>;
};

type PageViewRow = { host: string; path: string; title: string; views: number };
type WebData = {
    main_site_views: number;
    landing_page_views: number;
    main_site_pages: PageViewRow[];
    landing_pages: PageViewRow[];
};

type AttributionData = {
    available: boolean;
    total_clients: number;
    attributed_clients: number;
    unattributed_clients: number;
    attribution_rate: number | null;
    campaign_distribution: DistributionPoint[];
};

type InstagramShareData = {
    instagram_percentage: number | null;
    instagram_conversations: number;
    whatsapp_conversations: number;
    daily_evolution: Array<Record<string, string | number | null>>;
};

type MessengerShareData = {
    messenger_percentage: number | null;
    messenger_conversations: number;
    whatsapp_conversations: number;
    daily_evolution: Array<Record<string, string | number | null>>;
};

export default function ChannelDashboardWidgetRenderer({
    widgetId,
    period,
    selectedRange,
    unitNames = [],
}: Props) {
    const url = useMemo(
        () => buildEndpoint(widgetId, period, selectedRange, unitNames),
        [widgetId, period, selectedRange.end, selectedRange.start, unitNames.join("|")],
    );
    const { data, loading, error } = useCachedJson(url);

    if (loading) return <Skeleton className="h-[300px] w-full rounded-2xl" />;
    if (error || !data) {
        return (
            <Card>
                <div className="py-10 text-center text-sm text-slate-500">
                    {error ?? "Dados indisponíveis."}
                </div>
            </Card>
        );
    }

    if (widgetId.startsWith("instagram.")) {
        if (widgetId === "instagram.origem_paga" || widgetId === "instagram.clientes_campanha") {
            return renderAttribution(widgetId, data as AttributionData);
        }
        return renderInstagram(widgetId, data as InstagramAnalysisData);
    }
    if (widgetId.startsWith("messenger.")) {
        return renderMessenger(widgetId, data as MessengerAnalysisData);
    }
    if (widgetId.startsWith("ligacoes.")) {
        return renderCalls(widgetId, data as CallsData);
    }
    if (widgetId.startsWith("web.")) {
        return renderWeb(widgetId, data as WebData);
    }
    if (widgetId === "jornada.participacao_instagram") {
        return renderShareChart(
            "Participação do Instagram nas conversas",
            data as InstagramShareData,
            "instagram_percentage",
            "instagram_conversations",
            "Instagram",
        );
    }
    if (widgetId === "jornada.participacao_messenger") {
        return renderShareChart(
            "Participação do Messenger nas conversas",
            data as MessengerShareData,
            "messenger_percentage",
            "messenger_conversations",
            "Messenger",
        );
    }

    return <Card>Widget indisponível.</Card>;
}

function renderInstagram(id: string, data: InstagramAnalysisData) {
    switch (id) {
        case "instagram.conversas_analisadas":
            return <KpiCard icon={<FaInstagram size={26} />} label="Conversas analisadas" currentValue={data.conversations_analyzed} formatter={formatInteger} color="pink" tooltipText={`${formatPercent(data.analysis_coverage_rate)} de cobertura entre ${data.conversations_total.toLocaleString("pt-BR")} conversas do Instagram. ${data.notable_count.toLocaleString("pt-BR")} foram marcadas como notáveis.`} />;
        case "instagram.resolucao_real":
            return <KpiCard icon={<ShieldCheck size={26} />} label="Resolução real" currentValue={data.resolution_rate} suffix="%" color="green" tooltipText={`Baseado em ${data.resolution_observed.toLocaleString("pt-BR")} conversas com resultado de resolução observável.`} />;
        case "instagram.clientes_satisfeitos":
            return <KpiCard icon={<Smile size={26} />} label="Clientes satisfeitos" currentValue={data.satisfaction_rate} suffix="%" color="blue" tooltipText={`Considera apenas sinais claros de satisfação ou insatisfação. ${data.satisfaction_observed.toLocaleString("pt-BR")} conversas observadas.`} />;
        case "instagram.taxa_abandono":
            return <KpiCard icon={<CircleX size={26} />} label="Taxa de abandono" currentValue={data.dropoff_rate} suffix="%" color="orange" positiveDirection="down" tooltipText={`${data.dropoff_count.toLocaleString("pt-BR")} conversas tiveram abandono detectado pela análise.`} />;
        case "instagram.primeira_resposta_humana":
            return <KpiCard icon={<Clock size={26} />} label="1ª resposta humana" currentValue={data.average_first_human_response_seconds} formatter={formatDuration} color="purple" positiveDirection="down" tooltipText={`Média filtrada até 2 horas. Mediana: ${formatDuration(data.median_first_human_response_seconds)}. P90: ${formatDuration(data.p90_first_human_response_seconds)}. ${data.first_human_response_observed.toLocaleString("pt-BR")} respostas observadas.`} />;
        case "instagram.qualidade_atendimento":
            return <KpiCard icon={<BadgeCheck size={26} />} label="Qualidade do atendimento" currentValue={data.attendant_quality_score} suffix="/100" color="pink" tooltipText={`${data.attendant_quality_observed.toLocaleString("pt-BR")} conversas com qualidade geral avaliada.`} />;
        case "instagram.evolucao_diaria":
            return <EvolutionCard title="Evolução diária do Instagram" data={data.daily_evolution} />;
        case "instagram.pontos_abandono":
            return <DistributionCard title="Pontos de abandono" rows={data.dropoff_moments} />;
        case "instagram.motivos_abandono":
            return <DistributionCard title="Motivos prováveis de abandono" rows={data.dropoff_reasons} />;
        case "instagram.estado_final":
            return <DistributionCard title="Estado final do cliente" rows={data.customer_final_states} />;
        case "instagram.resultado_resolucao":
            return <DistributionCard title="Resultado da resolução" rows={data.resolution_results} />;
        case "instagram.status_objetivo":
            return <DistributionCard title="Status do objetivo" rows={data.goal_statuses} />;
        case "instagram.intencao_inicial":
            return <DistributionCard title="Intenção inicial" rows={data.customer_intents} />;
        case "instagram.objetivo_conversa":
            return <DistributionCard title="Objetivo da conversa" rows={data.conversation_goals} />;
        case "instagram.sentimento_cliente":
            return <DistributionCard title="Sentimento do cliente" rows={data.sentiments} />;
        case "instagram.dimensoes_qualidade":
            return <BarValueCard title="Dimensões da qualidade" rows={data.quality_dimensions.map((item) => ({ label: item.label, value: item.score ?? 0 }))} />;
        case "instagram.objecoes":
            return <BarValueCard title="Objeções identificadas" rows={data.objections.map((item) => ({ label: item.label, value: item.total }))} />;
        default:
            return <Card>Widget indisponível.</Card>;
    }
}

function renderMessenger(id: string, data: MessengerAnalysisData) {
    switch (id) {
        case "messenger.conversas_analisadas":
            return <KpiCard icon={<FaFacebookMessenger size={26} />} label="Conversas analisadas" currentValue={data.conversations_analyzed} formatter={formatInteger} color="blue" tooltipText={`${formatPercent(data.analysis_coverage_rate)} de cobertura entre ${data.conversations_total.toLocaleString("pt-BR")} conversas do Messenger. ${data.notable_count.toLocaleString("pt-BR")} foram marcadas como notáveis.`} />;
        case "messenger.resolucao_real":
            return <KpiCard icon={<ShieldCheck size={26} />} label="Resolução real" currentValue={data.resolution_rate} suffix="%" color="green" tooltipText={`Baseado em ${data.resolution_observed.toLocaleString("pt-BR")} conversas com resultado de resolução observável.`} />;
        case "messenger.clientes_satisfeitos":
            return <KpiCard icon={<Smile size={26} />} label="Clientes satisfeitos" currentValue={data.satisfaction_rate} suffix="%" color="blue" tooltipText={`Considera apenas sinais claros de satisfação ou insatisfação. ${data.satisfaction_observed.toLocaleString("pt-BR")} conversas observadas.`} />;
        case "messenger.taxa_abandono":
            return <KpiCard icon={<CircleX size={26} />} label="Taxa de abandono" currentValue={data.dropoff_rate} suffix="%" color="orange" positiveDirection="down" tooltipText={`${data.dropoff_count.toLocaleString("pt-BR")} conversas tiveram abandono detectado pela análise.`} />;
        case "messenger.primeira_resposta_humana":
            return <KpiCard icon={<Clock size={26} />} label="1ª resposta humana" currentValue={data.average_first_human_response_seconds} formatter={formatDuration} color="purple" positiveDirection="down" tooltipText={`Média filtrada até 2 horas. Mediana: ${formatDuration(data.median_first_human_response_seconds)}. P90: ${formatDuration(data.p90_first_human_response_seconds)}. ${data.first_human_response_observed.toLocaleString("pt-BR")} respostas observadas.`} />;
        case "messenger.qualidade_atendimento":
            return <KpiCard icon={<BadgeCheck size={26} />} label="Qualidade do atendimento" currentValue={data.attendant_quality_score} suffix="/100" color="blue" tooltipText={`${data.attendant_quality_observed.toLocaleString("pt-BR")} conversas com qualidade geral avaliada.`} />;
        case "messenger.evolucao_diaria":
            return <EvolutionCard title="Evolução diária do Messenger" data={data.daily_evolution} />;
        default:
            return <Card>Widget indisponível.</Card>;
    }
}

function renderCalls(id: string, data: CallsData) {
    switch (id) {
        case "ligacoes.realizadas":
            return <KpiCard icon={<PhoneCall size={26} />} label="Ligações realizadas" currentValue={data.total} formatter={formatInteger} color="green" />;
        case "ligacoes.final_bom":
            return <KpiCard icon={<ThumbsUp size={26} />} label="Final bom" currentValue={data.good_rate} suffix="%" color="green" tooltipText={`${data.good.toLocaleString("pt-BR")} ligações com final bom.`} />;
        case "ligacoes.final_neutro":
            return <KpiCard icon={<Minus size={26} />} label="Final neutro" currentValue={data.neutral_rate} suffix="%" color="blue" tooltipText={`${data.neutral.toLocaleString("pt-BR")} ligações com final neutro.`} />;
        case "ligacoes.final_ruim":
            return <KpiCard icon={<ThumbsDown size={26} />} label="Final ruim" currentValue={data.bad_rate} suffix="%" color="brand" positiveDirection="down" tooltipText={`${data.bad.toLocaleString("pt-BR")} ligações com final ruim.`} />;
        case "ligacoes.evolucao":
            return <CallEvolutionCard data={data} />;
        default:
            return <Card>Widget indisponível.</Card>;
    }
}

function renderWeb(id: string, data: WebData) {
    if (id === "web.visualizacoes_site") {
        return <KpiCard icon={<Globe2 size={26} />} label="Visualizações — site principal" currentValue={data.main_site_views} formatter={formatInteger} color="blue" />;
    }
    if (id === "web.visualizacoes_landing") {
        return <KpiCard icon={<PanelsTopLeft size={26} />} label="Visualizações — landing pages" currentValue={data.landing_page_views} formatter={formatInteger} color="purple" />;
    }
    if (id === "web.site_principal") return <PageTable title="Site principal" rows={data.main_site_pages} />;
    if (id === "web.landing_pages") return <PageTable title="Landing pages" rows={data.landing_pages} />;
    return <Card>Widget indisponível.</Card>;
}

function renderAttribution(id: string, data: AttributionData) {
    if (!data.available) return <Card><div className="py-10 text-center text-sm text-slate-500">Atribuição indisponível no período.</div></Card>;
    if (id === "instagram.origem_paga") {
        const rows = [
            { label: "Atribuídos", value: data.attributed_clients },
            { label: "Não atribuídos", value: data.unattributed_clients },
        ].filter((item) => item.value > 0);
        return <PieValueCard title="Origem paga dos clientes" rows={rows} />;
    }
    const rows = data.campaign_distribution
        .filter((item) => item.key !== "__unattributed__")
        .slice(0, 8)
        .map((item) => ({ label: item.label, value: item.count }));
    return <BarValueCard title="Clientes por campanha" rows={rows} />;
}

function EvolutionCard({ title, data }: { title: string; data: Array<Record<string, string | number | null>> }) {
    return (
        <Card className="min-w-0 overflow-hidden">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <div className="mt-5 h-[300px]">
                <ResponsiveContainer width="100%" height="100%" debounce={150}>
                    <AreaChart data={data}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis yAxisId="count" tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
                        <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip />
                        <Area yAxisId="count" type="monotone" dataKey="conversations" name="Conversas" stroke="#1683ff" fill="#1683ff22" />
                        <Line yAxisId="rate" type="monotone" dataKey="resolution_rate" name="Resolução" stroke="#10b981" strokeWidth={2.5} connectNulls />
                        <Line yAxisId="rate" type="monotone" dataKey="satisfaction_rate" name="Satisfação" stroke="#8b5cf6" strokeWidth={2.5} connectNulls />
                        <Line yAxisId="rate" type="monotone" dataKey="dropoff_rate" name="Abandono" stroke="#f59e0b" strokeWidth={2.5} connectNulls />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function CallEvolutionCard({ data }: { data: CallsData }) {
    const rows = data.daily_evolution.map((item) => ({ ...item, total: item.good + item.neutral + item.bad }));
    return (
        <Card className="min-w-0 overflow-hidden">
            <h3 className="text-base font-bold text-slate-900">Evolução das ligações</h3>
            <div className="mt-5 h-[300px]">
                <ResponsiveContainer width="100%" height="100%" debounce={150}>
                    <BarChart data={rows}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="good" name="Final bom" fill="#10b981" stackId="calls" />
                        <Bar dataKey="neutral" name="Final neutro" fill="#1683ff" stackId="calls" />
                        <Bar dataKey="bad" name="Final ruim" fill="#ef4444" stackId="calls" radius={[5, 5, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function renderShareChart(
    title: string,
    data: InstagramShareData | MessengerShareData,
    rateKey: string,
    channelKey: string,
    channelName: string,
) {
    return (
        <Card className="min-w-0 overflow-hidden">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <div className="mt-5 h-[300px]">
                <ResponsiveContainer width="100%" height="100%" debounce={150}>
                    <AreaChart data={data.daily_evolution}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis yAxisId="count" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip />
                        <Area yAxisId="count" type="monotone" dataKey={channelKey} name={channelName} stroke="#1683ff" fill="#1683ff22" />
                        <Line yAxisId="rate" type="monotone" dataKey={rateKey} name="Participação %" stroke="#8b5cf6" strokeWidth={2.5} connectNulls />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function DistributionCard({ title, rows }: { title: string; rows: DistributionPoint[] }) {
    return <BarValueCard title={title} rows={rows.map((item) => ({ label: item.label, value: item.count }))} />;
}

function BarValueCard({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
    const height = Math.max(260, rows.length * 42 + 70);
    return (
        <Card className="min-w-0 overflow-hidden">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            {rows.length === 0 ? <Empty /> : (
                <div className="mt-4" style={{ height }}>
                    <ResponsiveContainer width="100%" height="100%" debounce={150}>
                        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 18 }}>
                            <CartesianGrid strokeDasharray="4 4" stroke="#f1f5f9" horizontal={false} />
                            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                            <YAxis type="category" dataKey="label" width={160} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                            <Tooltip />
                            <Bar dataKey="value" name="Total" fill="#1683ff" radius={[0, 6, 6, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

function PieValueCard({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
    return (
        <Card className="min-w-0 overflow-hidden">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            {rows.length === 0 ? <Empty /> : (
                <div className="mt-4 h-[300px]">
                    <ResponsiveContainer width="100%" height="100%" debounce={150}>
                        <PieChart>
                            <Pie data={rows} dataKey="value" nameKey="label" innerRadius={58} outerRadius={95} paddingAngle={2}>
                                {rows.map((row, index) => <Cell key={row.label} fill={COLORS[index % COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

function PageTable({ title, rows }: { title: string; rows: PageViewRow[] }) {
    return (
        <Card className="min-w-0 overflow-hidden">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            {rows.length === 0 ? <Empty /> : (
                <div className="mt-4 max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
                    {rows.map((row) => (
                        <div key={`${row.host}${row.path}`} className="flex items-center justify-between gap-4 py-3">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-slate-800">{row.title || row.path}</div>
                                <div className="mt-1 truncate text-xs text-slate-500">{row.host}{row.path}</div>
                            </div>
                            <div className="shrink-0 text-sm font-bold text-slate-800">{formatInteger(row.views)}</div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}

function Empty() {
    return <div className="mt-5 rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center text-sm text-slate-400">Sem dados no período.</div>;
}

function buildEndpoint(
    widgetId: string,
    period: CalendarPresetValue | null,
    selectedRange: DateRange,
    unitNames: string[],
) {
    const params = new URLSearchParams();
    applyCalendarDateParams({ params, selectedRange, selectedPreset: period });

    if (widgetId.startsWith("instagram.")) {
        return `${widgetId === "instagram.origem_paga" || widgetId === "instagram.clientes_campanha" ? "/api/dashboard/instagram-attribution" : "/api/dashboard/instagram-analysis"}?${params.toString()}`;
    }
    if (widgetId.startsWith("messenger.")) return `/api/dashboard/messenger-analysis?${params.toString()}`;
    if (widgetId.startsWith("ligacoes.")) {
        for (const unit of unitNames) params.append("unit", unit);
        return `/api/dashboard/calls?${params.toString()}`;
    }
    if (widgetId.startsWith("web.")) return `/api/dashboard/web-pages?${params.toString()}`;
    if (widgetId === "jornada.participacao_instagram") return `/api/dashboard/instagram-share?${params.toString()}`;
    if (widgetId === "jornada.participacao_messenger") return `/api/dashboard/messenger-share?${params.toString()}`;
    return "";
}

function useCachedJson(url: string) {
    const [data, setData] = useState<unknown>(null);
    const [loading, setLoading] = useState(Boolean(url));
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        if (!url) {
            setLoading(false);
            setData(null);
            return;
        }

        setLoading(true);
        setError(null);
        let promise = requestCache.get(url);
        if (!promise) {
            promise = fetch(url, { cache: "no-store", credentials: "include" })
                .then(async (response) => {
                    const json = (await response.json()) as { error?: string };
                    if (!response.ok) throw new Error(json.error ?? "Falha ao carregar widget.");
                    return json;
                })
                .catch((requestError) => {
                    requestCache.delete(url);
                    throw requestError;
                });
            requestCache.set(url, promise);
        }

        void promise
            .then((json) => {
                if (active) setData(json);
            })
            .catch((requestError) => {
                if (active) setError(requestError instanceof Error ? requestError.message : "Falha ao carregar widget.");
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [url]);

    return { data, loading, error };
}

function formatInteger(value: number) {
    return value.toLocaleString("pt-BR");
}

function formatPercent(value: number | null | undefined) {
    return value === null || value === undefined ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function formatDuration(value: number) {
    if (!Number.isFinite(value)) return "—";
    if (value < 60) return `${Math.round(value)}s`;
    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);
    return seconds > 0 ? `${minutes}min ${seconds}s` : `${minutes}min`;
}
