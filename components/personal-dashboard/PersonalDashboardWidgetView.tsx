"use client";

import ChannelDashboardWidgetRenderer from "@/components/personal-dashboard/ChannelDashboardWidgetRenderer";
import PersonalDashboardWidgetRenderer from "@/components/personal-dashboard/PersonalDashboardWidgetRenderer";
import { isChannelDashboardWidgetId } from "@/lib/personal-dashboard/registryExtended";
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
};

export default function PersonalDashboardWidgetView(props: Props) {
    if (isChannelDashboardWidgetId(props.widget.id)) {
        return (
            <ChannelDashboardWidgetRenderer
                widgetId={props.widget.id}
                period={props.period}
                selectedRange={props.selectedRange}
            />
        );
    }

    return <PersonalDashboardWidgetRenderer {...props} />;
}
