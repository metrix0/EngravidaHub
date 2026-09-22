"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
    applyArrayParams,
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import type {
    DashboardWidgetDefinition,
    DashboardWidgetFilterKey,
    DashboardWidgetSource,
} from "@/lib/personal-dashboard/registry";
import type {
    ExecutiveDashboardData,
    FinancialDashboardData,
} from "@/types";
import type { FinancialUnitSummaryData } from "@/types/financial-dashboard-extras";

export type SourceData = {
    atendimento: ExecutiveDashboardData | null;
    financeiro: FinancialDashboardData | null;
    financeiroSummary: FinancialUnitSummaryData | null;
    jornada: unknown;
    eventos: unknown;
    clientes: unknown;
    funil: unknown;
    mensagem_ativa: unknown;
};

type Props = {
    definitions: DashboardWidgetDefinition[];
    ready: boolean;
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
    unitIds: string[];
    attendantIds: string[];
    tunnelValues: string[];
    originValues: string[];
    categories: string[];
    eventValues: string[];
    platformValues: string[];
    statusValues: string[];
    eventSourceValues: string[];
};

type SourceRequest = {
    source: Exclude<DashboardWidgetSource, "canais">;
    key: string;
    url: string;
    summaryUrl?: string;
};

const EMPTY_DATA: SourceData = {
    atendimento: null,
    financeiro: null,
    financeiroSummary: null,
    jornada: null,
    eventos: null,
    clientes: null,
    funil: null,
    mensagem_ativa: null,
};

const FINANCIAL_SUMMARY_WIDGETS = new Set([
    "financeiro.faturamento_autorizado",
    "financeiro.faturamento_unidade",
    "financeiro.procedimentos_cidade",
]);

export function usePersonalDashboardSources({
    definitions,
    ready,
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
}: Props) {
    const [data, setData] = useState<SourceData>(EMPTY_DATA);
    const [loadingSources, setLoadingSources] = useState<Set<string>>(
        () => new Set(),
    );
    const [errors, setErrors] = useState<Record<string, string>>({});
    const settledKeysRef = useRef<Record<string, string>>({});

    const definitionsBySource = useMemo(() => {
        const grouped = new Map<
            Exclude<DashboardWidgetSource, "canais">,
            DashboardWidgetDefinition[]
        >();

        for (const widget of definitions) {
            if (widget.source === "canais") continue;
            const source = widget.source as Exclude<
                DashboardWidgetSource,
                "canais"
            >;
            const current = grouped.get(source) ?? [];
            current.push(widget);
            grouped.set(source, current);
        }

        return grouped;
    }, [definitions]);

    const requests = useMemo(() => {
        const dateParams = new URLSearchParams();
        applyCalendarDateParams({
            params: dateParams,
            selectedRange,
            selectedPreset: period,
        });

        const next: SourceRequest[] = [];
        for (const [source, sourceDefinitions] of definitionsBySource) {
            const filters = new Set<DashboardWidgetFilterKey>(
                sourceDefinitions.flatMap(
                    (widget) => widget.supportedFilters,
                ),
            );
            const supports = (key: DashboardWidgetFilterKey) =>
                filters.has(key);

            if (source === "atendimento") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, {
                    unit_ids: supports("units") ? unitIds : [],
                    attendant_ids: supports("attendants")
                        ? attendantIds
                        : [],
                    tunnels: supports("tunnels") ? tunnelValues : [],
                    origins: supports("origins") ? originValues : [],
                });
                next.push(
                    sourceRequest(
                        source,
                        `/api/dashboard/executivo?${params.toString()}`,
                    ),
                );
                continue;
            }

            if (source === "financeiro") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, {
                    unit_ids: supports("units") ? unitIds : [],
                    categories: supports("categories") ? categories : [],
                });
                const url = `/api/dashboard/financeiro?${params.toString()}`;
                const needsSummary = sourceDefinitions.some((widget) =>
                    FINANCIAL_SUMMARY_WIDGETS.has(widget.id),
                );
                const summaryUrl = needsSummary
                    ? `/api/dashboard/financeiro/unit-summary?${params.toString()}`
                    : undefined;
                next.push(sourceRequest(source, url, summaryUrl));
                continue;
            }

            if (source === "jornada") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, {
                    unit_ids: supports("units") ? unitIds : [],
                    attendant_ids: supports("attendants")
                        ? attendantIds
                        : [],
                    tunnels: supports("tunnels") ? tunnelValues : [],
                    origins: supports("origins") ? originValues : [],
                });
                next.push(
                    sourceRequest(
                        source,
                        `/api/dashboard/jornada?${params.toString()}`,
                    ),
                );
                continue;
            }

            if (source === "eventos") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, {
                    tunnels: supports("tunnels") ? tunnelValues : [],
                    origins: supports("origins") ? originValues : [],
                });
                if (supports("platforms") && platformValues.length > 0) {
                    params.set("platforms", platformValues.join(","));
                }
                if (supports("event_types") && eventValues.length > 0) {
                    params.set("event_types", eventValues.join(","));
                }
                if (supports("statuses") && statusValues.length > 0) {
                    params.set("statuses", statusValues.join(","));
                }
                if (
                    supports("event_sources") &&
                    eventSourceValues.length > 0
                ) {
                    params.set("sources", eventSourceValues.join(","));
                }
                params.set("page", "1");
                params.set("page_size", "20");
                next.push(
                    sourceRequest(
                        source,
                        `/api/dashboard/eventos?${params.toString()}`,
                    ),
                );
                continue;
            }

            if (source === "clientes") {
                next.push(sourceRequest(source, "/api/clientes"));
                continue;
            }

            if (source === "funil") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, {
                    unit_ids: supports("units") ? unitIds : [],
                });
                next.push(
                    sourceRequest(
                        source,
                        `/api/funnel?${params.toString()}`,
                    ),
                );
                continue;
            }

            if (source === "mensagem_ativa") {
                next.push(
                    sourceRequest(
                        source,
                        `/api/mensagem-ativa/analytics?${dateParams.toString()}`,
                    ),
                );
            }
        }

        return next.sort((left, right) =>
            left.source.localeCompare(right.source),
        );
    }, [
        attendantIds,
        categories,
        definitionsBySource,
        eventSourceValues,
        eventValues,
        originValues,
        period,
        platformValues,
        selectedRange,
        statusValues,
        tunnelValues,
        unitIds,
    ]);

    useEffect(() => {
        if (!ready) {
            setLoadingSources(new Set());
            return;
        }

        const pending = requests.filter(
            (request) =>
                settledKeysRef.current[request.source] !== request.key,
        );
        if (pending.length === 0) return;

        const controller = new AbortController();
        setLoadingSources(new Set(pending.map((request) => request.source)));

        async function loadPending() {
            for (const request of pending) {
                if (controller.signal.aborted) return;

                try {
                    const update = await loadSource(
                        request,
                        controller.signal,
                    );
                    if (controller.signal.aborted) return;

                    settledKeysRef.current[request.source] = request.key;
                    setData((current) => ({ ...current, ...update }));
                    setErrors((current) => {
                        if (!current[request.source]) return current;
                        const next = { ...current };
                        delete next[request.source];
                        return next;
                    });
                } catch (error) {
                    if (controller.signal.aborted) return;
                    settledKeysRef.current[request.source] = request.key;
                    const message =
                        error instanceof Error
                            ? error.message
                            : "Falha ao carregar widget.";
                    console.error(
                        `[personal-dashboard] ${request.source} failed`,
                        error,
                    );
                    setErrors((current) => ({
                        ...current,
                        [request.source]: message,
                    }));
                } finally {
                    if (!controller.signal.aborted) {
                        setLoadingSources((current) => {
                            if (!current.has(request.source)) return current;
                            const next = new Set(current);
                            next.delete(request.source);
                            return next;
                        });
                    }
                }
            }
        }

        void loadPending();
        return () => controller.abort();
    }, [ready, requests]);

    return {
        data,
        loadingSources,
        errors,
        loading: loadingSources.size > 0,
    };
}

function sourceRequest(
    source: SourceRequest["source"],
    url: string,
    summaryUrl?: string,
): SourceRequest {
    return {
        source,
        url,
        summaryUrl,
        key: summaryUrl ? `${url}|${summaryUrl}` : url,
    };
}

async function loadSource(
    request: SourceRequest,
    signal: AbortSignal,
): Promise<Partial<SourceData>> {
    if (request.source === "atendimento") {
        return {
            atendimento: await fetchJson<ExecutiveDashboardData>(
                request.url,
                signal,
            ),
        };
    }

    if (request.source === "financeiro") {
        const financeiro = await fetchJson<FinancialDashboardData>(
            request.url,
            signal,
        );
        const financeiroSummary = request.summaryUrl
            ? await fetchJson<FinancialUnitSummaryData>(
                  request.summaryUrl,
                  signal,
              )
            : null;
        return { financeiro, financeiroSummary };
    }

    const value = await fetchJson<unknown>(request.url, signal);
    if (request.source === "jornada") return { jornada: value };
    if (request.source === "eventos") return { eventos: value };
    if (request.source === "clientes") return { clientes: value };
    if (request.source === "funil") return { funil: value };
    return { mensagem_ativa: value };
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, {
        cache: "no-store",
        credentials: "include",
        signal,
    });
    const json = (await response.json()) as T & { error?: string };
    if (!response.ok) {
        throw new Error(json.error ?? "Falha ao carregar widget.");
    }
    return json;
}
