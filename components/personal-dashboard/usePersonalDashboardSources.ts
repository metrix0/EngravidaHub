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
        const commonParams = new URLSearchParams();
        applyCalendarDateParams({
            params: commonParams,
            selectedRange,
            selectedPreset: period,
        });
        applyArrayParams(commonParams, { unit_ids: unitIds });

        setLoadingSources(new Set(sources));
        setErrors({});

        async function loadAll() {
            for (const source of sources) {
                if (controller.signal.aborted) return;
                try {
                    await loadSource(source, commonParams, controller.signal);
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
            params: URLSearchParams,
            signal: AbortSignal,
        ) {
            if (source === "atendimento") {
                const json = await fetchJson<ExecutiveDashboardData>(
                    `/api/dashboard/executivo?${params.toString()}`,
                    signal,
                );
                setData((current) => ({ ...current, atendimento: json }));
                return;
            }

            if (source === "financeiro") {
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
                const json = await fetchJson<unknown>(
                    `/api/dashboard/jornada?${params.toString()}`,
                    signal,
                );
                setData((current) => ({ ...current, jornada: json }));
                return;
            }

            if (source === "eventos") {
                const eventParams = new URLSearchParams(params);
                eventParams.set("page", "1");
                eventParams.set("page_size", "20");
                const json = await fetchJson<unknown>(
                    `/api/dashboard/eventos?${eventParams.toString()}`,
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
                const json = await fetchJson<unknown>(
                    `/api/funnel?${params.toString()}`,
                    signal,
                );
                setData((current) => ({ ...current, funil: json }));
                return;
            }

            if (source === "mensagem_ativa") {
                const analyticsParams = new URLSearchParams();
                applyCalendarDateParams({
                    params: analyticsParams,
                    selectedRange,
                    selectedPreset: period,
                });
                const json = await fetchJson<unknown>(
                    `/api/mensagem-ativa/analytics?${analyticsParams.toString()}`,
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
        needsFinancialSummary,
        period,
        ready,
        selectedRange,
        sourceKey,
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
