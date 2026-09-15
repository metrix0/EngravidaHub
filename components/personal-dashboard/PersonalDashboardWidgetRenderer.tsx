"use client";

import {
    AlertTriangle,
    Ban,
    BarChart3,
    Calendar,
    CalendarCheck,
    CalendarCheck2,
    CalendarPlus2,
    CheckCircle2,
    CircleAlert,
    Clock,
    Filter,
    MessageCircle,
    ReceiptText,
    Send,
    ShieldCheck,
    Smile,
    Users,
    UsersRound,
    WalletCards,
} from "lucide-react";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
    ZAxis,
} from "recharts";

import { Card, KpiCard, Skeleton } from "@/components";
import DashboardCallInsights from "@/components/dashboard/DashboardCallInsights";
import DashboardWebPageViews from "@/components/dashboard/DashboardWebPageViews";
import ExecutiveScheduleTable from "@/components/dashboard/ExecutiveScheduleTable";
import InstagramConversationInsights from "@/components/dashboard/InstagramConversationInsights";
import MessengerConversationInsights from "@/components/dashboard/MessengerConversationInsights";
import type {
    CalendarPresetValue,
    DateRange,
} from "@/components/ui/CalendarButton";
import type { DashboardWidgetDefinition } from "@/lib/personal-dashboard/registry";
import type {
    ExecutiveDashboardData,
    FinancialDashboardData,
} from "@/types";
import type { FinancialUnitSummaryData } from "@/types/financial-dashboard-extras";
import type { SourceData } from "./usePersonalDashboardSources";

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
    full_pipeline: {
        available: boolean;
        stages: Array<{
            key: string;
            label: string;
            value: number;
            secondary_value: number | null;
            secondary_kind: "count" | "currency" | null;
        }>;
        transitions: Array<{
            key: string;
            label: string;
            rate: number | null;
            from_value: number;
            to_value: number;
        }>;
        audit: {
            tracked_sources: Array<{
                platform: string;
                field: string;
                source: string;
                clients: number;
                percentage: number;
            }>;
            whatsapp_coverage: {
                total_conversations: number;
                tracked_conversations: number;
                tracking_rate: number | null;
                google_conversations: number;
                meta_conversations: number;
                other_conversations: number;
                untracked_conversations: number;
            };
        };
    };
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
        event_type: string;
        label: string;
        count: number;
        percentage: number | null;
    }>;
    previous_by_type: Array<{
        event_type: string;
        label: string;
        count: number;
        percentage: number | null;
    }>;
    daily: Array<Record<string, string | number>>;
    recent: Array<{
        id: string;
        date: string;
        client_name: string;
        event_type: string;
        platform: string;
        status: string;
    }>;
};

type EventKpis = {
    unique_events: number;
    sent_events: number;
    failed_events: number;
    meta_ip_rate?: number | null;
    google_click_id_rate?: number | null;
    gclid_rate: number | null;
};

type ClientsData = {
    clients: Array<{
        unit_id: string | null;
        funnel_stage_id: string | null;
        last_interaction_at: string;
    }>;
    stages: Array<{ id: string; name: string }>;
};

type FunnelData = {
    kpis: {
        evaluations_scheduled: number;
        evaluation_show_rate: number;
        procedures_scheduled: number;
        procedure_show_rate: number;
    };
    previous_kpis: FunnelData["kpis"];
};

type ActiveAnalytics = {
    history: Array<{
        id: string;
        template_id: string;
        template_name: string;
        sent_count: number;
        response_count: number;
        schedule_count: number;
        created_at: string;
    }>;
};

type Props = {
    widget: DashboardWidgetDefinition;
    sources: SourceData;
    loadingSources: Set<string>;
    errors: Record<string, string>;
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
    unitIds: string[];
};

export default function PersonalDashboardWidgetRenderer({
    widget,
    sources,
    loadingSources,
    errors,
    period,
    selectedRange,
    unitIds,
}: Props) {
    if (widget.source === "canais") {
        return renderChannelWidget(widget.id, period, selectedRange);
    }

    if (loadingSources.has(widget.source)) {
        return <WidgetSkeleton kind={widget.kind} />;
    }

    const error = errors[widget.source];
    if (error) return <UnavailableWidget message={error} />;

    switch (widget.source) {
        case "atendimento":
            return renderAtendimento(widget.id, sources.atendimento);
        case "financeiro":
            return renderFinanceiro(
                widget.id,
                sources.financeiro,
                sources.financeiroSummary,
            );
        case "jornada":
            return renderJornada(widget.id, sources.jornada as JourneyData | null);
        case "eventos":
            return renderEventos(widget.id, sources.eventos as EventsData | null);
        case "clientes":
            return renderClientes(
                widget.id,
                sources.clientes as ClientsData | null,
                unitIds,
            );
        case "funil":
            return renderFunil(widget.id, sources.funil as FunnelData | null);
        case "mensagem_ativa":
            return renderMensagemAtiva(
                widget.id,
                sources.mensagem_ativa as ActiveAnalytics | null,
            );
        default:
            return <UnavailableWidget />;
    }
}

function renderChannelWidget(
    id: string,
    period: CalendarPresetValue | null,
    selectedRange: DateRange,
) {
    if (id === "canais.instagram_conversas") {
        return (
            <InstagramConversationInsights
                mode="analysis"
                period={period}
                selectedRange={selectedRange}
            />
        );
    }
    if (id === "canais.messenger_conversas") {
        return (
            <MessengerConversationInsights
                mode="analysis"
                period={period}
                selectedRange={selectedRange}
            />
        );
    }
    if (id === "canais.ligacoes") {
        return (
            <DashboardCallInsights
                period={period}
                selectedRange={selectedRange}
            />
        );
    }
    if (id === "canais.site") {
        return (
            <DashboardWebPageViews
                period={period}
                selectedRange={selectedRange}
            />
        );
    }
    return <UnavailableWidget />;
}

function renderAtendimento(
    id: string,
    data: ExecutiveDashboardData | null,
) {
    if (!data) return <UnavailableWidget />;
    const total = data.schedule_unit_table.total;
    const previousTotal = data.previous_schedule_unit_table.total;
    const projectionFactor =
        total.appointments > 0
            ? total.projection / total.appointments
            : total.markings > 0
              ? total.markings_projection / total.markings
              : 1;
    const projected = (value: number) =>
        `Projeção ${Math.round(value * projectionFactor).toLocaleString("pt-BR")}`;
    const responseMinutes = secondsToMinutes(
        data.kpis.average_first_human_response_seconds,
    );
    const previousResponseMinutes = secondsToMinutes(
        data.previous_kpis.average_first_human_response_seconds,
    );

    switch (id) {
        case "atendimento.conversas_analisadas":
            return (
                <KpiCard
                    icon={<MessageCircle size={26} />}
                    label="Conversas analisadas"
                    currentValue={data.kpis.conversations_analyzed}
                    previousValue={data.previous_kpis.conversations_analyzed}
                    formatter={formatInteger}
                    color="blue"
                />
            );
        case "atendimento.resolucao_real":
            return (
                <KpiCard
                    icon={<ShieldCheck size={26} />}
                    label="Resolução real"
                    currentValue={data.kpis.real_resolution_rate}
                    previousValue={data.previous_kpis.real_resolution_rate}
                    suffix="%"
                    color="green"
                />
            );
        case "atendimento.clientes_satisfeitos":
            return (
                <KpiCard
                    icon={<Smile size={26} />}
                    label="Clientes satisfeitos"
                    currentValue={data.kpis.clear_satisfaction_rate}
                    previousValue={data.previous_kpis.clear_satisfaction_rate}
                    suffix="%"
                    color="purple"
                />
            );
        case "atendimento.taxa_agendamentos":
            return (
                <KpiCard
                    icon={<Calendar size={26} />}
                    label="Taxa agendamentos"
                    currentValue={data.kpis.scheduling_rate}
                    previousValue={data.previous_kpis.scheduling_rate}
                    suffix="%"
                    color="purple"
                />
            );
        case "atendimento.primeira_resposta_humana":
            return (
                <KpiCard
                    icon={<Clock size={26} />}
                    label="1ª resposta humana"
                    currentValue={responseMinutes}
                    previousValue={previousResponseMinutes}
                    suffix=" min"
                    color="orange"
                    positiveDirection="down"
                />
            );
        case "atendimento.marcacoes":
            return (
                <KpiCard
                    icon={<CalendarPlus2 size={26} />}
                    label="Marcações"
                    currentValue={total.markings}
                    previousValue={previousTotal.markings}
                    formatter={formatInteger}
                    projectionText={`Projeção ${Math.round(total.markings_projection).toLocaleString("pt-BR")}`}
                    color="blue"
                />
            );
        case "atendimento.agendamentos":
            return (
                <KpiCard
                    icon={<CalendarCheck2 size={26} />}
                    label="Agendamentos"
                    currentValue={total.appointments}
                    previousValue={previousTotal.appointments}
                    formatter={formatInteger}
                    projectionText={`Projeção ${Math.round(total.projection).toLocaleString("pt-BR")}`}
                    color="purple"
                />
            );
        case "atendimento.agendamentos_unicos":
            return (
                <KpiCard
                    icon={<UsersRound size={26} />}
                    label="Agendamentos únicos"
                    currentValue={total.unique_appointments}
                    previousValue={previousTotal.unique_appointments}
                    formatter={formatInteger}
                    projectionText={projected(total.unique_appointments)}
                    color="green"
                />
            );
        case "atendimento.cancelou":
            return (
                <KpiCard
                    icon={<Ban size={26} />}
                    label="Cancelou"
                    currentValue={total.cancelled}
                    previousValue={previousTotal.cancelled}
                    formatter={formatInteger}
                    projectionText={projected(total.cancelled)}
                    color="pink"
                    positiveDirection="down"
                />
            );
        case "atendimento.faltou":
            return (
                <KpiCard
                    icon={<CircleAlert size={26} />}
                    label="Faltou"
                    currentValue={total.no_show}
                    previousValue={previousTotal.no_show}
                    formatter={formatInteger}
                    projectionText={projected(total.no_show)}
                    color="brand"
                    positiveDirection="down"
                />
            );
        case "atendimento.compareceu":
            return (
                <KpiCard
                    icon={<CheckCircle2 size={26} />}
                    label="Compareceu"
                    currentValue={total.showed_up}
                    previousValue={previousTotal.showed_up}
                    formatter={formatInteger}
                    projectionText={projected(total.showed_up)}
                    color="green"
                />
            );
        case "atendimento.evolucao_conversas":
            return (
                <LineSeriesCard
                    title="Evolução de conversas"
                    data={data.daily_evolution}
                    xKey="date"
                    series={[
                        { key: "conversations", name: "Conversas", color: "#1683ff" },
                        { key: "resolution_rate", name: "Resolução %", color: "#10b981" },
                    ]}
                />
            );
        case "atendimento.objetivo_conversas":
            return (
                <PieValueCard
                    title="Objetivo das conversas"
                    rows={data.conversation_goals.map((item) => ({
                        label: item.label,
                        value: item.count,
                    }))}
                />
            );
        case "atendimento.momentos_perda":
            return (
                <RankedBarsCard
                    title="Momentos de perda mais comuns"
                    rows={data.dropoff_moments.map((item) => ({
                        label: item.label,
                        value: item.count,
                    }))}
                />
            );
        case "atendimento.mapa_palavras":
            return <WordMapWidget data={data} />;
        case "atendimento.palavras_unidade":
            return <UnitWordsWidget data={data} />;
        case "atendimento.agendamentos_periodo":
            return (
                <LineSeriesCard
                    title="Agendamentos no período"
                    data={data.schedule_evolution}
                    xKey="date"
                    series={[
                        { key: "total", name: "Agendamentos", color: "#8b5cf6" },
                        { key: "unique_total", name: "Únicos", color: "#10b981" },
                    ]}
                />
            );
        case "atendimento.marcacoes_dia":
            return (
                <BarSeriesCard
                    title="Marcações por dia"
                    data={data.schedule_creation_evolution}
                    xKey="date"
                    bars={[{ key: "total", name: "Marcações", color: "#06b6d4" }]}
                />
            );
        case "atendimento.online_presencial":
            return <ExecutiveScheduleTable data={data.schedule_unit_table} />;
        case "atendimento.eficiencia_unidades":
            return <UnitEfficiencyWidget data={data} />;
        case "atendimento.visao_unidade":
            return <UnitViewWidget data={data} />;
        default:
            return <UnavailableWidget />;
    }
}

function renderFinanceiro(
    id: string,
    data: FinancialDashboardData | null,
    summary: FinancialUnitSummaryData | null,
) {
    if (!data) return <UnavailableWidget />;
    const revenue = summary?.total.total ?? data.kpis.authorized_revenue;
    const ads = data.ads;

    switch (id) {
        case "financeiro.faturamento_autorizado":
            return (
                <KpiCard
                    icon={<WalletCards size={26} />}
                    label="Faturamento autorizado"
                    currentValue={revenue}
                    previousValue={data.previous_kpis.authorized_revenue}
                    formatter={formatCurrency}
                    color="green"
                />
            );
        case "financeiro.notas_autorizadas":
            return (
                <KpiCard
                    icon={<ReceiptText size={26} />}
                    label="Notas autorizadas"
                    currentValue={data.kpis.authorized_invoices}
                    previousValue={data.previous_kpis.authorized_invoices}
                    formatter={formatInteger}
                    color="blue"
                />
            );
        case "financeiro.ticket_medio":
            return (
                <KpiCard
                    icon={<WalletCards size={26} />}
                    label="Ticket médio"
                    currentValue={data.kpis.average_ticket}
                    previousValue={data.previous_kpis.average_ticket}
                    formatter={formatCurrency}
                    color="purple"
                />
            );
        case "financeiro.pacientes_faturados":
            return (
                <KpiCard
                    icon={<Users size={26} />}
                    label="Pacientes faturados"
                    currentValue={data.kpis.billed_patients}
                    previousValue={data.previous_kpis.billed_patients}
                    formatter={formatInteger}
                    color="pink"
                />
            );
        case "financeiro.valor_cancelado":
            return (
                <KpiCard
                    icon={<Ban size={26} />}
                    label="Valor cancelado"
                    currentValue={data.kpis.cancelled_amount}
                    previousValue={data.previous_kpis.cancelled_amount}
                    formatter={formatCurrency}
                    color="orange"
                    positiveDirection="down"
                />
            );
        case "financeiro.taxa_cancelamento":
            return (
                <KpiCard
                    icon={<CircleAlert size={26} />}
                    label="Taxa de cancelamento"
                    currentValue={data.kpis.cancellation_rate}
                    previousValue={data.previous_kpis.cancellation_rate}
                    suffix="%"
                    color="orange"
                    positiveDirection="down"
                />
            );
        case "financeiro.investimento_midia":
            return paidMediaKpi(
                "Investimento em mídia",
                ads.kpis.spend,
                ads.previous_kpis.spend,
                "currency",
            );
        case "financeiro.receita_midia":
            return paidMediaKpi(
                "Receita atribuída à mídia",
                ads.kpis.attributed_revenue,
                ads.previous_kpis.attributed_revenue,
                "currency",
            );
        case "financeiro.retorno_midia":
            return paidMediaKpi(
                "Retorno sobre mídia",
                ads.kpis.return_on_spend,
                ads.previous_kpis.return_on_spend,
                "multiple",
            );
        case "financeiro.custo_agendamento":
            return paidMediaKpi(
                "Custo por agendamento",
                ads.kpis.cost_per_schedule,
                ads.previous_kpis.cost_per_schedule,
                "currency",
                true,
            );
        case "financeiro.custo_paciente_faturado":
            return paidMediaKpi(
                "Custo por paciente faturado",
                ads.kpis.cost_per_billed_patient,
                ads.previous_kpis.cost_per_billed_patient,
                "currency",
                true,
            );
        case "financeiro.evolucao_faturamento":
            return (
                <LineSeriesCard
                    title="Evolução do faturamento"
                    data={data.evolution}
                    xKey="label"
                    series={[
                        {
                            key: "authorized_revenue",
                            name: "Faturamento",
                            color: "#10b981",
                        },
                    ]}
                    currency
                />
            );
        case "financeiro.status_fiscal":
            return (
                <PieValueCard
                    title="Status fiscal"
                    rows={data.by_status.map((item) => ({
                        label: item.label,
                        value: item.amount,
                    }))}
                    currency
                />
            );
        case "financeiro.faturamento_12_meses":
            return (
                <BarSeriesCard
                    title="Faturamento e investimento — 12 meses"
                    data={data.twelve_month_trend}
                    xKey="label"
                    bars={[
                        { key: "revenue", name: "Faturamento", color: "#10b981" },
                        { key: "investment", name: "Investimento", color: "#1683ff" },
                    ]}
                    currency
                />
            );
        case "financeiro.faturamento_procedimento":
            return (
                <HorizontalValueChart
                    title="Faturamento por procedimento"
                    rows={data.by_category.map((item) => ({
                        label: item.label,
                        value: item.revenue,
                    }))}
                    currency
                />
            );
        case "financeiro.faturamento_unidade":
            return (
                <SimpleTableCard
                    title="Faturamento por unidade"
                    headers={
                        summary
                            ? ["Unidade", "Faturamento", "Projeção"]
                            : ["Unidade", "Faturamento", "Pacientes"]
                    }
                    rows={
                        summary
                            ? summary.rows.map((item) => [
                                  item.unit_name,
                                  formatCurrency(item.total),
                                  formatCurrency(item.projection),
                              ])
                            : data.by_unit.map((item) => [
                                  item.unit_name,
                                  formatCurrency(item.revenue),
                                  formatInteger(item.patients),
                              ])
                    }
                />
            );
        case "financeiro.procedimentos_cidade":
            return (
                <HorizontalValueChart
                    title="Procedimentos por cidade"
                    rows={(summary?.procedures_by_city ?? []).map((item) => ({
                        label: item.unit_name,
                        value: item.total,
                    }))}
                />
            );
        case "financeiro.faturamento_origem":
            return (
                <HorizontalValueChart
                    title="Faturamento por origem"
                    rows={data.crm.by_origin.map((item) => ({
                        label: item.origin || "Sem origem",
                        value: item.revenue,
                    }))}
                    currency
                />
            );
        case "financeiro.faturamento_medico":
            return (
                <HorizontalValueChart
                    title="Faturamento por médico"
                    rows={data.by_doctor.map((item) => ({
                        label: item.doctor_name,
                        value: item.revenue,
                    }))}
                    currency
                />
            );
        case "financeiro.investimento_receita_midia":
            return (
                <LineSeriesCard
                    title="Investimento x receita atribuída"
                    data={ads.evolution}
                    xKey="label"
                    series={[
                        { key: "spend", name: "Investimento", color: "#1683ff" },
                        {
                            key: "attributed_revenue",
                            name: "Receita atribuída",
                            color: "#10b981",
                        },
                    ]}
                    currency
                />
            );
        case "financeiro.eficiencia_plataforma":
            return (
                <SimpleTableCard
                    title="Eficiência por plataforma"
                    headers={["Plataforma", "Investimento", "Receita", "ROAS"]}
                    rows={ads.by_platform.map((item) => [
                        item.label,
                        formatCurrency(item.spend),
                        formatCurrency(item.attributed_revenue),
                        formatMultiple(item.return_on_spend),
                    ])}
                />
            );
        case "financeiro.roas_plataforma":
            return (
                <HorizontalValueChart
                    title="ROAS por plataforma"
                    rows={ads.by_platform.map((item) => ({
                        label: item.label,
                        value: item.return_on_spend ?? 0,
                    }))}
                    suffix="x"
                />
            );
        case "financeiro.campanhas":
            return (
                <SimpleTableCard
                    title="Campanhas com maior investimento"
                    headers={["Campanha", "Plataforma", "Investimento", "Cliques"]}
                    rows={ads.top_campaigns.map((item) => [
                        item.campaign_name,
                        item.platform_label,
                        formatCurrency(item.spend),
                        formatInteger(item.clicks),
                    ])}
                />
            );
        case "financeiro.verba_cidade":
            return (
                <SimpleTableCard
                    title="Verba de mídia por cidade"
                    headers={["Cidade", "Orçamento", "Investimento", "Projeção"]}
                    rows={ads.by_city.map((item) => [
                        item.city,
                        formatCurrency(item.monthly_budget),
                        formatCurrency(item.spend),
                        formatCurrency(item.monthly_projection),
                    ])}
                />
            );
        case "financeiro.retorno_cidade":
            return (
                <HorizontalValueChart
                    title="Retorno real da mídia por cidade"
                    rows={ads.by_city.map((item) => ({
                        label: item.city,
                        value: item.real_roas ?? 0,
                    }))}
                    suffix="x"
                />
            );
        default:
            return <UnavailableWidget />;
    }
}

function renderJornada(id: string, data: JourneyData | null) {
    if (!data) return <UnavailableWidget />;
    const coverage = data.full_pipeline.audit?.whatsapp_coverage;

    switch (id) {
        case "jornada.jornada_completa":
            return (
                <HorizontalValueChart
                    title="Jornada completa"
                    rows={data.full_pipeline.stages.map((item) => ({
                        label: item.label,
                        value: item.value,
                    }))}
                />
            );
        case "jornada.cobertura_whatsapp":
            return (
                <PieValueCard
                    title="Cobertura das conversas no WhatsApp"
                    rows={[
                        {
                            label: "Rastreadas",
                            value: coverage?.tracked_conversations ?? 0,
                        },
                        {
                            label: "Não rastreadas",
                            value: coverage?.untracked_conversations ?? 0,
                        },
                    ]}
                />
            );
        case "jornada.fontes_whatsapp":
            return (
                <SimpleTableCard
                    title="De onde vem o WhatsApp rastreado"
                    headers={["Plataforma", "Origem", "Clientes", "%"]}
                    rows={(data.full_pipeline.audit?.tracked_sources ?? []).map(
                        (item) => [
                            item.platform,
                            item.source,
                            formatInteger(item.clients),
                            formatPercent(item.percentage),
                        ],
                    )}
                />
            );
        case "jornada.funil_conversa":
            return (
                <HorizontalValueChart
                    title="Jornada na Conversa"
                    rows={data.journey_funnel.map((item) => ({
                        label: item.name,
                        value: item.value,
                    }))}
                />
            );
        case "jornada.pontos_abandono":
            return (
                <RankedBarsCard
                    title="Pontos de abandono"
                    rows={data.dropoff_moments.map((item) => ({
                        label: item.label,
                        value: item.count,
                    }))}
                />
            );
        case "jornada.resultados_intencao":
            return (
                <SimpleTableCard
                    title="Resultados por intenção inicial"
                    headers={[
                        "Intenção",
                        "Resolvidas",
                        "Parciais",
                        "Não resolvidas",
                        "Abandonadas",
                    ]}
                    rows={data.intent_paths.map((item) => [
                        item.intent,
                        formatInteger(item.resolved),
                        formatInteger(item.partial),
                        formatInteger(item.not_resolved),
                        formatInteger(item.abandoned),
                    ])}
                />
            );
        case "jornada.objecoes":
            return (
                <RankedBarsCard
                    title="Principais objeções"
                    rows={data.objections.map((item) => ({
                        label: item.label,
                        value: item.value,
                    }))}
                />
            );
        default:
            return <UnavailableWidget />;
    }
}

function renderEventos(id: string, data: EventsData | null) {
    if (!data) return <UnavailableWidget />;
    const platformCount = (platform: string, previous = false) =>
        (previous ? data.previous_by_platform : data.by_platform).find(
            (item) => item.platform === platform,
        )?.count ?? 0;
    const typeCount = (type: string, previous = false) =>
        (previous ? data.previous_by_type : data.by_type).find(
            (item) => item.event_type === type,
        )?.count ?? 0;

    switch (id) {
        case "eventos.eventos_unicos":
            return eventKpi(
                "Eventos únicos",
                data.kpis.unique_events,
                data.previous_kpis.unique_events,
                <BarChart3 size={26} />,
                "green",
            );
        case "eventos.eventos_enviados":
            return eventKpi(
                "Eventos enviados",
                data.kpis.sent_events,
                data.previous_kpis.sent_events,
                <Send size={26} />,
                "purple",
            );
        case "eventos.meta_ads":
            return eventKpi(
                "Meta Ads",
                platformCount("meta_ads"),
                platformCount("meta_ads", true),
                <MessageCircle size={26} />,
                "blue",
            );
        case "eventos.google_ads":
            return eventKpi(
                "Google Ads",
                platformCount("google_ads"),
                platformCount("google_ads", true),
                <BarChart3 size={26} />,
                "orange",
            );
        case "eventos.qualified_lead":
            return eventKpi(
                "Qualified Lead",
                typeCount("lead"),
                typeCount("lead", true),
                <UsersRound size={26} />,
                "pink",
            );
        case "eventos.schedule":
            return eventKpi(
                "Schedule",
                typeCount("schedule"),
                typeCount("schedule", true),
                <Calendar size={26} />,
                "purple",
            );
        case "eventos.falhas_envio":
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
        case "eventos.eventos_dia":
            return (
                <BarSeriesCard
                    title="Eventos enviados por dia"
                    data={data.daily}
                    xKey="date"
                    bars={[
                        { key: "meta_ads_lead", name: "Meta · Lead", color: "#2563eb" },
                        { key: "meta_ads_schedule", name: "Meta · Schedule", color: "#639aeb" },
                        { key: "google_ads_lead", name: "Google · Lead", color: "#e29229" },
                        { key: "google_ads_schedule", name: "Google · Schedule", color: "#e0a569" },
                    ]}
                    stacked
                />
            );
        case "eventos.eventos_tipo":
            return (
                <PieValueCard
                    title="Eventos por tipo"
                    rows={data.by_type.map((item) => ({
                        label: item.label,
                        value: item.count,
                    }))}
                />
            );
        case "eventos.parametros_clique":
            return (
                <HorizontalValueChart
                    title="Parâmetros de clique"
                    rows={[
                        {
                            label: "Meta",
                            value: data.kpis.meta_ip_rate ?? 0,
                        },
                        {
                            label: "Google",
                            value:
                                data.kpis.google_click_id_rate ??
                                data.kpis.gclid_rate ??
                                0,
                        },
                    ]}
                    suffix="%"
                />
            );
        case "eventos.eventos_recentes":
            return (
                <SimpleTableCard
                    title="Eventos recentes"
                    headers={["Data", "Cliente", "Evento", "Plataforma", "Status"]}
                    rows={data.recent.map((item) => [
                        formatDateTime(item.date),
                        item.client_name || "—",
                        item.event_type,
                        item.platform,
                        item.status,
                    ])}
                />
            );
        default:
            return <UnavailableWidget />;
    }
}

function renderClientes(
    id: string,
    data: ClientsData | null,
    unitIds: string[],
) {
    if (!data) return <UnavailableWidget />;
    const stageById = new Map(data.stages.map((stage) => [stage.id, stage]));
    const clients = data.clients.filter(
        (client) =>
            unitIds.length === 0 ||
            Boolean(client.unit_id && unitIds.includes(client.unit_id)),
    );
    const withoutFunnel = clients.filter(
        (client) =>
            !client.funnel_stage_id || !stageById.has(client.funnel_stage_id),
    ).length;
    const scheduled = clients.filter((client) => {
        const name = client.funnel_stage_id
            ? stageById.get(client.funnel_stage_id)?.name ?? ""
            : "";
        return normalizeText(name).includes("agend");
    }).length;
    const now = Date.now();
    const withoutInteraction = clients.filter(
        (client) =>
            now - new Date(client.last_interaction_at).getTime() >
            24 * 60 * 60 * 1000,
    ).length;

    switch (id) {
        case "clientes.clientes_totais":
            return (
                <KpiCard
                    icon={<Users size={26} />}
                    label="Clientes totais"
                    currentValue={clients.length}
                    color="pink"
                />
            );
        case "clientes.sem_funil":
            return (
                <KpiCard
                    icon={<Filter size={26} />}
                    label="Sem funil"
                    currentValue={withoutFunnel}
                    color="green"
                />
            );
        case "clientes.agendados":
            return (
                <KpiCard
                    icon={<CalendarCheck size={26} />}
                    label="Agendados"
                    currentValue={scheduled}
                    color="blue"
                />
            );
        case "clientes.sem_interacao":
            return (
                <KpiCard
                    icon={<Clock size={26} />}
                    label="Sem interação"
                    currentValue={withoutInteraction}
                    color="orange"
                />
            );
        default:
            return <UnavailableWidget />;
    }
}

function renderFunil(id: string, data: FunnelData | null) {
    if (!data) return <UnavailableWidget />;
    const kpis = data.kpis;
    const previous = data.previous_kpis;

    switch (id) {
        case "funil.avaliacoes_agendadas":
            return (
                <KpiCard
                    icon={<CalendarCheck size={26} />}
                    label="Avaliações agendadas"
                    currentValue={kpis.evaluations_scheduled}
                    previousValue={previous.evaluations_scheduled}
                    formatter={formatInteger}
                    color="blue"
                />
            );
        case "funil.comparecimento_avaliacao":
            return (
                <KpiCard
                    icon={<CheckCircle2 size={26} />}
                    label="Comparecimento avaliação"
                    currentValue={kpis.evaluation_show_rate}
                    previousValue={previous.evaluation_show_rate}
                    suffix="%"
                    color="green"
                />
            );
        case "funil.procedimentos_agendados":
            return (
                <KpiCard
                    icon={<CalendarPlus2 size={26} />}
                    label="Procedimentos agendados"
                    currentValue={kpis.procedures_scheduled}
                    previousValue={previous.procedures_scheduled}
                    formatter={formatInteger}
                    color="purple"
                />
            );
        case "funil.comparecimento_procedimento":
            return (
                <KpiCard
                    icon={<CheckCircle2 size={26} />}
                    label="Comparecimento procedimento"
                    currentValue={kpis.procedure_show_rate}
                    previousValue={previous.procedure_show_rate}
                    suffix="%"
                    color="green"
                />
            );
        default:
            return <UnavailableWidget />;
    }
}

function renderMensagemAtiva(id: string, data: ActiveAnalytics | null) {
    if (!data) return <UnavailableWidget />;
    const byTemplate = new Map<
        string,
        { label: string; sent: number; responses: number; schedules: number }
    >();
    const byDay = new Map<
        string,
        { date: string; sent: number; responses: number; schedules: number }
    >();

    for (const item of data.history ?? []) {
        const templateKey = item.template_id || item.template_name;
        const template = byTemplate.get(templateKey) ?? {
            label: item.template_name,
            sent: 0,
            responses: 0,
            schedules: 0,
        };
        template.sent += item.sent_count;
        template.responses += item.response_count;
        template.schedules += item.schedule_count;
        byTemplate.set(templateKey, template);

        const date = formatDateKey(item.created_at);
        const day = byDay.get(date) ?? {
            date,
            sent: 0,
            responses: 0,
            schedules: 0,
        };
        day.sent += item.sent_count;
        day.responses += item.response_count;
        day.schedules += item.schedule_count;
        byDay.set(date, day);
    }

    const templateRows = [...byTemplate.values()].sort(
        (a, b) => b.sent - a.sent,
    );
    const dailyRows = [...byDay.values()].sort((a, b) =>
        a.date.localeCompare(b.date),
    );

    switch (id) {
        case "mensagem_ativa.templates_utilizados":
            return (
                <HorizontalValueChart
                    title="Templates utilizados"
                    rows={templateRows.map((item) => ({
                        label: item.label,
                        value: item.sent,
                    }))}
                />
            );
        case "mensagem_ativa.volume_resultados":
            return (
                <LineSeriesCard
                    title="Volume e resultados"
                    data={dailyRows}
                    xKey="date"
                    series={[
                        { key: "sent", name: "Enviados", color: "#06b6d4" },
                        { key: "responses", name: "Respostas", color: "#10b981" },
                        { key: "schedules", name: "Agendamentos", color: "#8b5cf6" },
                    ]}
                />
            );
        case "mensagem_ativa.historico_envios":
            return (
                <SimpleTableCard
                    title="Histórico de envios"
                    headers={[
                        "Data",
                        "Template",
                        "Enviados",
                        "Respostas",
                        "Agendamentos",
                    ]}
                    rows={(data.history ?? []).slice(0, 20).map((item) => [
                        formatDateTime(item.created_at),
                        item.template_name,
                        formatInteger(item.sent_count),
                        formatInteger(item.response_count),
                        formatInteger(item.schedule_count),
                    ])}
                />
            );
        default:
            return <UnavailableWidget />;
    }
}

function paidMediaKpi(
    label: string,
    currentValue: number | null,
    previousValue: number | null,
    format: "currency" | "multiple",
    positiveDown = false,
) {
    return (
        <KpiCard
            icon={<WalletCards size={26} />}
            label={label}
            currentValue={currentValue}
            previousValue={previousValue}
            formatter={format === "currency" ? formatCurrency : undefined}
            suffix={format === "multiple" ? "x" : ""}
            positiveDirection={positiveDown ? "down" : "up"}
            color={positiveDown ? "orange" : "blue"}
        />
    );
}

function eventKpi(
    label: string,
    currentValue: number,
    previousValue: number,
    icon: React.ReactNode,
    color: "green" | "purple" | "blue" | "orange" | "pink",
) {
    return (
        <KpiCard
            icon={icon}
            label={label}
            currentValue={currentValue}
            previousValue={previousValue}
            formatter={formatInteger}
            color={color}
        />
    );
}

function WordMapWidget({ data }: { data: ExecutiveDashboardData }) {
    const words = data.word_map?.words ?? [];
    const maximum = Math.max(1, ...words.map((word) => word.mentions));
    const palette = ["#0866ff", "#1683ff", "#8b5cf6", "#0f9f94", "#d97706"];

    return (
        <Card>
            <h2 className="text-lg font-bold">Mapa de palavras</h2>
            {words.length === 0 ? (
                <EmptyBody />
            ) : (
                <div className="flex min-h-[300px] flex-wrap content-center items-center justify-center gap-x-4 gap-y-3 px-3 py-6 text-center">
                    {words.map((word, index) => {
                        const scale = word.mentions / maximum;
                        return (
                            <span
                                key={word.word}
                                className="font-bold leading-none"
                                style={{
                                    color: palette[index % palette.length],
                                    fontSize: `${14 + scale * 24}px`,
                                    opacity: 0.68 + scale * 0.32,
                                }}
                                title={`${formatInteger(word.mentions)} citações`}
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

function UnitWordsWidget({ data }: { data: ExecutiveDashboardData }) {
    const words = (data.word_map?.words ?? []).slice(0, 6);
    const units = data.word_map?.by_unit ?? [];

    return (
        <SimpleTableCard
            title="Palavras por unidade"
            headers={["Unidade", ...words.map((word) => word.word)]}
            rows={units.map((unit) => {
                const byWord = new Map(
                    unit.words.map((word) => [word.word, word.mentions]),
                );
                return [
                    unit.unit_name,
                    ...words.map((word) =>
                        formatInteger(byWord.get(word.word) ?? 0),
                    ),
                ];
            })}
        />
    );
}

function UnitViewWidget({ data }: { data: ExecutiveDashboardData }) {
    return (
        <SimpleTableCard
            title="Visão por unidade"
            headers={[
                "Unidade",
                "Resolução",
                "Satisfação",
                "Agend. únicos",
                "No-show",
            ]}
            rows={data.by_unit.map((unit) => [
                unit.unit_name,
                formatPercent(unit.resolution_rate),
                formatPercent(unit.satisfaction_rate),
                formatInteger(unit.unique_appointments_count),
                formatPercent(unit.no_show_rate),
            ])}
        />
    );
}

function UnitEfficiencyWidget({ data }: { data: ExecutiveDashboardData }) {
    const rows = data.by_unit
        .filter(
            (unit) =>
                unit.raw_conversations > 0 && unit.resolution_rate !== null,
        )
        .map((unit) => ({
            unit: unit.unit_name,
            resolution: unit.resolution_rate ?? 0,
            scheduling:
                unit.raw_conversations > 0
                    ? (unit.unique_appointments_count / unit.raw_conversations) *
                      100
                    : 0,
            volume: unit.raw_conversations,
        }));

    return (
        <Card>
            <h2 className="mb-4 text-lg font-bold">
                Mapa de eficiência das unidades
            </h2>
            {rows.length === 0 ? (
                <EmptyBody />
            ) : (
                <div className="h-[340px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart
                            margin={{ top: 20, right: 20, bottom: 24, left: 0 }}
                        >
                            <CartesianGrid
                                strokeDasharray="4 4"
                                stroke="#e2e8f0"
                            />
                            <XAxis
                                type="number"
                                dataKey="resolution"
                                name="Resolução"
                                unit="%"
                                tick={{ fontSize: 11 }}
                            />
                            <YAxis
                                type="number"
                                dataKey="scheduling"
                                name="Agendamento"
                                unit="%"
                                tick={{ fontSize: 11 }}
                            />
                            <ZAxis
                                type="number"
                                dataKey="volume"
                                range={[80, 520]}
                            />
                            <Tooltip cursor={{ strokeDasharray: "4 4" }} />
                            <Scatter data={rows} fill="#8b5cf6" />
                        </ScatterChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

function LineSeriesCard({
    title,
    data,
    xKey,
    series,
    currency = false,
}: {
    title: string;
    data: Array<Record<string, unknown>>;
    xKey: string;
    series: Array<{ key: string; name: string; color: string }>;
    currency?: boolean;
}) {
    return (
        <Card>
            <h2 className="mb-4 text-lg font-bold">{title}</h2>
            <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} minTickGap={18} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                            formatter={(value) =>
                                currency
                                    ? formatCurrency(Number(value ?? 0))
                                    : formatInteger(Number(value ?? 0))
                            }
                        />
                        {series.map((item) => (
                            <Line
                                key={item.key}
                                type="monotone"
                                dataKey={item.key}
                                name={item.name}
                                stroke={item.color}
                                strokeWidth={3}
                                dot={false}
                                connectNulls
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function BarSeriesCard({
    title,
    data,
    xKey,
    bars,
    currency = false,
    stacked = false,
}: {
    title: string;
    data: Array<Record<string, unknown>>;
    xKey: string;
    bars: Array<{ key: string; name: string; color: string }>;
    currency?: boolean;
    stacked?: boolean;
}) {
    return (
        <Card>
            <h2 className="mb-4 text-lg font-bold">{title}</h2>
            <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} minTickGap={18} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                            formatter={(value) =>
                                currency
                                    ? formatCurrency(Number(value ?? 0))
                                    : formatInteger(Number(value ?? 0))
                            }
                        />
                        {bars.map((item) => (
                            <Bar
                                key={item.key}
                                dataKey={item.key}
                                name={item.name}
                                fill={item.color}
                                stackId={stacked ? "stack" : undefined}
                                radius={stacked ? undefined : [5, 5, 0, 0]}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function HorizontalValueChart({
    title,
    rows,
    currency = false,
    suffix = "",
}: {
    title: string;
    rows: Array<{ label: string; value: number }>;
    currency?: boolean;
    suffix?: string;
}) {
    const visible = rows.filter((item) => Number.isFinite(item.value)).slice(0, 15);
    return (
        <Card>
            <h2 className="mb-4 text-lg font-bold">{title}</h2>
            {visible.length === 0 ? (
                <EmptyBody />
            ) : (
                <div style={{ height: Math.max(280, visible.length * 38) }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={visible}
                            layout="vertical"
                            margin={{ left: 18, right: 16 }}
                        >
                            <CartesianGrid
                                strokeDasharray="4 4"
                                stroke="#e2e8f0"
                                horizontal={false}
                            />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis
                                type="category"
                                dataKey="label"
                                width={120}
                                tick={{ fontSize: 11 }}
                            />
                            <Tooltip
                                formatter={(value) =>
                                    currency
                                        ? formatCurrency(Number(value ?? 0))
                                        : `${formatInteger(Number(value ?? 0))}${suffix}`
                                }
                            />
                            <Bar
                                dataKey="value"
                                fill="#1683ff"
                                radius={[0, 6, 6, 0]}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

function RankedBarsCard({
    title,
    rows,
}: {
    title: string;
    rows: Array<{ label: string; value: number }>;
}) {
    const maximum = Math.max(1, ...rows.map((row) => row.value));
    return (
        <Card>
            <h2 className="mb-5 text-lg font-bold">{title}</h2>
            {rows.length === 0 ? (
                <EmptyBody />
            ) : (
                <div className="space-y-4">
                    {rows.slice(0, 10).map((row) => (
                        <div key={row.label}>
                            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                                <span className="truncate text-slate-600">
                                    {row.label}
                                </span>
                                <span className="font-bold text-slate-700">
                                    {formatInteger(row.value)}
                                </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                <div
                                    className="h-full rounded-full bg-purple"
                                    style={{
                                        width: `${Math.max(3, (row.value / maximum) * 100)}%`,
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}

function PieValueCard({
    title,
    rows,
    currency = false,
}: {
    title: string;
    rows: Array<{ label: string; value: number }>;
    currency?: boolean;
}) {
    const visible = rows.filter((row) => row.value > 0);
    const colors = ["#1683ff", "#8b5cf6", "#10b981", "#e29229", "#e4459b"];
    return (
        <Card>
            <h2 className="mb-4 text-lg font-bold">{title}</h2>
            {visible.length === 0 ? (
                <EmptyBody />
            ) : (
                <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={visible}
                                dataKey="value"
                                nameKey="label"
                                innerRadius={55}
                                outerRadius={95}
                            >
                                {visible.map((row, index) => (
                                    <Cell
                                        key={row.label}
                                        fill={colors[index % colors.length]}
                                    />
                                ))}
                            </Pie>
                            <Tooltip
                                formatter={(value) =>
                                    currency
                                        ? formatCurrency(Number(value ?? 0))
                                        : formatInteger(Number(value ?? 0))
                                }
                            />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

function SimpleTableCard({
    title,
    headers,
    rows,
}: {
    title: string;
    headers: string[];
    rows: string[][];
}) {
    return (
        <Card className="min-w-0 max-w-full overflow-hidden">
            <h2 className="mb-5 text-lg font-bold">{title}</h2>
            <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                        <tr>
                            {headers.map((header) => (
                                <th key={header} className="px-3 py-3 font-bold">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length > 0 ? (
                            rows.map((row, rowIndex) => (
                                <tr key={rowIndex} className="border-t border-slate-100">
                                    {row.map((cell, cellIndex) => (
                                        <td
                                            key={`${rowIndex}-${cellIndex}`}
                                            className="px-3 py-3 text-slate-600"
                                        >
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td
                                    colSpan={headers.length}
                                    className="px-3 py-10 text-center text-slate-400"
                                >
                                    Nenhum dado disponível.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

function WidgetSkeleton({ kind }: { kind: DashboardWidgetDefinition["kind"] }) {
    return (
        <Skeleton
            className={
                kind === "kpi"
                    ? "h-[118px] w-full rounded-2xl"
                    : "h-[360px] w-full rounded-2xl"
            }
        />
    );
}

function UnavailableWidget({
    message = "Este widget não está disponível no momento.",
}: {
    message?: string;
}) {
    return (
        <div className="flex min-h-[118px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-center text-sm text-slate-400">
            {message}
        </div>
    );
}

function EmptyBody() {
    return (
        <div className="flex min-h-[260px] items-center justify-center text-sm text-slate-400">
            Nenhum dado disponível neste período.
        </div>
    );
}

function secondsToMinutes(value: number | null) {
    return value === null ? null : Math.round(value / 60);
}

function formatInteger(value: number) {
    return Number(value).toLocaleString("pt-BR", {
        maximumFractionDigits: Number.isInteger(Number(value)) ? 0 : 1,
    });
}

function formatCurrency(value: number | null) {
    if (value === null || !Number.isFinite(value)) return "—";
    return value.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
    });
}

function formatPercent(value: number | null) {
    return value === null || !Number.isFinite(value)
        ? "—"
        : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function formatMultiple(value: number | null) {
    return value === null || !Number.isFinite(value)
        ? "—"
        : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`;
}

function formatDateTime(value: string) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return date.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDateKey(value: string) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

function normalizeText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR");
}
