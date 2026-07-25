// components/dashboard/FinancialDashboardExtras.tsx
"use client";

import {
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    Banknote,
    CalendarPlus2,
    Check,
    ChevronDown,
    HelpCircle,
    LoaderCircle,
} from "lucide-react";
import {
    Area,
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { Card, InfoTooltip, Skeleton } from "@/components";
import {
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import type { FinancialDashboardData } from "@/types";
import type {
    FinancialUnitRow,
    FinancialUnitSummaryData,
    ProcedureCategoryKey,
    ProcedureCityRow,
    RevenueComparisonData,
} from "@/types/financial-dashboard-extras";

const EMPTY_CATEGORIES: string[] = [];
const EMPTY_DATE_RANGE: DateRange = { start: null, end: null };

const PROCEDURE_SEGMENTS: {
    key: ProcedureCategoryKey;
    label: string;
    colorClass: string;
}[] = [
    {
        key: "first_evaluation",
        label: "1ª avaliação",
        colorClass: "bg-blue-500",
    },
    {
        key: "ivf",
        label: "FIV",
        colorClass: "bg-violet-500",
    },
    {
        key: "egg_freezing_cycle",
        label: "Crio",
        colorClass: "bg-cyan-500",
    },
    {
        key: "embryo_transfer",
        label: "TED + TOD",
        colorClass: "bg-pink-500",
    },
    {
        key: "storage",
        label: "Anuidade",
        colorClass: "bg-amber-500",
    },
    {
        key: "exams",
        label: "Exames",
        colorClass: "bg-emerald-500",
    },
    {
        key: "freezing",
        label: "Congelamento",
        colorClass: "bg-orange-500",
    },
    {
        key: "other",
        label: "Outros",
        colorClass: "bg-slate-400",
    },
];


type FinancialSummaryFilters = {
    unitIds: string[];
    categories?: string[];
    period?: CalendarPresetValue | null;
    selectedRange?: DateRange;
    enabled?: boolean;
};

export function useFinancialUnitSummary({
    unitIds,
    categories = EMPTY_CATEGORIES,
    period,
    selectedRange,
    enabled = true,
}: FinancialSummaryFilters) {
    const [data, setData] = useState<FinancialUnitSummaryData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled) {
            setData(null);
            setLoading(true);
            setError(null);
            return;
        }

        const controller = new AbortController();

        async function load() {
            setLoading(true);
            setError(null);

            try {
                const params = new URLSearchParams();
                if (unitIds.length > 0) params.set("unit_ids", unitIds.join(","));
                if (categories.length > 0) {
                    params.set("categories", categories.join(","));
                }
                if (period !== undefined || selectedRange !== undefined) {
                    applyCalendarDateParams({
                        params,
                        selectedRange: selectedRange ?? EMPTY_DATE_RANGE,
                        selectedPreset: period ?? null,
                    });
                }
                const response = await fetch(
                    `/api/dashboard/financeiro/unit-summary?${params.toString()}`,
                    { cache: "no-store", signal: controller.signal },
                );
                const json = (await response.json()) as
                    | FinancialUnitSummaryData
                    | { error?: string };

                if (!response.ok) {
                    throw new Error(
                        "error" in json && json.error
                            ? json.error
                            : "Falha ao carregar faturamento por unidade.",
                    );
                }

                setData(json as FinancialUnitSummaryData);
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Falha ao carregar faturamento por unidade.",
                );
                setData(null);
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        void load();
        return () => controller.abort();
    }, [
        enabled,
        unitIds,
        categories,
        period,
        selectedRange?.start,
        selectedRange?.end,
            ]);

    return { data, loading, error };
}

export function MonthlyProjectionKpiCard({
    currentValue,
    previousValue,
    projection,
    loading,
    freeWidth = false,
}: {
    currentValue: number;
    previousValue: number;
    projection: number | null;
    loading: boolean;
    freeWidth?: boolean;
}) {
    const trend = percentageChange(currentValue, previousValue);
    const tooltipText = projection === null
        ? `Valor exato: ${formatCurrency(currentValue)}`
        : `Valor exato: ${formatCurrency(currentValue)}\nProjeção: ${formatCurrency(projection)}`;
    const projectionTitle = projection === null
        ? "Projeção indisponível"
        : `Projeção ${formatCurrency(projection)}`;

    return (
        <Card
            className={
                freeWidth ? "h-full w-max min-w-[285px]" : "h-full"
            }
        >
            <div
                className={
                    freeWidth
                        ? "flex h-full w-max items-center gap-5"
                        : "flex h-full min-w-0 items-center gap-5"
                }
            >
                <div className="flex h-full items-center">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green-soft text-green">
                        <Banknote size={26} />
                    </div>
                </div>

                <div className={freeWidth ? "flex-none" : "min-w-0 flex-1"}>
                    <div className="whitespace-nowrap text-xs font-medium leading-tight text-muted">
                        <span>Faturamento autorizado</span>{" "}
                        <InfoTooltip
                            text={tooltipText}
                            portal
                            fitContent
                        >
                            <HelpCircle
                                size={13}
                                className="inline align-[-2px] text-slate-400"
                            />
                        </InfoTooltip>
                    </div>

                    <div className="mt-1 whitespace-nowrap text-3xl font-bold tracking-tight text-text">
                        {formatCompactCurrency(currentValue)}
                    </div>

                    <div
                        className={`mt-2 truncate text-xs font-semibold leading-tight ${
                            projection === null ? "text-slate-400" : "text-emerald-700"
                        }`}
                        title={projectionTitle}
                        aria-label={projectionTitle}
                    >
                        {loading
                            ? "Projeção —"
                            : projection === null
                              ? "Projeção —"
                              : `Projeção ${formatCompactProjection(projection)}`}
                    </div>

                    {trend !== null ? (
                        <div
                            className={`mt-1 text-[11px] font-medium leading-tight ${
                                trend >= 0 ? "text-green" : "text-red"
                            }`}
                        >
                            {trend >= 0 ? "↑" : "↓"} {formatAbsolutePercentage(trend)} vs. período anterior
                        </div>
                    ) : null}
                </div>
            </div>
        </Card>
    );
}

export function FinancialUnitTableCard({
    data,
    loading,
    error,
}: {
    data: FinancialUnitSummaryData | null;
    loading: boolean;
    error?: string | null;
}) {
    return (
        <Card className="w-full min-w-0 max-w-full overflow-hidden">
            <TableHeading title="Faturamento por unidade" />

            {loading ? (
                <TableSkeleton columns={13} />
            ) : data ? (
                <FinancialTable
                    rows={data.rows}
                    total={data.total}
                />
            ) : (
                <TableError message={error ?? "Sem dados financeiros no mês."} />
            )}
        </Card>
    );
}

export function ProcedureMixByCityCard({
    data,
    loading,
    error,
}: {
    data: FinancialUnitSummaryData | null;
    loading: boolean;
    error?: string | null;
}) {
    return (
        <Card className="w-full min-w-0">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold">
                        Procedimentos por cidade
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        O comprimento compara o volume total; as cores mostram
                        o mix de procedimentos.
                    </p>
                </div>

                <div className="flex max-w-[720px] flex-wrap justify-end gap-x-4 gap-y-2 text-[11px] text-slate-500">
                    {PROCEDURE_SEGMENTS.map((segment) => (
                        <div
                            key={segment.key}
                            className="flex items-center gap-1.5"
                        >
                            <span
                                className={`h-2.5 w-2.5 rounded-full ${segment.colorClass}`}
                            />
                            <span>{segment.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="space-y-4">
                    {Array.from({ length: 7 }).map((_, index) => (
                        <div
                            key={index}
                            className="grid grid-cols-[150px_minmax(0,1fr)_52px] items-center gap-4"
                        >
                            <Skeleton className="h-4 w-[110px]" />
                            <Skeleton className="h-9 w-full rounded-lg" />
                            <Skeleton className="h-4 w-10" />
                        </div>
                    ))}
                </div>
            ) : data ? (
                <ProcedureMixRows rows={data.procedures_by_city ?? []} />
            ) : (
                <TableError
                    message={error ?? "Sem procedimentos no período."}
                />
            )}
        </Card>
    );
}

function ProcedureMixRows({ rows }: { rows: ProcedureCityRow[] }) {
    const maxTotal = Math.max(1, ...rows.map((row) => row.total));

    return (
        <div className="space-y-4">
            {rows.map((row) => {
                const topProcedure = mostCommonProcedure(row);
                const barWidth =
                    row.total === 0
                        ? 0
                        : Math.max(3, (row.total / maxTotal) * 100);

                return (
                    <div
                        key={row.unit_id ?? row.unit_name}
                        className="grid grid-cols-[150px_minmax(0,1fr)_52px] items-center gap-4"
                    >
                        <div className="min-w-0">
                            <div
                                className="truncate text-sm font-semibold text-slate-700"
                                title={row.unit_name}
                            >
                                {row.unit_name}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] text-slate-400">
                                {topProcedure
                                    ? `${topProcedure.label}: ${formatInteger(
                                          topProcedure.value,
                                      )}`
                                    : "Sem procedimentos"}
                            </div>
                        </div>

                        <div className="h-9 overflow-hidden rounded-lg bg-slate-100">
                            <div
                                className="flex h-full min-w-0 overflow-hidden rounded-lg transition-[width] duration-300"
                                style={{ width: `${barWidth}%` }}
                            >
                                {row.total > 0
                                    ? PROCEDURE_SEGMENTS.map((segment) => {
                                          const value = row[segment.key];
                                          if (value <= 0) return null;

                                          return (
                                              <div
                                                  key={segment.key}
                                                  className={`${segment.colorClass} h-full min-w-[2px]`}
                                                  style={{
                                                      width: `${
                                                          (value / row.total) *
                                                          100
                                                      }%`,
                                                  }}
                                                  title={`${row.unit_name} · ${
                                                      segment.label
                                                  }: ${formatInteger(value)}`}
                                              />
                                          );
                                      })
                                    : null}
                            </div>
                        </div>

                        <div className="text-right text-sm font-bold text-slate-700">
                            {formatInteger(row.total)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function mostCommonProcedure(row: ProcedureCityRow) {
    return PROCEDURE_SEGMENTS.map((segment) => ({
        ...segment,
        value: row[segment.key],
    })).reduce<
        | (typeof PROCEDURE_SEGMENTS)[number] & { value: number }
        | null
    >((best, current) => {
        if (current.value <= 0) return best;
        if (!best || current.value > best.value) return current;
        return best;
    }, null);
}

export function RevenueEvolutionComparisonCard({
    data,
    unitIds,
    categories,
}: {
    data: FinancialDashboardData;
    unitIds: string[];
    categories: string[];
}) {
    const baseMonth = useMemo(() => dashboardBaseMonth(data), [data]);
    const options = useMemo(
        () => comparisonMonthOptions(12, baseMonth),
        [baseMonth],
    );
    const [comparisonMonth, setComparisonMonth] = useState("");
    const [comparison, setComparison] = useState<RevenueComparisonData | null>(
        null,
    );
    const [loadingComparison, setLoadingComparison] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        function closeMenu(event: MouseEvent) {
            if (
                menuRef.current &&
                event.target instanceof Node &&
                !menuRef.current.contains(event.target)
            ) {
                setMenuOpen(false);
            }
        }
        function closeWithEscape(event: KeyboardEvent) {
            if (event.key === "Escape") setMenuOpen(false);
        }

        document.addEventListener("mousedown", closeMenu);
        document.addEventListener("keydown", closeWithEscape);
        return () => {
            document.removeEventListener("mousedown", closeMenu);
            document.removeEventListener("keydown", closeWithEscape);
        };
    }, []);

    useEffect(() => {
        if (!comparisonMonth) {
            setComparison(null);
            return;
        }

        const controller = new AbortController();
        async function loadComparison() {
            setLoadingComparison(true);
            try {
                const params = new URLSearchParams({
                    month: comparisonMonth,
                    current_month: baseMonth,
                });
                if (unitIds.length > 0) params.set("unit_ids", unitIds.join(","));
                if (categories.length > 0) {
                    params.set("categories", categories.join(","));
                }
                const response = await fetch(
                    `/api/dashboard/financeiro/comparison?${params.toString()}`,
                    { cache: "no-store", signal: controller.signal },
                );
                const json = (await response.json()) as
                    | RevenueComparisonData
                    | { error?: string };
                if (!response.ok) {
                    throw new Error(
                        "error" in json && json.error
                            ? json.error
                            : "Falha ao carregar comparação.",
                    );
                }
                setComparison(json as RevenueComparisonData);
            } catch (error) {
                if (!controller.signal.aborted) {
                    console.error("[financeiro] comparison failed", error);
                    setComparison(null);
                }
            } finally {
                if (!controller.signal.aborted) setLoadingComparison(false);
            }
        }

        void loadComparison();
        return () => controller.abort();
    }, [comparisonMonth, baseMonth, unitIds, categories]);

    const chartData = useMemo(
        () => mergeComparisonEvolution(data.evolution, comparison),
        [data.evolution, comparison],
    );
    const selectedOption = options.find(
        (option) => option.value === comparisonMonth,
    );
    const currentInvoices = comparison
        ? comparison.current.authorized_invoices
        : data.kpis.authorized_invoices;

    function chooseMonth(value: string) {
        setComparisonMonth(value);
        setMenuOpen(false);
    }

    return (
        <Card>
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold">Evolução do faturamento</h2>
                        <InfoTooltip text="Valores de NFS-e autorizadas pela data de emissão. Cancelamentos aparecem separadamente e não reduzem silenciosamente a série autorizada. Ao comparar, o gráfico mostra o mês atual completo e sobrepõe o mês escolhido pelo mesmo dia do mês.">
                            <HelpCircle size={16} className="text-slate-400" />
                        </InfoTooltip>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                        {formatInteger(currentInvoices)} notas autorizadas {comparison ? `em ${capitalize(comparison.current.month_label)}` : "no período"}
                    </p>
                </div>

                <div ref={menuRef} className="relative">
                    <button
                        type="button"
                        onClick={() => setMenuOpen((open) => !open)}
                        className="flex min-w-[172px] items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-slate-800"
                        aria-haspopup="listbox"
                        aria-expanded={menuOpen}
                    >
                        <span className="flex min-w-0 items-center gap-2">
                            {loadingComparison ? (
                                <LoaderCircle size={15} className="shrink-0 animate-spin text-blue" />
                            ) : (
                                <CalendarPlus2 size={15} className="shrink-0 text-blue" />
                            )}
                            <span className="truncate">
                                {selectedOption?.label ?? "Comparar mês"}
                            </span>
                        </span>
                        <ChevronDown
                            size={14}
                            className={`shrink-0 text-slate-400 transition-transform ${
                                menuOpen ? "rotate-180" : ""
                            }`}
                        />
                    </button>

                    {menuOpen ? (
                        <div
                            className="absolute right-0 z-50 mt-2 w-[230px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.16)]"
                            role="listbox"
                            aria-label="Mês para comparação"
                        >
                            <button
                                type="button"
                                onClick={() => chooseMonth("")}
                                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
                                    comparisonMonth === ""
                                        ? "bg-blue-50 font-semibold text-blue"
                                        : "text-slate-600 hover:bg-slate-50"
                                }`}
                                role="option"
                                aria-selected={comparisonMonth === ""}
                            >
                                <span>Sem comparação</span>
                                {comparisonMonth === "" ? <Check size={15} /> : null}
                            </button>
                            <div className="my-1 border-t border-slate-100" />
                            <div className="max-h-[286px] overflow-y-auto pr-1">
                                {options.map((option) => {
                                    const selected = comparisonMonth === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => chooseMonth(option.value)}
                                            className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
                                                selected
                                                    ? "bg-blue-50 font-semibold text-blue"
                                                    : "text-slate-600 hover:bg-slate-50"
                                            }`}
                                            role="option"
                                            aria-selected={selected}
                                        >
                                            <span>{option.label}</span>
                                            {selected ? <Check size={15} /> : null}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-6 text-xs text-slate-500">
                <LegendItem color="#10b981" label="Faturamento autorizado" />
                <LegendItem color="#ef4444" label="Valor cancelado" />
                {comparison ? (
                    <LegendItem
                        color="#1683ff"
                        label={capitalize(comparison.comparison.month_label)}
                        dashed
                    />
                ) : null}
            </div>

            <div className="h-[300px]">
                {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                            <defs>
                                <linearGradient
                                    id="financialRevenueFill"
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                >
                                    <stop
                                        offset="5%"
                                        stopColor="#10b981"
                                        stopOpacity={0.25}
                                    />
                                    <stop
                                        offset="95%"
                                        stopColor="#10b981"
                                        stopOpacity={0}
                                    />
                                </linearGradient>
                            </defs>
                            <CartesianGrid
                                strokeDasharray="4 4"
                                stroke="#e2e8f0"
                            />
                            <XAxis
                                dataKey="label"
                                tick={{ fontSize: 12 }}
                                stroke="#94a3b8"
                                minTickGap={24}
                            />
                            <YAxis
                                tick={{ fontSize: 12 }}
                                stroke="#94a3b8"
                                tickFormatter={formatCompactCurrency}
                                width={72}
                            />
                            <Tooltip
                                content={
                                    <RevenueComparisonTooltip
                                        comparisonLabel={
                                            comparison
                                                ? capitalize(
                                                      comparison.comparison.month_label,
                                                  )
                                                : null
                                        }
                                    />
                                }
                            />
                            <Bar
                                dataKey="cancelled_amount"
                                fill="#ef4444"
                                opacity={0.35}
                                radius={[4, 4, 0, 0]}
                            />
                            <Area
                                type="monotone"
                                dataKey="authorized_revenue"
                                stroke="#10b981"
                                strokeWidth={3}
                                fill="url(#financialRevenueFill)"
                            />
                            {comparison ? (
                                <Line
                                    type="monotone"
                                    dataKey="comparison_authorized_revenue"
                                    stroke="#1683ff"
                                    strokeWidth={2.5}
                                    strokeDasharray="7 5"
                                    dot={false}
                                    connectNulls
                                />
                            ) : null}
                        </ComposedChart>
                    </ResponsiveContainer>
                ) : (
                    <TableError message="Nenhuma nota emitida no período." />
                )}
            </div>
        </Card>
    );
}

function FinancialTable({
    rows,
    total,
}: {
    rows: FinancialUnitRow[];
    total: FinancialUnitRow;
}) {
    const columns: {
        key: keyof FinancialUnitRow;
        label: string;
        emphasis?: boolean;
    }[] = [
        {
            key: "projection",
            label: "Projeção",
            emphasis: true,
        },
        { key: "total", label: "Total", emphasis: true },
        { key: "internal_doctors", label: "Médicos internos" },
        { key: "external_doctors", label: "Médicos externos" },
        { key: "first_evaluation", label: "1ª avaliação" },
        { key: "ivf", label: "FIV" },
        { key: "egg_freezing_cycle", label: "Crio OV." },
        { key: "embryo_transfer", label: "TED + TOD" },
        { key: "storage", label: "Anuidade" },
        { key: "exams", label: "Exames" },
        { key: "freezing", label: "Congelamento" },
        { key: "other", label: "Outros" },
    ];

    return (
        <div className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-xl pb-2">
            <table className="w-max min-w-[1500px] border-collapse text-xs">
                <thead className="bg-slate-50 text-slate-500">
                    <tr>
                        <th className="sticky left-0 z-20 bg-slate-50 px-3 py-3 text-left font-bold">
                            Unidade
                        </th>
                        {columns.map((column) => (
                            <th
                                key={column.key}
                                className="whitespace-nowrap px-3 py-3 text-right font-bold"
                            >
                                {column.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <FinancialRow
                            key={row.unit_id ?? row.unit_name}
                            row={row}
                            columns={columns}
                        />
                    ))}
                    <FinancialRow row={total} columns={columns} total />
                </tbody>
            </table>
        </div>
    );
}

function FinancialRow({
    row,
    columns,
    total = false,
}: {
    row: FinancialUnitRow;
    columns: {
        key: keyof FinancialUnitRow;
        label: string;
        emphasis?: boolean;
    }[];
    total?: boolean;
}) {
    return (
        <tr
            className={
                total
                    ? "border-t-2 border-slate-200 bg-slate-50 font-bold"
                    : "border-t border-slate-100 bg-white"
            }
        >
            <td
                className={`sticky left-0 z-10 whitespace-nowrap px-3 py-3 text-left font-medium text-slate-700 ${
                    total ? "bg-slate-50" : "bg-white"
                }`}
            >
                {row.unit_name}
            </td>
            {columns.map((column) => (
                <td
                    key={column.key}
                    className={`whitespace-nowrap px-3 py-3 text-right ${
                        column.emphasis
                            ? "font-semibold text-slate-800"
                            : "text-slate-600"
                    }`}
                >
                    {formatTableCurrency(Number(row[column.key] ?? 0))}
                </td>
            ))}
        </tr>
    );
}

function TableHeading({ title }: { title: string }) {
    return <h2 className="mb-5 text-lg font-bold text-slate-900">{title}</h2>;
}

function TableSkeleton({ columns }: { columns: number }) {
    return (
        <div className="overflow-hidden rounded-xl">
            <Skeleton className="h-11 w-full rounded-none" />
            {Array.from({ length: 7 }).map((_, row) => (
                <div
                    key={row}
                    className="flex gap-3 border-t border-slate-100 px-3 py-3"
                >
                    {Array.from({ length: columns }).map((__, column) => (
                        <Skeleton
                            key={column}
                            className={`${column === 0 ? "w-28" : "w-20"} h-4 shrink-0`}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

function TableError({ message }: { message: string }) {
    return (
        <div className="flex min-h-[150px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 text-center text-sm text-slate-400">
            {message}
        </div>
    );
}

function LegendItem({
    color,
    label,
    dashed = false,
}: {
    color: string;
    label: string;
    dashed?: boolean;
}) {
    return (
        <div className="flex items-center gap-2">
            <span
                className="h-0.5 w-4"
                style={{
                    backgroundColor: color,
                    backgroundImage: dashed
                        ? `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 8px)`
                        : undefined,
                }}
            />
            <span>{label}</span>
        </div>
    );
}

type ComparisonChartPoint = FinancialDashboardData["evolution"][number] & {
    comparison_authorized_revenue: number | null;
    comparison_label: string | null;
};

function mergeComparisonEvolution(
    current: FinancialDashboardData["evolution"],
    comparison: RevenueComparisonData | null,
): ComparisonChartPoint[] {
    if (!comparison) {
        return current.map((point) => ({
            ...point,
            comparison_authorized_revenue: null,
            comparison_label: null,
        }));
    }

    const comparisonByDay = new Map(
        comparison.comparison.evolution.map((point) => [point.label, point]),
    );

    return comparison.current.evolution.map((currentPoint) => {
        const comparisonPoint = comparisonByDay.get(currentPoint.label);
        return {
            period: currentPoint.period,
            label: currentPoint.label,
            authorized_revenue: currentPoint.authorized_revenue,
            cancelled_amount: currentPoint.cancelled_amount,
            authorized_invoices: currentPoint.authorized_invoices,
            average_ticket:
                currentPoint.authorized_invoices > 0
                    ? currentPoint.authorized_revenue /
                      currentPoint.authorized_invoices
                    : null,
            comparison_authorized_revenue:
                comparisonPoint?.authorized_revenue ?? null,
            comparison_label: comparisonPoint?.label ?? null,
        };
    });
}

function RevenueComparisonTooltip({
    active,
    payload,
    label,
    comparisonLabel,
}: {
    active?: boolean;
    payload?: { payload?: ComparisonChartPoint }[];
    label?: string;
    comparisonLabel: string | null;
}) {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload;
    if (!point) return null;

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
            <div className="mb-2 font-bold text-slate-700">{label}</div>
            <div className="space-y-1 text-slate-600">
                <div>Autorizado: {formatCurrency(point.authorized_revenue)}</div>
                <div>Cancelado: {formatCurrency(point.cancelled_amount)}</div>
                <div>Notas: {formatInteger(point.authorized_invoices)}</div>
                {comparisonLabel &&
                point.comparison_authorized_revenue !== null ? (
                    <div className="text-blue">
                        {comparisonLabel} · dia {point.comparison_label}: {formatCurrency(
                            point.comparison_authorized_revenue,
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function comparisonMonthOptions(count: number, baseMonth: string) {
    const [year, month] = baseMonth.split("-").map(Number);

    return Array.from({ length: count }, (_, index) => {
        const date = new Date(Date.UTC(year, month - 2 - index, 1));
        const value = date.toISOString().slice(0, 7);
        return {
            value,
            label: capitalize(
                new Intl.DateTimeFormat("pt-BR", {
                    month: "long",
                    year: "numeric",
                    timeZone: "America/Sao_Paulo",
                }).format(new Date(`${value}-01T12:00:00-03:00`)),
            ),
        };
    });
}

function dashboardBaseMonth(data: FinancialDashboardData) {
    const filteredEnd = data.filters.end_date?.slice(0, 7);
    if (filteredEnd && /^\d{4}-(0[1-9]|1[0-2])$/.test(filteredEnd)) {
        return filteredEnd;
    }

    const latestDailyPeriod = [...data.evolution]
        .reverse()
        .find((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.period))
        ?.period.slice(0, 7);
    return latestDailyPeriod ?? currentSaoPauloMonth();
}

function currentSaoPauloMonth() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}`;
}

function percentageChange(current: number, previous: number) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
        return null;
    }
    return ((current - previous) / previous) * 100;
}

function formatAbsolutePercentage(value: number) {
    return `${Math.abs(value).toLocaleString("pt-BR", {
        maximumFractionDigits: 1,
    })}%`;
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
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

function formatCompactProjection(value: number) {
    return new Intl.NumberFormat("pt-BR", {
        notation: "compact",
        maximumFractionDigits: 1,
    })
        .format(value)
        .replace(/\s+/g, "");
}

function formatTableCurrency(value: number) {
    return Math.round(value).toLocaleString("pt-BR", {
        maximumFractionDigits: 0,
    });
}

function formatInteger(value: number) {
    return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function capitalize(value: string) {
    return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

