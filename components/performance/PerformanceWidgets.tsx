"use client";

import { useState } from "react";
import { Activity, CalendarCheck2, Clock3, Headset, SearchCheck, Target, ChartNoAxesCombined, CheckCircle2, CircleDashed } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "@/components/ui/Card";
import KpiCard from "@/components/ui/KpiCard";
import Pagination from "@/components/ui/Pagination";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import type { PerformanceAttendant, PerformanceReport, PerformanceUnit } from "@/lib/performance/report";

const number = (value: number) => value.toLocaleString("pt-BR");
const percentage = (value: number | null) => value === null ? "—" : value.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
const monthLabel = (month: string) => new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(month + "-01T12:00:00Z")).replace(".", "");
const sectorLabel = (sector: string) => sector === "ra" ? "RA" : sector === "reception" ? "Recepção" : sector === "assistance" ? "Assistência" : sector === "management" ? "Gestão" : sector === "finance" ? "Financeiro" : "Outra equipe";
const COLORS = { brand: "#ef4444", green: "#0fbb73", blue: "#1683ff", amber: "#e29229" };
const PAGE_SIZE = 10;

function duration(value: number | null) {
    if (value === null) return "—";
    const seconds = Math.max(0, Math.round(value));
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, "0")).join(":");
}

function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
    return <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-500">{items.map(item =>
        <span key={item.label} className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span>
    )}</div>;
}

export function PerformanceKpi({ widgetId, person, freeWidth = false }: { widgetId: string; person: PerformanceAttendant; freeWidth?: boolean }) {
    switch (widgetId) {
        case "performance.tickets": return <KpiCard freeWidth={freeWidth} icon={<Headset size={22} />} color="blue" label="Tickets" currentValue={person.tickets} formatter={number} />;
        case "performance.consultas": return <KpiCard freeWidth={freeWidth} icon={<CalendarCheck2 size={22} />} color="green" label="Consultas marcadas" currentValue={person.appointments} formatter={number} tooltipText="Marcações no Clinisys atribuídas por nome único. Usa a data da marcação, não a data da consulta." />;
        case "performance.primeira_resposta": return <KpiCard freeWidth={freeWidth} icon={<Clock3 size={22} />} color="orange" label="1ª resposta" currentValue={person.firstResponse} formatter={duration} tooltipText={"Média das primeiras respostas humanas em " + number(person.firstCount) + " conversas. Segue o Dashboard: desconsidera tempos acima de 2 horas."} />;
        case "performance.resposta_media": return <KpiCard freeWidth={freeWidth} icon={<Activity size={22} />} color="purple" label="Resposta média" currentValue={person.response} formatter={duration} tooltipText={"Tempo médio de resposta humana em " + number(person.responseCount) + " análises, excluindo valores acima de 2 horas."} />;
        case "performance.score_ia": return <KpiCard freeWidth={freeWidth} icon={<Target size={22} />} color="brand" label="Score de resolução IA" currentValue={person.score} formatter={number} tooltipText={"A IA atribui uma nota de 0 a 100 a cada conversa com base em quanto a necessidade do cliente foi resolvida. Este KPI é a média aritmética das notas: soma das notas ÷ número de conversas com nota (" + number(person.scoreCount) + "). Não é o percentual de conversas resolvidas."} />;
        case "performance.resolucao_confirmada": return <KpiCard freeWidth={freeWidth} icon={<SearchCheck size={22} />} color="green" label="Resolução confirmada IA" currentValue={person.resolutionRate} formatter={percentage} tooltipText="Percentual de conversas analisadas como resolvidas, entre as que têm um resultado classificável." />;
        case "performance.analysis_coverage": return <KpiCard freeWidth={freeWidth} icon={<ChartNoAxesCombined size={22} />} color="blue" label="Conversas analisadas IA" currentValue={person.tickets ? 100 * person.analyzed / person.tickets : null} formatter={percentage} tooltipText={number(person.analyzed) + " de " + number(person.tickets) + " conversas analisadas no período."} />;
        case "performance.goal_achievement": return <KpiCard freeWidth={freeWidth} icon={<CheckCircle2 size={22} />} color="green" label="Objetivos atingidos" currentValue={person.goalAchievementRate} formatter={percentage} tooltipText={number(person.goalAchieved) + " objetivos atingidos em " + number(person.goalEligible) + " conversas com objetivo classificável. Casos incertos não entram na base."} />;
        case "performance.partial_resolutions": return <KpiCard freeWidth={freeWidth} icon={<CircleDashed size={22} />} color="orange" label="Resolução parcial" currentValue={person.partialResolutionRate} formatter={percentage} tooltipText={number(person.partiallyResolved) + " conversas parcialmente resolvidas entre " + number(person.eligibleResolution) + " com desfecho classificável pela IA."} />;
        default: return null;
    }
}

export function PerformanceMonthlyCard({ person }: { person: PerformanceAttendant }) {
    const columns: DataTableColumn<PerformanceAttendant["monthly"][number]>[] = [
        { id: "month", label: "Período", width: "17%", render: item => monthLabel(item.month) },
        { id: "tickets", label: "Tickets", width: "15%", align: "center", render: item => number(item.tickets) },
        { id: "appointments", label: "Consultas", width: "16%", align: "center", render: item => number(item.appointments) },
        { id: "first", label: "1ª resposta", width: "19%", align: "center", render: item => duration(item.firstResponse) },
        { id: "response", label: "Resposta", width: "19%", align: "center", render: item => duration(item.response) },
        { id: "score", label: "Score IA", width: "14%", align: "center", render: item => item.score === null ? "—" : number(item.score) },
    ];
    return <Card className="!p-0">
        <div className="p-4 md:p-6"><h3 className="text-lg font-bold">Evolução mensal</h3><p className="mt-1 text-xs text-muted">Últimos seis meses até o período selecionado.</p></div>
        <DataTable columns={columns} rows={person.monthly} getRowKey={row => row.month} />
    </Card>;
}

function chartRows(person: PerformanceAttendant) {
    return person.monthly.map(item => ({
        month: monthLabel(item.month), tickets: item.tickets, appointments: item.appointments,
        firstMinutes: item.firstResponse === null ? null : Math.round(item.firstResponse / 6) / 10,
        responseMinutes: item.response === null ? null : Math.round(item.response / 6) / 10,
    }));
}

export function PerformanceTicketsChart({ person }: { person: PerformanceAttendant }) {
    return <Card className="min-w-0">
        <h3 className="text-lg font-bold">Evolução de tickets e consultas</h3>
        <p className="mt-1 text-xs text-muted">Volume mensal de conversas e marcações</p>
        <ChartLegend items={[{ label: "Tickets", color: COLORS.brand }, { label: "Consultas", color: COLORS.green }]} />
        <div className="mt-5 h-72 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 288 }}>
            <ComposedChart data={chartRows(person)} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11} /><YAxis axisLine={false} tickLine={false} fontSize={11} />
                <Tooltip formatter={value => number(Number(value))} />
                <Area type="monotone" dataKey="tickets" name="Tickets" stroke={COLORS.brand} fill="#fce8e8" strokeWidth={2} />
                <Line type="monotone" dataKey="appointments" name="Consultas" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
        </ResponsiveContainer></div>
    </Card>;
}

export function PerformanceResponseChart({ person }: { person: PerformanceAttendant }) {
    return <Card className="min-w-0">
        <h3 className="text-lg font-bold">Evolução do tempo de resposta</h3>
        <p className="mt-1 text-xs text-muted">Média em minutos (somente medições válidas)</p>
        <ChartLegend items={[{ label: "1ª resposta", color: COLORS.amber }, { label: "Resposta", color: COLORS.blue }]} />
        <div className="mt-5 h-72 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 288 }}>
            <LineChart data={chartRows(person)} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11} /><YAxis axisLine={false} tickLine={false} fontSize={11} unit=" min" />
                <Tooltip formatter={value => value === null ? "—" : Number(value).toLocaleString("pt-BR") + " min"} />
                <Line type="monotone" dataKey="firstMinutes" name="1ª resposta" stroke={COLORS.amber} strokeWidth={2} connectNulls={false} />
                <Line type="monotone" dataKey="responseMinutes" name="Resposta" stroke={COLORS.blue} strokeWidth={2} connectNulls={false} />
            </LineChart>
        </ResponsiveContainer></div>
    </Card>;
}

export type ContributedUnit = PerformanceUnit & { contributed: number; contributionShare: number };

export function computePerformanceUnitContribution(report: PerformanceReport, ranked: PerformanceAttendant[], raOnly: boolean): ContributedUnit[] {
    const visibleIds = new Set(ranked.filter(person => !raOnly || person.sector === "ra").map(person => person.id));
    const byUnit = new Map<string, number>();
    for (const row of report.unitAttributions) {
        if (visibleIds.has(row.attendantId)) byUnit.set(row.unitName, (byUnit.get(row.unitName) ?? 0) + row.appointments);
    }
    return report.units.map(unit => {
        const contributed = byUnit.get(unit.name) ?? 0;
        return { ...unit, contributed, contributionShare: unit.total ? 100 * contributed / unit.total : 0 };
    });
}

export function PerformanceContributionCard({ units, raOnly }: { units: ContributedUnit[]; raOnly: boolean }) {
    return <section className="space-y-4">
        <div><h2 className="text-lg font-bold">{raOnly ? "Contribuição RA por unidade" : "Contribuição dos atendentes filtrados por unidade"}</h2>
            <p className="mt-1 text-xs text-muted">Participação das marcações dos atendentes selecionados sobre o total de cada unidade, no período.</p></div>
        {units.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{units.map(unit =>
            <Card key={unit.name} className="min-w-0">
                <div className="flex items-baseline justify-between gap-2"><h3 className="min-w-0 truncate text-sm font-bold" title={unit.name}>{unit.name}</h3>
                    <span className={"shrink-0 text-lg font-bold tabular-nums " + (unit.contributionShare >= 40 ? "text-green" : unit.contributionShare >= 20 ? "text-orange" : "text-red")}>{percentage(unit.contributionShare)}</span></div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green" style={{ width: Math.min(100, unit.contributionShare) + "%" }} /></div>
                <p className="mt-3 text-xs text-muted"><strong className="text-slate-700">{number(unit.contributed)}</strong> de {number(unit.total)} marcações</p>
                {unit.matched < unit.total ? <p className="mt-1 text-[11px] text-muted">{number(unit.total - unit.matched)} sem atendente identificado</p> : null}
            </Card>
        )}</div> : <p className="text-sm text-muted">Nenhuma marcação no período.</p>}
    </section>;
}

export function PerformanceRankingCard({ report, attendants }: { report: PerformanceReport; attendants: PerformanceAttendant[] }) {
    const [page, setPage] = useState(1);
    const rows = [...attendants].sort((a, b) => b.tickets - a.tickets || a.name.localeCompare(b.name, "pt-BR"));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const visible = rows.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE);
    const columns: DataTableColumn<PerformanceAttendant>[] = [
        { id: "position", label: "#", width: "7%", align: "center", render: (_, index) => <span className="font-bold tabular-nums">{(Math.min(page, pages) - 1) * PAGE_SIZE + index + 1}</span> },
        { id: "name", label: "Atendente", width: "29%", render: row => <div className="min-w-0"><strong className="block truncate">{row.name}</strong><span className="text-xs text-muted">{sectorLabel(row.sector)}</span></div> },
        { id: "tickets", label: "Tickets", width: "12%", align: "center", render: row => number(row.tickets) },
        { id: "appointments", label: "Consultas", width: "12%", align: "center", render: row => number(row.appointments) },
        { id: "first", label: "1ª resposta", width: "14%", align: "center", render: row => duration(row.firstResponse) },
        { id: "response", label: "Resposta", width: "14%", align: "center", render: row => duration(row.response) },
        { id: "score", label: "Score IA", width: "12%", align: "center", render: row => row.score === null ? "—" : number(row.score) },
    ];
    return <Card className="!p-0">
        <div className="p-4 md:p-6"><h2 className="text-lg font-bold">Ranking comparativo</h2><p className="mt-1 text-xs text-muted">Consultas contabilizadas pela data em que foram marcadas.</p></div>
        <DataTable columns={columns} rows={visible} getRowKey={row => row.id} emptyMessage="Nenhum atendente com atividade no período." />
        {pages > 1 ? <div className="flex justify-end px-4 py-3 md:px-6"><Pagination totalPages={pages} currentPage={Math.min(page, pages)} onPageChange={setPage} /></div> : null}
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-muted md:px-6">
            {number(rows.reduce((n, person) => n + person.tickets, 0))} tickets · {number(rows.reduce((n, person) => n + person.appointments, 0))} consultas marcadas · {number(report.coverage.totalBookings)} marcações registradas
        </div>
    </Card>;
}
