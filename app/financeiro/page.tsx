// app/financeiro/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    BadgeDollarSign,
    Ban,
    CalendarCheck2,
    ChartNoAxesCombined,
    CircleDollarSign,
    HelpCircle,
    Layers3,
    Link2,
    Megaphone,
    Percent,
    ReceiptText,
    Users,
    WalletCards,
} from "lucide-react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Line,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { FaGoogle, FaMeta } from "react-icons/fa6";

import {
    Card,
    DashboardHeader,
    DashboardFilterBar,
    DashboardFilterBarSkeleton,
    FilterButton,
    HorizontalScroller,
    InfoTooltip,
    KpiCard,
    MainFilters,
    PercentageBar,
    Skeleton,
} from "@/components";
import {
    applyArrayParams,
    applyCalendarDateParams,
} from "@/components/ui/CalendarButton";
import type {
    FiltersResponse,
    FinancialDashboardData,
} from "@/types";
import {
    FinancialUnitTableCard,
    MonthlyProjectionKpiCard,
    ProcedureMixByCityCard,
    RevenueEvolutionComparisonCard,
    useFinancialUnitSummary,
} from "@/components/dashboard/FinancialDashboardExtras";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import {
    StatusCard as SharedStatusCard,
    TwelveMonthRevenueCard as SharedTwelveMonthRevenueCard,
    CategoryCard as SharedCategoryCard,
    CrmCard as SharedCrmCard,
    DoctorCard as SharedDoctorCard,
    AdsEvolutionCard as SharedAdsEvolutionCard,
    AdsPlatformCard as SharedAdsPlatformCard,
    AdsPlatformRoasCard as SharedAdsPlatformRoasCard,
    AdsCampaignCard as SharedAdsCampaignCard,
    MediaBudgetByCityCard as SharedMediaBudgetByCityCard,
    PaidCityReturnCard as SharedPaidCityReturnCard,
} from "@/components/personal-dashboard/ExactFinanceiroDashboardGraphs";


const STATUS_COLORS: Record<string, string> = {
    authorized: "#10b981",
    cancelled: "#ef4444",
    pending: "#f59e0b",
    denied: "#8b5cf6",
    other: "#64748b",
};

const CATEGORY_COLOR = "#1683ff";
const AD_PLATFORM_COLORS = {
    google_ads: "#d97706",
    meta_ads: "#0866ff",
} as const;

export default function FinancialDashboardPage() {
    const [data, setData] = useState<FinancialDashboardData | null>(null);
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [completedQueryKey, setCompletedQueryKey] = useState<string | null>(null);
    const hasLoadedOnce = useRef(false);
    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("current_month");
    const dashboardQueryKey = useMemo(() => {
        if (!dateFilterReady) return "";

        const params = new URLSearchParams();
        applyCalendarDateParams({
            params,
            selectedRange,
            selectedPreset: period,
        });
        applyArrayParams(params, {
            unit_ids: unitIds,
            categories,
        });
        return params.toString();
    }, [
        categories,
        dateFilterReady,
        period,
        selectedRange,
        unitIds,
    ]);
    const financialSummary = useFinancialUnitSummary({
        unitIds,
        categories,
        period,
        selectedRange,
        // The summary reads the same invoice population as the main route.
        // Start it only after the main payload finishes so both expensive
        // requests never compete for the database pool.
        enabled:
            dateFilterReady &&
            Boolean(dashboardQueryKey) &&
            completedQueryKey === dashboardQueryKey,
    });

    useEffect(() => {
        if (!dateFilterReady) return;
        const controller = new AbortController();

        async function loadFilters() {
            try {
                const response = await fetch(
                    "/api/dashboard/filters?entities=units",
                    { signal: controller.signal },
                );
                if (!response.ok) return;
                setFilters((await response.json()) as FiltersResponse);
            } catch (loadError) {
                if (controller.signal.aborted) return;
                console.error("[financeiro] filters failed", loadError);
            }
        }

        void loadFilters();
        return () => controller.abort();
    }, [dateFilterReady]);

    useEffect(() => {
        if (!dateFilterReady) return;
        const controller = new AbortController();

        async function loadDashboard() {
            if (hasLoadedOnce.current) setIsRefreshing(true);
            else setLoading(true);

            try {
                setError(null);
                const response = await fetch(
                    `/api/dashboard/financeiro?${dashboardQueryKey}`,
                    { cache: "no-store", signal: controller.signal },
                );
                const json = (await response.json()) as
                    | FinancialDashboardData
                    | { error?: string };

                if (!response.ok) {
                    throw new Error(
                        "error" in json && json.error
                            ? json.error
                            : "Falha ao carregar o Financeiro.",
                    );
                }

                setData(json as FinancialDashboardData);
                setCompletedQueryKey(dashboardQueryKey);
            } catch (loadError) {
                if (controller.signal.aborted) return;
                console.error("[financeiro] dashboard failed", loadError);
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Falha ao carregar o Financeiro.",
                );
                setData(null);
            } finally {
                if (controller.signal.aborted) return;
                hasLoadedOnce.current = true;
                setLoading(false);
                setIsRefreshing(false);
            }
        }

        const debounceId = window.setTimeout(() => {
            void loadDashboard();
        }, 150);

        return () => {
            window.clearTimeout(debounceId);
            controller.abort();
        };
    }, [
        dashboardQueryKey,
        dateFilterReady,
    ]);

    if (!dateFilterReady || loading) {
        return (
            <main className="flex h-full min-h-0 w-full overflow-y-auto bg-white text-slate-900">
                <section className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
                    <DashboardHeader title="Financeiro" description="Acompanhe faturamento, mix de serviços e eficiência comercial" period={period} setPeriod={setPeriod} selectedRange={selectedRange} setSelectedRange={setSelectedRange} storageManaged storageReady />
                    <DashboardFilterBarSkeleton widths={["w-[230px]", "w-[250px]"]} />
                    <FinancialBodySkeleton />
                </section>
            </main>
        );
    }

    if (!data) {
        return (
            <main className="flex h-full min-h-0 w-full overflow-y-auto bg-white text-slate-900">
                <section className="flex min-w-0 flex-1 items-center justify-center px-4 py-5 md:px-8 md:py-8">
                    <Card className="max-w-xl text-center">
                        <h1 className="text-xl font-bold">
                            Não foi possível carregar o Financeiro
                        </h1>
                        <p className="mt-2 text-sm text-slate-500">
                            {error ?? "Nenhum dado financeiro encontrado."}
                        </p>
                    </Card>
                </section>
            </main>
        );
    }

    const exactAuthorizedRevenue =
        financialSummary.data?.total.total ??
        data.kpis.authorized_revenue;
    return (
        <main className="flex h-full min-h-0 w-full overflow-y-auto bg-white text-slate-900">
            <section className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
                <DashboardHeader
                    title="Financeiro"
                    description="Acompanhe faturamento, mix de serviços e eficiência comercial"
                    period={period}
                    setPeriod={setPeriod}
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                    storageManaged
                    storageReady={dateFilterReady}
                />

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

                    <FilterButton
                        icon={<Layers3 size={16} />}
                        label="Todas as categorias"
                        values={categories}
                        onChange={setCategories}
                        options={data.available_filters.categories}
                        widthClassName="w-[250px]"
                    />
                </DashboardFilterBar>

                {isRefreshing ? (
                    <FinancialBodySkeleton />
                ) : (
                    <div className="overflow-x-hidden pb-12">
                        <KpiSection
                            data={data}
                            exactAuthorizedRevenue={exactAuthorizedRevenue}
                            projection={financialSummary.data?.projection ?? null}
                            projectionLoading={financialSummary.loading}
                        />

                        <section className="mb-6 grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.55fr_0.85fr]">
                            <RevenueEvolutionComparisonCard
                                data={data}
                                unitIds={unitIds}
                                categories={categories}
                            />
                            <StatusCard data={data} />
                        </section>

                        <section className="mb-6 grid grid-cols-1 items-stretch gap-5 xl:grid-cols-[1.55fr_0.85fr]">
                            <TwelveMonthRevenueCard data={data} />
                            <CategoryCard data={data} />
                        </section>

                        <section className="mb-6 min-w-0 max-w-full">
                            <FinancialUnitTableCard
                                data={financialSummary.data}
                                operationalUnits={data.by_unit}
                                operationalKpis={data.kpis}
                                loading={financialSummary.loading}
                                error={financialSummary.error}
                            />
                        </section>

                        <section className="mb-6">
                            <ProcedureMixByCityCard
                                data={financialSummary.data}
                                loading={financialSummary.loading}
                                error={financialSummary.error}
                            />
                        </section>

                        <section className="mb-6 grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
                            <CrmCard data={data} />
                            <DoctorCard data={data} />
                        </section>

                        <section className="mb-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
                            <TicketAverageCard data={data} />
                        </section>

                        <AdsSection data={data} />
                    </div>
                )}
            </section>
        </main>
    );
}

function KpiSection({
    data,
    exactAuthorizedRevenue,
    projection,
    projectionLoading,
}: {
    data: FinancialDashboardData;
    exactAuthorizedRevenue: number;
    projection: number | null;
    projectionLoading: boolean;
}) {
    return (
        <section className="mb-6 grid grid-cols-1 gap-5">
            <HorizontalScroller scrollAmount={420}>
                <KpiContainer>
                    <MonthlyProjectionKpiCard
                        currentValue={exactAuthorizedRevenue}
                        previousValue={data.previous_kpis.authorized_revenue}
                        projection={projection}
                        loading={projectionLoading}
                        freeWidth
                    />
                </KpiContainer>

                <KpiContainer>
                    <KpiCard
                        icon={<ReceiptText size={26} />}
                        label="Notas autorizadas"
                        currentValue={data.kpis.authorized_invoices}
                        previousValue={data.previous_kpis.authorized_invoices}
                        formatter={formatInteger}
                        color="blue"
                    />
                </KpiContainer>

                <KpiContainer>
                    <KpiCard
                        icon={<WalletCards size={26} />}
                        label="Ticket médio"
                        currentValue={data.kpis.average_ticket}
                        previousValue={data.previous_kpis.average_ticket}
                        formatter={formatCurrency}
                        color="purple"
                        tooltipText="Faturamento total das NFS-e autorizadas ÷ quantidade de NFS-e autorizadas no período selecionado."
                        tooltipWidthClassName="w-[300px]"
                    />
                </KpiContainer>

                <KpiContainer>
                    <KpiCard
                        icon={<Users size={26} />}
                        label="Pacientes faturados"
                        currentValue={data.kpis.billed_patients}
                        previousValue={data.previous_kpis.billed_patients}
                        formatter={formatInteger}
                        color="pink"
                    />
                </KpiContainer>

                <KpiContainer>
                    <KpiCard
                        icon={<Ban size={26} />}
                        label="Valor cancelado"
                        currentValue={data.kpis.cancelled_amount}
                        previousValue={data.previous_kpis.cancelled_amount}
                        formatter={formatCompactCurrency}
                        color="orange"
                        positiveDirection="down"
                        tooltipText={`Valor exato: ${formatCurrency(
                            data.kpis.cancelled_amount,
                        )}`}
                    />
                </KpiContainer>

                <KpiContainer>
                    <KpiCard
                        icon={<Percent size={26} />}
                        label="Taxa de cancelamento"
                        currentValue={data.kpis.cancellation_rate}
                        previousValue={data.previous_kpis.cancellation_rate}
                        suffix="%"
                        color="orange"
                        positiveDirection="down"
                    />
                </KpiContainer>
            </HorizontalScroller>
        </section>
    );
}

function KpiContainer({ children }: { children: ReactNode }) {
    return <div className="min-w-[285px] shrink-0">{children}</div>;
}

function TicketAverageCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle
                title="Ticket Médio"
                tooltip={"Geral: faturamento das NFS-e autorizadas ÷ notas autorizadas.\n\nTratamentos: mesma conta apenas para FIV, congelamento, genética/biópsias, transferências embrionárias e banco/doação.\n\nPrimeira consulta: mesma conta apenas para NFS-e cuja descrição identifica 1ª avaliação."}
                subtitle="Valor médio por NFS-e autorizada no período selecionado"
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MiniMetric
                    icon={<WalletCards size={17} />}
                    label="Geral"
                    value={formatNullableCurrency(data.kpis.average_ticket)}
                />
                <MiniMetric
                    icon={<CircleDollarSign size={17} />}
                    label="Tratamentos"
                    value={formatNullableCurrency(data.ticket_averages.treatments)}
                />
                <MiniMetric
                    icon={<ReceiptText size={17} />}
                    label="Primeira consulta"
                    value={formatNullableCurrency(
                        data.ticket_averages.first_consultation,
                    )}
                />
            </div>
        </Card>
    );
}

function AdsSection({ data }: { data: FinancialDashboardData }) {
    const ads = data.ads;

    return (
        <section className="mt-8 border-t border-slate-200 pt-8">
            <div className="mb-4">
                <div>
                    <div className="flex items-center gap-2">
                        <Megaphone size={19} className="text-blue" />
                        <h2 className="text-xl font-bold">Mídia paga</h2>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                        Investimento das plataformas ligado a resultados reais do CliniSys
                    </p>
                </div>
            </div>

            {!ads.has_data ? (
                <Card>
                    <EmptyState message="Nenhum dado do Google Ads ou Meta Ads foi sincronizado neste período." />
                </Card>
            ) : (
                <>
                    {!ads.comparison_available ? (
                        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                            O investimento é global. Remova os filtros de unidade e categoria para comparar mídia com receita e agendamentos.
                        </div>
                    ) : null}

                    <section className="mb-5 grid grid-cols-1 gap-5">
                        <HorizontalScroller scrollAmount={420}>
                            <KpiContainer>
                                <KpiCard
                                    icon={<BadgeDollarSign size={26} />}
                                    label="Investimento em mídia"
                                    currentValue={ads.kpis.spend}
                                    previousValue={
                                        ads.previous_kpis.spend
                                    }
                                    formatter={formatCompactCurrency}
                                    color="blue"
                                    freeWidth
                                />
                            </KpiContainer>

                            <KpiContainer>
                                <KpiCard
                                    icon={<CircleDollarSign size={26} />}
                                    label="Receita atribuída à mídia"
                                    currentValue={ads.kpis.attributed_revenue}
                                    previousValue={
                                        ads.previous_kpis.attributed_revenue
                                    }
                                    formatter={formatCompactCurrency}
                                    color="green"
                                    tooltipText="Soma das NFS-e autorizadas ligadas a clientes com evidência de aquisição paga. Atribuição: Origem Google/Meta; na ausência, UTM ou ID de clique (Google: gclid, gbraid, wbraid; Meta: fbclid, fbc, ctwa_clid). Sinais conflitantes e faturas sem cliente ficam de fora."
                                    tooltipWidthClassName="w-[260px]"
                                />
                            </KpiContainer>

                            <KpiContainer>
                                <KpiCard
                                    icon={<ChartNoAxesCombined size={26} />}
                                    label="Retorno sobre mídia"
                                    currentValue={ads.kpis.return_on_spend}
                                    previousValue={
                                        ads.previous_kpis.return_on_spend
                                    }
                                    formatter={formatMultiplier}
                                    color="purple"
                                />
                            </KpiContainer>

                            <KpiContainer>
                                <KpiCard
                                    icon={<CalendarCheck2 size={26} />}
                                    label="Custo por agendamento"
                                    currentValue={ads.kpis.cost_per_schedule}
                                    previousValue={
                                        ads.previous_kpis.cost_per_schedule
                                    }
                                    formatter={formatCurrency}
                                    color="orange"
                                    positiveDirection="down"
                                    tooltipText="Investimento ÷ agendamentos vinculados a clientes de mídia."
                                />
                            </KpiContainer>

                            <KpiContainer>
                                <KpiCard
                                    icon={<Users size={26} />}
                                    label="Custo por paciente faturado"
                                    currentValue={
                                        ads.kpis.cost_per_billed_patient
                                    }
                                    previousValue={
                                        ads.previous_kpis
                                            .cost_per_billed_patient
                                    }
                                    formatter={formatCurrency}
                                    color="pink"
                                    positiveDirection="down"
                                    tooltipText="Investimento ÷ pacientes de mídia com NFS-e autorizada."
                                />
                            </KpiContainer>
                        </HorizontalScroller>
                    </section>

                    <section className="mb-5">
                        <AdsEvolutionCard data={data} />
                    </section>

                    <div className="mb-5">
                        <AdsPlatformCard data={data} />
                    </div>

                    <div className="mb-5">
                        <PaidCityReturnCard data={data} />
                    </div>

                    <div className="mb-5">
                        <MediaBudgetByCityCard data={data} />
                    </div>

                    <AdsCampaignCard data={data} />
                </>
            )}
        </section>
    );
}

function AdsEvolutionCard({ data }: { data: FinancialDashboardData }) {
    return <SharedAdsEvolutionCard data={data} />;
}

function AdsPlatformCard({ data }: { data: FinancialDashboardData }) {
    return <SharedAdsPlatformCard data={data} />;
}

function AdsPlatformRoasCard({ data }: { data: FinancialDashboardData }) {
    return <SharedAdsPlatformRoasCard data={data} />;
}

function PlatformHighlight({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-xl bg-slate-50 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {label}
            </div>
            <div className="mt-1.5 truncate text-base font-bold text-slate-800">
                {value}
            </div>
        </div>
    );
}

function PlatformStat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[11px] text-slate-400">{label}</div>
            <div className="mt-1 font-bold text-slate-700">{value}</div>
        </div>
    );
}

function AdsPlatformIcon({
    platform,
    size,
}: {
    platform: keyof typeof AD_PLATFORM_COLORS;
    size: number;
}) {
    return platform === "google_ads" ? (
        <FaGoogle size={size} />
    ) : (
        <FaMeta size={size} />
    );
}

function AdsCampaignCard({ data }: { data: FinancialDashboardData }) {
    return <SharedAdsCampaignCard data={data} />;
}

type MediaBudgetCityRow = FinancialDashboardData["ads"]["by_city"][number];

function MediaBudgetByCityCard({ data }: { data: FinancialDashboardData }) {
    return <SharedMediaBudgetByCityCard data={data} />;
}

function MediaBudgetByCityRowItem({ row }: { row: MediaBudgetCityRow }) {
    const investedPercentage =
        row.monthly_budget > 0
            ? Math.max(
                  0,
                  Math.min(100, (row.spend / row.monthly_budget) * 100),
              )
            : 0;
    const campaignNamesTitle =
        row.matched_campaign_names.length > 0
            ? row.matched_campaign_names.join("\n")
            : undefined;

    return (
        <div className="grid grid-cols-[minmax(180px,1.35fr)_0.9fr_1fr_0.95fr_0.95fr_0.95fr_0.72fr_0.78fr_0.95fr] items-center gap-3 border-t border-slate-100 px-3 py-3 text-sm">
            <div className="min-w-0">
                <div className="truncate font-medium text-slate-700">
                    {row.city}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                    {row.meta_spend > 0 ? (
                        <span
                            className="text-[#0866FF]"
                            title="Meta Ads"
                            aria-label="Meta Ads"
                        >
                            <FaMeta size={12} />
                        </span>
                    ) : null}
                    {row.google_spend > 0 ? (
                        <span
                            style={{ color: AD_PLATFORM_COLORS.google_ads }}
                            title="Google Ads"
                            aria-label="Google Ads"
                        >
                            <FaGoogle size={12} />
                        </span>
                    ) : null}
                    <span
                        className={
                            campaignNamesTitle
                                ? "cursor-help underline decoration-dotted underline-offset-2"
                                : undefined
                        }
                        title={campaignNamesTitle}
                    >
                        {row.matched_campaigns}{" "}
                        {row.matched_campaigns === 1 ? "campanha" : "campanhas"}
                    </span>
                </div>
            </div>

            <div className="font-semibold text-slate-700">
                {formatCurrency(row.monthly_budget)}
            </div>

            <div className="min-w-0">
                <div className="font-semibold text-slate-700">
                    {formatCurrency(row.spend)}
                </div>
                <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
                    title={`${formatPercentage(investedPercentage)} da verba mensal`}
                >
                    <div
                        className="h-full rounded-full bg-blue-500"
                        style={{ width: `${investedPercentage}%` }}
                    />
                </div>
            </div>

            <div className="text-slate-600">
                {formatCurrency(row.remaining_to_budget)}
            </div>

            <div className="text-slate-600">
                {formatCurrency(row.average_daily_spend)}
            </div>

            <div className="text-slate-600">
                {formatCurrency(row.monthly_projection)}
            </div>

            <div className="font-semibold text-slate-700">
                {row.pace_percentage === null
                    ? "—"
                    : formatPercentage(row.pace_percentage)}
            </div>

            <div className="text-slate-600">
                {formatInteger(row.schedules)}
            </div>

            <div className="text-slate-600">
                {row.cost_per_schedule === null
                    ? "—"
                    : formatCurrency(row.cost_per_schedule)}
            </div>
        </div>
    );
}

function PaidCityReturnCard({ data }: { data: FinancialDashboardData }) {
    return <SharedPaidCityReturnCard data={data} />;
}

function StatusCard({ data }: { data: FinancialDashboardData }) {
    return <SharedStatusCard data={data} />;
}

function TwelveMonthRevenueCard({ data }: { data: FinancialDashboardData }) {
    return <SharedTwelveMonthRevenueCard data={data} />;
}

function TwelveMonthRevenueTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{
        dataKey?: string;
        value?: number | string;
    }>;
    label?: string;
}) {
    if (!active || !payload?.length) return null;

    const values = new Map(
        payload.map((item) => [item.dataKey, Number(item.value ?? 0)]),
    );

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs shadow-lg">
            <div className="mb-2 text-sm font-bold text-slate-800">
                {label ? formatMonthName(label, "long") : ""}
            </div>
            <div className="space-y-1.5 text-slate-600">
                <div className="flex items-center justify-between gap-6">
                    <span>Faturamento autorizado</span>
                    <strong className="text-blue-600">
                        {formatCurrency(values.get("revenue") ?? 0)}
                    </strong>
                </div>
                <div className="flex items-center justify-between gap-6">
                    <span>Investimento em mídia</span>
                    <strong className="text-amber-600">
                        {formatCurrency(values.get("investment") ?? 0)}
                    </strong>
                </div>
            </div>
        </div>
    );
}

function CategoryCard({ data }: { data: FinancialDashboardData }) {
    return <SharedCategoryCard data={data} />;
}

function CrmCard({ data }: { data: FinancialDashboardData }) {
    return <SharedCrmCard data={data} />;
}

function DoctorCard({ data }: { data: FinancialDashboardData }) {
    return <SharedDoctorCard data={data} />;
}

function CardTitle({
    title,
    tooltip,
    subtitle,
}: {
    title: string;
    tooltip?: string;
    subtitle?: string;
}) {
    return (
        <div className="mb-5">
            <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{title}</h2>
                {tooltip ? (
                    <InfoTooltip text={tooltip}>
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                ) : null}
            </div>
            {subtitle ? (
                <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
            ) : null}
        </div>
    );
}

function MiniMetric({
    icon,
    label,
    value,
}: {
    icon: ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-xl bg-slate-50 px-3 py-3">
            <div className="flex items-center gap-2 text-slate-500">
                {icon}
                <span className="text-[11px] font-medium">{label}</span>
            </div>
            <div className="mt-2 text-xl font-bold text-slate-800">{value}</div>
        </div>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
            />
            <span>{label}</span>
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex h-full min-h-[150px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 text-center text-sm text-slate-400">
            {message}
        </div>
    );
}

type TooltipPayloadItem = {
    dataKey?: string;
    value?: number;
    payload?: Record<string, unknown>;
};

function AdsEvolutionTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: TooltipPayloadItem[];
    label?: string;
}) {
    if (!active || !payload?.length) return null;
    const values = payload[0]?.payload ?? {};
    const googleSpend = Number(values.google_spend ?? 0);
    const metaSpend = Number(values.meta_spend ?? 0);
    const attributedRevenue =
        typeof values.attributed_revenue === "number"
            ? values.attributed_revenue
            : null;

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
            <div className="mb-2 font-bold text-slate-700">{label}</div>
            <div className="space-y-1 text-slate-600">
                <div>Google Ads: {formatCurrency(googleSpend)}</div>
                <div>Meta Ads: {formatCurrency(metaSpend)}</div>
                <div>Investimento: {formatCurrency(googleSpend + metaSpend)}</div>
                {attributedRevenue !== null ? (
                    <div>Receita atribuída: {formatCurrency(attributedRevenue)}</div>
                ) : null}
            </div>
        </div>
    );
}

function AdsPlatformRoasTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: TooltipPayloadItem[];
}) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload ?? {};
    const attributedRevenue =
        typeof row.attributed_revenue === "number"
            ? row.attributed_revenue
            : null;
    const roas = typeof row.roas === "number" ? row.roas : null;

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
            <div className="mb-2 font-bold text-slate-700">
                {String(row.platform ?? "")}
            </div>
            <div className="space-y-1 text-slate-600">
                <div>
                    Investimento: {formatCurrency(Number(row.spend ?? 0))}
                </div>
                <div>
                    Receita atribuída:{" "}
                    {attributedRevenue === null
                        ? "—"
                        : formatCurrency(attributedRevenue)}
                </div>
                <div>
                    ROAS: {roas === null ? "—" : formatMultiplier(roas)}
                </div>
            </div>
        </div>
    );
}

function PaidCityReturnTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: TooltipPayloadItem[];
}) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload ?? {};
    const roas =
        typeof row.real_roas === "number" ? row.real_roas : null;

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
            <div className="mb-2 font-bold text-slate-700">
                {String(row.city ?? "")}
            </div>
            <div className="space-y-1 text-slate-600">
                <div>
                    Investimento: {formatCurrency(Number(row.spend ?? 0))}
                </div>
                <div>
                    Receita atribuída:{" "}
                    {formatCurrency(Number(row.attributed_revenue ?? 0))}
                </div>
                <div>
                    ROAS real: {roas === null ? "—" : formatMultiplier(roas)}
                </div>
                <div>
                    Agendados pagos:{" "}
                    {formatInteger(Number(row.paid_schedules ?? 0))}
                </div>
                <div>
                    Custo/agendado pago:{" "}
                    {typeof row.cost_per_paid_schedule === "number"
                        ? formatCurrency(row.cost_per_paid_schedule)
                        : "—"}
                </div>
                <div>
                    Pacientes faturados:{" "}
                    {formatInteger(Number(row.attributed_patients ?? 0))}
                </div>
            </div>
        </div>
    );
}

function CategoryTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: TooltipPayloadItem[];
}) {
    if (!active || !payload?.length) return null;
    const values = payload[0]?.payload ?? {};

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
            <div className="mb-2 font-bold text-slate-700">
                {String(values.label ?? "Categoria")}
            </div>
            <div className="space-y-1 text-slate-600">
                <div>Faturamento: {formatCurrency(Number(values.revenue ?? 0))}</div>
                <div>Participação: {formatPercentage(Number(values.percentage ?? 0))}</div>
                <div>Notas: {formatInteger(Number(values.invoices ?? 0))}</div>
                <div>
                    Ticket: {formatNullableCurrency(
                        typeof values.average_ticket === "number"
                            ? values.average_ticket
                            : null,
                    )}
                </div>
            </div>
        </div>
    );
}

function FinancialDashboardSkeleton() {
    return (
        <>
            <div className="mb-8 flex items-start justify-between">
                <div>
                    <Skeleton className="h-9 w-[260px]" />
                    <Skeleton className="mt-3 h-4 w-[390px]" />
                </div>
                <Skeleton className="h-12 w-[310px]" />
            </div>
            <div className="mb-8 flex justify-end gap-3">
                <Skeleton className="h-12 w-[230px]" />
                <Skeleton className="h-12 w-[250px]" />
            </div>
            <FinancialBodySkeleton />
        </>
    );
}

function FinancialBodySkeleton() {
    return (
        <>
            <section className="mb-6 grid grid-cols-1 gap-5">
                <HorizontalScroller scrollAmount={420}>
                    {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="min-w-[285px]">
                            <Card>
                                <div className="flex items-center gap-5">
                                    <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
                                    <div className="flex-1">
                                        <Skeleton className="h-3 w-[65%]" />
                                        <Skeleton className="mt-3 h-8 w-[55%]" />
                                        <Skeleton className="mt-3 h-3 w-[75%]" />
                                    </div>
                                </div>
                            </Card>
                        </div>
                    ))}
                </HorizontalScroller>
            </section>
            <section className="mb-6 grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.55fr_0.85fr]">
                <Card>
                    <Skeleton className="mb-5 h-6 w-[38%]" />
                    <Skeleton className="h-[300px] w-full" />
                </Card>
                <Card>
                    <Skeleton className="mb-5 h-6 w-[45%]" />
                    <Skeleton className="mx-auto h-[210px] w-[210px] rounded-full" />
                </Card>
            </section>
            <section className="mb-6 grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_1.2fr]">
                <Card>
                    <Skeleton className="mb-5 h-6 w-[45%]" />
                    <Skeleton className="h-[335px] w-full" />
                </Card>
                <Card>
                    <Skeleton className="mb-5 h-6 w-[38%]" />
                    <Skeleton className="h-[335px] w-full" />
                </Card>
            </section>
            <section className="mb-6 grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
                <Card>
                    <Skeleton className="mb-5 h-6 w-[42%]" />
                    <Skeleton className="h-[300px] w-full" />
                </Card>
                <Card>
                    <Skeleton className="mb-5 h-6 w-[42%]" />
                    <Skeleton className="h-[300px] w-full" />
                </Card>
            </section>
            <section className="mb-6">
                <Card>
                    <Skeleton className="mb-5 h-6 w-[28%]" />
                    <Skeleton className="h-11 w-full rounded-xl" />
                    <div className="mt-1 space-y-1">
                        {Array.from({ length: 7 }).map((_, index) => (
                            <Skeleton
                                key={index}
                                className="h-10 w-full rounded-none"
                            />
                        ))}
                    </div>
                </Card>
            </section>
            <section className="mb-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
                <Card>
                    <Skeleton className="mb-5 h-6 w-[32%]" />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <Skeleton
                                key={index}
                                className="h-[78px] w-full rounded-xl"
                            />
                        ))}
                    </div>
                </Card>
            </section>
            <section className="mt-8 border-t border-slate-200 pt-8">
                <Skeleton className="mb-3 h-7 w-[190px]" />
                <section className="mb-5 grid grid-cols-1 gap-5">
                    <HorizontalScroller scrollAmount={420}>
                        {Array.from({ length: 5 }).map((_, index) => (
                            <div key={index} className="min-w-[285px]">
                                <Card>
                                    <div className="flex items-center gap-5">
                                        <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
                                        <div className="flex-1">
                                            <Skeleton className="h-3 w-[70%]" />
                                            <Skeleton className="mt-3 h-8 w-[58%]" />
                                        </div>
                                    </div>
                                </Card>
                            </div>
                        ))}
                    </HorizontalScroller>
                </section>
                <section className="mb-5 space-y-5">
                    <Card>
                        <Skeleton className="mb-5 h-6 w-[42%]" />
                        <Skeleton className="h-[310px] w-full" />
                    </Card>
                    <Card>
                        <Skeleton className="mb-5 h-6 w-[55%]" />
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Skeleton className="h-[290px] w-full" />
                            <Skeleton className="h-[290px] w-full" />
                        </div>
                    </Card>
                </section>
            </section>
        </>
    );
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}

function formatCompactCurrency(value: number) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(value);
}

function formatMonthName(value: string, length: "short" | "long" = "short") {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return value;

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    const formatted = new Intl.DateTimeFormat("pt-BR", {
        month: length,
        timeZone: "UTC",
    }).format(date);

    return length === "short" ? formatted.replace(".", "") : formatted;
}

function formatNullableCurrency(value: number | null) {
    return value === null ? "—" : formatCurrency(value);
}

function formatMultiplier(value: number) {
    return `${value.toLocaleString("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
    })}x`;
}

function formatNullableMultiplier(value: number | null) {
    return value === null ? "—" : formatMultiplier(value);
}

function formatMetric(value: number) {
    return value.toLocaleString("pt-BR", {
        minimumFractionDigits: value % 1 === 0 ? 0 : 1,
        maximumFractionDigits: 1,
    });
}

function formatInteger(value: number) {
    return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function formatPercentage(value: number | null) {
    return value === null
        ? "—"
        : `${value.toLocaleString("pt-BR", {
              minimumFractionDigits: value % 1 === 0 ? 0 : 1,
              maximumFractionDigits: 1,
          })}%`;
}
