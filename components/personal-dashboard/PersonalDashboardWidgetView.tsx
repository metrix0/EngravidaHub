"use client";

import { AgendaReportWidget } from "@/components/scheduling/AgendaReports";
import BookingAuthorsTable from "@/components/scheduling/BookingAuthorsTable";
import { PerformanceResolutionEvolutionChart, PerformanceResolutionOutcomesChart } from "@/components/performance/PerformanceAnalysisCharts";
import {
    PerformanceKpi, PerformanceMonthlyCard, PerformanceTicketsChart, PerformanceResponseChart,
    PerformanceContributionCard, PerformanceRankingCard, computePerformanceUnitContribution,
} from "@/components/performance/PerformanceWidgets";
import { applyCalendarDateParams } from "@/components/ui/CalendarButton";
import Card from "@/components/ui/Card";
import { AgendaIntelligenceWidget } from "@/components/scheduling/AgendaIntelligenceWidgets";
import Skeleton from "@/components/ui/Skeleton";
import GerencialOverview from "@/components/gerencial/GerencialOverview";
import ChannelDashboardWidgetRenderer from "@/components/personal-dashboard/ChannelDashboardWidgetRenderer";
import ExactDashboardGraphRenderer from "@/components/personal-dashboard/ExactDashboardGraphRenderer";
import PersonalDashboardWidgetRenderer from "@/components/personal-dashboard/PersonalDashboardWidgetRenderer";
import SourceFaithfulDashboardWidgetRenderer from "@/components/personal-dashboard/SourceFaithfulDashboardWidgetRenderer";
import { isChannelDashboardWidgetId } from "@/lib/personal-dashboard/registryExtended";
import { isSourceFaithfulDashboardWidgetId } from "@/lib/personal-dashboard/sourceFaithfulWidgetIds";
import type { DashboardWidgetDefinition } from "@/lib/personal-dashboard/registry";
import type {
    CalendarPresetValue,
    DateRange,
} from "@/components/ui/CalendarButton";
import type { SourceData } from "@/components/personal-dashboard/usePersonalDashboardSources";

type Props = {
    widget: DashboardWidgetDefinition;
    sources: SourceData;
    loadingSources: Set<string>;
    errors: Record<string, string>;
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
    unitIds: string[];
    unitNames: string[];
    attendantIds: string[];
    tunnelValues: string[];
    originValues: string[];
    categories: string[];
};

export default function PersonalDashboardWidgetView(props: Props) {
    if (props.widget.source === "performance") {
        const dateParams = new URLSearchParams();
        applyCalendarDateParams({ params: dateParams, selectedRange: props.selectedRange, selectedPreset: props.period });
        const start = dateParams.get("start_date") ?? "";
        const end = dateParams.get("end_date") ?? "";
        if (props.unitIds.length > 1) return <Card><p className="text-sm text-muted">Selecione apenas uma unidade para visualizar Performance.</p></Card>;
        if (props.widget.id === "performance.marcado_por_atendente") {
            return <BookingAuthorsTable start={start} end={end} unitIds={props.unitIds} />;
        }
        if (props.loadingSources.has("performance")) return <Skeleton className={props.widget.kind === "kpi" ? "h-32 rounded-2xl" : "h-64 rounded-2xl"} />;
        if (props.errors.performance) return <Card><p className="text-sm text-red">{props.errors.performance}</p></Card>;
        const report = props.sources.performance;
        if (!report) return <Skeleton className="h-40 rounded-2xl" />;
        const ranked = report.attendants.filter(person => !props.attendantIds.length || props.attendantIds.includes(person.id));
        const selected = [...ranked].sort((a, b) => b.tickets - a.tickets)[0];
        if (props.widget.id === "performance.ranking") return <PerformanceRankingCard report={report} attendants={ranked} />;
        if (props.widget.id === "performance.contribuicao_unidade") {
            const raOnly = props.attendantIds.length === 0;
            return <PerformanceContributionCard units={computePerformanceUnitContribution(report, ranked, raOnly)} raOnly={raOnly} />;
        }
        if (props.attendantIds.length > 1) return <Card><p className="text-sm text-muted">Selecione apenas um atendente para este indicador.</p></Card>;
        if (!selected) return <Card><p className="text-sm text-muted">Nenhum atendente com atividade no período.</p></Card>;
        const content = props.widget.kind === "kpi" ? <PerformanceKpi widgetId={props.widget.id} person={selected} /> :
            props.widget.id === "performance.evolucao_mensal" ? <PerformanceMonthlyCard person={selected} /> :
            props.widget.id === "performance.evolucao_tickets" ? <PerformanceTicketsChart person={selected} /> :
            props.widget.id === "performance.evolucao_resposta" ? <PerformanceResponseChart person={selected} /> :
            props.widget.id === "performance.resolution_evolution" ? <PerformanceResolutionEvolutionChart person={selected} /> :
            props.widget.id === "performance.resolution_outcomes" ? <PerformanceResolutionOutcomesChart person={selected} /> : null;
        return <div className="min-w-0 space-y-2"><p className="px-1 text-xs font-semibold text-muted">{selected.name}</p>{content}</div>;
    }

    if (props.widget.id === "gerencial.visao_geral") {
        return (
            <GerencialOverview
                period={props.period}
                selectedRange={props.selectedRange}
                unitIds={props.unitIds}
            />
        );
    }

    const isChannelWidget = isChannelDashboardWidgetId(props.widget.id);

    if (props.widget.kind !== "kpi" && isChannelWidget) {
        return <ExactDashboardGraphRenderer {...props} />;
    }

    if (isChannelWidget) {
        return (
            <ChannelDashboardWidgetRenderer
                widgetId={props.widget.id}
                period={props.period}
                selectedRange={props.selectedRange}
                unitNames={props.unitNames}
            />
        );
    }

    if (
        props.loadingSources.has(props.widget.source) ||
        props.errors[props.widget.source]
    ) {
        return <PersonalDashboardWidgetRenderer {...baseRendererProps(props)} />;
    }

    if (props.widget.source === "agenda_disponibilidade" || props.widget.source === "agenda_indicadores") {
        const report = props.sources[props.widget.source];
        if (!report) return <Skeleton className="h-40 rounded-2xl" />;
        const label = props.widget.source === "agenda_disponibilidade"
            ? `Data: ${report.reportDate.split("-").reverse().join("/")}`
            : new Date(`${report.start}T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
        return <div className="space-y-2"><p className="px-1 text-xs capitalize text-muted">{label}</p><AgendaReportWidget widgetId={props.widget.id} report={report} /></div>;
    }

    if (props.widget.source === "inteligencia_agenda") {
        return props.sources.inteligencia_agenda ? <AgendaIntelligenceWidget widgetId={props.widget.id} report={props.sources.inteligencia_agenda} /> : <Skeleton className="h-40 rounded-2xl" />;
    }

    if (props.widget.kind !== "kpi") {
        return <ExactDashboardGraphRenderer {...props} />;
    }

    if (isSourceFaithfulDashboardWidgetId(props.widget.id)) {
        return (
            <SourceFaithfulDashboardWidgetRenderer
                widget={props.widget}
                sources={props.sources}
                unitIds={props.unitIds}
                categories={props.categories}
            />
        );
    }

    return <PersonalDashboardWidgetRenderer {...baseRendererProps(props)} />;
}

function baseRendererProps(props: Props) {
    return {
        widget: props.widget,
        sources: props.sources,
        loadingSources: props.loadingSources,
        errors: props.errors,
        period: props.period,
        selectedRange: props.selectedRange,
        unitIds: props.unitIds,
    };
}
