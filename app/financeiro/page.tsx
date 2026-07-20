// app/financeiro/page.tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
    Ban,
    Banknote,
    CalendarCheck2,
    CircleDollarSign,
    HelpCircle,
    Layers3,
    Link2,
    Percent,
    ReceiptText,
    Users,
    WalletCards,
} from "lucide-react";
import {
    Area,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import {
    Card,
    DashboardHeader,
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
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import type {
    FiltersResponse,
    FinancialDashboardData,
} from "@/types";

const STATUS_COLORS: Record<string, string> = {
    authorized: "#10b981",
    cancelled: "#ef4444",
    pending: "#f59e0b",
    denied: "#8b5cf6",
    other: "#64748b",
};

const CATEGORY_COLOR = "#1683ff";

export default function FinancialDashboardPage() {
    const [data, setData] = useState<FinancialDashboardData | null>(null);
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasLoadedOnce = useRef(false);
    const [period, setPeriod] =
        useState<CalendarPresetValue | null>("30");
    const [selectedRange, setSelectedRange] = useState<DateRange>({
        start: null,
        end: null,
    });

    useEffect(() => {
        async function loadFilters() {
            try {
                const response = await fetch(
                    "/api/dashboard/filters?entities=units",
                );
                if (!response.ok) return;
                setFilters((await response.json()) as FiltersResponse);
            } catch (loadError) {
                console.error("[financeiro] filters failed", loadError);
            }
        }

        void loadFilters();
    }, []);

    useEffect(() => {
        async function loadDashboard() {
            if (hasLoadedOnce.current) setIsRefreshing(true);
            else setLoading(true);

            try {
                setError(null);
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

                const response = await fetch(
                    `/api/dashboard/financeiro?${params.toString()}`,
                    { cache: "no-store" },
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
            } catch (loadError) {
                console.error("[financeiro] dashboard failed", loadError);
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Falha ao carregar o Financeiro.",
                );
                setData(null);
            } finally {
                hasLoadedOnce.current = true;
                setLoading(false);
                setIsRefreshing(false);
            }
        }

        void loadDashboard();
    }, [unitIds, categories, period, selectedRange]);

    if (loading) {
        return (
            <main className="scrollbar-hide flex h-full w-full overflow-y-auto bg-white text-slate-900">
                <section className="min-w-0 flex-1 px-8 py-8">
                    <FinancialDashboardSkeleton />
                </section>
            </main>
        );
    }

    if (!data) {
        return (
            <main className="scrollbar-hide flex h-full w-full overflow-y-auto bg-white text-slate-900">
                <section className="flex min-w-0 flex-1 items-center justify-center px-8 py-8">
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

    return (
        <main className="scrollbar-hide flex h-full w-full overflow-y-auto bg-white text-slate-900">
            <section className="min-w-0 flex-1 px-8 py-8">
                <DashboardHeader
                    title="Financeiro"
                    description="Acompanhe faturamento, mix de serviços e eficiência comercial"
                    period={period}
                    setPeriod={setPeriod}
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                />

                <div className="mb-3 flex justify-end gap-3">
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
                </div>

                {isRefreshing ? (
                    <FinancialBodySkeleton />
                ) : (
                    <div className="overflow-x-hidden pb-12">
                        <KpiSection data={data} />

                        <section className="mb-6 grid grid-cols-[1.55fr_0.85fr] gap-5">
                            <EvolutionCard data={data} />
                            <StatusCard data={data} />
                        </section>

                        <section className="mb-6 grid grid-cols-[1fr_1.2fr] gap-5">
                            <CategoryCard data={data} />
                            <UnitCard data={data} />
                        </section>

                        <section className="grid grid-cols-2 gap-5">
                            <CrmCard data={data} />
                            <DoctorCard data={data} />
                        </section>
                    </div>
                )}
            </section>
        </main>
    );
}

function KpiSection({ data }: { data: FinancialDashboardData }) {
    return (
        <section className="mb-6 grid grid-cols-1 gap-5">
            <HorizontalScroller scrollAmount={420}>
                <KpiContainer>
                    <KpiCard
                        icon={<Banknote size={26} />}
                        label="Faturamento autorizado"
                        currentValue={data.kpis.authorized_revenue}
                        previousValue={data.previous_kpis.authorized_revenue}
                        formatter={formatCompactCurrency}
                        color="green"
                        tooltipText={`Valor exato: ${formatCurrency(
                            data.kpis.authorized_revenue,
                        )}`}
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
    return <div className="min-w-[285px]">{children}</div>;
}

function EvolutionCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle
                title="Evolução do faturamento"
                tooltip="Valores de NFS-e autorizadas pela data de emissão. Cancelamentos aparecem separadamente e não reduzem silenciosamente a série autorizada."
                subtitle={`${formatInteger(
                    data.kpis.authorized_invoices,
                )} notas autorizadas no período`}
            />

            <div className="mb-4 flex items-center gap-6 text-xs text-slate-500">
                <LegendDot color="#10b981" label="Faturamento autorizado" />
                <LegendDot color="#ef4444" label="Valor cancelado" />
            </div>

            <div className="h-[300px]">
                {data.evolution.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data.evolution}>
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
                            <Tooltip content={<EvolutionTooltip />} />
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
                        </ComposedChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState message="Nenhuma nota emitida no período." />
                )}
            </div>
        </Card>
    );
}

function StatusCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle
                title="Status fiscal"
                tooltip="Cancelamento negado ou rejeitado permanece como nota válida e entra em autorizadas. Pendentes e negadas são exibidas separadamente."
                subtitle="Situação atual consolidada por fatura"
            />

            {data.by_status.length > 0 ? (
                <div className="grid grid-cols-[155px_1fr] items-center gap-4">
                    <div className="relative h-[210px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={data.by_status}
                                    dataKey="invoices"
                                    nameKey="label"
                                    innerRadius={48}
                                    outerRadius={76}
                                    paddingAngle={2}
                                >
                                    {data.by_status.map((item) => (
                                        <Cell
                                            key={item.status}
                                            fill={STATUS_COLORS[item.status]}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(value) => [
                                        formatInteger(Number(value)),
                                        "Notas",
                                    ]}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-xl font-bold text-slate-800">
                                {formatInteger(data.audit.invoices_in_period)}
                            </span>
                            <span className="text-xs text-slate-500">notas</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {data.by_status.map((item) => (
                            <div key={item.status}>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span
                                            className="h-3 w-3 shrink-0 rounded-full"
                                            style={{
                                                backgroundColor:
                                                    STATUS_COLORS[item.status],
                                            }}
                                        />
                                        <span className="truncate text-slate-600">
                                            {item.label}
                                        </span>
                                    </div>
                                    <span className="font-semibold text-slate-700">
                                        {formatPercentage(item.percentage)}
                                    </span>
                                </div>
                                <p className="ml-5 mt-1 text-xs text-slate-400">
                                    {formatInteger(item.invoices)} · {formatCurrency(item.amount)}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <EmptyState message="Nenhum status fiscal no período." />
            )}
        </Card>
    );
}

function CategoryCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle
                title="Mix de faturamento"
                tooltip="Participação de cada grupo de procedimento apenas no faturamento autorizado. As categorias são consolidadas a partir da descrição do CliniSys."
                subtitle="Quais serviços sustentam o faturamento"
            />

            <div className="h-[335px]">
                {data.by_category.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={data.by_category}
                            layout="vertical"
                            margin={{ left: 8, right: 16 }}
                            barCategoryGap="24%"
                        >
                            <CartesianGrid
                                strokeDasharray="4 4"
                                stroke="#e2e8f0"
                                horizontal={false}
                            />
                            <XAxis
                                type="number"
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                                tickFormatter={formatCompactCurrency}
                            />
                            <YAxis
                                type="category"
                                dataKey="label"
                                width={148}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                            />
                            <Tooltip content={<CategoryTooltip />} cursor={false} />
                            <Bar
                                dataKey="revenue"
                                fill={CATEGORY_COLOR}
                                radius={[0, 7, 7, 0]}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState message="Nenhuma categoria faturada no período." />
                )}
            </div>
        </Card>
    );
}

function UnitCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle
                title="Visão por unidade"
                tooltip="Faturamento, ticket e cancelamento vêm das NFS-e. Agendamentos vêm da agenda CliniSys no mesmo período e servem como contexto operacional."
                subtitle="Desempenho financeiro e volume de agenda"
            />

            {data.by_unit.length > 0 ? (
                <div className="max-h-[335px] overflow-y-auto rounded-xl">
                    <div className="sticky top-0 grid grid-cols-[1.1fr_1fr_0.75fr_0.7fr_0.7fr] gap-3 bg-slate-50 px-3 py-3 text-xs font-bold text-slate-500">
                        <div>Unidade</div>
                        <div>Faturamento</div>
                        <div>Ticket</div>
                        <div>Cancel.</div>
                        <div>Agenda</div>
                    </div>

                    {data.by_unit.map((unit) => (
                        <div
                            key={unit.unit_id ?? unit.unit_name}
                            className="grid grid-cols-[1.1fr_1fr_0.75fr_0.7fr_0.7fr] items-center gap-3 border-t border-slate-100 px-3 py-3 text-sm"
                        >
                            <div className="truncate font-medium text-slate-700">
                                {unit.unit_name}
                            </div>
                            <div className="font-semibold text-slate-700">
                                {formatCurrency(unit.revenue)}
                            </div>
                            <div className="text-slate-600">
                                {formatNullableCurrency(unit.average_ticket)}
                            </div>
                            <div className="text-slate-600">
                                {formatPercentage(unit.cancellation_rate)}
                            </div>
                            <div className="text-slate-600">
                                {formatInteger(unit.schedules)}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <EmptyState message="Nenhuma unidade faturou no período." />
            )}
        </Card>
    );
}

function CrmCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle
                title="Conexão com o CRM"
                tooltip="O vínculo usa o telefone do paciente no CliniSys para localizar o cliente no Hub. Com origem mede a parcela do faturamento autorizado atribuída ao último canal conhecido. Agenda + fatura mede clientes agendados que também tiveram uma NFS-e autorizada no mesmo período."
                subtitle="Quanto do faturamento pode ser relacionado à jornada comercial"
            />

            <div className="mb-6 grid grid-cols-3 gap-3">
                <MiniMetric
                    icon={<Link2 size={17} />}
                    label="Receita vinculada"
                    value={formatPercentage(data.crm.linked_revenue_coverage)}
                />
                <MiniMetric
                    icon={<CircleDollarSign size={17} />}
                    label="Com origem"
                    value={formatPercentage(data.crm.attribution_coverage)}
                />
                <MiniMetric
                    icon={<CalendarCheck2 size={17} />}
                    label="Agenda + fatura"
                    value={formatPercentage(data.crm.schedule_to_billing_rate)}
                />
            </div>

            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">
                    Faturamento por origem
                </h3>
                <span className="text-xs text-slate-400">
                    {formatCurrency(data.crm.attributed_revenue)} atribuído
                </span>
            </div>

            {data.crm.by_origin.length > 0 ? (
                <div className="space-y-4">
                    {data.crm.by_origin.map((origin) => (
                        <div key={origin.origin}>
                            <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                                <span className="truncate font-medium text-slate-600">
                                    {origin.origin}
                                </span>
                                <span className="shrink-0 font-semibold text-slate-700">
                                    {formatCurrency(origin.revenue)}
                                </span>
                            </div>
                            <PercentageBar
                                value={origin.percentage ?? 0}
                                color="blue"
                            />
                        </div>
                    ))}
                </div>
            ) : (
                <EmptyState message="Nenhuma origem atribuída neste período." />
            )}
        </Card>
    );
}

function DoctorCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle
                title="Faturamento por médico"
                tooltip="Ranking pelo valor das NFS-e autorizadas associadas ao médico na fonte CliniSys. Não representa remuneração ou margem médica."
                subtitle="Participação no faturamento autorizado"
            />

            {data.by_doctor.length > 0 ? (
                <div className="space-y-4">
                    {data.by_doctor.map((doctor, index) => (
                        <div
                            key={doctor.doctor_name}
                            className="grid grid-cols-[26px_minmax(0,1fr)_125px] items-center gap-3"
                        >
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-soft text-xs font-bold text-purple">
                                {index + 1}
                            </span>
                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                                    <span className="truncate font-medium text-slate-600">
                                        {doctor.doctor_name}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                        {formatInteger(doctor.invoices)} notas
                                    </span>
                                </div>
                                <PercentageBar
                                    value={doctor.percentage ?? 0}
                                    color="purple"
                                />
                            </div>
                            <span className="text-right text-sm font-semibold text-slate-700">
                                {formatCurrency(doctor.revenue)}
                            </span>
                        </div>
                    ))}
                </div>
            ) : (
                <EmptyState message="Nenhum médico associado no período." />
            )}
        </Card>
    );
}

function CardTitle({
    title,
    tooltip,
    subtitle,
}: {
    title: string;
    tooltip: string;
    subtitle?: string;
}) {
    return (
        <div className="mb-5">
            <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{title}</h2>
                <InfoTooltip text={tooltip}>
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
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

function EvolutionTooltip({
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

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
            <div className="mb-2 font-bold text-slate-700">{label}</div>
            <div className="space-y-1 text-slate-600">
                <div>
                    Autorizado: {formatCurrency(Number(values.authorized_revenue ?? 0))}
                </div>
                <div>
                    Cancelado: {formatCurrency(Number(values.cancelled_amount ?? 0))}
                </div>
                <div>
                    Notas: {formatInteger(Number(values.authorized_invoices ?? 0))}
                </div>
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
            <section className="mb-6 grid grid-cols-[1.55fr_0.85fr] gap-5">
                <Card>
                    <Skeleton className="mb-5 h-6 w-[38%]" />
                    <Skeleton className="h-[300px] w-full" />
                </Card>
                <Card>
                    <Skeleton className="mb-5 h-6 w-[45%]" />
                    <Skeleton className="mx-auto h-[210px] w-[210px] rounded-full" />
                </Card>
            </section>
            <section className="mb-6 grid grid-cols-[1fr_1.2fr] gap-5">
                <Card>
                    <Skeleton className="mb-5 h-6 w-[45%]" />
                    <Skeleton className="h-[335px] w-full" />
                </Card>
                <Card>
                    <Skeleton className="mb-5 h-6 w-[38%]" />
                    <Skeleton className="h-[335px] w-full" />
                </Card>
            </section>
            <section className="grid grid-cols-2 gap-5">
                <Card>
                    <Skeleton className="mb-5 h-6 w-[42%]" />
                    <Skeleton className="h-[300px] w-full" />
                </Card>
                <Card>
                    <Skeleton className="mb-5 h-6 w-[42%]" />
                    <Skeleton className="h-[300px] w-full" />
                </Card>
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

function formatNullableCurrency(value: number | null) {
    return value === null ? "—" : formatCurrency(value);
}

function formatCompactCurrency(value: number) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(value);
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
