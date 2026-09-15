import type { AppTabId } from "@/lib/auth/userAccess";
import { CHANNEL_DASHBOARD_WIDGETS } from "@/lib/personal-dashboard/channelWidgets";
import {
    DASHBOARD_PRESETS,
    DASHBOARD_WIDGETS,
    type DashboardWidgetDefinition,
    type DashboardWidgetKind,
} from "@/lib/personal-dashboard/registry";

export const ALL_DASHBOARD_WIDGETS: DashboardWidgetDefinition[] = [
    ...DASHBOARD_WIDGETS,
    ...CHANNEL_DASHBOARD_WIDGETS,
];

const widgetById = new Map(
    ALL_DASHBOARD_WIDGETS.map((widget) => [widget.id, widget]),
);

const legacyPresetReplacement: Record<string, string> = {
    "canais.instagram_conversas": "instagram.evolucao_diaria",
    "canais.messenger_conversas": "messenger.evolucao_diaria",
    "canais.ligacoes": "ligacoes.evolucao",
    "canais.site": "web.site_principal",
};

export function getDashboardWidget(id: string): DashboardWidgetDefinition | null {
    return widgetById.get(id) ?? null;
}

export function isChannelDashboardWidgetId(id: string) {
    return CHANNEL_DASHBOARD_WIDGETS.some((widget) => widget.id === id);
}

export function filterDashboardWidgetIds(
    ids: readonly string[],
    allowedTabs: readonly AppTabId[],
) {
    const allowed = new Set(allowedTabs);
    return [...new Set(ids)].filter((id) => {
        const widget = getDashboardWidget(id);
        return Boolean(widget && allowed.has(widget.permissionTab));
    });
}

export function getDashboardPreset(
    preset: string,
    allowedTabs: readonly AppTabId[],
) {
    const ids = (DASHBOARD_PRESETS[preset] ?? []).map(
        (id) => legacyPresetReplacement[id] ?? id,
    );
    return filterDashboardWidgetIds(ids, allowedTabs);
}

export function findDashboardWidgetBySource(
    sourcePath: string,
    title: string,
    kind?: DashboardWidgetKind,
) {
    const normalized = normalizeTitle(title);
    return (
        ALL_DASHBOARD_WIDGETS.find(
            (widget) =>
                widget.sourcePath === sourcePath &&
                (!kind || widget.kind === kind) &&
                normalizeTitle(widget.title) === normalized,
        ) ?? null
    );
}

function normalizeTitle(value: string) {
    return value.trim().toLocaleLowerCase("pt-BR");
}
