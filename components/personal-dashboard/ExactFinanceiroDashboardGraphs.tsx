"use client";

import { CalendarCheck2, CircleDollarSign, HelpCircle, Link2 } from "lucide-react";
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

import { Card, InfoTooltip, PercentageBar } from "@/components";
import {
    ProcedureMixByCityCard,
    RevenueEvolutionComparisonCard,
} from "@/components/dashboard/FinancialDashboardExtras";
import type { FinancialDashboardData } from "@/types";
import type { FinancialUnitSummaryData } from "@/types/financial-dashboard-extras";

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

type Props = {
    widgetId: string;
    data: FinancialDashboardData;
    summary: FinancialUnitSummaryData | null;
    unitIds: string[];
    categories: string[];
};

export default function ExactFinanceiroDashboardGraphs({
    widgetId,
    data,
    summary,
    unitIds,
    categories,
}: Props) {
    switch (widgetId) {
        case "financeiro.evolucao_faturamento":
            return <RevenueEvolutionComparisonCard data={data} unitIds={unitIds} categories={categories} />;
        case "financeiro.status_fiscal":
            return <StatusCard data={data} />;
        case "financeiro.faturamento_12_meses":
            return <TwelveMonthRevenueCard data={data} />;
        case "financeiro.faturamento_procedimento":
            return <CategoryCard data={data} />;
        case "financeiro.procedimentos_cidade":
            return <ProcedureMixByCityCard data={summary} loading={false} />;
        case "financeiro.faturamento_origem":
            return <CrmCard data={data} />;
        case "financeiro.faturamento_medico":
            return <DoctorCard data={data} />;
        case "financeiro.investimento_receita_midia":
            return <AdsEvolutionCard data={data} />;
        case "financeiro.roas_plataforma":
            return <AdsPlatformRoasCard data={data} />;
        case "financeiro.retorno_cidade":
            return <PaidCityReturnCard data={data} />;
        default:
            return null;
    }
}

function StatusCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle
                title="Status fiscal"
                tooltip="Cancelamento negado ou rejeitado permanece como nota válida e entra em autorizadas. Pendentes e negadas são exibidas separadamente."
            />
            {data.by_status.length > 0 ? (
                <div className="grid grid-cols-[155px_1fr] items-center gap-4">
                    <div className="relative h-[210px]">
                        <ResponsiveContainer width="100%" height="100%" debounce={200}>
                            <PieChart>
                                <Pie data={data.by_status} dataKey="invoices" nameKey="label" innerRadius={48} outerRadius={76} paddingAngle={2}>
                                    {data.by_status.map((item) => (
                                        <Cell key={item.status} fill={STATUS_COLORS[item.status]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value: number | string) => [formatInteger(Number(value)), "Notas"]} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-xl font-bold text-slate-800">{formatInteger(data.audit.invoices_in_period)}</span>
                            <span className="text-xs text-slate-500">notas</span>
                        </div>
                    </div>
                    <div className="space-y-3">
                        {data.by_status.map((item) => (
                            <div key={item.status}>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLORS[item.status] }} />
                                        <span className="truncate text-slate-600">{item.label}</span>
                                    </div>
                                    <span className="font-semibold text-slate-700">{formatPercentage(item.percentage)}</span>
                                </div>
                                <p className="ml-5 mt-1 text-xs text-slate-400">{formatInteger(item.invoices)} · {formatCurrency(item.amount)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            ) : <EmptyState message="Nenhum status fiscal no período." />}
        </Card>
    );
}

function TwelveMonthRevenueCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle title="Faturamento e investimento — 12 meses" />
            <div className="mb-4 flex flex-wrap items-center gap-5 text-xs text-slate-500">
                <LegendDot color="#1683ff" label="Faturamento autorizado" />
                <LegendDot color="#d97706" label="Investimento em mídia" />
            </div>
            <div className="h-[335px]">
                {data.twelve_month_trend.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <ComposedChart data={data.twelve_month_trend} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                            <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={0} tickFormatter={(value) => formatMonthName(String(value))} />
                            <YAxis yAxisId="revenue" tick={{ fontSize: 10 }} stroke="#1683ff" tickFormatter={formatCompactCurrency} width={58} />
                            <YAxis yAxisId="investment" orientation="right" tick={{ fontSize: 10 }} stroke="#d97706" tickFormatter={formatCompactCurrency} width={58} />
                            <Tooltip content={<TwelveMonthRevenueTooltip />} />
                            <Bar yAxisId="revenue" dataKey="revenue" fill="#1683ff" radius={[5, 5, 0, 0]} isAnimationActive={false} />
                            <Line yAxisId="investment" type="monotone" dataKey="investment" stroke="#d97706" strokeWidth={3} dot={{ r: 3, fill: "#d97706" }} isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                ) : <EmptyState message="Nenhum histórico disponível." />}
            </div>
        </Card>
    );
}

function CategoryCard({ data }: { data: FinancialDashboardData }) {
    const chartHeight = Math.min(335, Math.max(210, data.by_category.length * 44 + 42));
    return (
        <Card>
            <CardTitle title="Faturamento por procedimento" />
            <div style={{ height: chartHeight }}>
                {data.by_category.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <BarChart data={data.by_category} layout="vertical" margin={{ left: 0, right: 20 }} barCategoryGap="24%">
                            <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={formatCompactCurrency} />
                            <YAxis type="category" dataKey="label" width={124} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                            <Tooltip content={<CategoryTooltip />} cursor={false} />
                            <Bar dataKey="revenue" fill={CATEGORY_COLOR} radius={[0, 7, 7, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : <EmptyState message="Nenhuma categoria faturada no período." />}
            </div>
        </Card>
    );
}

function CrmCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle
                title="Faturamento por Origem"
                tooltip="Receita vinculada: fatura ligada ao cliente. Agenda + fatura: cliente com os dois no período."
                subtitle="Quanto do faturamento pode ser relacionado à jornada comercial"
            />
            <div className="mb-6 grid grid-cols-3 gap-3">
                <MiniMetric icon={<Link2 size={17} />} label="Receita vinculada" value={formatPercentage(data.crm.linked_revenue_coverage)} />
                <MiniMetric icon={<CircleDollarSign size={17} />} label="Com origem" value={formatPercentage(data.crm.attribution_coverage)} />
                <MiniMetric icon={<CalendarCheck2 size={17} />} label="Agenda + fatura" value={formatPercentage(data.crm.schedule_to_billing_rate)} />
            </div>
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">Faturamento por origem</h3>
                <span className="text-xs text-slate-400">{formatCurrency(data.crm.attributed_revenue)} atribuído</span>
            </div>
            {data.crm.by_origin.length > 0 ? (
                <div className="space-y-4">
                    {data.crm.by_origin.map((origin) => (
                        <div key={origin.origin}>
                            <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                                <span className="truncate font-medium text-slate-600">{origin.origin}</span>
                                <span className="shrink-0 font-semibold text-slate-700">{formatCurrency(origin.revenue)}</span>
                            </div>
                            <PercentageBar value={origin.percentage ?? 0} color="blue" />
                        </div>
                    ))}
                </div>
            ) : <EmptyState message="Nenhuma origem atribuída neste período." />}
        </Card>
    );
}

function DoctorCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle title="Faturamento por médico" subtitle="Participação no faturamento autorizado" />
            {data.by_doctor.length > 0 ? (
                <div className="space-y-4">
                    {data.by_doctor.map((doctor, index) => (
                        <div key={doctor.doctor_name} className="grid grid-cols-[26px_minmax(0,1fr)_125px] items-center gap-3">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-soft text-xs font-bold text-purple">{index + 1}</span>
                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                                    <span className="truncate font-medium text-slate-600">{doctor.doctor_name}</span>
                                    <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">{formatInteger(doctor.invoices)} notas</span>
                                </div>
                                <PercentageBar value={doctor.percentage ?? 0} color="purple" />
                            </div>
                            <span className="text-right text-sm font-semibold text-slate-700">{formatCurrency(doctor.revenue)}</span>
                        </div>
                    ))}
                </div>
            ) : <EmptyState message="Nenhum médico associado no período." />}
        </Card>
    );
}

function AdsEvolutionCard({ data }: { data: FinancialDashboardData }) {
    return (
        <Card>
            <CardTitle title="Investimento x receita atribuída" />
            <div className="mb-4 flex flex-wrap items-center gap-5 text-xs text-slate-500">
                <LegendDot color={AD_PLATFORM_COLORS.google_ads} label="Google Ads" />
                <LegendDot color={AD_PLATFORM_COLORS.meta_ads} label="Meta Ads" />
                {data.ads.comparison_available ? <LegendDot color="#10b981" label="Receita atribuída" /> : null}
            </div>
            <div className="h-[310px]">
                {data.ads.evolution.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <ComposedChart data={data.ads.evolution}>
                            <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" minTickGap={24} />
                            <YAxis yAxisId="spend" tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={formatCompactCurrency} width={66} />
                            {data.ads.comparison_available ? <YAxis yAxisId="revenue" orientation="right" tick={{ fontSize: 11 }} stroke="#10b981" tickFormatter={formatCompactCurrency} width={66} /> : null}
                            <Tooltip content={<AdsEvolutionTooltip />} />
                            <Bar yAxisId="spend" dataKey="google_spend" stackId="spend" fill={AD_PLATFORM_COLORS.google_ads} radius={[0, 0, 0, 0]} />
                            <Bar yAxisId="spend" dataKey="meta_spend" stackId="spend" fill={AD_PLATFORM_COLORS.meta_ads} radius={[4, 4, 0, 0]} />
                            {data.ads.comparison_available ? <Line yAxisId="revenue" type="monotone" dataKey="attributed_revenue" stroke="#10b981" strokeWidth={3} dot={false} /> : null}
                        </ComposedChart>
                    </ResponsiveContainer>
                ) : <EmptyState message="Nenhum investimento no período." />}
            </div>
        </Card>
    );
}

function AdsPlatformRoasCard({ data }: { data: FinancialDashboardData }) {
    const chartData = data.ads.by_platform.map((platform) => ({
        platform: platform.label,
        spend: platform.spend,
        attributed_revenue: platform.attributed_revenue,
        roas: platform.return_on_spend,
    }));
    return (
        <Card>
            <CardTitle title="ROAS por Plataforma" />
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                <LegendDot color="#94a3b8" label="Investimento" />
                <LegendDot color="#10b981" label="Receita atribuída" />
                <LegendDot color="#d97706" label="ROAS" />
            </div>
            {chartData.length > 0 ? (
                <div className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <ComposedChart data={chartData} margin={{ top: 18, right: 18, bottom: 0, left: 6 }}>
                            <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                            <XAxis dataKey="platform" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                            <YAxis yAxisId="money" tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={formatCompactCurrency} />
                            <YAxis yAxisId="roas" orientation="right" tick={{ fontSize: 11 }} stroke="#d97706" tickFormatter={(value) => `${value}x`} />
                            <Tooltip content={<AdsPlatformRoasTooltip />} />
                            <Bar yAxisId="money" dataKey="spend" fill="#94a3b8" radius={[5, 5, 0, 0]} />
                            <Bar yAxisId="money" dataKey="attributed_revenue" fill="#10b981" radius={[5, 5, 0, 0]} />
                            <Line yAxisId="roas" type="monotone" dataKey="roas" stroke="#d97706" strokeWidth={3} dot={{ r: 5, fill: "#d97706" }} connectNulls={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            ) : <EmptyState message="Nenhuma plataforma com dados no período." />}
        </Card>
    );
}

function PaidCityReturnCard({ data }: { data: FinancialDashboardData }) {
    const rows = data.ads.by_city
        .filter((row) => row.spend > 0 || row.attributed_revenue > 0)
        .sort((first, second) => second.spend - first.spend || second.attributed_revenue - first.attributed_revenue);
    return (
        <Card>
            <CardTitle
                title="Retorno real da mídia por cidade"
                tooltip="Cruza a verba das campanhas identificadas pelo nome da cidade com notas autorizadas de clientes que possuem Origem, UTM ou ID de clique pago. Uma interação orgânica posterior não apaga a evidência paga."
            />
            {rows.length === 0 ? <EmptyState message="Sem investimento ou receita paga atribuída para comparar neste período." /> : (
                <>
                    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                        <LegendDot color="#94a3b8" label="Investimento" />
                        <LegendDot color="#10b981" label="Receita atribuída" />
                        <LegendDot color="#d97706" label="ROAS real" />
                    </div>
                    <div className="h-[360px] w-full min-w-0">
                        <ResponsiveContainer width="100%" height="100%" debounce={200}>
                            <ComposedChart data={rows} margin={{ top: 18, right: 26, bottom: 18, left: 8 }}>
                                <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                                <XAxis dataKey="city" tick={{ fontSize: 11 }} stroke="#94a3b8" interval={0} angle={-18} textAnchor="end" height={58} />
                                <YAxis yAxisId="money" tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={formatCompactCurrency} />
                                <YAxis yAxisId="roas" orientation="right" tick={{ fontSize: 11 }} stroke="#d97706" tickFormatter={(value) => `${value}x`} />
                                <Tooltip content={<PaidCityReturnTooltip />} />
                                <Bar yAxisId="money" dataKey="spend" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                                <Bar yAxisId="money" dataKey="attributed_revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                                <Line yAxisId="roas" type="monotone" dataKey="real_roas" stroke="#d97706" strokeWidth={3} dot={{ r: 4, fill: "#d97706" }} connectNulls={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}
        </Card>
    );
}

function CardTitle({ title, tooltip, subtitle }: { title: string; tooltip?: string; subtitle?: string }) {
    return (
        <div className="mb-5">
            <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{title}</h2>
                {tooltip ? <InfoTooltip text={tooltip}><HelpCircle size={16} className="text-slate-400" /></InfoTooltip> : null}
            </div>
            {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
    );
}
function MiniMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return <div className="rounded-xl bg-slate-50 px-3 py-3"><div className="flex items-center gap-2 text-slate-500">{icon}<span className="text-[11px] font-medium">{label}</span></div><div className="mt-2 text-xl font-bold text-slate-800">{value}</div></div>;
}
function LegendDot({ color, label }: { color: string; label: string }) { return <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} /><span>{label}</span></div>; }
function EmptyState({ message }: { message: string }) { return <div className="flex h-full min-h-[150px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 text-center text-sm text-slate-400">{message}</div>; }

function TwelveMonthRevenueTooltip({ active, payload, label }: TooltipProps) {
    if (!active || !payload?.length) return null;
    const values = new Map(payload.map((item) => [item.dataKey, Number(item.value ?? 0)]));
    return <TooltipBox title={label ? formatMonthName(label, "long") : ""} rows={[["Faturamento autorizado", formatCurrency(values.get("revenue") ?? 0)], ["Investimento em mídia", formatCurrency(values.get("investment") ?? 0)]]} />;
}
function CategoryTooltip({ active, payload }: TooltipProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as { label?: string; revenue?: number; invoices?: number; percentage?: number | null } | undefined;
    if (!row) return null;
    return <TooltipBox title={row.label ?? ""} rows={[["Faturamento", formatCurrency(row.revenue ?? 0)], ["Notas", formatInteger(row.invoices ?? 0)], ["Participação", formatPercentage(row.percentage)]]} />;
}
function AdsEvolutionTooltip({ active, payload, label }: TooltipProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as Record<string, unknown> | undefined;
    if (!row) return null;
    return <TooltipBox title={label ?? ""} rows={[["Google Ads", formatCurrency(Number(row.google_spend ?? 0))], ["Meta Ads", formatCurrency(Number(row.meta_spend ?? 0))], ["Investimento", formatCurrency(Number(row.google_spend ?? 0) + Number(row.meta_spend ?? 0))], ...(typeof row.attributed_revenue === "number" ? [["Receita atribuída", formatCurrency(row.attributed_revenue)] as [string,string]] : [])]} />;
}
function AdsPlatformRoasTooltip({ active, payload, label }: TooltipProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as Record<string, unknown> | undefined;
    if (!row) return null;
    return <TooltipBox title={label ?? ""} rows={[["Investimento", formatCurrency(Number(row.spend ?? 0))], ["Receita atribuída", formatCurrency(Number(row.attributed_revenue ?? 0))], ["ROAS", formatMultiple(typeof row.roas === "number" ? row.roas : null)]]} />;
}
function PaidCityReturnTooltip({ active, payload, label }: TooltipProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as Record<string, unknown> | undefined;
    if (!row) return null;
    return <TooltipBox title={label ?? ""} rows={[["Investimento", formatCurrency(Number(row.spend ?? 0))], ["Receita atribuída", formatCurrency(Number(row.attributed_revenue ?? 0))], ["ROAS real", formatMultiple(typeof row.real_roas === "number" ? row.real_roas : null)]]} />;
}
type TooltipProps = { active?: boolean; payload?: Array<{ dataKey?: string; value?: number | string; payload?: Record<string, unknown> }>; label?: string };
function TooltipBox({ title, rows }: { title: string; rows: Array<[string,string]> }) {
    return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs shadow-lg"><div className="mb-2 text-sm font-bold text-slate-800">{title}</div><div className="space-y-1.5 text-slate-600">{rows.map(([key,value]) => <div key={key} className="flex items-center justify-between gap-6"><span>{key}</span><strong className="text-slate-700">{value}</strong></div>)}</div></div>;
}

function formatInteger(value: number) { return value.toLocaleString("pt-BR"); }
function formatCurrency(value: number) { return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function formatPercentage(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`; }
function formatMultiple(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`; }
function formatCompactCurrency(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatMonthName(value: string, month: "short" | "long" = "short") {
    const [year, monthValue] = value.split("-").map(Number);
    if (!year || !monthValue) return value;
    return new Intl.DateTimeFormat("pt-BR", { month, year: month === "long" ? "numeric" : undefined, timeZone: "UTC" }).format(new Date(Date.UTC(year, monthValue - 1, 1)));
}
