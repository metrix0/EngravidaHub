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
}: Props) {
    const [data, setData] = useState<SourceData>(EMPTY_DATA);
    const [loadingSources, setLoadingSources] = useState<Set<string>>(
        () => new Set(),
    );
    const [errors, setErrors] = useState<Record<string, string>>({});

    const sources = useMemo(
        () =>
            [...new Set(
                definitions
                    .map((widget) => widget.source)
                    .filter((source) => source !== "canais"),
            )] as DashboardWidgetSource[],
        [definitions],
    );
    const sourceKey = sources.join("|");
    const needsFinancialSummary = definitions.some((widget) =>
        FINANCIAL_SUMMARY_WIDGETS.has(widget.id),
    );

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
        setErrors({});

        async function loadAll() {
            for (const source of sources) {
                if (controller.signal.aborted) return;
                try {
                    await loadSource(source, controller.signal);
                } catch (error) {
                    if (controller.signal.aborted) return;
                    const message =
                        error instanceof Error
                            ? error.message
                            : "Falha ao carregar widget.";
                    console.error(`[personal-dashboard] ${source} failed`, error);
                    setErrors((current) => ({
                        ...current,
                        [source]: message,
                    }));
                } finally {
                    if (!controller.signal.aborted) {
                        setLoadingSources((current) => {
                            const next = new Set(current);
                            next.delete(source);
                            return next;
                        });
                    }
                }
            }
        }

        async function loadSource(
            source: DashboardWidgetSource,
            signal: AbortSignal,
        ) {
            if (source === "atendimento") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, {
                    unit_ids: unitIds,
                    attendant_ids: attendantIds,
                    tunnels: tunnelValues,
                    origins: originValues,
                });
                const json = await fetchJson<ExecutiveDashboardData>(
                    `/api/dashboard/executivo?${params.toString()}`,
                    signal,
                );
                setData((current) => ({ ...current, atendimento: json }));
                return;
            }

            if (source === "financeiro") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, { unit_ids: unitIds, categories });
                const json = await fetchJson<FinancialDashboardData>(
                    `/api/dashboard/financeiro?${params.toString()}`,
                    signal,
                );
                setData((current) => ({ ...current, financeiro: json }));

                if (needsFinancialSummary) {
                    const summary = await fetchJson<FinancialUnitSummaryData>(
                        `/api/dashboard/financeiro/unit-summary?${params.toString()}`,
                        signal,
                    );
                    setData((current) => ({
                        ...current,
                        financeiroSummary: summary,
                    }));
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
                const json = await fetchJson<unknown>(
                    `/api/dashboard/jornada?${params.toString()}`,
                    signal,
                );
                setData((current) => ({ ...current, jornada: json }));
                return;
            }

            if (source === "eventos") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, {
                    tunnels: tunnelValues,
                    origins: originValues,
                });
                params.set("page", "1");
                params.set("page_size", "20");
                const json = await fetchJson<unknown>(
                    `/api/dashboard/eventos?${params.toString()}`,
                    signal,
                );
                setData((current) => ({ ...current, eventos: json }));
                return;
            }

            if (source === "clientes") {
                const json = await fetchJson<unknown>("/api/clientes", signal);
                setData((current) => ({ ...current, clientes: json }));
                return;
            }

            if (source === "funil") {
                const params = new URLSearchParams(dateParams);
                applyArrayParams(params, { unit_ids: unitIds });
                const json = await fetchJson<unknown>(
                    `/api/funnel?${params.toString()}`,
                    signal,
                );
                setData((current) => ({ ...current, funil: json }));
                return;
            }

            if (source === "mensagem_ativa") {
                const json = await fetchJson<unknown>(
                    `/api/mensagem-ativa/analytics?${dateParams.toString()}`,
                    signal,
                );
                setData((current) => ({
                    ...current,
                    mensagem_ativa: json,
                }));
            }
        }

        void loadAll();
        return () => controller.abort();
    }, [
        attendantIds,
        categories,
        needsFinancialSummary,
        originValues,
        period,
        ready,
        selectedRange,
        sourceKey,
        tunnelValues,
        unitIds,
    ]);

    return { data, loadingSources, errors };
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