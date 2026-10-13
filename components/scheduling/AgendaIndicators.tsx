// components/scheduling/AgendaIndicators.tsx
"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import { AGENDA_COLORS } from "@/lib/scheduling/bookingOrigin";
import type { AgendaCounts, OperationalAgendaReport } from "@/lib/scheduling/operationalAgenda";

export const percent = (value: number | null) => value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export function AgendaCountTable({ rows }: { rows: Array<AgendaCounts & { unitName: string }> }) {
    return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-muted"><tr>{["Unidade", "Total", "Disponíveis", "Em aberto", "AG RA", "AG Unidade", "Sem origem", "Bloqueados", "Ocupação", "Ocup. RA", "Ocup. Unidade"].map(label => <th key={label} className="whitespace-nowrap px-3 py-3 font-bold">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.unitName} className="border-t border-slate-100"><td className="whitespace-nowrap px-3 py-3 font-semibold">{row.unitName}</td>{[row.total, row.available, row.open, row.ra, row.unit, row.unknown, row.blocked, percent(row.occupancy), percent(row.raOccupancy), percent(row.unitOccupancy)].map((value, index) => <td key={index} className="px-3 py-3 tabular-nums">{value}</td>)}</tr>)}</tbody></table></div>;
}
export function AgendaLegend() {
    return <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-slate-600">{([["available", "Disponível"], ["ra", "Agendado RA"], ["unit", "Agendado Unidade"], ["blocked", "Férias / bloqueio"], ["open", "Em aberto (passado)"], ["unknown", "Origem não identificada"]] as const).map(([key, label]) => <span key={key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: AGENDA_COLORS[key] }} />{label}</span>)}</div>;
}
export default function AgendaIndicators({ report, loading }: { report: OperationalAgendaReport | null; loading: boolean }) {
    const [unitsOpen, setUnitsOpen] = useState(false), [projectionOpen, setProjectionOpen] = useState(false);
    if (!report) return loading ? <Skeleton className="mb-4 h-36 shrink-0 rounded-2xl" /> : <AgendaLegend />;
    const rows = [["Total", report.counts.total], ["Disponíveis", report.counts.available], ["Em aberto (não preenchidos)", report.counts.open], ["Média meses anteriores", report.averagePreviousMonths ?? "—"], ["AG RA", report.counts.ra], ["AG Unidade", report.counts.unit], ["Bloqueados", report.counts.blocked], ["Ocupação", percent(report.counts.occupancy)], ["Ocupação RA", percent(report.counts.raOccupancy)], ["Ocupação Unidade", percent(report.counts.unitOccupancy)]];
    return <div className={`mb-4 shrink-0 ${loading ? "pointer-events-none opacity-50" : ""}`} aria-busy={loading}><Card className="!p-3 md:!p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 xl:grid-cols-10">{rows.map(([label, value]) => <div key={label} title={label === "Média meses anteriores" ? "Média dos seis meses anteriores com capacidade, calculada pelas agendas sincronizadas e suas datas de vigência." : undefined}><div className="text-[11px] font-medium text-muted">{label}</div><div className="mt-1 text-xl font-bold tabular-nums">{value}</div></div>)}</div>
        {report.counts.unknown > 0 ? <p className="mt-2 text-xs text-muted">{report.counts.unknown} vagas ocupadas com origem não identificada; incluídas na ocupação total.</p> : null}
        <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3"><AgendaLegend /><div className="ml-auto flex gap-3"><button type="button" onClick={() => setProjectionOpen(!projectionOpen)} className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-brand" aria-expanded={projectionOpen}>Projeção do mês {projectionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button><button type="button" onClick={() => setUnitsOpen(!unitsOpen)} className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-brand" aria-expanded={unitsOpen}>{unitsOpen ? "Ocultar por unidade" : "Ver por unidade"} {unitsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></div></div>
        {projectionOpen ? <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><p className="font-semibold">Projeção {report.projection.month}: RA {report.projection.ra ?? "—"} · Unidade {report.projection.unit ?? "—"} · Base: {report.projection.base} vagas úteis</p><p className="mt-1 text-xs text-muted">Taxas dos {report.projection.historicalMonths} meses anteriores com capacidade. {report.projection.unknown ? "A projeção por equipe aguarda a identificação da origem dos agendamentos históricos." : "Estimativa com base nas agendas sincronizadas."}</p></div> : null}
        {unitsOpen ? <div className="mt-3 max-h-52 overflow-y-auto"><AgendaCountTable rows={report.byUnit} /></div> : null}
    </Card></div>;
}
