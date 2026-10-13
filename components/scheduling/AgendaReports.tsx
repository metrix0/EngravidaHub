// components/scheduling/AgendaReports.tsx
"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, LoaderCircle, Save } from "lucide-react";
import Card from "@/components/ui/Card";
import ButtonGroup from "@/components/ui/ButtonGroup";
import Skeleton from "@/components/ui/Skeleton";
import { CalendarDatePicker } from "@/components/ui/CalendarDatePicker";
import { AGENDA_COLORS } from "@/lib/scheduling/bookingOrigin";
import type { AgendaCounts, OperationalAgendaReport } from "@/lib/scheduling/operationalAgenda";
import { AgendaCountTable, AgendaLegend, percent } from "./AgendaIndicators";

type Report = OperationalAgendaReport & { missingDoctors: Array<{ doctorName: string }> };
type Snapshot = { month: string; captured_at: string; report: { counts: AgendaCounts; byUnit: Array<AgendaCounts & { unitName: string }> } };
type Tab = "daily" | "chart" | "distribution" | "history";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1, 12)).toISOString().slice(0, 10);
const SERIES = [{ key: "available", label: "Disponíveis" }, { key: "ra", label: "AG RA" }, { key: "unit", label: "AG Unidade" }, { key: "unknown", label: "Origem não identificada" }, { key: "blocked", label: "Bloqueados" }, { key: "open", label: "Em aberto" }] as const;
const buttonClass = "flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:bg-selection disabled:cursor-wait disabled:opacity-50";

export default function AgendaReports({ unitIds, doctorIds, ready }: { unitIds: string[]; doctorIds: string[]; ready: boolean }) {
    const [tab, setTab] = useState<Tab>("daily"), [date, setDate] = useState(today), [month, setMonth] = useState(() => today().slice(0, 7));
    const [reload, setReload] = useState(0), [saving, setSaving] = useState(false), [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [result, setResult] = useState<{ query: string; report: Report | null; snapshots: Snapshot[]; error: string | null }>({ query: "", report: null, snapshots: [], error: null });
    const unitKey = [...unitIds].sort().join(","), doctorKey = [...doctorIds].sort().join(",");
    const daily = tab === "daily";
    const query = useMemo(() => {
        const selectedMonth = daily ? date.slice(0, 7) : month;
        const params = new URLSearchParams({ view: "reports", start: `${selectedMonth}-01`, end: monthEnd(selectedMonth), report_date: daily ? date : `${selectedMonth}-01` });
        unitKey.split(",").filter(Boolean).forEach(id => params.append("unit_ids", id));
        doctorKey.split(",").filter(Boolean).forEach(id => params.append("doctor_ids", id));
        return params.toString();
    }, [daily, date, month, unitKey, doctorKey]);
    const loading = !ready || result.query !== `${query}:${reload}`, report = result.report;
    useEffect(() => {
        if (!ready) return;
        const controller = new AbortController();
        void (async () => {
            try {
                const response = await fetch(`/api/scheduling/reports?${query}`, { cache: "no-store", signal: controller.signal });
                const json = await response.json();
                if (!response.ok) throw new Error(json.error ?? "Falha ao carregar os relatórios.");
                if (!controller.signal.aborted) setResult({ query: `${query}:${reload}`, report: json.report, snapshots: json.snapshots ?? [], error: null });
            } catch (error) { if (!controller.signal.aborted) setResult({ query: `${query}:${reload}`, report: null, snapshots: [], error: error instanceof Error ? error.message : "Falha ao carregar os relatórios." }); }
        })();
        return () => controller.abort();
    }, [ready, query, reload]);
    async function saveSnapshot() {
        setSaving(true); setSaveMessage(null);
        try {
            const response = await fetch("/api/scheduling/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, unitIds, doctorIds }) });
            const json = await response.json(); if (!response.ok) throw new Error(json.error);
            setSaveMessage("Histórico mensal salvo."); setReload(value => value + 1);
        } catch (error) { setSaveMessage(error instanceof Error ? error.message : "Falha ao salvar o histórico."); }
        finally { setSaving(false); }
    }
    return <section className="mt-6 space-y-4" aria-busy={loading}>
        <h2 className="text-lg font-bold">Relatórios da agenda</h2>
        <ButtonGroup<Tab> value={tab} onChange={setTab} options={[{ value: "daily", label: "Relatório Diário" }, { value: "chart", label: "Gráfico" }, { value: "distribution", label: "Distribuição" }, { value: "history", label: "Histórico Mensal" }]} />
        <div className="flex flex-wrap items-end gap-3">{daily ? <label className="w-56 text-xs font-semibold text-muted">Data do relatório<div className="mt-1"><CalendarDatePicker value={date} onChange={value => { if (value) setDate(value); }} /></div></label> : <label className="text-xs font-semibold text-muted">Mês<input type="month" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} className="mt-1 block h-11 rounded-xl border border-slate-200 px-3 text-sm text-slate-700" /></label>}
            {daily ? <button type="button" disabled={loading || !report} onClick={() => report && downloadDailyReport(report)} className={buttonClass}><Download size={16} />Baixar JPEG</button> : null}
            {tab === "history" ? <button type="button" disabled={saving || loading} onClick={() => void saveSnapshot()} className={buttonClass}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}Salvar Snapshot</button> : null}
        </div>
        {saveMessage ? <p role="status" className="text-sm text-muted">{saveMessage}</p> : null}
        {loading ? <Skeleton className="h-64 rounded-2xl" /> : result.error ? <p role="alert" className="rounded-xl bg-red-soft p-4 text-sm text-red">{result.error}</p> : report ? <>
            {report.missingDoctors.length ? <p className="text-xs text-muted">{report.missingDoctors.length} médicos sem agenda sincronizada; disponibilidade parcial.</p> : null}
            {daily ? <DailyReport report={report} /> : tab === "history" ? <div className="space-y-4"><p className="text-sm text-muted">Captura os indicadores do mês para preservar o histórico, com os filtros de unidade e médico selecionados.</p><h3 className="font-bold">Histórico salvo ({result.snapshots.length} meses)</h3>{result.snapshots.map(snapshot => <Card key={snapshot.month}><h4 className="mb-3 font-bold">{snapshot.month.slice(0, 7)} · Capturado em {new Date(snapshot.captured_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</h4><AgendaCountTable rows={snapshot.report.byUnit} /></Card>)}{!result.snapshots.length ? <p className="py-8 text-center text-sm text-muted">Nenhum histórico salvo para estes filtros.</p> : null}</div> : <Card>
                <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">{[["Total", report.counts.total], ["Disponíveis", report.counts.available], ["AG RA", report.counts.ra], ["AG Unidade", report.counts.unit], ["Bloqueados", report.counts.blocked], ["Ocupação total", percent(report.counts.occupancy)], ["Ocupação RA", percent(report.counts.raOccupancy)], ["Ocupação Unidade", percent(report.counts.unitOccupancy)]].map(([label, value]) => <div key={label}><p className="text-xs text-muted">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>)}</div>
                <AgendaLegend /><div className="mt-5 h-80">{tab === "chart" ? <ResponsiveContainer width="100%" height="100%"><BarChart data={report.daily}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={shortDate} fontSize={11} /><YAxis fontSize={11} /><Tooltip labelFormatter={value => String(value).split("-").reverse().join("/")} /><Legend />{SERIES.map(series => <Bar key={series.key} dataKey={series.key} name={series.label} stackId="slots" fill={AGENDA_COLORS[series.key]} />)}</BarChart></ResponsiveContainer> : <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={SERIES.map(series => ({ name: series.label, value: report.counts[series.key], fill: AGENDA_COLORS[series.key] })).filter(row => row.value > 0)} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="75%" /><Tooltip /><Legend /></PieChart></ResponsiveContainer>}</div>
                <div className="mt-5"><AgendaCountTable rows={report.byUnit} /></div>
            </Card>}
        </> : null}
    </section>;
}

function ReportTable({ title, columns, rows, note }: { title: string; columns: string[]; rows: ReactNode[][]; note?: string }) {
    return <Card><h3 className="mb-3 font-bold">{title}</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-muted"><tr>{columns.map(column => <th key={column} className="whitespace-nowrap px-3 py-3">{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-slate-100">{row.map((cell, i) => <td key={i} className={`px-3 py-3 ${i === 0 ? "font-semibold" : "tabular-nums"}`}>{cell}</td>)}</tr>)}</tbody></table></div>{!rows.length ? <p className="py-8 text-center text-sm text-muted">Nenhuma agenda disponível para estes filtros.</p> : null}{note ? <p className="mt-3 text-xs text-muted">{note}</p> : null}</Card>;
}
function dailyTables(report: OperationalAgendaReport) {
    const days = (value: number | null) => value === null ? "Sem vaga" : `${value} ${value === 1 ? "dia" : "dias"}`;
    return [
        { title: "Tempo de Espera", columns: ["Unidade", "1ª vaga", "Dia com 3+ vagas"], rows: report.availability.map(row => [row.unitName, days(row.firstWaitDays), days(row.threeWaitDays)]), note: "3+ vagas = primeiro dia com pelo menos três horários livres, somando os médicos da unidade." },
        { title: "Próximas Datas Disponíveis", columns: ["Unidade", "1ª", "2ª", "3ª"], rows: report.availability.map(row => [row.unitName, ...Array.from({ length: 3 }, (_, index) => row.nextDates[index] ? shortDate(row.nextDates[index]) : "—")]) },
        { title: "Disponibilidade Atual e Próximas 3 Semanas", columns: ["Unidade", "Semana atual", "Semana 1", "Semana 2", "Semana 3"], rows: report.availability.map(row => [row.unitName, ...row.weeks]) },
        { title: "Próximos Sábados Disponíveis", columns: ["Unidade", "Datas"], rows: report.availability.map(row => [row.unitName, row.saturdays.length ? row.saturdays.map(item => `${shortDate(item.date)}${item.threeOrMore ? " (3+ vagas)" : ""}`).join(" | ") : row.servesSaturday ? "Sem vaga no horizonte" : "Não atende no horizonte"]) },
    ];
}
function DailyReport({ report }: { report: OperationalAgendaReport }) {
    return <div className="space-y-4"><div><h3 className="font-bold">Engravida · Disponibilidade de Agendas</h3><p className="text-sm text-muted">{report.reportDate.split("-").reverse().join("/")} · Busca até {shortDate(report.horizonEnd)}</p></div>{dailyTables(report).map(table => <ReportTable key={table.title} {...table} />)}<p className="text-xs text-muted">Atualizado em {new Date(report.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>;
}
function downloadDailyReport(report: OperationalAgendaReport) {
    const tables = dailyTables(report), canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 160 + tables.reduce((sum, table) => sum + 120 + table.rows.length * 36, 0);
    const context = canvas.getContext("2d"); if (!context) return;
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ef4444"; context.font = "bold 26px Arial"; context.fillText("Engravida · Disponibilidade de Agendas", 40, 45);
    context.fillStyle = "#64748b"; context.font = "16px Arial"; context.fillText(`${report.reportDate.split("-").reverse().join("/")} · Busca até ${shortDate(report.horizonEnd)}`, 40, 78);
    let y = 112;
    tables.forEach(table => {
        context.fillStyle = "#0f172a"; context.font = "bold 20px Arial"; context.fillText(table.title, 40, y); y += 36;
        const width = 1120 / table.columns.length;
        context.fillStyle = "#f1f5f9"; context.fillRect(40, y - 24, 1120, 36);
        context.fillStyle = "#64748b"; context.font = "bold 14px Arial"; table.columns.forEach((value, index) => context.fillText(value, 48 + index * width, y, width - 16)); y += 36;
        table.rows.forEach(row => { context.fillStyle = "#334155"; context.font = "15px Arial"; row.forEach((value, index) => context.fillText(String(value), 48 + index * width, y, width - 16)); y += 36; });
        if (table.note) { context.fillStyle = "#64748b"; context.font = "13px Arial"; context.fillText(table.note, 40, y, 1120); y += 30; }
        y += 24;
    });
    context.font = "13px Arial"; context.fillStyle = "#64748b"; context.fillText(`Atualizado: ${new Date(report.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, 40, y);
    canvas.toBlob(blob => { if (!blob) return; const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `agenda-${report.reportDate}.jpg`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, "image/jpeg", 0.95);
}
