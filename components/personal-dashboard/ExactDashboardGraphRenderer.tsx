"use client";

import ExactAtendimentoDashboardGraphs from "@/components/personal-dashboard/ExactAtendimentoDashboardGraphs";
import ExactChannelDashboardGraphRenderer from "@/components/personal-dashboard/ExactChannelDashboardGraphRenderer";
import ExactEventosDashboardGraphs from "@/components/personal-dashboard/ExactEventosDashboardGraphs";
import ExactFinanceiroDashboardGraphs from "@/components/personal-dashboard/ExactFinanceiroDashboardGraphs";
import ExactJornadaDashboardGraphs from "@/components/personal-dashboard/ExactJornadaDashboardGraphs";
import ExactMensagemAtivaDashboardGraphs from "@/components/personal-dashboard/ExactMensagemAtivaDashboardGraphs";
import PersonalDashboardWidgetRenderer from "@/components/personal-dashboard/PersonalDashboardWidgetRenderer";
import SourceFaithfulDashboardWidgetRenderer from "@/components/personal-dashboard/SourceFaithfulDashboardWidgetRenderer";
import { isChannelDashboardWidgetId } from "@/lib/personal-dashboard/registryExtended";
import type { DashboardWidgetDefinition } from "@/lib/personal-dashboard/registry";
import type { CalendarPresetValue, DateRange } from "@/components/ui/CalendarButton";
import type { SourceData } from "@/components/personal-dashboard/usePersonalDashboardSources";
import type { ExecutiveDashboardData, FinancialDashboardData } from "@/types";
import type { FinancialUnitSummaryData } from "@/types/financial-dashboard-extras";

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

const SOURCE_FAITHFUL_JOURNEY_GRAPH_IDS = new Set([
    "jornada.funil_conversa",
    "jornada.pontos_abandono",
    "jornada.objecoes",
]);

export default function ExactDashboardGraphRenderer(props: Props) {
    const { widget, sources } = props;

    if (isChannelDashboardWidgetId(widget.id)) {
        return (
            <ExactChannelDashboardGraphRenderer
                widgetId={widget.id}
                period={props.period}
                selectedRange={props.selectedRange}
                unitNames={props.unitNames}
            />
        );
    }

    if (widget.id.startsWith("canais.")) {
        return <PersonalDashboardWidgetRenderer {...baseRendererProps(props)} />;
    }

    if (widget.source === "atendimento" && sources.atendimento) {
        return (
            <ExactAtendimentoDashboardGraphs
                widgetId={widget.id}
                data={sources.atendimento as ExecutiveDashboardData}
            />
        );
    }

    if (widget.source === "financeiro" && sources.financeiro) {
        return (
            <ExactFinanceiroDashboardGraphs
                widgetId={widget.id}
                data={sources.financeiro as FinancialDashboardData}
                summary={sources.financeiroSummary as FinancialUnitSummaryData | null}
                unitIds={props.unitIds}
                categories={props.categories}
            />
        );
    }

    if (widget.source === "jornada" && sources.jornada) {
        if (SOURCE_FAITHFUL_JOURNEY_GRAPH_IDS.has(widget.id)) {
            return (
                <SourceFaithfulDashboardWidgetRenderer
                    widget={widget}
                    sources={sources}
                    unitIds={props.unitIds}
                    categories={props.categories}
                />
            );
        }
        return (
            <ExactJornadaDashboardGraphs
                widgetId={widget.id}
                data={sources.jornada as Parameters<typeof ExactJornadaDashboardGraphs>[0]["data"]}
            />
        );
    }

    if (widget.source === "eventos" && sources.eventos) {
        return (
            <ExactEventosDashboardGraphs
                widgetId={widget.id}
                data={sources.eventos as Parameters<typeof ExactEventosDashboardGraphs>[0]["data"]}
            />
        );
    }

    if (widget.source === "mensagem_ativa" && sources.mensagem_ativa) {
        return (
            <ExactMensagemAtivaDashboardGraphs
                widgetId={widget.id}
                data={sources.mensagem_ativa as Parameters<typeof ExactMensagemAtivaDashboardGraphs>[0]["data"]}
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
