"use client";

import { useEffect, useMemo, useState } from "react";

import {
    applyArrayParams,
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import type {
    DashboardWidgetDefinition,
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
    const [settledRequestKey, setSettledRequestKey] = useState<string | null>(null);

    const sources = useMemo(
        () =>
            ([...new Set(
                definitions
                    .map((widget) => widget.source)
                    .filter((source) => source !== "canais"),
            )] as DashboardWidgetSource[]).sort(),
        [definitions],
    );
    const sourceKey = sources.join("|");
    const needsFinancialSummary = definitions.some((widget) =>
        FINANCIAL_SUMMARY_WIDGETS.has(widget.id),
    );
    const requestKey = useMemo(
        () =>
            JSON.stringify({
                sourceKey,
                needsFinancialSummary,
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
            }),
        [
            attendantIds,
            categories,
            eventSourceValues,
            eventValues,
            needsFinancialSummary,
            originValues,
            period,
            platformValues,
            selectedRange,
            sourceKey,
            statusValues,
            tunnelValues,
            unitIds,
        ],
    );
    const requestPending =
        ready && sources.length > 0 && settledRequestKey !== requestKey;
    const effectiveLoadingSources = useMemo(() => {
        const next = new Set(loadingSources);
        if (requestPending) {
            for (const source of sources) next.add(source);
        }
        return next;
    }, [loadingSources, requestPending, sourceKey]);
    const loading = requestPending || loadingSources.size > 0;

    useEffect(() => {
        if (!ready || sources.length === 0) {
            if (sources.length === 0) {
                setLoadingSources(new Set());
                setErrors({});
            }
            return;
        }

        const controller = new AbortController();
        const dateParams = new URLSearchParams();
        applyCalendarDateParams({
            params: dateParams,
            selectedRange,
            selectedPreset: period,
        });

        setLoadingSources(new Set(sources));

        async function loadAll() {
            const nextData: SourceData = { ...EMPTY_DATA };
            const nextErrors: Record<string, string> = {};

            for (const source of sources) {
                if (controller.signal.aborted) return;
                try {
                    await loadSource(source, controller.signal, nextData);
                } catch (error) {
                    if (controller.signal.aborted) return;
                    const message =
                        error instanceof Error
                            ? error.message
                            : "Falha ao carregar widget.";
                    console.error(`[personal-dashboard] ${source} failed`, error);
                    nextErrors[source] = message;
                }
            }

            if (controller.signal.aborted) return;
            setData(nextData);
            setErrors(nextErrors);
            setLoadingSources(new Set());
            setSettledRequestKey(requestKey);
        }

        async function loadSource(
            source: DashboardWidgetSource,
            signal: AbortSignal,
            nextData: SourceData,
        ) {
            if (source === "atendimento") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, {
                    unit_ids: unitIds,
                    attendant_ids: attendantIds,
                    tunnels: tunnelValues,
                    origins: originValues,
                });
                nextData.atendimento = await fetchJson<ExecutiveDashboardData>(
                    `/api/dashboard/executivo?${params.toString()}`,
                    signal,
                );
                return;
            }

            if (source === "financeiro") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, { unit_ids: unitIds, categories });
                nextData.financeiro = await fetchJson<FinancialDashboardData>(
                    `/api/dashboard/financeiro?${params.toString()}`,
                    signal,
                );

                if (needsFinancialSummary) {
                    nextData.financeiroSummary =
                        await fetchJson<FinancialUnitSummaryData>(
                            `/api/dashboard/financeiro/unit-summary?${params.toString()}`,
                            signal,
                        );
                }
                return;
            }

            if (source === "jornada") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, {
                    unit_ids: unitIds,
                    attendant_ids: attendantIds,
                    tunnels: tunnelValues,
                    origins: originValues,
                });
                nextData.jornada = await fetchJson<unknown>(
                    `/api/dashboard/jornada?${params.toString()}`,
                    signal,
                );
                return;
            }

            if (source === "eventos") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, {
                    tunnels: tunnelValues,
                    origins: originValues,
                });
                if (platformValues.length > 0) {
                    params.set("platforms", platformValues.join(","));
                }
                if (eventValues.length > 0) {
                    params.set("event_types", eventValues.join(","));
                }
                if (statusValues.length > 0) {
                    params.set("statuses", statusValues.join(","));
                }
                if (eventSourceValues.length > 0) {
                    params.set("sources", eventSourceValues.join(","));
                }
                params.set("page", "1");
                params.set("page_size", "20");
                nextData.eventos = await fetchJson<unknown>(
                    `/api/dashboard/eventos?${params.toString()}`,
                    signal,
                );
                return;
            }

            if (source === "clientes") {
                nextData.clientes = await fetchJson<unknown>("/api/clientes", signal);
                return;
            }

            if (source === "funil") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, { unit_ids: unitIds });
                nextData.funil = await fetchJson<unknown>(
                    `/api/funnel?${params.toString()}`,
                    signal,
                );
                return;
            }

            if (source === "mensagem_ativa") {
                nextData.mensagem_ativa = await fetchJson<unknown>(
                    `/api/mensagem-ativa/analytics?${dateParams.toString()}`,
                    signal,
                );
            }
        }

        void loadAll();
        return () => controller.abort();
    }, [
        attendantIds,
        categories,
        eventSourceValues,
        eventValues,
        needsFinancialSummary,
        originValues,
        period,
        platformValues,
        ready,
        requestKey,
        selectedRange,
        sourceKey,
        statusValues,
        tunnelValues,
        unitIds,
    ]);

    return {
        data,
        loadingSources: effectiveLoadingSources,
        errors,
        loading,
    };
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
