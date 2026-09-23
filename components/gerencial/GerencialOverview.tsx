"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    Banknote,
    CalendarCheck2,
    CalendarPlus2,
    Megaphone,
} from "lucide-react";
import {
    Area,
    AreaChart,
    ResponsiveContainer,
    Tooltip,
} from "recharts";

import { Card, Skeleton } from "@/components";
import { usePersonalDashboardSources } from "@/components/personal-dashboard/usePersonalDashboardSources";
import {
    applyArrayParams,
    applyCalendarDateParams,
    getDateStringWithOffset,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import {
    getActiveMessageTemplate,
    getActiveMessageTemplatePriceBrl,
} from "@/lib/active-messages/templates";
import type { DashboardWidgetDefinition } from "@/lib/personal-dashboard/registry";
import { getDashboardWidget } from "@/lib/personal-dashboard/registryExtended";
import type {
    ExecutiveDashboardData,
    FinancialDashboardData,
} from "@/types";

const EMPTY_FILTER_VALUES: string[] = [];
const GERENCIAL_DATA_WIDGETS = [
    "financeiro.faturamento_autorizado",
    "atendimento.agendamentos_periodo",
    "mensagem_ativa.fluxo_resgate_leads",
]
    .map(getDashboardWidget)
    .filter(
        (widget): widget is DashboardWidgetDefinition => widget !== null,
    );

type Props = {
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
    unitIds: string[];
    ready?: boolean;
};

type MarkingsData = {
    total: {
        unique_markings: number;
        unique_projection: number;
    };
};

type ActiveMessageHistoryItem = {
    template_id: string;
    sent_count: number;
    template_message_count?: number;
    response_count: number;
    automation: string | null;
};

type ActiveMessageAnalyticsData = {
    history: ActiveMessageHistoryItem[];
};

type MetricRow = {
    label: string;
    value: string;
};

type OutcomeRow = {
    label: string;
    value: number;
    color: string;
};

type MiniTooltipPayloadItem = {
    value?: number | string;
    payload?: Record<string, unknown>;
};

export default function GerencialOverview({
    period,
    selectedRange,
    unitIds,
    ready = true,
}: Props) {
    const [markings, setMarkings] = useState<MarkingsData | null>(null);
    const [markingsLoading, setMarkingsLoading] = useState(true);
    const [markingsError, setMarkingsError] = useState<string | null>(null);

    const { data, loadingSources, errors } = usePersonalDashboardSources({
        definitions: GERENCIAL_DATA_WIDGETS,
        ready,
        period,
        selectedRange,
        unitIds,
        attendantIds: EMPTY_FILTER_VALUES,
        tunnelValues: EMPTY_FILTER_VALUES,
        originValues: EMPTY_FILTER_VALUES,
        categories: EMPTY_FILTER_VALUES,
        eventValues: EMPTY_FILTER_VALUES,
        platformValues: EMPTY_FILTER_VALUES,
        statusValues: EMPTY_FILTER_VALUES,
        eventSourceValues: EMPTY_FILTER_VALUES,
    });

    const dateWindow = useMemo(() => {
        if (!ready) return null;

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
        period,
        ready,
        selectedRange.end,
        selectedRange.start,
    ]);

    useEffect(() => {
        if (!ready) return;

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
                if (!controller.signal.aborted) {
                    setMarkingsLoading(false);
                }
            });

        return () => controller.abort();
    }, [
        period,
        ready,
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

    const financialLoading =
        loadingSources.has("financeiro") && !financial;
    const atendimentoLoading =
        loadingSources.has("atendimento") && !executive;
    const activeMessagesLoading =
        loadingSources.has("mensagem_ativa") && !activeMessages;

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <OverviewColumn
                title="Financeiro"
                icon={<Banknote size={18} />}
                accent="var(--color-green)"
                soft="var(--color-green-soft)"
            >
                {financialLoading ? (
                    <ColumnSkeleton />
                ) : errors.financeiro || !financial ? (
                    <UnavailableCard
                        message={
                            errors.financeiro ??
                            "Dados financeiros indisponíveis."
                        }
                    />
                ) : (
                    <>
                        <MetricCard
                            eyebrow="Faturamento"
                            label="Faturamento total"
                            value={formatCurrency(financialTotal)}
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
                        <ProjectionProgressCard
                            current={financialTotal}
                            projection={financialProjection}
                            formatter={formatCurrency}
                            accent="var(--color-green)"
                        />
                        <MiniAreaCard
                            title="Ritmo de faturamento"
                            subtitle="Evolução no período selecionado"
                            data={financial.evolution}
                            dataKey="authorized_revenue"
                            valueLabel="Faturamento"
                            valueKind="currency"
                            stroke="var(--color-green)"
                            fill="var(--color-green-soft)"
                        />
                    </>
                )}
            </OverviewColumn>

            <OverviewColumn
                title="Marketing"
                icon={<Megaphone size={18} />}
                accent="var(--color-blue)"
                soft="var(--color-blue-soft)"
            >
                {financialLoading ? (
                    <ColumnSkeleton />
                ) : errors.financeiro || !financial ? (
                    <UnavailableCard
                        message={
                            errors.financeiro ??
                            "Dados de marketing indisponíveis."
                        }
                    />
                ) : (
                    <>
                        <MetricCard
                            eyebrow="Investimento"
                            label="Investimento total"
                            value={formatCurrency(
                                financial.ads.kpis.spend,
                            )}
                            rows={[
                                {
                                    label: "Meta",
                                    value: formatCurrency(metaInvestment),
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
                        <PlatformSpendCard
                            data={financial.ads.evolution}
                        />
                    </>
                )}

                {activeMessagesLoading ? (
                    <ColumnSkeleton compact />
                ) : errors.mensagem_ativa || !activeMessages ? (
                    <UnavailableCard
                        message={
                            errors.mensagem_ativa ??
                            "Dados do Fluxo de Resgate indisponíveis."
                        }
                    />
                ) : (
                    <LeadRescueCard
                        total={resgate.total}
                        sent={resgate.sent}
                        responseRate={resgate.responseRate}
                        costPerResgate={resgate.costPerResgate}
                    />
                )}
            </OverviewColumn>

            <OverviewColumn
                title="Avaliações"
                icon={<CalendarCheck2 size={18} />}
                accent="var(--color-purple)"
                soft="var(--color-purple-soft)"
            >
                {atendimentoLoading ? (
                    <ColumnSkeleton />
                ) : errors.atendimento ||
                  !executive ||
                  !scheduleTotal ? (
                    <UnavailableCard
                        message={
                            errors.atendimento ??
                            "Dados de avaliações indisponíveis."
                        }
                    />
                ) : (
                    <>
                        <MetricCard
                            eyebrow="Avaliações"
                            label="Compareceu"
                            value={formatInteger(
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
                        <OutcomeCard
                            rows={[
                                {
                                    label: "Compareceu",
                                    value: scheduleTotal.showed_up,
                                    color: "var(--color-green)",
                                },
                                {
                                    label: "Cancelou",
                                    value: scheduleTotal.cancelled,
                                    color: "var(--color-red)",
                                },
                                {
                                    label: "Remarcou",
                                    value: scheduleTotal.reschedulings,
                                    color: "var(--color-purple)",
                                },
                                {
                                    label: "Faltou",
                                    value: scheduleTotal.no_show,
                                    color: "var(--color-orange)",
                                },
                            ]}
                        />
                        <MiniAreaCard
                            title="Volume de avaliações"
                            subtitle="Consultas previstas por dia"
                            data={executive.schedule_evolution}
                            dataKey="total"
                            valueLabel="Avaliações"
                            valueKind="integer"
                            stroke="var(--color-purple)"
                            fill="var(--color-purple-soft)"
                        />
                    </>
                )}
            </OverviewColumn>

            <OverviewColumn
                title="Marcações"
                icon={<CalendarPlus2 size={18} />}
                accent="var(--color-orange)"
                soft="var(--color-orange-soft)"
            >
                {markingsLoading && !markings ? (
                    <ColumnSkeleton />
                ) : markingsError || !markings ? (
                    <UnavailableCard
                        message={
                            markingsError ??
                            "Dados de marcações indisponíveis."
                        }
                    />
                ) : (
                    <>
                        <MetricCard
                            eyebrow="Marcações"
                            label="Total único"
                            value={formatInteger(
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
                        <ProjectionProgressCard
                            current={markings.total.unique_markings}
                            projection={markings.total.unique_projection}
                            formatter={formatInteger}
                            accent="var(--color-orange)"
                        />
                    </>
                )}

                {atendimentoLoading ? (
                    <ColumnSkeleton compact />
                ) : errors.atendimento || !executive ? (
                    <UnavailableCard
                        message={
                            errors.atendimento ??
                            "Evolução de marcações indisponível."
                        }
                    />
                ) : (
                    <MiniAreaCard
                        title="Marcações por dia"
                        subtitle="Ritmo de novas marcações"
                        data={executive.schedule_creation_evolution}
                        dataKey="total"
                        valueLabel="Marcações"
                        valueKind="integer"
                        stroke="var(--color-orange)"
                        fill="var(--color-orange-soft)"
                    />
                )}
            </OverviewColumn>
        </div>
    );
}

function OverviewColumn({
    title,
    icon,
    accent,
    soft,
    children,
}: {
    title: string;
    icon: ReactNode;
    accent: string;
    soft: string;
    children: ReactNode;
}) {
    return (
        <section className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-3 flex items-center gap-2 px-1">
                <span
                    className="flex h-8 w-8 items-center justify-center rounded-xl"
                    style={{
                        backgroundColor: soft,
                        color: accent,
                    }}
                >
                    {icon}
                </span>
                <h2 className="text-sm font-bold text-slate-800">
                    {title}
                </h2>
            </div>
            <div className="space-y-3">{children}</div>
        </section>
    );
}

function MetricCard({
    eyebrow,
    label,
    value,
    rows,
}: {
    eyebrow: string;
    label: string;
    value: string;
    rows: MetricRow[];
}) {
    return (
        <Card className="min-w-0 p-4 md:p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                {eyebrow}
            </div>
            <div className="mt-3 text-xs font-medium text-slate-500">
                {label}
            </div>
            <div className="mt-1 break-words text-2xl font-bold tracking-tight text-slate-950">
                {value}
            </div>
            <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
                {rows.map((row) => (
                    <div
                        key={row.label}
                        className="flex items-center justify-between gap-2 py-2.5"
                    >
                        <span className="text-xs text-slate-500">
                            {row.label}
                        </span>
                        <span className="text-sm font-bold text-slate-800">
                            {row.value}
                        </span>
                    </div>
                ))}
            </div>
        </Card>
    );
}

function MiniAreaCard({
    title,
    subtitle,
    data,
    dataKey,
    valueLabel,
    valueKind,
    stroke,
    fill,
}: {
    title: string;
    subtitle: string;
    data: ReadonlyArray<object>;
    dataKey: string;
    valueLabel: string;
    valueKind: "currency" | "integer";
    stroke: string;
    fill: string;
}) {
    return (
        <Card className="min-w-0 p-4 md:p-4">
            <div className="text-xs font-bold text-slate-800">
                {title}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
                {subtitle}
            </div>
            {data.length > 0 ? (
                <div
                    className="mt-3 h-[96px] w-full"
                    aria-label={title}
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                            data={[...data]}
                            margin={{
                                top: 5,
                                right: 2,
                                bottom: 0,
                                left: 2,
                            }}
                        >
                            <Tooltip
                                content={
                                    <MiniAreaTooltip
                                        valueLabel={valueLabel}
                                        valueKind={valueKind}
                                    />
                                }
                                cursor={{
                                    stroke: "#cbd5e1",
                                    strokeDasharray: "3 3",
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey={dataKey}
                                stroke={stroke}
                                fill={fill}
                                strokeWidth={2}
                                fillOpacity={0.75}
                                dot={false}
                                activeDot={{ r: 3 }}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <MiniEmpty />
            )}
        </Card>
    );
}

function PlatformSpendCard({
    data,
}: {
    data: FinancialDashboardData["ads"]["evolution"];
}) {
    return (
        <Card className="min-w-0 p-4 md:p-4">
            <div className="text-xs font-bold text-slate-800">
                Investimento por plataforma
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
                Meta e Google Ads no período
            </div>
            <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
                <LegendDot
                    color="var(--color-blue)"
                    label="Meta"
                />
                <LegendDot
                    color="var(--color-orange)"
                    label="Google"
                />
            </div>
            {data.length > 0 ? (
                <div
                    className="mt-2 h-[96px] w-full"
                    aria-label="Investimento por plataforma"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                            data={data}
                            margin={{
                                top: 5,
                                right: 2,
                                bottom: 0,
                                left: 2,
                            }}
                        >
                            <Tooltip
                                content={<PlatformSpendTooltip />}
                                cursor={{
                                    stroke: "#cbd5e1",
                                    strokeDasharray: "3 3",
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey="meta_spend"
                                stackId="spend"
                                stroke="var(--color-blue)"
                                fill="var(--color-blue-soft)"
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 3 }}
                                isAnimationActive={false}
                            />
                            <Area
                                type="monotone"
                                dataKey="google_spend"
                                stackId="spend"
                                stroke="var(--color-orange)"
                                fill="var(--color-orange-soft)"
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 3 }}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <MiniEmpty />
            )}
        </Card>
    );
}

function ProjectionProgressCard({
    current,
    projection,
    formatter,
    accent,
}: {
    current: number | null | undefined;
    projection: number | null | undefined;
    formatter: (value: number | null | undefined) => string;
    accent: string;
}) {
    const validProjection =
        typeof projection === "number" && projection > 0;
    const validCurrent = typeof current === "number";
    const percentage =
        validProjection && validCurrent
            ? (current / projection) * 100
            : null;
    const remaining =
        validProjection && validCurrent
            ? Math.max(projection - current, 0)
            : null;
    const progress = Math.max(
        0,
        Math.min(100, percentage ?? 0),
    );

    return (
        <Card className="min-w-0 p-4 md:p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-xs font-bold text-slate-800">
                        Progresso da projeção
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                        Realizado em relação à projeção
                    </div>
                </div>
                <div className="shrink-0 text-sm font-bold text-slate-800">
                    {percentage === null
                        ? "—"
                        : `${percentage.toLocaleString("pt-BR", {
                              maximumFractionDigits: 1,
                          })}%`}
                </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                    className="h-full rounded-full"
                    style={{
                        width: `${progress}%`,
                        backgroundColor: accent,
                    }}
                />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-slate-500">
                <span>Atual: {formatter(current)}</span>
                <span>Falta: {formatter(remaining)}</span>
            </div>
        </Card>
    );
}

function MiniAreaTooltip({
    active,
    payload,
    valueLabel,
    valueKind,
}: {
    active?: boolean;
    payload?: MiniTooltipPayloadItem[];
    valueLabel: string;
    valueKind: "currency" | "integer";
}) {
    if (!active || !payload?.length) return null;

    const row = payload[0]?.payload ?? {};
    const label = String(
        row.label ?? row.date ?? row.period ?? "",
    );
    const value = Number(payload[0]?.value ?? 0);

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            {label ? (
                <div className="mb-3 text-sm font-semibold text-slate-800">
                    {label}
                </div>
            ) : null}
            <div className="flex items-center justify-between gap-6 text-sm">
                <span className="text-slate-600">{valueLabel}</span>
                <span className="font-semibold text-slate-800">
                    {valueKind === "currency"
                        ? formatCurrency(value)
                        : formatInteger(value)}
                </span>
            </div>
        </div>
    );
}

function PlatformSpendTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: MiniTooltipPayloadItem[];
}) {
    if (!active || !payload?.length) return null;

    const row = payload[0]?.payload ?? {};
    const label = String(row.label ?? row.period ?? "");
    const metaSpend = Number(row.meta_spend ?? 0);
    const googleSpend = Number(row.google_spend ?? 0);

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
            {label ? (
                <div className="mb-2 font-bold text-slate-700">
                    {label}
                </div>
            ) : null}
            <div className="space-y-1 text-slate-600">
                <div>Meta Ads: {formatCurrency(metaSpend)}</div>
                <div>Google Ads: {formatCurrency(googleSpend)}</div>
                <div>
                    Investimento: {formatCurrency(metaSpend + googleSpend)}
                </div>
            </div>
        </div>
    );
}

function LegendDot({
    color,
    label,
}: {
    color: string;
    label: string;
}) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
            />
            {label}
        </span>
    );
}

function LeadRescueCard({
    total,
    sent,
    responseRate,
    costPerResgate,
}: {
    total: number;
    sent: number;
    responseRate: number | null;
    costPerResgate: number | null;
}) {
    const progress = Math.max(
        0,
        Math.min(100, responseRate ?? 0),
    );

    return (
        <Card className="min-w-0 p-4 md:p-4">
            <div className="text-xs font-bold text-slate-800">
                Fluxo de Resgate de Leads
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">
                        Total resgatado
                    </div>
                    <div className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                        {formatInteger(total)}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-[10px] text-slate-400">
                        Custo / resgate
                    </div>
                    <div className="mt-1 text-sm font-bold text-slate-800">
                        {formatCurrency(costPerResgate, 2)}
                    </div>
                </div>
            </div>

            <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-500">
                    <span>{formatInteger(sent)} enviados</span>
                    <span>
                        {responseRate === null
                            ? "—"
                            : `${responseRate.toLocaleString("pt-BR", {
                                  maximumFractionDigits: 1,
                              })}% responderam`}
                    </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                        className="h-full rounded-full"
                        style={{
                            width: `${progress}%`,
                            backgroundColor: "var(--color-blue)",
                        }}
                    />
                </div>
            </div>
        </Card>
    );
}

function OutcomeCard({ rows }: { rows: OutcomeRow[] }) {
    const max = Math.max(1, ...rows.map((row) => row.value));

    return (
        <Card className="min-w-0 p-4 md:p-4">
            <div className="text-xs font-bold text-slate-800">
                Resultado das avaliações
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
                Distribuição dos desfechos observados
            </div>
            <div className="mt-4 space-y-3">
                {rows.map((row) => (
                    <div key={row.label}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                            <span className="text-slate-500">
                                {row.label}
                            </span>
                            <span className="font-bold text-slate-700">
                                {formatInteger(row.value)}
                            </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                                className="h-full rounded-full"
                                style={{
                                    width: `${Math.max(
                                        4,
                                        (row.value / max) * 100,
                                    )}%`,
                                    backgroundColor: row.color,
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}

function ColumnSkeleton({ compact = false }: { compact?: boolean }) {
    return (
        <Skeleton
            className={`${
                compact ? "h-[150px]" : "h-[220px]"
            } rounded-2xl`}
        />
    );
}

function UnavailableCard({ message }: { message: string }) {
    return (
        <Card className="p-4 md:p-4">
            <div className="py-5 text-center text-xs text-slate-500">
                {message}
            </div>
        </Card>
    );
}

function MiniEmpty() {
    return (
        <div className="mt-3 flex h-[96px] items-center justify-center rounded-xl bg-slate-50 text-[10px] text-slate-400">
            Sem dados no período
        </div>
    );
}

function summarizeResgate(history: ActiveMessageHistoryItem[]) {
    let total = 0;
    let sent = 0;
    let cost = 0;
    let completePricing = true;

    for (const item of history) {
        if (item.automation !== "resgate") continue;

        total += item.response_count;
        sent += item.sent_count;

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
        sent,
        responseRate: sent > 0 ? (total / sent) * 100 : null,
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
