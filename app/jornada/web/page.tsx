"use client";

import {
    DashboardHeader,
    SidePanel,
    Skeleton,
} from "@/components";
import DashboardWebPageViews from "@/components/dashboard/DashboardWebPageViews";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";

export default function JourneyWebPage() {
    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("current_month");

    return (
        <main className="flex h-full w-full overflow-y-scroll bg-white text-slate-900 md:h-screen md:w-screen">
            <SidePanel />
            <section className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
                <DashboardHeader
                    title="Jornada"
                    description="Entenda o caminho dos clientes ao longo do atendimento"
                    period={period}
                    setPeriod={setPeriod}
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                    storageManaged
                    storageReady={dateFilterReady}
                />

                {dateFilterReady ? (
                    <div className="min-w-0 max-w-full overflow-x-hidden pb-12">
                        <DashboardWebPageViews
                            period={period}
                            selectedRange={selectedRange}
                        />
                    </div>
                ) : (
                    <Skeleton className="h-[560px] w-full rounded-2xl" />
                )}
            </section>
        </main>
    );
}
