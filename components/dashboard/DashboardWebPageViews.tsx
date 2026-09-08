"use client";

import { useEffect, useState } from "react";
import { Globe2, PanelsTopLeft } from "lucide-react";

import {
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import Card from "@/components/ui/Card";
import HorizontalScroller from "@/components/ui/HorizontalScroller";
import KpiCard from "@/components/ui/KpiCard";
import Skeleton from "@/components/ui/Skeleton";

type Props = {
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
};

type PageViewRow = {
    host: string;
    path: string;
    title: string;
    views: number;
};

type WebPageViewsData = {
    main_site_views: number;
    landing_page_views: number;
    main_site_pages: PageViewRow[];
    landing_pages: PageViewRow[];
};

export default function DashboardWebPageViews({
    period,
    selectedRange,
}: Props) {
    const [data, setData] = useState<WebPageViewsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const debounceId = window.setTimeout(() => {
            void loadPageViews();
        }, 120);

        async function loadPageViews() {
            setLoading(true);
            setError(null);

            try {
                const params = new URLSearchParams();
                applyCalendarDateParams({
                    params,
                    selectedRange,
                    selectedPreset: period,
                });

                const response = await fetch(
                    `/api/dashboard/web-pages?${params.toString()}`,
                    {
                        signal: controller.signal,
                        cache: "no-store",
                    },
                );
                const payload = (await response.json()) as WebPageViewsData & {
                    error?: string;
                };

                if (!response.ok) {
                    throw new Error(
                        payload.error ??
                            "Não foi possível carregar as visualizações.",
                    );
                }

                setData(payload);
            } catch (loadError) {
                if (
                    loadError instanceof DOMException &&
                    loadError.name === "AbortError"
                ) {
                    return;
                }

                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Não foi possível carregar as visualizações.",
                );
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        return () => {
            window.clearTimeout(debounceId);
            controller.abort();
        };
    }, [period, selectedRange.start, selectedRange.end]);

    if (loading) return <WebPageViewsSkeleton />;

    if (error) {
        return (
            <Card className="border-red/20 bg-red-soft/20">
                <div className="text-sm font-medium text-red">{error}</div>
            </Card>
        );
    }

    if (!data) return null;

    return (
        <div className="min-w-0 space-y-5">
            <div className="px-1">
                <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-soft text-blue">
                        <Globe2 size={19} />
                    </span>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">
                            Páginas web
                        </h2>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                            Visualizações do site principal e das landing pages no período selecionado.
                        </p>
                    </div>
                </div>
            </div>

            <HorizontalScroller scrollAmount={360}>
                <div className="min-w-[270px] flex-1">
                    <KpiCard
                        icon={<Globe2 size={26} />}
                        label="Visualizações — site principal"
                        currentValue={data.main_site_views}
                        formatter={formatViews}
                        color="blue"
                    />
                </div>
                <div className="min-w-[270px] flex-1">
                    <KpiCard
                        icon={<PanelsTopLeft size={26} />}
                        label="Visualizações — landing pages"
                        currentValue={data.landing_page_views}
                        formatter={formatViews}
                        color="purple"
                    />
                </div>
            </HorizontalScroller>

            <div className="grid min-w-0 gap-5 lg:grid-cols-2">
                <PageViewsCard
                    title="Site principal"
                    pages={data.main_site_pages}
                    emptyLabel="Nenhuma visualização do site principal no período."
                />
                <PageViewsCard
                    title="Landing pages"
                    pages={data.landing_pages}
                    emptyLabel="Nenhuma visualização das landing pages no período."
                />
            </div>
        </div>
    );
}

function PageViewsCard({
    title,
    pages,
    emptyLabel,
}: {
    title: string;
    pages: PageViewRow[];
    emptyLabel: string;
}) {
    return (
        <Card className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>

            {pages.length === 0 ? (
                <div className="mt-5 rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center text-sm text-slate-400">
                    {emptyLabel}
                </div>
            ) : (
                <div className="mt-4 max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
                    {pages.map((page) => (
                        <div
                            key={`${page.host}${page.path}`}
                            className="flex min-w-0 items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                        >
                            <div className="min-w-0">
                                <div
                                    className="truncate text-sm font-semibold text-slate-800"
                                    title={page.title || page.path}
                                >
                                    {page.title || page.path}
                                </div>
                                <div
                                    className="mt-1 truncate text-xs text-slate-500"
                                    title={`${page.host}${page.path}`}
                                >
                                    {page.host}
                                    {page.path}
                                </div>
                            </div>
                            <div className="shrink-0 text-sm font-bold text-slate-800">
                                {formatViews(page.views)}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}

function formatViews(value: number) {
    return value.toLocaleString("pt-BR");
}

function WebPageViewsSkeleton() {
    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3 px-1">
                <Skeleton className="h-9 w-9" />
                <div className="space-y-2">
                    <Skeleton className="h-5 w-[180px]" />
                    <Skeleton className="h-3 w-[360px]" />
                </div>
            </div>
            <div className="flex gap-5 overflow-hidden">
                {Array.from({ length: 2 }).map((_, index) => (
                    <Skeleton
                        key={index}
                        className="h-[130px] min-w-[270px] flex-1"
                    />
                ))}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
                <Skeleton className="h-[360px] w-full" />
                <Skeleton className="h-[360px] w-full" />
            </div>
        </div>
    );
}
