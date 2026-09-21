"use client";

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
