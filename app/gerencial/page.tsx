"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    Banknote,
    CalendarCheck2,
    CalendarPlus2,
    Megaphone,
} from "lucide-react";

import {
    Card,
    DashboardFilterBar,
    DashboardFilterBarSkeleton,
    DashboardHeader,
    MainFilters,
    Skeleton,
} from "@/components";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import DashboardWidget from "@/components/personal-dashboard/DashboardWidget";
import {
    ScheduleCreationEvolutionCard,
    ScheduleEvolutionCard,
} from "@/components/personal-dashboard/ExactAtendimentoDashboardGraphs";
import {
    AdsEvolutionCard,
    TwelveMonthRevenueCard,
} from "@/components/personal-dashboard/ExactFinanceiroDashboardGraphs";
import {
    ResgateLeadsCard,
    type HistoryItem,
} from "@/components/personal-dashboard/ExactMensagemAtivaDashboardGraphs";
import { usePersonalDashboardSources } from "@/components/personal-dashboard/usePersonalDashboardSources";
import {
    applyArrayParams,
    applyCalendarDateParams,
    getDateStringWithOffset,
} from "@/components/ui/CalendarButton";
import {
    getActiveMessageTemplate,
    getActiveMessageTemplatePriceBrl,
} from "@/lib/active-messages/templates";
import type { DashboardWidgetDefinition } from "@/lib/personal-dashboard/registry";
import { getDashboardWidget } from "@/lib/personal-dashboard/registryExtended";
import type {
    ExecutiveDashboardData,
    FiltersResponse,
    FinancialDashboardData,
} from "@/types";

const GERENCIAL_WIDGET_IDS = [
    "financeiro.faturamento_autorizado",
    "financeiro.faturamento_12_meses",
    "financeiro.investimento_receita_midia",
    "atendimento.agendamentos_periodo",
    "atendimento.marcacoes_dia",
    "mensagem_ativa.fluxo_resgate_leads",
] as const;

type MarkingsData = {
    total: {
        unique_markings: number;
        unique_projection: number;
    };
};

type ActiveMessageAnalyticsData = {
    history: HistoryItem[];
};

export default function GerencialPage() {
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [filtersLoading, setFiltersLoading] = useState(true);
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [markings, setMarkings] = useState<MarkingsData | null>(null);
    const [markingsLoading, setMarkingsLoading] = useState(true);
    const [markingsError, setMarkingsError] = useState<string | null>(null);
    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("current_month");

    const definitions = useMemo(
        () =>
            GERENCIAL_WIDGET_IDS.map(getDashboardWidget).filter(
                (widget): widget is DashboardWidgetDefinition =>
                    widget !== null,
            ),
        [],
    );

    const {
        data,
        loadingSources,
        errors,
    } = usePersonalDashboardSources({
        definitions,
        ready: dateFilterReady,
        period,
        selectedRange,
        unitIds,
        attendantIds: [],
        tunnelValues: [],
        originValues: [],
        categories: [],
        eventValues: [],
        platformValues: [],
        statusValues: [],
        eventSourceValues: [],
    });

    const dateWindow = useMemo(() => {
        if (!dateFilterReady) return null;

        const params = new URLSearchParams();
        applyCalendarDateParams({
            params,
            selectedRange,
            selectedPreset: period,
        });
        return {
            start: params.get("start_date"),
            end: params.get("end_date"),
        };
    }, [
        dateFilterReady,
        period,
        selectedRange.end,
        selectedRange.start,
    ]);

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
                if (!controller.signal.aborted) setFiltersLoading(false);
            });

        return () => controller.abort();
    }, [dateFilterReady]);

    useEffect(() => {
        if (!dateFilterReady) return;
        const controller = new AbortController();
        const params = new URLSearchParams();
        applyCalendarDateParams({
            params,
            selectedRange,
            selectedPreset: period,
        });
        applyArrayParams(params, { unit_ids: unitIds });

        setMarkingsLoading(true);
        setMarkingsError(null);
        void fetch(`/api/dashboard/markings?${params.toString()}`, {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
        })
            .then(async (response) => {
                const json = (await response.json()) as MarkingsData & {
                    error?: string;
                };
                if (!response.ok) {
                    throw new Error(
                        json.error ?? "Falha ao carregar marcações.",
                    );
                }
                setMarkings(json);
            })
            .catch((error) => {
                if (controller.signal.aborted) return;
                console.error("[gerencial] markings failed", error);
                setMarkings(null);
                setMarkingsError(
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar marcações.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) setMarkingsLoading(false);
            });

        return () => controller.abort();
    }, [
        dateFilterReady,
        period,
        selectedRange.end,
        selectedRange.start,
        unitIds,
    ]);

    const financial = data.financeiro as FinancialDashboardData | null;
    const executive = data.atendimento as ExecutiveDashboardData | null;
    const activeMessages =
        data.mensagem_ativa as ActiveMessageAnalyticsData | null;

    const yesterday = getDateStringWithOffset(-1);
    const yesterdayInPeriod = Boolean(
        dateWindow?.start &&
            dateWindow.end &&
            dateWindow.start <= yesterday &&
            yesterday <= dateWindow.end,
    );
    const financialDailyRange =
        yesterdayInPeriod &&
        Boolean(
            dateWindow?.start &&
                dateWindow.end &&
                daysBetween(dateWindow.start, dateWindow.end) <= 45,
        );

    const yesterdayRevenue = financialDailyRange
        ? financial?.evolution.find((row) => row.period === yesterday)
              ?.authorized_revenue ?? 0
        : null;
    const yesterdayInvestment = financialDailyRange
        ? financial?.ads.evolution.find((row) => row.period === yesterday)
              ?.spend ?? 0
        : null;
    const yesterdayMarkings = yesterdayInPeriod
        ? executive?.schedule_creation_evolution.find(
              (row) => row.date_iso === yesterday,
          )?.total ?? 0
        : null;

    const financialTotal =
        data.financeiroSummary?.total.total ??
        financial?.kpis.authorized_revenue ??
        null;
    const financialProjection =
        data.financeiroSummary?.projection ?? null;
    const metaInvestment =
        financial?.ads.by_platform.find(
            (item) => item.platform === "meta_ads",
        )?.spend ?? 0;
    const googleInvestment =
        financial?.ads.by_platform.find(
            (item) => item.platform === "google_ads",
        )?.spend ?? 0;
    const scheduleTotal = executive?.schedule_unit_table.total ?? null;
    const resgate = useMemo(
        () => summarizeResgate(activeMessages?.history ?? []),
        [activeMessages?.history],
    );

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
                    <DashboardFilterBarSkeleton widths={["w-[230px]"]} />
                )}

                <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 2xl:grid-cols-4">
                    <ManagementColumn
                        title="Financeiro"
                        icon={<Banknote size={18} />}
                    >
                        {loadingSources.has("financeiro") && !financial ? (
                            <SummarySkeleton />
                        ) : errors.financeiro || !financial ? (
                            <UnavailableCard
                                message={
                                    errors.financeiro ??
                                    "Dados financeiros indisponíveis."
                                }
                            />
                        ) : (
                            <>
                                <SummaryCard
                                    title="Faturamento"
                                    mainLabel="Faturamento total"
                                    mainValue={formatCurrency(financialTotal)}
                                    rows={[
                                        {
                                            label: "Projeção",
                                            value: formatCurrency(
                                                financialProjection,
                                            ),
                                        },
                                        {
                                            label: "Ontem",
                                            value: formatCurrency(
                                                yesterdayRevenue,
                                            ),
                                        },
                                    ]}
                                />
                                <DashboardWidget widgetId="financeiro.faturamento_12_meses">
                                    <TwelveMonthRevenueCard data={financial} />
                                </DashboardWidget>
                            </>
                        )}
                    </ManagementColumn>

                    <ManagementColumn
                        title="Marketing"
                        icon={<Megaphone size={18} />}
                    >
                        {loadingSources.has("financeiro") && !financial ? (
                            <SummarySkeleton />
                        ) : errors.financeiro || !financial ? (
                            <UnavailableCard
                                message={
                                    errors.financeiro ??
                                    "Dados de marketing indisponíveis."
                                }
                            />
                        ) : (
                            <>
                                <SummaryCard
                                    title="Investimento"
                                    mainLabel="Investimento total"
                                    mainValue={formatCurrency(
                                        financial.ads.kpis.spend,
                                    )}
                                    rows={[
                                        {
                                            label: "Meta",
                                            value: formatCurrency(
                                                metaInvestment,
                                            ),
                                        },
                                        {
                                            label: "Google Ads",
                                            value: formatCurrency(
                                                googleInvestment,
                                            ),
                                        },
                                        {
                                            label: "Total ontem",
                                            value: formatCurrency(
                                                yesterdayInvestment,
                                            ),
                                        },
                                    ]}
                                />
                                <DashboardWidget widgetId="financeiro.investimento_receita_midia">
                                    <AdsEvolutionCard data={financial} />
                                </DashboardWidget>
                            </>
                        )}

                        {loadingSources.has("mensagem_ativa") &&
                        !activeMessages ? (
                            <SummarySkeleton />
                        ) : errors.mensagem_ativa || !activeMessages ? (
                            <UnavailableCard
                                message={
                                    errors.mensagem_ativa ??
                                    "Dados do Fluxo de Resgate indisponíveis."
                                }
                            />
                        ) : (
                            <>
                                <SummaryCard
                                    title="Fluxo de Resgate de Leads"
                                    mainLabel="Total"
                                    mainValue={formatInteger(resgate.total)}
                                    mainHint="Leads que responderam ao fluxo"
                                    rows={[
                                        {
                                            label: "Custo por resgate",
                                            value: formatCurrency(
                                                resgate.costPerResgate,
                                                2,
                                            ),
                                            hint: "Tarifa Meta de templates ÷ respostas",
                                        },
                                    ]}
                                />
                                <DashboardWidget widgetId="mensagem_ativa.fluxo_resgate_leads">
                                    <ResgateLeadsCard
                                        history={activeMessages.history}
                                    />
                                </DashboardWidget>
                            </>
                        )}
                    </ManagementColumn>

                    <ManagementColumn
                        title="Avaliações"
                        icon={<CalendarCheck2 size={18} />}
                    >
                        {loadingSources.has("atendimento") && !executive ? (
                            <SummarySkeleton />
                        ) : errors.atendimento || !executive || !scheduleTotal ? (
                            <UnavailableCard
                                message={
                                    errors.atendimento ??
                                    "Dados de avaliações indisponíveis."
                                }
                            />
                        ) : (
                            <>
                                <SummaryCard
                                    title="Avaliações"
                                    mainLabel="Compareceu"
                                    mainValue={formatInteger(
                                        scheduleTotal.showed_up,
                                    )}
                                    rows={[
                                        {
                                            label: "Projeção",
                                            value: formatInteger(
                                                scheduleTotal.projection,
                                            ),
                                        },
                                        {
                                            label: "Cancelamento",
                                            value: formatInteger(
                                                scheduleTotal.cancelled,
                                            ),
                                        },
                                        {
                                            label: "Remarcações",
                                            value: formatInteger(
                                                scheduleTotal.reschedulings,
                                            ),
                                        },
                                    ]}
                                />
                                <DashboardWidget widgetId="atendimento.agendamentos_periodo">
                                    <ScheduleEvolutionCard data={executive} />
                                </DashboardWidget>
                            </>
                        )}
                    </ManagementColumn>

                    <ManagementColumn
                        title="Marcações"
                        icon={<CalendarPlus2 size={18} />}
                    >
                        {markingsLoading && !markings ? (
                            <SummarySkeleton />
                        ) : markingsError || !markings ? (
                            <UnavailableCard
                                message={
                                    markingsError ??
                                    "Dados de marcações indisponíveis."
                                }
                            />
                        ) : (
                            <SummaryCard
                                title="Marcações"
                                mainLabel="Total único"
                                mainValue={formatInteger(
                                    markings.total.unique_markings,
                                )}
                                rows={[
                                    {
                                        label: "Ontem",
                                        value: formatInteger(
                                            yesterdayMarkings,
                                        ),
                                    },
                                    {
                                        label: "Projeção",
                                        value: formatInteger(
                                            markings.total.unique_projection,
                                        ),
                                    },
                                ]}
                            />
                        )}

                        {loadingSources.has("atendimento") && !executive ? (
                            <Skeleton className="h-[360px] rounded-2xl" />
                        ) : executive ? (
                            <DashboardWidget widgetId="atendimento.marcacoes_dia">
                                <ScheduleCreationEvolutionCard
                                    data={executive}
                                />
                            </DashboardWidget>
                        ) : null}
                    </ManagementColumn>
                </div>
            </section>
        </main>
    );
}

function ManagementColumn({
    title,
    icon,
    children,
}: {
    title: string;
    icon: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-3 flex items-center gap-2 px-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm">
                    {icon}
                </span>
                <h2 className="text-sm font-bold text-slate-800">{title}</h2>
            </div>
            <div className="space-y-3">{children}</div>
        </section>
    );
}

function SummaryCard({
    title,
    mainLabel,
    mainValue,
    mainHint,
    rows,
}: {
    title: string;
    mainLabel: string;
    mainValue: string;
    mainHint?: string;
    rows: Array<{ label: string; value: string; hint?: string }>;
}) {
    return (
        <Card className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {title}
            </div>
            <div className="mt-4 text-xs font-medium text-slate-500">
                {mainLabel}
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                {mainValue}
            </div>
            {mainHint ? (
                <div className="mt-1 text-[11px] text-slate-400">
                    {mainHint}
                </div>
            ) : null}
            <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
                {rows.map((row) => (
                    <div
                        key={row.label}
                        className="flex items-start justify-between gap-3 py-3"
                    >
                        <div className="min-w-0">
                            <div className="text-xs text-slate-500">
                                {row.label}
                            </div>
                            {row.hint ? (
                                <div className="mt-0.5 text-[10px] leading-4 text-slate-400">
                                    {row.hint}
                                </div>
                            ) : null}
                        </div>
                        <div className="shrink-0 text-sm font-bold text-slate-800">
                            {row.value}
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}

function SummarySkeleton() {
    return <Skeleton className="h-[220px] rounded-2xl" />;
}

function UnavailableCard({ message }: { message: string }) {
    return (
        <Card>
            <div className="py-8 text-center text-sm text-slate-500">
                {message}
            </div>
        </Card>
    );
}

function summarizeResgate(history: HistoryItem[]) {
    let total = 0;
    let cost = 0;
    let completePricing = true;

    for (const item of history) {
        if (item.automation !== "resgate") continue;
        total += item.response_count;

        const templateCount = item.template_message_count ?? 0;
        if (templateCount <= 0) continue;

        const template = getActiveMessageTemplate(item.template_id);
        if (!template) {
            completePricing = false;
            continue;
        }

        cost +=
            templateCount *
            getActiveMessageTemplatePriceBrl(template.category);
    }

    return {
        total,
        costPerResgate:
            total > 0 && completePricing ? cost / total : null,
    };
}

function formatInteger(value: number | null | undefined) {
    return value === null || value === undefined
        ? "—"
        : Math.round(value).toLocaleString("pt-BR");
}

function formatCurrency(
    value: number | null | undefined,
    maximumFractionDigits = 0,
) {
    return value === null || value === undefined
        ? "—"
        : new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
              minimumFractionDigits:
                  maximumFractionDigits > 0
                      ? maximumFractionDigits
                      : 0,
              maximumFractionDigits,
          }).format(value);
}

function daysBetween(start: string, end: string) {
    return Math.max(
        1,
        Math.round(
            (Date.parse(`${end}T12:00:00Z`) -
                Date.parse(`${start}T12:00:00Z`)) /
                86_400_000,
        ) + 1,
    );
}
