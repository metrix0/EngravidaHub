"use client";

import { useEffect, useState } from "react";

import {
    DashboardFilterBar,
    DashboardFilterBarSkeleton,
    DashboardHeader,
    MainFilters,
} from "@/components";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import GerencialOverview from "@/components/gerencial/GerencialOverview";
import DashboardWidget from "@/components/personal-dashboard/DashboardWidget";
import type { FiltersResponse } from "@/types";

export default function GerencialPage() {
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [filtersLoading, setFiltersLoading] = useState(true);
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("current_month");

    useEffect(() => {
        if (!dateFilterReady) return;

        const controller = new AbortController();
        setFiltersLoading(true);

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
                    console.error("[gerencial] filters failed", error);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setFiltersLoading(false);
                }
            });

        return () => controller.abort();
    }, [dateFilterReady]);

    return (
        <main className="h-full min-h-0 w-full overflow-y-auto bg-white text-slate-900">
            <section className="min-w-0 px-4 py-5 md:px-8 md:py-8">
                <DashboardHeader
                    title="Gerencial"
                    description="Visão consolidada de financeiro, marketing, avaliações e marcações"
                    period={period}
                    setPeriod={setPeriod}
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                    storageManaged
                    storageReady={dateFilterReady}
                />

                {dateFilterReady && !filtersLoading ? (
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
                    <DashboardFilterBarSkeleton
                        widths={["w-[230px]"]}
                    />
                )}

                <DashboardWidget widgetId="gerencial.visao_geral">
                    <GerencialOverview
                        period={period}
                        selectedRange={selectedRange}
                        unitIds={unitIds}
                        ready={dateFilterReady}
                    />
                </DashboardWidget>
            </section>
        </main>
    );
}
