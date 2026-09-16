"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
    ArrowUpRight,
    Globe2,
    MessageCircle,
    MousePointerClick,
    PanelsTopLeft,
} from "lucide-react";

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

type TrafficSourceRow = {
    source: string;
    medium: string;
    campaign: string;
    sessions: number;
    percentage: number;
};

type LandingPagePerformanceRow = PageViewRow & {
    whatsapp_clicks: number;
    main_site_clicks: number;
    action_clicks: number;
    action_rate: number;
};

type WebPageViewsData = {
    main_site_views: number;
    previous_main_site_views: number;
    landing_page_views: number;
    previous_landing_page_views: number;
    whatsapp_clicks: number;
    previous_whatsapp_clicks: number;
    main_site_clicks: number;
    previous_main_site_clicks: number;
    landing_page_action_rate: number;
    previous_landing_page_action_rate: number;
    main_site_pages: PageViewRow[];
    landing_pages: PageViewRow[];
    traffic_sources: TrafficSourceRow[];
    landing_page_performance: LandingPagePerformanceRow[];
};

export default function DashboardWebPageViews({
    period,
    selectedRange,
}: Props) {
    const pathname = usePathname();
    const [data, setData] = useState<WebPageViewsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (pathname === "/atendimento") return;

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
                            "Não foi possível carregar os dados web.",
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
                        : "Não foi possível carregar os dados web.",
                );
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        return () => {
            window.clearTimeout(debounceId);
            controller.abort();
        };
    }, [pathname, period, selectedRange.start, selectedRange.end]);

    if (pathname === "/atendimento") return null;
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
                            Aquisição, visualizações e ações do site principal e das landing pages.
                        </p>
                    </div>
                </div>
            </div>

            <HorizontalScroller scrollAmount={360}>
                <div className="min-w-[245px] flex-1">
                    <KpiCard
                        icon={<Globe2 size={26} />}
                        label="Visualizações — site principal"
                        currentValue={data.main_site_views}
                        previousValue={data.previous_main_site_views}
                        formatter={formatViews}
                        color="blue"
                    />
                </div>
                <div className="min-w-[245px] flex-1">
                    <KpiCard
                        icon={<PanelsTopLeft size={26} />}
                        label="Visualizações — landing pages"
                        currentValue={data.landing_page_views}
                        previousValue={data.previous_landing_page_views}
                        formatter={formatViews}
                        color="purple"
                    />
                </div>
                <div className="min-w-[245px] flex-1">
                    <KpiCard
                        icon={<MessageCircle size={26} />}
                        label="Cliques no WhatsApp"
                        currentValue={data.whatsapp_clicks}
                        previousValue={data.previous_whatsapp_clicks}
                        formatter={formatViews}
                        color="green"
                        tooltipText="Cliques nos CTAs de WhatsApp registrados nas landing pages."
                    />
                </div>
                <div className="min-w-[245px] flex-1">
                    <KpiCard
                        icon={<ArrowUpRight size={26} />}
                        label="Cliques para o site principal"
                        currentValue={data.main_site_clicks}
                        previousValue={data.previous_main_site_clicks}
                        formatter={formatViews}
                        color="orange"
                        tooltipText="Cliques de saída das landing pages que levam para engravida.com.br."
                    />
                </div>
                <div className="min-w-[245px] flex-1">
                    <KpiCard
                        icon={<MousePointerClick size={26} />}
                        label="Taxa de ação das landing pages"
                        currentValue={data.landing_page_action_rate}
                        previousValue={data.previous_landing_page_action_rate}
                        formatter={formatPercent}
                        color="pink"
                        tooltipText="Cliques no WhatsApp + cliques para o site principal, divididos pelas visualizações das landing pages."
                    />
                </div>
            </HorizontalScroller>

            <div className="grid min-w-0 gap-5 lg:grid-cols-2">
                <TrafficSourcesCard sources={data.traffic_sources} />
                <PageViewsCard
                    title="Páginas do site principal"
                    description="Visualizações por página no período selecionado."
                    pages={data.main_site_pages}
                    emptyLabel="Nenhuma visualização do site principal no período."
                />
            </div>

            <LandingPagePerformanceCard
                pages={data.landing_page_performance}
            />
        </div>
    );
}

function TrafficSourcesCard({ sources }: { sources: TrafficSourceRow[] }) {
    const visibleSources = sources.slice(0, 12);

    return (
        <Card className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">
                Origem do tráfego
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
                Sessões por origem, mídia e campanha. Inclui UTMs, orgânico, referência e acesso direto.
            </p>

            {visibleSources.length === 0 ? (
                <EmptyState label="Nenhuma origem de tráfego no período." />
            ) : (
                <div className="mt-5 space-y-4">
                    {visibleSources.map((source, index) => (
                        <div
                            key={`${source.source}-${source.medium}-${source.campaign}-${index}`}
                            className="min-w-0"
                        >
                            <div className="flex min-w-0 items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-slate-800">
                                        {source.source}
                                        <span className="font-normal text-slate-400">
                                            {` / ${source.medium}`}
                                        </span>
                                    </div>
                                    {source.campaign !== "—" ? (
                                        <div className="mt-0.5 truncate text-xs text-slate-400">
                                            {source.campaign}
                                        </div>
                                    ) : null}
                                </div>
                                <div className="shrink-0 text-right">
                                    <div className="text-sm font-bold text-slate-800">
                                        {formatViews(source.sessions)}
                                    </div>
                                    <div className="text-xs font-medium text-slate-400">
                                        {formatPercent(source.percentage)}
                                    </div>
                                </div>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <div
                                    className="h-full rounded-full bg-blue"
                                    style={{
                                        width: `${Math.min(100, Math.max(0, source.percentage))}%`,
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}

function LandingPagePerformanceCard({
    pages,
}: {
    pages: LandingPagePerformanceRow[];
}) {
    return (
        <Card className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">
                Performance das landing pages
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
                Conecta cada página às ações geradas depois da visualização.
            </p>

            {pages.length === 0 ? (
                <EmptyState label="Nenhuma landing page no período." />
            ) : (
                <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[780px] text-left">
                        <thead>
                            <tr className="border-b border-slate-100 text-xs font-bold text-slate-500">
                                <th className="pb-3 pr-5">Landing page</th>
                                <th className="pb-3 px-3 text-right">Visualizações</th>
                                <th className="pb-3 px-3 text-right">WhatsApp</th>
                                <th className="pb-3 px-3 text-right">Site principal</th>
                                <th className="pb-3 pl-3 text-right">Taxa de ação</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {pages.map((page) => (
                                <tr key={`${page.host}${page.path}`}>
                                    <td className="py-3 pr-5">
                                        <div
                                            className="max-w-[360px] truncate text-sm font-semibold text-slate-800"
                                            title={page.title || page.path}
                                        >
                                            {page.title || page.path}
                                        </div>
                                        <div
                                            className="mt-0.5 max-w-[360px] truncate text-xs text-slate-400"
                                            title={`${page.host}${page.path}`}
                                        >
                                            {page.host}
                                            {page.path}
                                        </div>
                                    </td>
                                    <td className="px-3 py-3 text-right text-sm font-semibold text-slate-700">
                                        {formatViews(page.views)}
                                    </td>
                                    <td className="px-3 py-3 text-right text-sm font-semibold text-slate-700">
                                        {formatViews(page.whatsapp_clicks)}
                                    </td>
                                    <td className="px-3 py-3 text-right text-sm font-semibold text-slate-700">
                                        {formatViews(page.main_site_clicks)}
                                    </td>
                                    <td className="py-3 pl-3 text-right">
                                        <div className="text-sm font-bold text-slate-800">
                                            {formatPercent(page.action_rate)}
                                        </div>
                                        <div className="mt-0.5 text-xs text-slate-400">
                                            {formatViews(page.action_clicks)} ações
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
}

function PageViewsCard({
    title,
    description,
    pages,
    emptyLabel,
}: {
    title: string;
    description: string;
    pages: PageViewRow[];
    emptyLabel: string;
}) {
    return (
        <Card className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
                {description}
            </p>

            {pages.length === 0 ? (
                <EmptyState label={emptyLabel} />
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

function EmptyState({ label }: { label: string }) {
    return (
        <div className="mt-5 rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center text-sm text-slate-400">
            {label}
        </div>
    );
}

function formatViews(value: number) {
    return value.toLocaleString("pt-BR");
}

function formatPercent(value: number) {
    return `${value.toLocaleString("pt-BR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
    })}%`;
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
                {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton
                        key={index}
                        className="h-[130px] min-w-[245px] flex-1"
                    />
                ))}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
                <Skeleton className="h-[420px] w-full" />
                <Skeleton className="h-[420px] w-full" />
            </div>
            <Skeleton className="h-[420px] w-full" />
        </div>
    );
}
