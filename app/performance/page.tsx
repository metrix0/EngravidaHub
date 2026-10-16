// app/performance/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownUp, CalendarCheck2, Clock3, Headset, SearchCheck, Target, Users } from "lucide-react";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, ComposedChart, Legend } from "recharts";
import Card from "@/components/ui/Card";
import KpiCard from "@/components/ui/KpiCard";
import Skeleton from "@/components/ui/Skeleton";
import HorizontalScroller from "@/components/ui/HorizontalScroller";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { SearchFilter } from "@/components/ui/SearchFilter";
import { DashboardHeader, useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import { getDateRangeFromPreset, DEFAULT_CALENDAR_PRESETS } from "@/components/ui/CalendarButton";
import { useCurrentUser } from "@/components/auth/CurrentUserProvider";
import type { PerformanceAttendant, PerformanceReport } from "@/lib/performance/report";

type SortKey = "tickets" | "appointments" | "firstResponse" | "response" | "score";
const number = (value: number) => value.toLocaleString("pt-BR");
const percentage = (value: number | null) => value === null ? "—" : value.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
function duration(value: number | null) {
    if (value === null) return "—";
    const seconds = Math.max(0, Math.round(value));
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, "0")).join(":");
}
const monthLabel = (value: string) => new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(value + "-01T12:00:00Z")).replace(".", "");
const labelForSector = (sector: string) => sector === "ra" ? "Relacionamento (RA)" : sector === "reception" ? "Recepção" : sector === "assistance" ? "Assistência" : sector === "management" ? "Gestão" : sector === "finance" ? "Financeiro" : "Outra equipe";
const COLORS = { brand: "#ef4444", green: "#0fbb73", blue: "#1683ff", amber: "#e29229", muted: "#94a3b8" };

export default function PerformancePage() {
    const { period, setPeriod, selectedRange, setSelectedRange, ready } = useDashboardDateFilter("current_month");
    const { currentUser, isLoadingCurrentUser } = useCurrentUser();
    const [result, setResult] = useState<{ key: string; report: PerformanceReport | null; error: string | null }>({ key: "", report: null, error: null });
    const [search, setSearch] = useState("");
    const [team, setTeam] = useState("all");
    const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "tickets", descending: true });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const dateRange = useMemo(() => {
        if (period !== null) {
            const preset = DEFAULT_CALENDAR_PRESETS.find(item => item.value === period);
            if (preset) return getDateRangeFromPreset(preset);
        }
        return selectedRange;
    }, [period, selectedRange]);
    const start = dateRange.start, end = dateRange.end;
    const requestKey = start && end ? start + ":" + end : "";
    const loading = ready && Boolean(currentUser) && (!requestKey || result.key !== requestKey);
    const report = result.key === requestKey ? result.report : null;
    const error = result.key === requestKey ? result.error : null;

    useEffect(() => {
        if (!ready || !currentUser || !start || !end || start > end) return;
        const controller = new AbortController();
        void (async () => {
            try {
                const params = new URLSearchParams({ start, end });
                const response = await fetch("/api/performance?" + params, { cache: "no-store", signal: controller.signal });
                const json = await response.json();
                if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar a performance.");
                if (!controller.signal.aborted) setResult({ key: requestKey, report: json.report, error: null });
            } catch (failure) {
                if (!controller.signal.aborted) setResult({ key: requestKey, report: null, error: failure instanceof Error ? failure.message : "Erro ao carregar a performance." });
            }
        })();
        return () => controller.abort();
    }, [ready, currentUser, start, end, requestKey]);

    const ranked = useMemo(() => {
        if (!report) return [];
        const term = search.trim().toLocaleLowerCase("pt-BR");
        return report.attendants.filter(person => (!term || person.name.toLocaleLowerCase("pt-BR").includes(term)) &&
            (team === "all" || (team === "ra" ? person.sector === "ra" : person.sector !== "ra")))
            .sort((first, second) => {
                const a = first[sort.key], b = second[sort.key];
                if (a === null) return b === null ? first.name.localeCompare(second.name, "pt-BR") : 1;
                if (b === null) return -1;
                const delta = sort.descending ? b - a : a - b;
                return delta || first.name.localeCompare(second.name, "pt-BR");
            });
    }, [report, search, team, sort]);
    const selected = ranked.find(person => person.id === selectedId) ?? ranked[0] ?? null;
    const totals = useMemo(() => ranked.reduce((acc, person) => ({
        tickets: acc.tickets + person.tickets,
        appointments: acc.appointments + person.appointments,
    }), { tickets: 0, appointments: 0 }), [ranked]);
    function toggleSort(key: SortKey) {
        setSort(previous => ({ key, descending: previous.key === key ? !previous.descending : key !== "firstResponse" && key !== "response" }));
    }
    const sortedHeading = (key: SortKey, label: string) => <button type="button" onClick={() => toggleSort(key)}
        className={"inline-flex cursor-pointer items-center gap-1 whitespace-nowrap hover:text-brand " + (sort.key === key ? "text-brand" : "")} aria-label={"Ordenar por " + label}>
        {label}<ArrowDownUp size={12} />
    </button>;
    const columns: DataTableColumn<PerformanceAttendant>[] = [
        { id: "position", label: "#", width: "7%", align: "center", render: (_, index) =>
            <span className={"inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold " + (index === 0 ? "bg-green-soft text-green" : index === 1 ? "bg-blue-soft text-blue" : index === 2 ? "bg-orange-soft text-orange" : "bg-slate-100 text-slate-600")}>{index + 1}</span> },
        { id: "attendant", label: "Atendente", width: "28%", render: person =>
            <div className="min-w-0"><button type="button" className={"block truncate text-left font-semibold hover:text-brand " + (person.id === selected?.id ? "text-brand" : "")}
                title={"Ver " + person.name} onClick={() => setSelectedId(person.id)}>{person.name}</button><span className="block truncate text-xs text-muted">{labelForSector(person.sector)}</span></div> },
        { id: "tickets", label: sortedHeading("tickets", "Tickets"), width: "12%", align: "center", render: person => <strong className="tabular-nums">{number(person.tickets)}</strong> },
        { id: "appointments", label: sortedHeading("appointments", "Consultas"), width: "12%", align: "center", render: person => <span className="tabular-nums">{number(person.appointments)}</span> },
        { id: "first", label: sortedHeading("firstResponse", "1ª resposta"), width: "14%", align: "center", render: person => <span className="tabular-nums">{duration(person.firstResponse)}</span> },
        { id: "response", label: sortedHeading("response", "Resposta"), width: "14%", align: "center", render: person => <span className="tabular-nums">{duration(person.response)}</span> },
        { id: "score", label: sortedHeading("score", "Score IA"), width: "13%", align: "center", render: person =>
            <span className="font-semibold tabular-nums" title={person.scoreCount + " análises com nota"}>{person.score === null ? "—" : number(person.score)}</span> },
    ];
    const chart = selected?.monthly.map(item => ({
        month: monthLabel(item.month), tickets: item.tickets, appointments: item.appointments,
        firstMinutes: item.firstResponse === null ? null : Math.round(item.firstResponse / 6) / 10,
        responseMinutes: item.response === null ? null : Math.round(item.response / 6) / 10,
    })) ?? [];

    return <main className="h-full overflow-y-auto bg-white px-3 py-5 text-slate-900 sm:px-5 md:px-7 md:py-7">
        <section className="mx-auto max-w-[1500px] space-y-7">
            <DashboardHeader title="Performance" description="Produtividade, consultas marcadas e tempos de resposta por atendente."
                period={period} setPeriod={setPeriod} selectedRange={selectedRange} setSelectedRange={setSelectedRange} storageManaged storageReady={ready} />
            {isLoadingCurrentUser || loading ? <div className="space-y-5"><Skeleton className="h-80 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div>
                : error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
                : report ? <>
                    <Card className="min-w-0 !p-0">
                        <div className="flex flex-wrap items-start justify-between gap-4 p-4 md:p-6">
                            <div><h2 className="text-lg font-bold">Ranking comparativo</h2>
                                <p className="mt-1 text-xs text-muted">Clique em um nome para detalhar. Consultas contabilizadas pela data em que foram marcadas.</p></div>
                            <div className="flex flex-wrap gap-3">
                                <SearchFilter value={search} onChange={setSearch} placeholder="Buscar atendente" />
                                <DropdownSelect value={team} onChange={setTeam} widthClassName="w-[215px]" options={[
                                    { value: "all", label: "Todas as equipes" }, { value: "ra", label: "Relacionamento (RA)" }, { value: "other", label: "Demais equipes" }
                                ]} />
                            </div>
                        </div>
                        <DataTable columns={columns} rows={ranked} getRowKey={row => row.id} onRowClick={person => setSelectedId(person.id)} emptyMessage="Nenhum atendente com atividade no período." />
                        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-muted md:px-6">
                            <span><strong className="text-slate-700">{number(totals.tickets)}</strong> tickets · <strong className="text-slate-700">{number(totals.appointments)}</strong> consultas marcadas</span>
                            <span>{number(ranked.length)} atendentes com atividade · Score IA = média da nota de resolução (0–100)</span>
                        </div>
                    </Card>
                    {selected ? <section className="space-y-5" aria-label={"Desempenho de " + selected.name}>
                        <div className="flex flex-wrap items-baseline gap-3">
                            <h2 className="text-xl font-bold">{selected.name}</h2>
                            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{labelForSector(selected.sector)}</span>
                            <span className="text-xs text-muted">{number(selected.analyzed)} de {number(selected.tickets)} tickets analisados pela IA</span>
                        </div>
                        <HorizontalScroller>
                            <KpiCard freeWidth icon={<Headset size={22} />} color="blue" label="Tickets" currentValue={selected.tickets} formatter={number} />
                            <KpiCard freeWidth icon={<CalendarCheck2 size={22} />} color="green" label="Consultas marcadas" currentValue={selected.appointments} formatter={number} tooltipText="Marcações no Clinisys atribuídas por nome único. Usa a data da marcação, não a data da consulta." />
                            <KpiCard freeWidth icon={<Clock3 size={22} />} color="orange" label="1ª resposta" currentValue={selected.firstResponse} formatter={duration} tooltipText={"Média das primeiras respostas humanas em " + number(selected.firstCount) + " conversas. Segue o Dashboard: desconsidera tempos acima de 2 horas."} />
                            <KpiCard freeWidth icon={<Activity size={22} />} color="purple" label="Resposta média" currentValue={selected.response} formatter={duration} tooltipText={"Tempo médio de resposta humana em " + number(selected.responseCount) + " análises, excluindo valores acima de 2 horas."} />
                            <KpiCard freeWidth icon={<Target size={22} />} color="brand" label="Score de resolução IA" currentValue={selected.score} formatter={value => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} tooltipText={"Nota média de resolução analisada pela IA, de 0 a 100. Amostra: " + number(selected.scoreCount) + " conversas; não é um ranking de produtividade."} />
                            <KpiCard freeWidth icon={<SearchCheck size={22} />} color="green" label="Resolução confirmada IA" currentValue={selected.resolutionRate} formatter={value => percentage(value)} tooltipText="Percentual de conversas analisadas como resolvidas, entre as que têm um resultado classificável." />
                        </HorizontalScroller>
                        <Card className="!p-0">
                            <div className="p-4 md:p-6"><h3 className="text-lg font-bold">Evolução mensal</h3><p className="mt-1 text-xs text-muted">Últimos seis meses até o período selecionado.</p></div>
                            <DataTable columns={[
                                { id: "month", label: "Período", width: "17%", render: (item: PerformanceAttendant["monthly"][number]) => monthLabel(item.month) },
                                { id: "tickets", label: "Tickets", width: "15%", align: "center", render: item => number(item.tickets) },
                                { id: "appointments", label: "Consultas", width: "16%", align: "center", render: item => number(item.appointments) },
                                { id: "first", label: "1ª resposta", width: "19%", align: "center", render: item => duration(item.firstResponse) },
                                { id: "response", label: "Resposta", width: "19%", align: "center", render: item => duration(item.response) },
                                { id: "score", label: "Score IA", width: "14%", align: "center", render: item => item.score === null ? "—" : number(item.score) }
                            ]} rows={selected.monthly} getRowKey={row => row.month} />
                        </Card>
                        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
                            <Card className="min-w-0"><h3 className="text-lg font-bold">Evolução de tickets e consultas</h3><p className="mt-1 text-xs text-muted">Volume mensal de conversas e marcações</p>
                                <div className="mt-5 h-72 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width: 500, height: 288}}>
                                    <ComposedChart data={chart} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11} /><YAxis axisLine={false} tickLine={false} fontSize={11} />
                                        <Tooltip formatter={value => number(Number(value))} /><Legend />
                                        <Area type="monotone" dataKey="tickets" name="Tickets" stroke={COLORS.brand} fill="#fce8e8" strokeWidth={2} />
                                        <Line type="monotone" dataKey="appointments" name="Consultas" stroke={COLORS.green} strokeWidth={2} dot={{r: 3}} />
                                    </ComposedChart></ResponsiveContainer></div>
                            </Card>
                            <Card className="min-w-0"><h3 className="text-lg font-bold">Evolução do tempo de resposta</h3><p className="mt-1 text-xs text-muted">Média em minutos (somente medições válidas)</p>
                                <div className="mt-5 h-72 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width: 500, height: 288}}>
                                    <LineChart data={chart} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11} /><YAxis axisLine={false} tickLine={false} fontSize={11} unit=" min" />
                                        <Tooltip formatter={value => value === null ? "—" : Number(value).toLocaleString("pt-BR") + " min"} /><Legend />
                                        <Line type="monotone" dataKey="firstMinutes" name="1ª resposta" stroke={COLORS.amber} strokeWidth={2} connectNulls={false} />
                                        <Line type="monotone" dataKey="responseMinutes" name="Resposta" stroke={COLORS.blue} strokeWidth={2} connectNulls={false} />
                                    </LineChart></ResponsiveContainer></div>
                            </Card>
                        </div>
                    </section> : null}
                    <section className="space-y-4">
                        <div><h2 className="text-lg font-bold">Contribuição RA por unidade</h2><p className="mt-1 text-xs text-muted">Participação das marcações feitas pelo time de Relacionamento em cada unidade, no período selecionado.</p></div>
                        {report.units.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{report.units.map(unit =>
                            <Card key={unit.name} className="min-w-0">
                                <div className="flex items-baseline justify-between gap-2"><h3 className="min-w-0 truncate text-sm font-bold" title={unit.name}>{unit.name}</h3>
                                    <span className={"shrink-0 text-lg font-bold tabular-nums " + (unit.share >= 40 ? "text-green" : unit.share >= 20 ? "text-orange" : "text-red")}>{percentage(unit.share)}</span></div>
                                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green" style={{width: Math.min(100,unit.share) + "%"}} /></div>
                                <p className="mt-3 text-xs text-muted"><strong className="text-slate-700">{number(unit.ra)}</strong> RA de {number(unit.total)} marcações</p>
                                {unit.matched < unit.total ? <p className="mt-1 text-[11px] text-muted">{number(unit.total - unit.matched)} sem atendente identificado</p> : null}
                            </Card>
                        )}</div> : <p className="text-sm text-muted">Nenhuma marcação no período.</p>}
                    </section>
                    <p className="pb-6 text-xs leading-5 text-muted">
                        Fonte: conversas e análises do Hub; marcações importadas do Clinisys, pelo dia em que foram criadas.
                        {report.coverage.totalBookings > 0 ? " " + number(report.coverage.matchedBookings) + " de " + number(report.coverage.totalBookings) + " marcações puderam ser vinculadas com segurança a atendentes." : ""}
                        {" "}Tempos são médias apenas de análises com valores válidos até 2 horas. O score e a taxa de resolução são calculados somente sobre conversas avaliadas pela IA.
                        Tickets sem atendente identificado não entram no ranking. Marcações sem correspondência permanecem apenas nos totais por unidade.
                    </p>
                </> : !isLoadingCurrentUser && !loading ? <p className="py-12 text-center text-sm text-muted">Não há dados para o período.</p> : null}
        </section>
    </main>;
}
