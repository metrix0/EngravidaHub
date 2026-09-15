"use client";

import {
    AlertTriangle,
    BarChart3,
    Calendar,
    HelpCircle,
    Send,
    UsersRound,
} from "lucide-react";
import { FaGoogle, FaMeta } from "react-icons/fa6";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Funnel,
    FunnelChart,
    LabelList,
    Line,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { Card, InfoTooltip, KpiCard, PercentageBar } from "@/components";
import {
    FinancialUnitTableCard,
    MonthlyProjectionKpiCard,
    ProcedureMixByCityCard,
    RevenueEvolutionComparisonCard,
} from "@/components/dashboard/FinancialDashboardExtras";
import type { DashboardWidgetDefinition } from "@/lib/personal-dashboard/registry";
import type {
    ExecutiveDashboardData,
    FinancialDashboardData,
} from "@/types";
import type { FinancialUnitSummaryData } from "@/types/financial-dashboard-extras";
import type { SourceData } from "@/components/personal-dashboard/usePersonalDashboardSources";

type Props = {
    widget: DashboardWidgetDefinition;
    sources: SourceData;
    unitIds: string[];
    categories: string[];
};

type JourneyData = {
    journey_funnel: Array<{
        key: string;
        name: string;
        value: number;
        percentage: number | null;
        relative_percentage: number | null;
        fill: string;
    }>;
    dropoff_moments: Array<{
        moment: string;
        label: string;
        count: number;
        percentage: number | null;
    }>;
    intent_paths: Array<{
        intent: string;
        resolved: number;
        partial: number;
        not_resolved: number;
        abandoned: number;
    }>;
    objections: Array<{
        type: string;
        label: string;
        value: number;
        percentage: number | null;
    }>;
    audit?: {
        conversations_with_objections?: number;
    } | null;
};

type EventKpis = {
    total_events: number;
    unique_events: number;
    sent_events: number;
    failed_events: number;
    fbclid_events: number;
    fbclid_rate: number | null;
    gclid_events: number;
    gclid_rate: number | null;
};

type EventsData = {
    kpis: EventKpis;
    previous_kpis: EventKpis;
    by_platform: Array<{
        platform: string;
        count: number;
        percentage: number | null;
    }>;
    previous_by_platform: Array<{
        platform: string;
        count: number;
        percentage: number | null;
    }>;
    by_type: Array<{
        event_type: "lead" | "schedule";
        label: string;
        count: number;
        percentage: number | null;
    }>;
    previous_by_type: Array<{
        event_type: "lead" | "schedule";
        label: string;
        count: number;
        percentage: number | null;
    }>;
    daily: Array<Record<string, string | number>>;
};

const DAILY_EVENT_COLORS: Record<string, string> = {
    meta_ads_lead: "#2563eb",
    meta_ads_schedule: "#639aeb",
    google_ads_lead: "#E29229",
    google_ads_schedule: "#e0a569",
};

const EVENT_TYPE_CHART_COLORS = {
    lead: "#8b5cf6",
    schedule: "#e83e8c",
} as const;

export default function SourceFaithfulDashboardWidgetRenderer({
    widget,
    sources,
    unitIds,
    categories,
}: Props) {
    const atendimento = sources.atendimento;
    const financeiro = sources.financeiro;
    const summary = sources.financeiroSummary;
    const jornada = sources.jornada as JourneyData | null;
    const eventos = sources.eventos as EventsData | null;

    if (atendimento) {
        const view = renderAtendimento(widget.id, atendimento);
        if (view) return view;
    }

    if (financeiro) {
        const view = renderFinanceiro(
            widget.id,
            financeiro,
            summary,
            unitIds,
            categories,
        );
        if (view) return view;
    }

    if (jornada) {
        const view = renderJornada(widget.id, jornada);
        if (view) return view;
    }

    if (eventos) {
        const view = renderEventos(widget.id, eventos);
        if (view) return view;
    }

    return null;
}

function renderAtendimento(id: string, data: ExecutiveDashboardData) {
    if (id === "atendimento.evolucao_conversas") {
        return <AtendimentoEvolutionCard data={data} />;
    }
    if (id === "atendimento.objetivo_conversas") {
        return <AtendimentoGoalsCard data={data} />;
    }
    if (id === "atendimento.momentos_perda") {
        return <AtendimentoDropoffCard data={data} />;
    }
    return null;
}

function AtendimentoEvolutionCard({ data }: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <h2 className="text-lg font-bold">Evolução de conversas</h2>
                <div className="mt-3 flex items-center gap-6 text-xs text-slate-500">
                    <LegendDot color="#1683ff" label="Conversas" />
                    <LegendDot color="#10b981" label="Resolução (%)" />
                    <LegendDot color="#8b5cf6" label="Satisfação (%)" />
                </div>
            </div>
            <div className="h-[290px]">
                <ResponsiveContainer width="100%" height="100%" debounce={200}>
                    <AreaChart data={data.daily_evolution}>
                        <defs>
                            <linearGradient id="personalConversationFill" x1="0" y1="0" x2="0" y2="1">
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
                        />
                        <Tooltip />
                        <Area
                            type="monotone"
                            dataKey="conversations"
                            yAxisId="conversations"
                            name="Conversas"
                            stroke="#1683ff"
                            strokeWidth={3}
                            fill="url(#personalConversationFill)"
                        />
                        <Line
                            type="monotone"
                            dataKey="resolution_rate"
                            yAxisId="percentage"
                            name="Resolução"
                            stroke="#10b981"
                            strokeWidth={3}
                            dot={{ r: 4 }}
                        />
                        <Line
                            type="monotone"
                            dataKey="satisfaction_rate"
                            yAxisId="percentage"
                            name="Satisfação"
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

function AtendimentoGoalsCard({ data }: { data: ExecutiveDashboardData }) {
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

function AtendimentoDropoffCard({ data }: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Momentos de perda mais comuns</h2>
                <InfoTooltip text="Somente abandonos com evidência de mensagem. A porcentagem usa como base apenas os abandonos observáveis do período.">
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
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

function renderFinanceiro(
    id: string,
    data: FinancialDashboardData,
    summary: FinancialUnitSummaryData | null,
    unitIds: string[],
    categories: string[],
) {
    if (id === "financeiro.faturamento_autorizado") {
        return (
            <MonthlyProjectionKpiCard
                currentValue={summary?.total.total ?? data.kpis.authorized_revenue}
                previousValue={data.previous_kpis.authorized_revenue}
                projection={summary?.projection ?? null}
                loading={false}
                freeWidth
            />
        );
    }
    if (id === "financeiro.evolucao_faturamento") {
        return (
            <RevenueEvolutionComparisonCard
                data={data}
                unitIds={unitIds}
                categories={categories}
            />
        );
    }
    if (id === "financeiro.faturamento_unidade") {
        return (
            <FinancialUnitTableCard
                data={summary}
                operationalUnits={data.by_unit}
                operationalKpis={data.kpis}
                loading={false}
            />
        );
    }
    if (id === "financeiro.procedimentos_cidade") {
        return (
            <ProcedureMixByCityCard
                data={summary}
                loading={false}
            />
        );
    }
    return null;
}

function renderJornada(id: string, data: JourneyData) {
    if (id === "jornada.funil_conversa") {
        return <JourneyFunnelCard data={data} />;
    }
    if (id === "jornada.pontos_abandono") {
        return <JourneyDropoffCard data={data} />;
    }
    if (id === "jornada.resultados_intencao") {
        return <JourneyIntentPathsCard data={data} />;
    }
    if (id === "jornada.objecoes") {
        return <JourneyObjectionsCard data={data} />;
    }
    return null;
}

function JourneyFunnelCard({ data }: { data: JourneyData }) {
    return (
        <Card>
            <div className="mb-5">
                <h2 className="text-lg font-bold">Jornada na Conversa</h2>
            </div>
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(245px,0.65fr)] items-center gap-5">
                <div className="h-[330px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <FunnelChart margin={{ top: 10, right: 64, bottom: 10, left: 6 }}>
                            <Tooltip />
                            <Funnel dataKey="value" data={data.journey_funnel} isAnimationActive={false}>
                                <LabelList position="right" fill="#334155" stroke="none" dataKey="value" />
                                {data.journey_funnel.map((item) => (
                                    <Cell key={item.key} fill={item.fill} />
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
                                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
                                <span className="truncate font-medium text-slate-700" title={item.name}>
                                    {item.name}
                                </span>
                            </div>
                            <div className="grid grid-cols-[48px_52px] items-center gap-1">
                                <span className="text-right text-xs font-bold text-slate-500">
                                    {formatRate(item.relative_percentage)}
                                </span>
                                <span className="text-right text-xs font-medium text-slate-500">
                                    ({formatRate(item.percentage)})
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}

function JourneyDropoffCard({ data }: { data: JourneyData }) {
    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Pontos de abandono</h2>
                <InfoTooltip text="Base: abandonos observáveis">
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
            </div>
            <RankedPercentRows rows={data.dropoff_moments.map((item) => ({
                key: item.moment,
                label: item.label,
                percentage: item.percentage,
            }))} />
        </Card>
    );
}

function JourneyIntentPathsCard({ data }: { data: JourneyData }) {
    return (
        <Card>
            <div className="mb-5">
                <h2 className="text-lg font-bold">Resultados por intenção inicial</h2>
                <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-500">
                    <LegendDot color="var(--color-green)" label="Resolvida" />
                    <LegendDot color="var(--color-orange)" label="Parcial" />
                    <LegendDot color="#64748b" label="Não resolvida" />
                    <LegendDot color="var(--color-red)" label="Abandonou" />
                </div>
            </div>
            <div className="h-[470px] overflow-visible">
                <ResponsiveContainer width="100%" height="100%" debounce={200}>
                    <BarChart
                        data={data.intent_paths}
                        barCategoryGap="28%"
                        margin={{ top: 8, right: 8, bottom: 28, left: 10 }}
                    >
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis
                            dataKey="intent"
                            tick={{ fontSize: 12 }}
                            stroke="#94a3b8"
                            interval={0}
                            angle={-18}
                            textAnchor="end"
                            height={130}
                        />
                        <YAxis width={58} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <Tooltip cursor={false} />
                        <Bar dataKey="resolved" name="Resolvida" stackId="result" fill="var(--color-green)" />
                        <Bar dataKey="partial" name="Parcial" stackId="result" fill="var(--color-orange)" />
                        <Bar dataKey="not_resolved" name="Não resolvida" stackId="result" fill="#64748b" />
                        <Bar dataKey="abandoned" name="Abandonou" stackId="result" fill="var(--color-red)" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function JourneyObjectionsCard({ data }: { data: JourneyData }) {
    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Principais objeções</h2>
                <InfoTooltip text={`Base: ${data.audit?.conversations_with_objections ?? 0} conversas com objeções observáveis`}>
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
            </div>
            <RankedPercentRows rows={data.objections.map((item) => ({
                key: item.type,
                label: item.label,
                percentage: item.percentage,
            }))} />
        </Card>
    );
}

function RankedPercentRows({
    rows,
}: {
    rows: Array<{ key: string; label: string; percentage: number | null }>;
}) {
    return (
        <div className="space-y-4">
            {rows.map((item, index) => (
                <div key={item.key} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple text-xs font-bold text-white">
                        {index + 1}
                    </span>
                    <div className="w-full">
                        <div className="mb-2 flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-700">{item.label}</span>
                            <span className="font-bold text-slate-700">{formatRate(item.percentage)}</span>
                        </div>
                        <PercentageBar value={item.percentage ?? 0} color="purple" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function renderEventos(id: string, data: EventsData) {
    const platformCount = (platform: string, previous = false) =>
        (previous ? data.previous_by_platform : data.by_platform).find(
            (item) => item.platform === platform,
        )?.count ?? 0;
    const typeCount = (type: "lead" | "schedule", previous = false) =>
        (previous ? data.previous_by_type : data.by_type).find(
            (item) => item.event_type === type,
        )?.count ?? 0;

    if (id === "eventos.eventos_unicos") {
        return <EventKpi icon={<BarChart3 size={26} />} label="Eventos únicos" current={data.kpis.unique_events} previous={data.previous_kpis.unique_events} color="green" />;
    }
    if (id === "eventos.eventos_enviados") {
        return <EventKpi icon={<Send size={26} />} label="Eventos enviados" current={data.kpis.sent_events} previous={data.previous_kpis.sent_events} color="purple" />;
    }
    if (id === "eventos.meta_ads") {
        return <EventKpi icon={<FaMeta size={26} className="text-blue-600" />} label="Meta Ads" current={platformCount("Meta Ads")} previous={platformCount("Meta Ads", true)} color="blue" />;
    }
    if (id === "eventos.google_ads") {
        return <EventKpi icon={<FaGoogle size={24} className="text-amber-600" />} label="Google Ads" current={platformCount("Google Ads")} previous={platformCount("Google Ads", true)} color="orange" />;
    }
    if (id === "eventos.qualified_lead") {
        return <EventKpi icon={<UsersRound size={26} />} label="Qualified Lead" current={typeCount("lead")} previous={typeCount("lead", true)} color="pink" />;
    }
    if (id === "eventos.schedule") {
        return <EventKpi icon={<Calendar size={26} />} label="Schedule" current={typeCount("schedule")} previous={typeCount("schedule", true)} color="purple" />;
    }
    if (id === "eventos.falhas_envio") {
        return (
            <KpiCard
                icon={<AlertTriangle size={26} />}
                label="Falhas no envio"
                currentValue={data.kpis.failed_events}
                previousValue={data.previous_kpis.failed_events}
                formatter={formatInteger}
                color="orange"
                positiveDirection="down"
            />
        );
    }
    if (id === "eventos.eventos_dia") return <EventsByDayCard data={data} />;
    if (id === "eventos.eventos_tipo") return <EventsByTypeCard data={data} />;
    if (id === "eventos.parametros_clique") return <ClickIdRatesCard data={data} />;
    return null;
}

function EventKpi({
    icon,
    label,
    current,
    previous,
    color,
}: {
    icon: React.ReactNode;
    label: string;
    current: number;
    previous: number;
    color: "green" | "purple" | "blue" | "orange" | "pink";
}) {
    return (
        <KpiCard
            icon={icon}
            label={label}
            currentValue={current}
            previousValue={previous}
            formatter={formatInteger}
            color={color}
        />
    );
}

function EventsByDayCard({ data }: { data: EventsData }) {
    const bars = [
        ["meta_ads_lead", "Meta Ads · Qualified Lead"],
        ["meta_ads_schedule", "Meta Ads · Schedule"],
        ["google_ads_lead", "Google Ads · Qualified Lead"],
        ["google_ads_schedule", "Google Ads · Schedule"],
    ] as const;
    return (
        <Card>
            <div className="mb-5 flex items-center gap-2">
                <h2 className="text-lg font-bold">Eventos enviados por dia</h2>
                <InfoTooltip text="Mostra a quantidade de eventos enviados por plataforma e tipo de evento, agrupada no fuso America/Sao_Paulo.">
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
            </div>
            <div className="h-[285px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.daily} barCategoryGap="22%">
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <Tooltip cursor={false} />
                        {bars.map(([key, label]) => (
                            <Bar
                                key={key}
                                dataKey={key}
                                name={label}
                                stackId="events"
                                fill={DAILY_EVENT_COLORS[key]}
                            />
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
                            {data.by_type.map((item) => (
                                <Cell key={item.event_type} fill={EVENT_TYPE_CHART_COLORS[item.event_type]} />
                            ))}
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
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: EVENT_TYPE_CHART_COLORS[item.event_type] }} />
                            <span className="text-slate-600">{item.label}</span>
                        </div>
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

function RateBox({
    icon,
    label,
    value,
    count,
    colorClass,
    barClass,
}: {
    icon: React.ReactNode;
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
                    {icon}<span>{label}</span>
                </div>
                <span className="text-xs font-semibold text-slate-500">{count.toLocaleString("pt-BR")} eventos</span>
            </div>
            <div className="mb-2 text-3xl font-bold text-slate-950">{formatRate(value)}</div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${barClass}`} style={{ width: `${value === null ? 0 : Math.min(100, Math.max(0, value))}%` }} />
            </div>
        </div>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
            <span>{label}</span>
        </div>
    );
}

function formatRate(value: number | null | undefined) {
    return value === null || value === undefined ? "—" : `${value}%`;
}

function formatInteger(value: number) {
    return value.toLocaleString("pt-BR");
}
