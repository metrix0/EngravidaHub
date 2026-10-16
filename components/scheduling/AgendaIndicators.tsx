// components/scheduling/AgendaIndicators.tsx
"use client";
import { useState } from "react";
import { CalendarCheck2, CalendarDays, ChartNoAxesCombined, ChevronDown, ChevronUp, Clock3, LockKeyhole, UsersRound } from "lucide-react";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import { AGENDA_COLORS } from "@/lib/scheduling/bookingOrigin";
import type { AgendaCounts, OperationalAgendaReport } from "@/lib/scheduling/operationalAgenda";

export const AGENDA_NOTE_COLOR = "#facc15";
export const percent = (value: number | null) => value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export function AgendaCountTable({ rows }: { rows: Array<AgendaCounts & { unitName: string }> }) {
    return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-muted"><tr>{["Unidade", "Total", "Disponíveis", "Em aberto", "AG RA", "AG Unidade", "Sem origem", "Bloqueados", "Ocupação", "Ocup. RA", "Ocup. Unidade"].map(label => <th key={label} className="whitespace-nowrap px-3 py-3 font-bold">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.unitName} className="border-t border-slate-100"><td className="whitespace-nowrap px-3 py-3 font-semibold">{row.unitName}</td>{[row.total, row.available, row.open, row.ra, row.unit, row.unknown, row.blocked, percent(row.occupancy), percent(row.raOccupancy), percent(row.unitOccupancy)].map((value, index) => <td key={index} className="px-3 py-3 tabular-nums">{value}</td>)}</tr>)}</tbody></table></div>;
}
export function AgendaLegend() {
    return <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-slate-600">{([["available", "Disponível"], ["ra", "Agendado RA"], ["unit", "Agendado Unidade"], ["blocked", "Férias / bloqueio"], ["open", "Em aberto (passado)"], ["unknown", "Origem não identificada"]] as const).map(([key, label]) => <span key={key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: AGENDA_COLORS[key] }} />{label}</span>)}<span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: AGENDA_NOTE_COLOR }} />Notas</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-600" />Agendamentos agrupados</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#94a3b8" }} />Cancelado</span></div>;
}
const number = (value: number) => value.toLocaleString("pt-BR");
const formatReportDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const barWidth = (value: number, total: number) =>
    total > 0 ? String(Math.max(0, Math.min(100, (value / total) * 100))) + "%" : "0%";
const percentWidth = (value: number | null) =>
    String(Math.max(0, Math.min(100, value ?? 0))) + "%";

export default function AgendaIndicators({ report, loading }: { report: OperationalAgendaReport | null; loading: boolean }) {
    const [unitsOpen, setUnitsOpen] = useState(false);
    const [projectionOpen, setProjectionOpen] = useState(false);

    if (!report) {
        return loading ? <div className="space-y-3"><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" /></div> : null;
    }

    const { counts } = report;
    const booked = counts.ra + counts.unit + counts.unknown;
    const periodEnd = new Date(`${report.end}T12:00:00Z`);
    periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);
    const historicalBase = report.previousMonths.reduce((total, month) => total + month.total - month.blocked, 0);
    const historicalRa = report.previousMonths.reduce((total, month) => total + month.ra, 0);
    const historicalUnit = report.previousMonths.reduce((total, month) => total + month.unit, 0);
    const historicalRatesAvailable = historicalBase > 0 && !report.projection.unknown;
    const summary = [
        { label: "Total de vagas", value: counts.total, icon: CalendarDays, tone: "bg-brand-soft text-brand" },
        { label: "Disponíveis", value: counts.available, icon: CalendarCheck2, tone: "bg-green-soft text-green" },
        { label: "Agendadas", value: booked, icon: UsersRound, tone: "bg-blue-soft text-blue" },
        { label: "Bloqueadas", value: counts.blocked, icon: LockKeyhole, tone: "bg-red-soft text-red" },
    ];
    const distribution = [
        { key: "ra", label: "Agendado RA", value: counts.ra },
        { key: "unit", label: "Agendado Unidade", value: counts.unit },
        { key: "available", label: "Disponíveis", value: counts.available },
        { key: "open", label: "Em aberto", value: counts.open },
        { key: "blocked", label: "Bloqueados", value: counts.blocked },
        { key: "unknown", label: "Sem origem", value: counts.unknown },
    ] as const;
    const teamOccupancy = [
        { label: "Ocupação RA", value: counts.raOccupancy, color: AGENDA_COLORS.ra },
        { label: "Ocupação Unidade", value: counts.unitOccupancy, color: AGENDA_COLORS.unit },
    ];

    return (
        <div className={["space-y-5 pb-3", loading ? "pointer-events-none opacity-50" : ""].join(" ")} aria-busy={loading}>
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Visão geral</p>
                <p className="mt-1 text-sm text-slate-500">Capacidade e agendamentos do período</p>
                <p className="mt-1 text-xs text-muted">{formatReportDate(report.start)} a {formatReportDate(periodEnd.toISOString().slice(0, 10))} (Semana)</p>
            </div>

            <Card className="!p-5">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><ChartNoAxesCombined size={21} /></span>
                        <div className="min-w-0">
                            <h3 className="text-sm font-bold text-slate-900">Ocupação geral</h3>
                            <p className="mt-0.5 text-xs text-muted">Das vagas não bloqueadas</p>
                        </div>
                    </div>
                    <span className="shrink-0 text-3xl font-bold tracking-tight tabular-nums text-slate-950">{percent(counts.occupancy)}</span>
                </div>
                <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Ocupação geral" aria-valuenow={counts.occupancy ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: percentWidth(counts.occupancy) }} />
                </div>
                <p className="mt-2.5 text-xs text-muted">{counts.occupancy === null ? "Sem capacidade útil para calcular a ocupação." : number(booked) + " vagas agendadas no período"}</p>
            </Card>

            <div className="grid grid-cols-2 gap-3">
                {summary.map(item => {
                    const Icon = item.icon;
                    return (
                        <div key={item.label} className="min-w-0 rounded-2xl border border-border bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                            <span className={["flex h-9 w-9 items-center justify-center rounded-xl", item.tone].join(" ")}><Icon size={18} /></span>
                            <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums text-slate-950">{number(item.value)}</div>
                            <div className="mt-0.5 text-xs font-medium text-muted">{item.label}</div>
                            {item.label === "Disponíveis" ? <p className="mt-1 text-[11px] text-green">A partir de hoje</p> : null}
                        </div>
                    );
                })}
            </div>

            <Card className="!p-4 md:!p-5">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-slate-900">Distribuição das vagas</h3>
                    <span className="text-xs font-medium tabular-nums text-muted">{number(counts.total)} no total</span>
                </div>
                <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Distribuição de vagas por status">
                    {distribution.map(item => (
                        <div key={item.key} title={item.label + ": " + number(item.value)} style={{ width: barWidth(item.value, counts.total), backgroundColor: AGENDA_COLORS[item.key] }} />
                    ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                    {distribution.map(item => (
                        <div key={item.key} className="flex min-w-0 items-start justify-between gap-2 text-xs">
                            <span className="flex min-w-0 items-start gap-1.5 text-slate-600"><span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: AGENDA_COLORS[item.key] }} /><span>{item.label}</span></span>
                            <span className="shrink-0 font-bold tabular-nums text-slate-900">{number(item.value)}</span>
                        </div>
                    ))}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                    {teamOccupancy.map(item => (
                        <div key={item.label} className="min-w-0 rounded-xl border border-border bg-white px-3 py-3">
                            <p className="text-[11px] font-medium leading-4 text-muted">{item.label}</p>
                            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{percent(item.value)}</p>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full" style={{ width: percentWidth(item.value), backgroundColor: item.color }} /></div>
                        </div>
                    ))}
                </div>
                {counts.unknown > 0 ? <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-muted">{number(counts.unknown)} vagas ocupadas com origem não identificada; incluídas na ocupação total.</p> : null}
            </Card>

            <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0 rounded-xl border border-border bg-white p-4">
                    <span className="flex items-center gap-2 text-xs font-medium leading-4 text-muted"><Clock3 size={15} className="shrink-0" />Em aberto (não preenchidos)</span>
                    <p className="mt-2 text-xl font-bold tabular-nums text-slate-900">{number(counts.open)}</p>
                    <p className="mt-1 text-[11px] leading-4 text-muted">Horários passados sem agendamento</p>
                </div>
                <div className="min-w-0 rounded-xl border border-border bg-white p-4" title="Média dos seis meses anteriores com capacidade, calculada pelas agendas sincronizadas e suas datas de vigência.">
                    <span className="flex items-center gap-2 text-xs font-medium leading-4 text-muted"><CalendarDays size={15} className="shrink-0" />Média meses anteriores</span>
                    <p className="mt-2 text-xl font-bold tabular-nums text-slate-900">{report.averagePreviousMonths === null ? "—" : number(report.averagePreviousMonths)}</p>
                </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                <section>
                    <button type="button" onClick={() => setProjectionOpen(value => !value)} aria-expanded={projectionOpen} className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-slate-50">
                        <span className="min-w-0"><span className="block text-sm font-bold text-slate-900">Projeção do mês</span><span className="mt-0.5 block text-xs text-muted">Estimativa com base no histórico</span></span>
                        {projectionOpen ? <ChevronUp size={18} className="shrink-0 text-slate-400" /> : <ChevronDown size={18} className="shrink-0 text-slate-400" />}
                    </button>
                    {projectionOpen ? (
                        <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-4">
                            <p className="text-xs font-semibold text-slate-600">Projeção {report.projection.month}</p>
                            <p className="text-xs leading-relaxed text-muted">Baseado em {report.projection.historicalMonths} meses anteriores. Taxa RA {historicalRatesAvailable ? percent(historicalRa / historicalBase * 100) : "—"} · Unidade {historicalRatesAvailable ? percent(historicalUnit / historicalBase * 100) : "—"}</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-xl bg-blue-soft p-3"><p className="text-xs text-blue">RA</p><p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{report.projection.ra === null ? "—" : number(report.projection.ra)}</p></div>
                                <div className="rounded-xl bg-purple-soft p-3"><p className="text-xs text-purple">Unidade</p><p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{report.projection.unit === null ? "—" : number(report.projection.unit)}</p></div>
                            </div>
                            <p className="text-xs font-medium text-slate-600">Base: {number(report.projection.base)} vagas úteis</p>
                            <p className="text-xs leading-relaxed text-muted">{report.projection.unknown ? "A projeção por equipe aguarda a identificação da origem dos agendamentos históricos." : "Estimativa com base nas agendas sincronizadas."}</p>
                        </div>
                    ) : null}
                </section>
                <section className="border-t border-slate-100">
                    <button type="button" onClick={() => setUnitsOpen(value => !value)} aria-expanded={unitsOpen} className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-slate-50">
                        <span className="min-w-0"><span className="block text-sm font-bold text-slate-900">Métricas por unidade</span><span className="mt-0.5 block text-xs text-muted">{report.byUnit.length} {report.byUnit.length === 1 ? "unidade" : "unidades"}</span></span>
                        {unitsOpen ? <ChevronUp size={18} className="shrink-0 text-slate-400" /> : <ChevronDown size={18} className="shrink-0 text-slate-400" />}
                    </button>
                    {unitsOpen ? (
                        <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-3">
                            {report.byUnit.length === 0 ? <p className="px-2 py-3 text-sm text-muted">Nenhuma unidade encontrada.</p> : null}
                            {report.byUnit.map(row => (
                                <div key={row.unitId} className="rounded-xl border border-border bg-white p-3.5">
                                    <div className="flex items-start justify-between gap-3"><h4 className="min-w-0 text-sm font-bold text-slate-900">{row.unitName}</h4><span className="shrink-0 text-sm font-bold tabular-nums text-brand">{percent(row.occupancy)}</span></div>
                                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-brand" style={{ width: percentWidth(row.occupancy) }} /></div>
                                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                                        {([
                                            ["Total", row.total], ["Disponíveis", row.available],
                                            ["Em aberto", row.open], ["AG RA", row.ra],
                                            ["AG Unidade", row.unit], ["Sem origem", row.unknown],
                                            ["Bloqueados", row.blocked], ["Ocupação", percent(row.occupancy)],
                                            ["Ocupação RA", percent(row.raOccupancy)], ["Ocupação Unidade", percent(row.unitOccupancy)],
                                        ] as const).map(([label, value]) => (
                                            <div key={label} className="min-w-0">
                                                <dt className="text-[11px] leading-4 text-muted">{label}</dt>
                                                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{typeof value === "number" ? number(value) : value}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </section>
            </div>
        </div>
    );
}
