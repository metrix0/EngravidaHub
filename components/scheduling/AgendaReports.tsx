// components/scheduling/AgendaReports.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarCheck2, CalendarDays, ChartNoAxesCombined, Clock3, Download, History, LayoutGrid, LoaderCircle, LockKeyhole, PieChart as PieChartIcon, RefreshCw, Save, Users } from "lucide-react";
import Card from "@/components/ui/Card";
import KpiCard from "@/components/ui/KpiCard";
import Skeleton from "@/components/ui/Skeleton";
import { CalendarDatePicker } from "@/components/ui/CalendarDatePicker";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { AGENDA_COLORS } from "@/lib/scheduling/bookingOrigin";
import type { AgendaCounts, OperationalAgendaReport } from "@/lib/scheduling/operationalAgenda";
import { monthlyAgendaCounts } from "@/lib/scheduling/agendaReportMetrics";
import { AgendaCountTable, percent } from "./AgendaIndicators";

type Report = OperationalAgendaReport & { missingDoctors: Array<{ doctorName: string }> };
type Snapshot = { month: string; captured_at: string; report: { counts: AgendaCounts; byUnit: Array<AgendaCounts & { unitName: string }> } };
type Result = { query: string; report: Report | null; snapshots: Snapshot[]; error: string | null };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1, 12)).toISOString().slice(0, 10);
const SERIES = [{ key: "available", label: "Disponíveis" }, { key: "ra", label: "Agendado RA" }, { key: "unit", label: "Agendado Unidade" }, { key: "unknown", label: "Origem não identificada" }, { key: "blocked", label: "Bloqueados" }] as const;
const buttonClass = "flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-selection disabled:cursor-not-allowed disabled:opacity-50";
const number = (value: number) => value.toLocaleString("pt-BR");

function useAgendaReport(query: string, ready: boolean) {
    const [reload, setReload] = useState(0);
    const [result, setResult] = useState<Result>({ query: "", report: null, snapshots: [], error: null });
    const requestKey = `${query}:${reload}`;
    const loading = !ready || result.query !== requestKey;
    useEffect(() => {
        if (!ready) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            controller.abort();
            setResult({ query: requestKey, report: null, snapshots: [], error: "A consulta demorou mais que o esperado. Tente novamente." });
        }, 65_000);
        void (async () => {
            try {
                const response = await fetch(`/api/scheduling/reports?${query}`, { cache: "no-store", signal: controller.signal });
                const json = await response.json();
                if (!response.ok || !json.report) throw new Error(json.error ?? "Não foi possível carregar o relatório.");
                if (!controller.signal.aborted) setResult({ query: requestKey, report: json.report, snapshots: json.snapshots ?? [], error: null });
            } catch (error) {
                if (!controller.signal.aborted) setResult({ query: requestKey, report: null, snapshots: [], error: error instanceof Error ? error.message : "Não foi possível carregar o relatório." });
            } finally { window.clearTimeout(timer); }
        })();
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [ready, query, requestKey]);
    return { ...result, report: loading ? null : result.report, error: loading ? null : result.error, loading, refresh: () => setReload(value => value + 1) };
}

export default function AgendaReports({ unitIds, doctorIds, ready }: { unitIds: string[]; doctorIds: string[]; ready: boolean }) {
    const [date, setDate] = useState(today), [month, setMonth] = useState(() => today().slice(0, 7));
    const [saving, setSaving] = useState(false), [saveMessage, setSaveMessage] = useState<string | null>(null), [saveFailed, setSaveFailed] = useState(false);
    const unitKey = [...unitIds].sort().join(","), doctorKey = [...doctorIds].sort().join(",");
    const queries = useMemo(() => {
        const build = (selectedMonth: string, reportDate: string) => {
            const params = new URLSearchParams({ view: "reports", start: `${selectedMonth}-01`, end: monthEnd(selectedMonth), report_date: reportDate });
            unitKey.split(",").filter(Boolean).forEach(id => params.append("unit_ids", id));
            doctorKey.split(",").filter(Boolean).forEach(id => params.append("doctor_ids", id));
            return params.toString();
        };
        return { daily: build(date.slice(0, 7), date), monthly: build(month, `${month}-01`) };
    }, [date, month, unitKey, doctorKey]);
    const daily = useAgendaReport(queries.daily, ready), monthly = useAgendaReport(queries.monthly, ready);
    const selectedYear = Number(month.slice(0, 4)), currentYear = Number(today().slice(0, 4));
    const years = Array.from(new Set([...Array.from({ length: 5 }, (_, i) => currentYear - 2 + i), selectedYear])).sort((a, b) => b - a);
    async function saveSnapshot() {
        setSaving(true); setSaveMessage(null); setSaveFailed(false);
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 65_000);
        try {
            const response = await fetch("/api/scheduling/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, unitIds, doctorIds }), signal: controller.signal });
            const json = await response.json();
            if (!response.ok) throw new Error(json.error ?? "Não foi possível salvar o histórico.");
            setSaveMessage(`Histórico de ${month.split("-").reverse().join("/")} salvo.`); monthly.refresh();
        } catch (error) { setSaveFailed(true); setSaveMessage(controller.signal.aborted ? "Não foi possível confirmar o salvamento. Atualize o histórico antes de tentar novamente." : error instanceof Error ? error.message : "Não foi possível salvar o histórico."); }
        finally { window.clearTimeout(timer); setSaving(false); }
    }
    return <section id="agenda-relatorios" className="mt-8 min-w-0 space-y-5">
        <div className="px-1"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><ChartNoAxesCombined size={19} aria-hidden="true" /></span><h2 className="text-lg font-bold text-slate-900">Relatórios da agenda</h2></div><p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">Acompanhe tempo de espera, disponibilidade e distribuição dos agendamentos por unidade.</p></div>
        <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-56"><p className="mb-1.5 text-xs font-semibold text-muted">Data do relatório diário</p><CalendarDatePicker value={date} onChange={value => setDate(value || today())} /></div>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={daily.loading || !daily.report} onClick={() => daily.report && downloadDailyReport(daily.report)} className={buttonClass}><Download size={16} />Baixar JPEG</button><button type="button" disabled={daily.loading} onClick={daily.refresh} className={buttonClass} aria-label="Atualizar relatório diário"><RefreshCw size={16} /></button></div>
        </div>
        {daily.error ? <ReportError message={daily.error} onRetry={daily.refresh} /> : null}
        {daily.loading ? <div className="grid gap-5 lg:grid-cols-2" aria-label="Carregando relatório diário">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-80 rounded-2xl" />)}</div> : daily.report ? <DailyReport report={daily.report} /> : null}
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 pt-5">
            <div className="flex flex-wrap gap-3"><div><p className="mb-1.5 text-xs font-semibold text-muted">Mês dos indicadores</p><DropdownSelect value={month.slice(5, 7)} onChange={value => { setMonth(`${month.slice(0, 4)}-${value}`); setSaveMessage(null); }} options={Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1).padStart(2, "0"), label: new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, index, 1))) }))} widthClassName="w-[180px]" icon={<CalendarDays size={16} />} /></div><div><p className="mb-1.5 text-xs font-semibold text-muted">Ano</p><DropdownSelect value={month.slice(0, 4)} onChange={value => { setMonth(`${value}-${month.slice(5, 7)}`); setSaveMessage(null); }} options={years.map(year => ({ value: String(year), label: String(year) }))} widthClassName="w-[120px]" /></div></div>
            <button type="button" disabled={monthly.loading} onClick={monthly.refresh} className={buttonClass}><RefreshCw size={16} />Atualizar indicadores</button>
        </div>
        {monthly.error ? <ReportError message={monthly.error} onRetry={monthly.refresh} /> : null}
        {monthly.loading ? <Skeleton className="h-64 rounded-2xl" /> : monthly.report ? <MonthlyReport report={monthly.report} /> : null}
        <Card className="min-w-0 !p-0">
            <div className="flex flex-wrap items-start justify-between gap-3 p-4 md:p-6"><WidgetHeading title="Histórico mensal" description="Salve os indicadores do mês selecionado para consultar depois." icon={<History size={18} />} /><button type="button" disabled={saving || monthly.loading || !monthly.report} onClick={() => void saveSnapshot()} className={buttonClass}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}Salvar histórico</button></div>
            {saveMessage ? <p role={saveFailed ? "alert" : "status"} className={`px-4 pb-4 text-sm md:px-6 ${saveFailed ? "text-red" : "text-green"}`}>{saveMessage}</p> : null}
            {monthly.loading ? <div className="p-4 md:p-6"><Skeleton className="h-32 rounded-xl" /></div> : monthly.error ? <p className="px-4 pb-6 text-sm text-muted md:px-6">Atualize os indicadores para consultar o histórico.</p> : <div className="space-y-3 px-4 pb-4 md:px-6 md:pb-6">{monthly.snapshots.map(snapshot => <details key={snapshot.month} className="rounded-xl border border-slate-200"><summary className="cursor-pointer p-3 text-sm font-semibold">{snapshot.month.slice(0, 7).split("-").reverse().join("/")} · {new Date(snapshot.captured_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</summary><AgendaCountTable rows={snapshot.report.byUnit.map(monthlyAgendaCounts)} /></details>)}{!monthly.snapshots.length ? <p className="py-8 text-center text-sm text-muted">Nenhum histórico salvo para os filtros selecionados.</p> : null}</div>}
        </Card>
    </section>;
}

function ReportError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red/20 bg-red-soft p-4 text-sm text-red"><span>{message}</span><button type="button" onClick={onRetry} className={buttonClass}>Tentar novamente</button></div>;
}
function WidgetHeading({ title, description, icon }: { title: string; description: string; icon: ReactNode }) {
    return <div><h3 className="flex items-center gap-2 text-lg font-bold text-slate-900"><span className="text-muted">{icon}</span>{title}</h3><p className="mt-1 text-xs leading-5 text-muted">{description}</p></div>;
}
function MonthlyReport({ report }: { report: OperationalAgendaReport }) {
    const counts = monthlyAgendaCounts(report.counts);
    const units = report.byUnit.map(monthlyAgendaCounts);
    const teamsNote = "Classificação confirmada por equipe. Agendamentos sem origem identificada aparecem separadamente na tabela por unidade.";
    return <div className="min-w-0 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={<LayoutGrid size={22} />} label="Total de vagas" currentValue={counts.total} formatter={number} color="blue" />
            <KpiCard icon={<CalendarDays size={22} />} label="Disponíveis" currentValue={counts.available} formatter={number} color="green" tooltipText="Horários não ocupados no mês selecionado, incluindo os que já passaram." />
            <KpiCard icon={<CalendarCheck2 size={22} />} label="Agendado RA" currentValue={counts.ra} formatter={number} color="blue" tooltipText={teamsNote} />
            <KpiCard icon={<Users size={22} />} label="Agendado Unidade" currentValue={counts.unit} formatter={number} color="purple" tooltipText={teamsNote} />
            <KpiCard icon={<LockKeyhole size={22} />} label="Bloqueados" currentValue={counts.blocked} formatter={number} color="orange" />
            <KpiCard icon={<PieChartIcon size={22} />} label="Ocupação total" currentValue={counts.occupancy} formatter={value => percent(value)} color="brand" tooltipText="RA + Unidade divididos pelo total de vagas, incluindo bloqueados na base, conforme o relatório de referência. Agendamentos sem origem identificada não entram no numerador." />
            <KpiCard icon={<Users size={22} />} label="Ocupação RA" currentValue={counts.raOccupancy} formatter={value => percent(value)} color="blue" tooltipText={teamsNote} />
            <KpiCard icon={<Users size={22} />} label="Ocupação Unidade" currentValue={counts.unitOccupancy} formatter={value => percent(value)} color="purple" tooltipText={teamsNote} />
        </div>
        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <Card className="min-w-0"><WidgetHeading title="Agendamentos por unidade" description="Distribuição das vagas no mês selecionado." icon={<ChartNoAxesCombined size={18} />} /><div className="mt-5 h-80 min-w-0">{counts.total ? <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 320 }}><BarChart data={units} margin={{ top: 8, right: 8, bottom: 12, left: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="unitName" fontSize={10} interval={0} angle={-35} textAnchor="end" height={85} axisLine={false} tickLine={false} /><YAxis fontSize={11} axisLine={false} tickLine={false} width={40} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />{SERIES.map(item => <Bar key={item.key} dataKey={item.key} name={item.label} fill={AGENDA_COLORS[item.key]} radius={[3, 3, 0, 0]} />)}</BarChart></ResponsiveContainer> : <p className="flex h-full items-center justify-center text-sm text-muted">Nenhuma vaga no mês selecionado.</p>}</div></Card>
            <Card className="min-w-0"><WidgetHeading title="Distribuição das vagas" description="Participação de cada situação no mês selecionado." icon={<PieChartIcon size={18} />} /><div className="mt-5 h-80 min-w-0">{counts.total ? <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 320 }}><PieChart><Pie data={SERIES.map(item => ({ name: item.label, value: counts[item.key], fill: AGENDA_COLORS[item.key] })).filter(row => row.value > 0)} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="75%" paddingAngle={2} /><Tooltip formatter={value => number(Number(value))} /><Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} /></PieChart></ResponsiveContainer> : <p className="flex h-full items-center justify-center text-sm text-muted">Nenhuma vaga no mês selecionado.</p>}</div></Card>
        </div>
        <Card className="min-w-0 !p-0"><div className="p-4 md:p-6"><WidgetHeading title="Indicadores por unidade" description="Capacidade, agendamentos e ocupação do mês selecionado." icon={<LayoutGrid size={18} />} /></div><AgendaCountTable rows={units} /></Card>
    </div>;
}

function ReportTable({ title, columns, rows, note, description, icon }: { title: string; columns: string[]; rows: ReactNode[][]; note?: string; description: string; icon: ReactNode }) {
    const tableColumns: DataTableColumn<ReactNode[]>[] = columns.map((column, index) => ({ id: String(index), label: column, width: `${index === 0 ? 38 : 62 / (columns.length - 1)}%` as `${number}%`, align: index === 0 ? "left" : "center", render: row => <span className={`block text-xs leading-5 ${index === 0 ? "font-semibold" : "tabular-nums"}`}>{row[index]}</span> }));
    return <Card className="min-w-0 !p-0"><div className="p-4 md:p-6"><WidgetHeading title={title} description={description} icon={icon} /></div><DataTable columns={tableColumns} rows={rows} getRowKey={(_, index) => String(index)} emptyMessage="Nenhuma agenda disponível para estes filtros." />{note ? <p className="px-4 py-3 text-xs leading-5 text-muted md:px-6">{note}</p> : null}</Card>;
}
function dailyTables(report: OperationalAgendaReport) {
    const days = (value: number | null, total: number) => value === null ? total ? "Sem vaga" : "Sem agenda vigente" : `${value} ${value === 1 ? "dia" : "dias"}`;
    return [
        { title: "Tempo de espera", description: "Espera pela primeira vaga e pelo primeiro dia com três vagas livres.", icon: <Clock3 size={18} />, columns: ["Unidade", "1ª vaga", "Dia com 3+"], rows: report.availability.map(row => [row.unitName, days(row.firstWaitDays, row.total), days(row.threeWaitDays, row.total)]), note: "3+ vagas considera o total de horários livres dos médicos da unidade no mesmo dia." },
        { title: "Próximas datas", description: "Os três próximos dias com horários disponíveis por unidade.", icon: <CalendarDays size={18} />, columns: ["Unidade", "1ª data", "2ª data", "3ª data"], rows: report.availability.map(row => [row.unitName, ...Array.from({ length: 3 }, (_, index) => row.nextDates[index] ? shortDate(row.nextDates[index]) : "—")]) },
        { title: "Disponibilidade semanal", description: "Vagas da semana atual e das três semanas seguintes.", icon: <LayoutGrid size={18} />, columns: ["Unidade", "Atual", "+1 sem.", "+2 sem.", "+3 sem."], rows: report.availability.map(row => [row.unitName, ...row.weeks]) },
        { title: "Próximos sábados", description: "As duas próximas datas de sábado com horários livres.", icon: <CalendarCheck2 size={18} />, columns: ["Unidade", "Datas disponíveis"], rows: report.availability.map(row => [row.unitName, row.saturdays.length ? row.saturdays.map(item => `${shortDate(item.date)}${item.threeOrMore ? " (3+)" : ""}`).join(" · ") : row.servesSaturday ? "Sem vaga no período" : row.total ? "Não atende no período" : "Sem agenda vigente"]) },
    ];
}
function DailyReport({ report }: { report: OperationalAgendaReport }) {
    return <div className="min-w-0 space-y-3"><div className="grid min-w-0 gap-5 lg:grid-cols-2">{dailyTables(report).map(table => <ReportTable key={table.title} {...table} />)}</div><p className="text-xs text-muted">Atualizado em {new Date(report.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Busca até {shortDate(report.horizonEnd)}</p></div>;
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
