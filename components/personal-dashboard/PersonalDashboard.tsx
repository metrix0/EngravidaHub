"use client";

import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Layers3,
    Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
    DashboardFilterBar,
    DashboardFilterBarSkeleton,
    DashboardHeader,
    FilterButton,
    HorizontalScroller,
    MainFilters,
    Skeleton,
} from "@/components";
import AdvancedFilterButton, {
    type AdvancedFilterSection,
} from "@/components/ui/AdvancedFilterButton";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import PersonalDashboardWidgetRenderer from "@/components/personal-dashboard/PersonalDashboardWidgetView";
import { usePersonalDashboard } from "@/components/personal-dashboard/PersonalDashboardProvider";
import { usePersonalDashboardSources } from "@/components/personal-dashboard/usePersonalDashboardSources";
import { getDashboardWidget } from "@/lib/personal-dashboard/registryExtended";
import type {
    DashboardWidgetDefinition,
    DashboardWidgetFilterKey,
} from "@/lib/personal-dashboard/registry";
import type { FiltersResponse } from "@/types";
import {
    AD_EVENT_STATUS_LABELS,
    AD_EVENT_STATUSES,
    AD_EVENT_TYPE_LABELS,
    AD_EVENT_TYPES,
    AD_PLATFORM_LABELS,
    AD_PLATFORMS,
} from "@/types/ad-event";

export default function PersonalDashboard() {
    const {
        widget_ids,
        status,
        saving,
        ensureLoaded,
        removeWidget,
        reorderWidgets,
    } = usePersonalDashboard();
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [attendantIds, setAttendantIds] = useState<string[]>([]);
    const [tunnelValues, setTunnelValues] = useState<string[]>([]);
    const [originValues, setOriginValues] = useState<string[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [eventValues, setEventValues] = useState<string[]>([]);
    const [platformValues, setPlatformValues] = useState<string[]>([]);
    const [statusValues, setStatusValues] = useState<string[]>([]);
    const [eventSourceValues, setEventSourceValues] = useState<string[]>([]);
    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("current_month");

    useEffect(() => {
        void ensureLoaded().catch(() => undefined);
    }, [ensureLoaded]);

    const definitions = useMemo(
        () =>
            widget_ids
                .map(getDashboardWidget)
                .filter(
                    (widget): widget is DashboardWidgetDefinition =>
                        widget !== null,
                ),
        [widget_ids],
    );
    const kpis = definitions.filter((widget) => widget.kind === "kpi");
    const content = definitions.filter((widget) => widget.kind !== "kpi");
    const supportedFilters = useMemo(
        () =>
            new Set<DashboardWidgetFilterKey>(
                definitions.flatMap((widget) => widget.supportedFilters),
            ),
        [definitions],
    );
    const filterEntitiesKey = useMemo(
        () =>
            (["units", "attendants", "tunnels", "origins"] as const)
                .filter((key) => supportedFilters.has(key))
                .join(","),
        [supportedFilters],
    );

    useEffect(() => {
        if (!dateFilterReady || !filterEntitiesKey) {
            setFilters(null);
            return;
        }

        const controller = new AbortController();
        void fetch(
            `/api/dashboard/filters?entities=${filterEntitiesKey}`,
            {
                cache: "no-store",
                credentials: "include",
                signal: controller.signal,
            },
        )
            .then(async (response) => {
                if (!response.ok) return;
                setFilters((await response.json()) as FiltersResponse);
            })
            .catch((error) => {
                if (!controller.signal.aborted) {
                    console.error("[personal-dashboard] filters failed", error);
                }
            });

        return () => controller.abort();
    }, [dateFilterReady, filterEntitiesKey]);

    useEffect(() => {
        if (!supportedFilters.has("units")) {
            setUnitIds((current) => (current.length > 0 ? [] : current));
        }
        if (!supportedFilters.has("attendants")) {
            setAttendantIds((current) => (current.length > 0 ? [] : current));
        }
        if (!supportedFilters.has("tunnels")) {
            setTunnelValues((current) => (current.length > 0 ? [] : current));
        }
        if (!supportedFilters.has("origins")) {
            setOriginValues((current) => (current.length > 0 ? [] : current));
        }
        if (!supportedFilters.has("categories")) {
            setCategories((current) => (current.length > 0 ? [] : current));
        }
        if (!supportedFilters.has("event_types")) {
            setEventValues((current) => (current.length > 0 ? [] : current));
        }
        if (!supportedFilters.has("platforms")) {
            setPlatformValues((current) => (current.length > 0 ? [] : current));
        }
        if (!supportedFilters.has("statuses")) {
            setStatusValues((current) => (current.length > 0 ? [] : current));
        }
        if (!supportedFilters.has("event_sources")) {
            setEventSourceValues((current) =>
                current.length > 0 ? [] : current,
            );
        }
    }, [supportedFilters]);

    const {
        data,
        loadingSources,
        errors,
    } = usePersonalDashboardSources({
        definitions,
        ready: status === "ready" && dateFilterReady,
        period,
        selectedRange,
        unitIds,
        attendantIds,
        tunnelValues,
        originValues,
        categories,
        eventValues,
        platformValues,
        statusValues,
        eventSourceValues,
    });

    const unitNames = useMemo(
        () =>
            unitIds.map(
                (unitId) =>
                    filters?.units?.find((option) => option.value === unitId)
                        ?.label ?? unitId,
            ),
        [filters?.units, unitIds],
    );

    const advancedFilterSections = useMemo(() => {
        const sections: AdvancedFilterSection[] = [];

        if (supportedFilters.has("tunnels")) {
            sections.push({
                id: "tunnels",
                title: "Túnel",
                values: tunnelValues,
                onChange: setTunnelValues,
                options: filters?.tunnels ?? [],
            });
        }
        if (supportedFilters.has("origins")) {
            sections.push({
                id: "origins",
                title: "Origem",
                values: originValues,
                onChange: setOriginValues,
                options: filters?.origins ?? [],
            });
        }
        if (supportedFilters.has("event_types")) {
            sections.push({
                id: "event",
                title: "Evento",
                values: eventValues,
                onChange: setEventValues,
                options: AD_EVENT_TYPES.map((eventType) => ({
                    label: AD_EVENT_TYPE_LABELS[eventType],
                    value: eventType,
                })),
            });
        }
        if (supportedFilters.has("platforms")) {
            sections.push({
                id: "platform",
                title: "Plataforma",
                values: platformValues,
                onChange: setPlatformValues,
                options: AD_PLATFORMS.map((platform) => ({
                    label: AD_PLATFORM_LABELS[platform],
                    value: platform,
                })),
            });
        }
        if (supportedFilters.has("statuses")) {
            sections.push({
                id: "status",
                title: "Status",
                values: statusValues,
                onChange: setStatusValues,
                options: AD_EVENT_STATUSES.map((eventStatus) => ({
                    label: AD_EVENT_STATUS_LABELS[eventStatus],
                    value: eventStatus,
                })),
            });
        }
        if (supportedFilters.has("event_sources")) {
            sections.push({
                id: "source",
                title: "Origem do evento",
                values: eventSourceValues,
                onChange: setEventSourceValues,
                options: [
                    { label: "Clinisys", value: "clinisys" },
                    { label: "IA", value: "ai" },
                ],
            });
        }

        return sections;
    }, [
        eventSourceValues,
        eventValues,
        filters?.origins,
        filters?.tunnels,
        originValues,
        platformValues,
        statusValues,
        supportedFilters,
        tunnelValues,
    ]);

    async function reorderSection(
        section: DashboardWidgetDefinition[],
        widgetId: string,
        targetWidgetId: string,
    ) {
        if (widgetId === targetWidgetId) return;
        const ids = section.map((widget) => widget.id);
        const next = ids.filter((id) => id !== widgetId);
        const targetIndex = next.indexOf(targetWidgetId);
        next.splice(targetIndex < 0 ? next.length : targetIndex, 0, widgetId);

        await reorderWidgets(
            section[0]?.kind === "kpi"
                ? [...next, ...content.map((widget) => widget.id)]
                : [...kpis.map((widget) => widget.id), ...next],
        );
    }

    async function moveInSection(
        section: DashboardWidgetDefinition[],
        widgetId: string,
        offset: -1 | 1,
    ) {
        const ids = section.map((widget) => widget.id);
        const from = ids.indexOf(widgetId);
        const to = from + offset;
        if (from < 0 || to < 0 || to >= ids.length) return;
        const next = [...ids];
        [next[from], next[to]] = [next[to], next[from]];

        await reorderWidgets(
            section[0]?.kind === "kpi"
                ? [...next, ...content.map((widget) => widget.id)]
                : [...kpis.map((widget) => widget.id), ...next],
        );
    }

    return (
        <main className="h-full min-h-0 w-full overflow-y-auto bg-white text-slate-900">
            <section className="min-w-0 px-4 py-5 md:px-8 md:py-8">
                <DashboardHeader
                    title="Dashboard"
                    description="Seus principais indicadores em um só lugar"
                    period={period}
                    setPeriod={setPeriod}
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                    storageManaged
                    storageReady={dateFilterReady}
                />

                {dateFilterReady && status === "ready" ? (
                    supportedFilters.size > 0 ? (
                        <DashboardFilterBar>
                            {supportedFilters.has("units") ||
                            supportedFilters.has("attendants") ? (
                                <MainFilters
                                    units={filters?.units}
                                    attendants={filters?.attendants}
                                    unitValues={unitIds}
                                    setUnitValues={setUnitIds}
                                    attendantValues={attendantIds}
                                    setAttendantValues={setAttendantIds}
                                    show={{
                                        units: supportedFilters.has("units"),
                                        attendants:
                                            supportedFilters.has("attendants"),
                                        tunnels: false,
                                        origins: false,
                                    }}
                                />
                            ) : null}
                            {supportedFilters.has("categories") ? (
                                data.financeiro ? (
                                    <FilterButton
                                        icon={<Layers3 size={16} />}
                                        label="Todas as categorias"
                                        values={categories}
                                        onChange={setCategories}
                                        options={
                                            data.financeiro.available_filters
                                                .categories
                                        }
                                        widthClassName="w-[250px]"
                                    />
                                ) : (
                                    <Skeleton className="h-11 w-[250px] rounded-xl" />
                                )
                            ) : null}
                            {advancedFilterSections.length > 0 ? (
                                <AdvancedFilterButton
                                    sections={advancedFilterSections}
                                />
                            ) : null}
                        </DashboardFilterBar>
                    ) : null
                ) : definitions.length > 0 ? (
                    <DashboardFilterBarSkeleton widths={["w-[230px]"]} />
                ) : null}

                {status === "error" ? (
                    <DashboardError onRetry={() => void ensureLoaded()} />
                ) : status === "loading" ||
                  status === "idle" ||
                  !dateFilterReady ? (
                    <DashboardLoading />
                ) : definitions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-16 text-center">
                        <h2 className="text-lg font-bold text-slate-800">
                            Seu dashboard está vazio
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                            Passe o mouse sobre um indicador, gráfico ou tabela e clique em + para adicioná-lo aqui.
                        </p>
                    </div>
                ) : (
                    <div className="pb-12">
                        {kpis.length > 0 ? (
                            <section className="mb-6 grid grid-cols-1 gap-5">
                                <HorizontalScroller scrollAmount={420}>
                                    {kpis.map((widget, index) => (
                                        <DashboardItem
                                            key={widget.id}
                                            widget={widget}
                                            saving={saving}
                                            canMoveBefore={index > 0}
                                            canMoveAfter={index < kpis.length - 1}
                                            horizontal
                                            onMoveBefore={() =>
                                                void moveInSection(
                                                    kpis,
                                                    widget.id,
                                                    -1,
                                                )
                                            }
                                            onMoveAfter={() =>
                                                void moveInSection(
                                                    kpis,
                                                    widget.id,
                                                    1,
                                                )
                                            }
                                            onRemove={() =>
                                                void removeWidget(widget.id)
                                            }
                                            onDrop={(draggedId) =>
                                                void reorderSection(
                                                    kpis,
                                                    draggedId,
                                                    widget.id,
                                                )
                                            }
                                            className={`${kpiWidthClass(widget)} shrink-0`}
                                        >
                                            <PersonalDashboardWidgetRenderer
                                                widget={widget}
                                                sources={data}
                                                loadingSources={loadingSources}
                                                errors={errors}
                                                period={period}
                                                selectedRange={selectedRange}
                                                unitIds={unitIds}
                                                unitNames={unitNames}
                                                attendantIds={attendantIds}
                                                tunnelValues={tunnelValues}
                                                originValues={originValues}
                                                categories={categories}
                                            />
                                        </DashboardItem>
                                    ))}
                                </HorizontalScroller>
                            </section>
                        ) : null}

                        {content.length > 0 ? (
                            <section className="mb-8">
                                <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-2">
                                    {content.map((widget, index) => (
                                        <DashboardItem
                                            key={widget.id}
                                            widget={widget}
                                            saving={saving}
                                            canMoveBefore={index > 0}
                                            canMoveAfter={
                                                index < content.length - 1
                                            }
                                            onMoveBefore={() =>
                                                void moveInSection(
                                                    content,
                                                    widget.id,
                                                    -1,
                                                )
                                            }
                                            onMoveAfter={() =>
                                                void moveInSection(
                                                    content,
                                                    widget.id,
                                                    1,
                                                )
                                            }
                                            onRemove={() =>
                                                void removeWidget(widget.id)
                                            }
                                            onDrop={(draggedId) =>
                                                void reorderSection(
                                                    content,
                                                    draggedId,
                                                    widget.id,
                                                )
                                            }
                                            stretchHeight={widget.kind === "chart"}
                                            className={
                                                widget.kind === "table"
                                                    ? "xl:col-span-2"
                                                    : ""
                                            }
                                        >
                                            <PersonalDashboardWidgetRenderer
                                                widget={widget}
                                                sources={data}
                                                loadingSources={loadingSources}
                                                errors={errors}
                                                period={period}
                                                selectedRange={selectedRange}
                                                unitIds={unitIds}
                                                unitNames={unitNames}
                                                attendantIds={attendantIds}
                                                tunnelValues={tunnelValues}
                                                originValues={originValues}
                                                categories={categories}
                                            />
                                        </DashboardItem>
                                    ))}
                                </div>
                            </section>
                        ) : null}
                    </div>
                )}
            </section>
        </main>
    );
}

function DashboardItem({
    widget,
    children,
    saving,
    canMoveBefore,
    canMoveAfter,
    horizontal = false,
    stretchHeight = false,
    onMoveBefore,
    onMoveAfter,
    onRemove,
    onDrop,
    className = "",
}: {
    widget: DashboardWidgetDefinition;
    children: ReactNode;
    saving: boolean;
    canMoveBefore: boolean;
    canMoveAfter: boolean;
    horizontal?: boolean;
    stretchHeight?: boolean;
    onMoveBefore: () => void;
    onMoveAfter: () => void;
    onRemove: () => void;
    onDrop: (draggedId: string) => void;
    className?: string;
}) {
    return (
        <div
            className={`group/personal-widget relative min-w-0 ${stretchHeight ? "h-full" : ""} ${className}`}
            draggable={!saving}
            onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", widget.id);
            }}
            onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
                event.preventDefault();
                const draggedId = event.dataTransfer.getData("text/plain");
                if (draggedId) onDrop(draggedId);
            }}
        >
            <div className="absolute bottom-3 right-3 z-40 flex items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/personal-widget:opacity-100 group-focus-within/personal-widget:opacity-100">
                <ControlButton
                    label={horizontal ? "Mover para esquerda" : "Mover para cima"}
                    disabled={!canMoveBefore || saving}
                    onClick={onMoveBefore}
                >
                    {horizontal ? (
                        <ArrowLeft size={14} />
                    ) : (
                        <ArrowUp size={14} />
                    )}
                </ControlButton>
                <ControlButton
                    label={horizontal ? "Mover para direita" : "Mover para baixo"}
                    disabled={!canMoveAfter || saving}
                    onClick={onMoveAfter}
                >
                    {horizontal ? (
                        <ArrowRight size={14} />
                    ) : (
                        <ArrowDown size={14} />
                    )}
                </ControlButton>
                <ControlButton
                    label="Remover do dashboard"
                    disabled={saving}
                    onClick={onRemove}
                    danger
                >
                    <Trash2 size={14} />
                </ControlButton>
            </div>
            {stretchHeight ? (
                <div className="h-full [&>*]:h-full [&_[data-dashboard-card='true']]:h-full">
                    {children}
                </div>
            ) : (
                children
            )}
        </div>
    );
}

function ControlButton({
    label,
    disabled,
    onClick,
    danger = false,
    children,
}: {
    label: string;
    disabled: boolean;
    onClick: () => void;
    danger?: boolean;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition disabled:pointer-events-none disabled:opacity-30 ${
                danger
                    ? "text-slate-400 hover:bg-red-50 hover:text-red"
                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            }`}
        >
            {children}
        </button>
    );
}

function kpiWidthClass(widget: DashboardWidgetDefinition) {
    if (widget.source === "financeiro") return "min-w-[285px]";
    if (widget.id.startsWith("instagram.") || widget.id.startsWith("messenger.")) {
        return "min-w-[270px]";
    }
    if (widget.source === "atendimento") return "min-w-[260px]";
    return "min-w-[270px]";
}

function DashboardLoading() {
    return (
        <div className="space-y-6">
            <div className="flex gap-5 overflow-hidden">
                {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton
                        key={index}
                        className="h-[118px] min-w-[260px] rounded-2xl"
                    />
                ))}
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <Skeleton className="h-[360px] rounded-2xl" />
                <Skeleton className="h-[360px] rounded-2xl" />
            </div>
        </div>
    );
}

function DashboardError({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-6 py-10 text-center">
            <p className="text-sm font-semibold text-red-700">
                Não foi possível carregar seu dashboard.
            </p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-4 cursor-pointer rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
            >
                Tentar novamente
            </button>
        </div>
    );
}
