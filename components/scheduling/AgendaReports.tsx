// components/scheduling/AgendaReports.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarCheck2, CalendarDays, ChartNoAxesCombined, ChevronLeft, ChevronRight, Download, LayoutGrid, LoaderCircle, LockKeyhole, PieChart as PieChartIcon, Users } from "lucide-react";
import Card from "@/components/ui/Card";
import KpiCard from "@/components/ui/KpiCard";
import Skeleton from "@/components/ui/Skeleton";
import { CalendarDatePicker } from "@/components/ui/CalendarDatePicker";
import HorizontalScroller from "@/components/ui/HorizontalScroller";
import DashboardWidget from "@/components/personal-dashboard/DashboardWidget";
import { AGENDA_AVAILABILITY_WIDGETS, AGENDA_INDICATOR_WIDGETS } from "@/lib/personal-dashboard/agendaReportWidgets";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { AGENDA_COLORS } from "@/lib/scheduling/bookingOrigin";
import type { OperationalAgendaReport } from "@/lib/scheduling/operationalAgenda";
import { monthlyAgendaCounts } from "@/lib/scheduling/agendaReportMetrics";
import { renderAgendaReportImage } from "@/lib/scheduling/agendaReportImage";
import { AgendaCountTable, percent } from "./AgendaIndicators";

type Report = OperationalAgendaReport & { missingDoctors: Array<{ doctorName: string }> };
type Result = { query: string; report: Report | null; error: string | null };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1, 12)).toISOString().slice(0, 10);
const SERIES = [{ key: "available", label: "Disponíveis" }, { key: "ra", label: "Agendado RA" }, { key: "unit", label: "Agendado Unidade" }, { key: "unknown", label: "Origem não identificada" }, { key: "blocked", label: "Bloqueados" }] as const;
const buttonClass = "flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-selection disabled:cursor-not-allowed disabled:opacity-50";
const number = (value: number) => value.toLocaleString("pt-BR");

function useAgendaReport(query: string, ready: boolean) {
    const [reload, setReload] = useState(0);
    const [result, setResult] = useState<Result>({ query: "", report: null, error: null });
    const requestKey = `${query}:${reload}`;
    const loading = !ready || result.query !== requestKey;
    useEffect(() => {
        if (!ready) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            controller.abort();
            setResult({ query: requestKey, report: null, error: "A consulta demorou mais que o esperado. Tente novamente." });
        }, 65_000);
        void (async () => {
            try {
                const response = await fetch(`/api/scheduling/reports?${query}`, { cache: "no-store", signal: controller.signal });
                const json = await response.json();
                if (!response.ok || !json.report) throw new Error(json.error ?? "Não foi possível carregar o relatório.");
                if (!controller.signal.aborted) setResult({ query: requestKey, report: json.report, error: null });
            } catch (error) {
                if (!controller.signal.aborted) setResult({ query: requestKey, report: null, error: error instanceof Error ? error.message : "Não foi possível carregar o relatório." });
            } finally { window.clearTimeout(timer); }
        })();
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [ready, query, requestKey]);
    return { ...result, report: loading ? null : result.report, error: loading ? null : result.error, loading, refresh: () => setReload(value => value + 1) };
}

export default function AgendaReports({ unitIds, doctorIds, ready }: { unitIds: string[]; doctorIds: string[]; ready: boolean }) {
    const [date, setDate] = useState(today), [month, setMonth] = useState(() => today().slice(0, 7));
    const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState<string | null>(null);
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
    async function exportImage() {
        if (!daily.report) return;
        setExporting(true); setExportError(null);
        try { await downloadDailyReport(daily.report); }
        catch { setExportError("Não foi possível gerar a imagem. Tente novamente."); }
        finally { setExporting(false); }
    }
    const shiftDay = (days: number) => setDate(new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10));
    return <>
        <section id="agenda-disponibilidade" className="mt-8 min-w-0 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <ReportSectionHeading title="Disponibilidade da agenda" description="Tempo de espera e próximos horários livres por unidade." icon={<CalendarDays size={19} />} />
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => shiftDay(-1)} className={`${buttonClass} !h-11 !w-11 !px-0`} aria-label="Dia anterior"><ChevronLeft size={17} /></button>
                    <div className="w-48"><CalendarDatePicker value={date} onChange={setDate} clearable={false} /></div>
                    <button type="button" onClick={() => shiftDay(1)} className={`${buttonClass} !h-11 !w-11 !px-0`} aria-label="Próximo dia"><ChevronRight size={17} /></button>
                    <button type="button" onClick={() => setDate(today())} className={`${buttonClass} !h-11`}>Hoje</button>
                    <button type="button" disabled={daily.loading || !daily.report || exporting} onClick={() => void exportImage()} className={`${buttonClass} !h-11`}>{exporting ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}Baixar imagem</button>
                </div>
            </div>
            {exportError ? <p role="alert" className="text-sm text-red">{exportError}</p> : null}
            {daily.error ? <ReportError message={daily.error} onRetry={daily.refresh} /> : null}
            {daily.loading ? <div className="grid gap-5 lg:grid-cols-2" aria-label="Carregando relatório diário">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-80 rounded-2xl" />)}</div> : daily.report ? <DailyReport report={daily.report} /> : null}
        </section>
        <section id="agenda-indicadores" className="mt-8 min-w-0 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <ReportSectionHeading title="Indicadores da agenda" description="Capacidade, agendamentos e ocupação do mês." icon={<ChartNoAxesCombined size={19} />} />
                <div className="w-60"><CalendarDatePicker mode="month" align="right" value={month} onChange={setMonth} clearable={false} /></div>
            </div>
            {monthly.error ? <ReportError message={monthly.error} onRetry={monthly.refresh} /> : null}
            {monthly.loading ? <Skeleton className="h-64 rounded-2xl" /> : monthly.report ? <MonthlyReport report={monthly.report} /> : null}
        </section>
    </>;
}

function ReportSectionHeading({ title, description, icon }: { title: string; description: string; icon: ReactNode }) {
    return <div className="px-1"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">{icon}</span><h2 className="text-lg font-bold text-slate-900">{title}</h2></div><p className="mt-2 text-xs leading-5 text-slate-500">{description}</p></div>;
}

function ReportError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red/20 bg-red-soft p-4 text-sm text-red"><span>{message}</span><button type="button" onClick={onRetry} className={buttonClass}>Tentar novamente</button></div>;
}
function WidgetHeading({ title }: { title: string }) {
    return <h3 className="text-lg font-bold text-slate-900">{title}</h3>;
}
function MonthlyReport({ report }: { report: OperationalAgendaReport }) {
    return <div className="min-w-0 space-y-5">
        <HorizontalScroller scrollAmount={400}>
            {AGENDA_INDICATOR_WIDGETS.filter(widget => widget.kind === "kpi").map(widget => <DashboardWidget key={widget.id} widgetId={widget.id} className="shrink-0"><AgendaReportWidget widgetId={widget.id} report={report} freeWidth /></DashboardWidget>)}
        </HorizontalScroller>
        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            {AGENDA_INDICATOR_WIDGETS.filter(widget => widget.kind === "chart").map(widget => <DashboardWidget key={widget.id} widgetId={widget.id}><AgendaReportWidget widgetId={widget.id} report={report} /></DashboardWidget>)}
        </div>
        <DashboardWidget widgetId="agenda_indicadores.unidades"><AgendaReportWidget widgetId="agenda_indicadores.unidades" report={report} /></DashboardWidget>
    </div>;
}

export function AgendaReportWidget({ widgetId, report, freeWidth = false }: { widgetId: string; report: OperationalAgendaReport; freeWidth?: boolean }) {
    const dailyIndex = AGENDA_AVAILABILITY_WIDGETS.findIndex(widget => widget.id === widgetId);
    if (dailyIndex >= 0) return <ReportTable {...dailyTables(report)[dailyIndex]} />;
    const counts = monthlyAgendaCounts(report.counts);
    const units = report.byUnit.map(monthlyAgendaCounts);
    const teamsNote = "Classificação confirmada por equipe. Agendamentos sem origem identificada aparecem separadamente na tabela por unidade.";
    switch (widgetId) {
        case "agenda_indicadores.total": return <KpiCard freeWidth={freeWidth} icon={<LayoutGrid size={22} />} label="Total de vagas" currentValue={counts.total} formatter={number} color="blue" />;
        case "agenda_indicadores.disponiveis": return <KpiCard freeWidth={freeWidth} icon={<CalendarDays size={22} />} label="Disponíveis" currentValue={counts.available} formatter={number} color="green" tooltipText="Horários não ocupados no mês selecionado, incluindo os que já passaram." />;
        case "agenda_indicadores.ra": return <KpiCard freeWidth={freeWidth} icon={<CalendarCheck2 size={22} />} label="Agendado RA" currentValue={counts.ra} formatter={number} color="blue" tooltipText={teamsNote} />;
        case "agenda_indicadores.unidade": return <KpiCard freeWidth={freeWidth} icon={<Users size={22} />} label="Agendado Unidade" currentValue={counts.unit} formatter={number} color="purple" tooltipText={teamsNote} />;
        case "agenda_indicadores.bloqueados": return <KpiCard freeWidth={freeWidth} icon={<LockKeyhole size={22} />} label="Bloqueados" currentValue={counts.blocked} formatter={number} color="orange" />;
        case "agenda_indicadores.ocupacao": return <KpiCard freeWidth={freeWidth} icon={<PieChartIcon size={22} />} label="Ocupação total" currentValue={counts.occupancy} formatter={value => percent(value)} color="brand" tooltipText="RA + Unidade divididos pelo total de vagas, incluindo bloqueados na base, conforme o relatório de referência. Agendamentos sem origem identificada não entram no numerador." />;
        case "agenda_indicadores.ocupacao_ra": return <KpiCard freeWidth={freeWidth} icon={<Users size={22} />} label="Ocupação RA" currentValue={counts.raOccupancy} formatter={value => percent(value)} color="blue" tooltipText={teamsNote} />;
        case "agenda_indicadores.ocupacao_unidade": return <KpiCard freeWidth={freeWidth} icon={<Users size={22} />} label="Ocupação Unidade" currentValue={counts.unitOccupancy} formatter={value => percent(value)} color="purple" tooltipText={teamsNote} />;
        case "agenda_indicadores.grafico_unidades": return <Card className="min-w-0"><WidgetHeading title="Agendamentos por unidade" /><div className="mt-5 h-80 min-w-0">{counts.total ? <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 320 }}><BarChart data={units} margin={{ top: 8, right: 8, bottom: 12, left: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="unitName" fontSize={10} interval={0} angle={-35} textAnchor="end" height={85} axisLine={false} tickLine={false} /><YAxis fontSize={11} axisLine={false} tickLine={false} width={40} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />{SERIES.map(item => <Bar key={item.key} dataKey={item.key} name={item.label} fill={AGENDA_COLORS[item.key]} radius={[3, 3, 0, 0]} />)}</BarChart></ResponsiveContainer> : <p className="flex h-full items-center justify-center text-sm text-muted">Nenhuma vaga no mês selecionado.</p>}</div></Card>;
        case "agenda_indicadores.distribuicao": return <Card className="min-w-0"><WidgetHeading title="Distribuição das vagas" /><div className="mt-5 h-80 min-w-0">{counts.total ? <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 320 }}><PieChart><Pie data={SERIES.map(item => ({ name: item.label, value: counts[item.key], fill: AGENDA_COLORS[item.key] })).filter(row => row.value > 0)} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="75%" paddingAngle={2} /><Tooltip formatter={value => number(Number(value))} /><Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} /></PieChart></ResponsiveContainer> : <p className="flex h-full items-center justify-center text-sm text-muted">Nenhuma vaga no mês selecionado.</p>}</div></Card>;
        case "agenda_indicadores.unidades": return <Card className="min-w-0 !p-0"><div className="p-4 md:p-6"><WidgetHeading title="Indicadores por unidade" /></div><AgendaCountTable rows={units} /></Card>;
        default: return null;
    }
}

function ReportTable({ title, columns, rows, note }: { title: string; columns: string[]; rows: ReactNode[][]; note?: string }) {
    const tableColumns: DataTableColumn<ReactNode[]>[] = columns.map((column, index) => ({ id: String(index), label: column, width: `${index === 0 ? 38 : 62 / (columns.length - 1)}%` as `${number}%`, align: index === 0 ? "left" : "center", render: row => <span className={`block text-xs leading-5 ${index === 0 ? "font-semibold" : "tabular-nums"}`}>{row[index]}</span> }));
    return <Card className="min-w-0 !p-0"><div className="p-4 md:p-6"><WidgetHeading title={title} /></div><DataTable columns={tableColumns} rows={rows} getRowKey={(_, index) => String(index)} emptyMessage="Nenhuma agenda disponível para estes filtros." />{note ? <p className="px-4 py-3 text-xs leading-5 text-muted md:px-6">{note}</p> : null}</Card>;
}
function dailyTables(report: OperationalAgendaReport) {
    const days = (value: number | null, total: number) => value === null ? total ? "Sem vaga" : "Sem agenda vigente" : `${value} ${value === 1 ? "dia" : "dias"}`;
    return [
        { title: "Tempo de espera", columns: ["Unidade", "1ª vaga", "Dia com 3+"], rows: report.availability.map(row => [row.unitName, days(row.firstWaitDays, row.total), days(row.threeWaitDays, row.total)]), note: "3+ vagas considera o total de horários livres dos médicos da unidade no mesmo dia." },
        { title: "Próximas datas", columns: ["Unidade", "1ª data", "2ª data", "3ª data"], rows: report.availability.map(row => [row.unitName, ...Array.from({ length: 3 }, (_, index) => row.nextDates[index] ? shortDate(row.nextDates[index]) : "—")]) },
        { title: "Disponibilidade semanal", columns: ["Unidade", "Atual", "+1 sem.", "+2 sem.", "+3 sem."], rows: report.availability.map(row => [row.unitName, ...row.weeks]) },
        { title: "Próximos sábados", columns: ["Unidade", "Datas disponíveis"], rows: report.availability.map(row => [row.unitName, row.saturdays.length ? row.saturdays.map(item => `${shortDate(item.date)}${item.threeOrMore ? " (3+)" : ""}`).join(" · ") : row.servesSaturday ? "Sem vaga no período" : row.total ? "Não atende no período" : "Sem agenda vigente"]) },
    ];
}
function DailyReport({ report }: { report: OperationalAgendaReport }) {
    return <div className="min-w-0 space-y-3"><div className="grid min-w-0 gap-5 lg:grid-cols-2">{AGENDA_AVAILABILITY_WIDGETS.map(widget => <DashboardWidget key={widget.id} widgetId={widget.id}><AgendaReportWidget widgetId={widget.id} report={report} /></DashboardWidget>)}</div><p className="text-xs text-muted">Atualizado em {new Date(report.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Busca até {shortDate(report.horizonEnd)}</p></div>;
}
async function downloadDailyReport(report: OperationalAgendaReport) {
    const logo = new Image();
    logo.src = "/logo.png";
    await logo.decode();
    await document.fonts.ready;
    const canvas = document.createElement("canvas");
    const tables = dailyTables(report).map(table => ({ title: table.title, columns: table.columns, rows: table.rows.map(row => row.map(String)) }));
    if (!renderAgendaReportImage(canvas, { ...report, tables }, { image: logo, width: logo.naturalWidth, height: logo.naturalHeight }, getComputedStyle(document.body).fontFamily)) throw new Error("Canvas indisponível");
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Imagem indisponível")), "image/jpeg", 0.95));
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `agenda-${report.reportDate}.jpg`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
