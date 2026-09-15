"use client";

import {
    ArrowDown,
    ArrowUp,
    GripVertical,
    Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
    DashboardFilterBar,
    DashboardFilterBarSkeleton,
    DashboardHeader,
    MainFilters,
    Skeleton,
} from "@/components";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import PersonalDashboardWidgetRenderer from "@/components/personal-dashboard/PersonalDashboardWidgetView";
import { usePersonalDashboard } from "@/components/personal-dashboard/PersonalDashboardProvider";
import { usePersonalDashboardSources } from "@/components/personal-dashboard/usePersonalDashboardSources";
import { getDashboardWidget } from "@/lib/personal-dashboard/registryExtended";
import type { DashboardWidgetDefinition } from "@/lib/personal-dashboard/registry";
import type { FiltersResponse } from "@/types";

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

    useEffect(() => {
        if (!dateFilterReady) return;
        const controller = new AbortController();

        void fetch("/api/dashboard/filters?entities=units", {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
        })
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
    }, [dateFilterReady]);

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

    const { data, loadingSources, errors } = usePersonalDashboardSources({
        definitions,
        ready: status === "ready" && dateFilterReady,
        period,
        selectedRange,
        unitIds,
    });

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

                {dateFilterReady ? (
                    <DashboardFilterBar>
                        <MainFilters
                            units={filters?.units}
                            unitValues={unitIds}
                            setUnitValues={setUnitIds}
                            show={{
                                units: true,
                                attendants: false,
                                tunnels: false,
                                origins: false,
                            }}
                        />
                    </DashboardFilterBar>
                ) : (
                    <DashboardFilterBarSkeleton widths={["w-[230px]"]} />
                )}

                {status === "loading" || status === "idle" ? (
                    <DashboardLoading />
                ) : status === "error" ? (
                    <DashboardError onRetry={() => void ensureLoaded()} />
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
                            <DashboardSection title="KPIs">
                                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
                                    {kpis.map((widget, index) => (
                                        <DashboardItem
                                            key={widget.id}
                                            widget={widget}
                                            saving={saving}
                                            canMoveUp={index > 0}
                                            canMoveDown={index < kpis.length - 1}
                                            onMoveUp={() =>
                                                void moveInSection(
                                                    kpis,
                                                    widget.id,
                                                    -1,
                                                )
                                            }
                                            onMoveDown={() =>
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
                                        >
                                            <PersonalDashboardWidgetRenderer
                                                widget={widget}
                                                sources={data}
                                                loadingSources={loadingSources}
                                                errors={errors}
                                                period={period}
                                                selectedRange={selectedRange}
                                                unitIds={unitIds}
                                            />
                                        </DashboardItem>
                                    ))}
                                </div>
                            </DashboardSection>
                        ) : null}

                        {content.length > 0 ? (
                            <DashboardSection title="Gráficos e tabelas">
                                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                                    {content.map((widget, index) => (
                                        <DashboardItem
                                            key={widget.id}
                                            widget={widget}
                                            saving={saving}
                                            canMoveUp={index > 0}
                                            canMoveDown={
                                                index < content.length - 1
                                            }
                                            onMoveUp={() =>
                                                void moveInSection(
                                                    content,
                                                    widget.id,
                                                    -1,
                                                )
                                            }
                                            onMoveDown={() =>
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
                                            />
                                        </DashboardItem>
                                    ))}
                                </div>
                            </DashboardSection>
                        ) : null}
                    </div>
                )}
            </section>
        </main>
    );
}

function DashboardSection({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <section className="mb-8">
            <h2 className="mb-4 text-xl font-bold text-slate-900">{title}</h2>
            {children}
        </section>
    );
}

function DashboardItem({
    widget,
    children,
    saving,
    canMoveUp,
    canMoveDown,
    onMoveUp,
    onMoveDown,
    onRemove,
    onDrop,
    className = "",
}: {
    widget: DashboardWidgetDefinition;
    children: ReactNode;
    saving: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
    onDrop: (draggedId: string) => void;
    className?: string;
}) {
    return (
        <div
            className={`group/personal-widget relative min-w-0 ${className}`}
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
            <div className="absolute right-3 top-3 z-40 flex items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/personal-widget:opacity-100 group-focus-within/personal-widget:opacity-100">
                <span
                    className="flex h-7 w-7 items-center justify-center text-slate-400"
                    title="Arrastar para reorganizar"
                >
                    <GripVertical size={15} />
                </span>
                <ControlButton
                    label="Mover para cima"
                    disabled={!canMoveUp || saving}
                    onClick={onMoveUp}
                >
                    <ArrowUp size={14} />
                </ControlButton>
                <ControlButton
                    label="Mover para baixo"
                    disabled={!canMoveDown || saving}
                    onClick={onMoveDown}
                >
                    <ArrowDown size={14} />
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
            {children}
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
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition disabled:pointer-events-none disabled:opacity-30 ${
                danger
                    ? "text-slate-400 hover:bg-red-50 hover:text-red"
                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            }`}
        >
            {children}
        </button>
    );
}

function DashboardLoading() {
    return (
        <div className="space-y-8">
            <section>
                <Skeleton className="mb-4 h-7 w-20" />
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                        <Skeleton
                            key={index}
                            className="h-[118px] rounded-2xl"
                        />
                    ))}
                </div>
            </section>
            <section>
                <Skeleton className="mb-4 h-7 w-44" />
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                    <Skeleton className="h-[360px] rounded-2xl" />
                    <Skeleton className="h-[360px] rounded-2xl" />
                </div>
            </section>
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
                className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
            >
                Tentar novamente
            </button>
        </div>
    );
}
