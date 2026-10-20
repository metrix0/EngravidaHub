// app/performance/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Activity, ArrowDownUp, CalendarCheck2, ChevronLeft, ChevronRight, Clock3, Headset, Info, MapPin, SearchCheck, Target, UserRound, Users } from "lucide-react";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, ComposedChart } from "recharts";
import Card from "@/components/ui/Card";
import KpiCard from "@/components/ui/KpiCard";
import Skeleton from "@/components/ui/Skeleton";
import HorizontalScroller from "@/components/ui/HorizontalScroller";
import Pagination from "@/components/ui/Pagination";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import SingleFilterButton from "@/components/ui/SingleFilterButton";
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
const labelForSector = (sector: string) => sector === "ra" ? "RA" : sector === "reception" ? "Recepção" : sector === "assistance" ? "Assistência" : sector === "management" ? "Gestão" : sector === "finance" ? "Financeiro" : "Outra equipe";
const COLORS = { brand: "#ef4444", green: "#0fbb73", blue: "#1683ff", amber: "#e29229", muted: "#94a3b8" };
const RANKING_PAGE_SIZE = 10;
const BookingAuthorsTable = dynamic(() => import("@/components/scheduling/BookingAuthorsTable"), {
    loading: () => <Skeleton className="h-44 rounded-2xl" />,
});

function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
    return (
        <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-500">
            {items.map(item => (
                <span key={item.label} className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                    {item.label}
                </span>
            ))}
        </div>
    );
}

export default function PerformancePage() {
    const { period, setPeriod, selectedRange, setSelectedRange, ready } = useDashboardDateFilter("current_month");
    const { currentUser, isLoadingCurrentUser } = useCurrentUser();
    const [result, setResult] = useState<{ key: string; report: PerformanceReport | null; error: string | null }>({ key: "", report: null, error: null });
    const [attendantSearch, setAttendantSearch] = useState("");
    const [team, setTeam] = useState("all");
    const [unitId, setUnitId] = useState("");
    const [attendantId, setAttendantId] = useState("");
    const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "tickets", descending: true });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [rankingPage, setRankingPage] = useState(1);
    const dateRange = useMemo(() => {
        if (period !== null) {
            const preset = DEFAULT_CALENDAR_PRESETS.find(item => item.value === period);
            if (preset) return getDateRangeFromPreset(preset);
        }
        return selectedRange;
    }, [period, selectedRange]);
    const start = dateRange.start, end = dateRange.end;
    const requestKey = start && end ? start + ":" + end + ":" + unitId : "";
    const loading = ready && Boolean(currentUser) && (!requestKey || result.key !== requestKey);
    const report = result.key === requestKey ? result.report : null;
    const error = result.key === requestKey ? result.error : null;

    useEffect(() => {
        if (!ready || !currentUser || !start || !end || start > end) return;
        const controller = new AbortController();
        void (async () => {
            try {
                const params = new URLSearchParams({ start, end });
                if (unitId) params.set("unit_id", unitId);
                const response = await fetch("/api/performance?" + params, { cache: "no-store", signal: controller.signal });
                const json = await response.json();
                if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar a performance.");
                if (!controller.signal.aborted) setResult({ key: requestKey, report: json.report, error: null });
            } catch (failure) {
                if (!controller.signal.aborted) setResult({ key: requestKey, report: null, error: failure instanceof Error ? failure.message : "Erro ao carregar a performance." });
            }
        })();
        return () => controller.abort();
    }, [ready, currentUser, start, end, requestKey, unitId]);

    const ranked = useMemo(() => {
        if (!report) return [];
        const term = attendantSearch.trim().toLocaleLowerCase("pt-BR");
        return report.attendants.filter(person => (!term || person.name.toLocaleLowerCase("pt-BR").includes(term)) &&
            (!attendantId || person.id === attendantId) &&
            (team === "all" || (team === "ra" ? person.sector === "ra" : person.sector !== "ra")))
            .sort((first, second) => {
                const a = first[sort.key], b = second[sort.key];
                if (a === null) return b === null ? first.name.localeCompare(second.name, "pt-BR") : 1;
                if (b === null) return -1;
                const delta = sort.descending ? b - a : a - b;
                return delta || first.name.localeCompare(second.name, "pt-BR");
            });
    }, [report, attendantSearch, team, sort, attendantId]);
    useEffect(() => {
        setRankingPage(1);
    }, [attendantSearch, team, unitId, attendantId, sort, start, end]);
    const rankingPages = Math.max(1, Math.ceil(ranked.length / RANKING_PAGE_SIZE));
    const currentRankingPage = Math.min(rankingPage, rankingPages);
    const rankingStart = (currentRankingPage - 1) * RANKING_PAGE_SIZE;
    const visibleRanked = ranked.slice(rankingStart, rankingStart + RANKING_PAGE_SIZE);
    const selected = ranked.find(person => person.id === selectedId) ?? ranked[0] ?? null;
    const selectedIndex = selected ? ranked.findIndex(person => person.id === selected.id) : -1;
    function navigateAttendant(direction: -1 | 1) {
        const nextIndex = selectedIndex + direction;
        const next = ranked[nextIndex];
        if (!next) return;
        setSelectedId(next.id);
        setRankingPage(Math.floor(nextIndex / RANKING_PAGE_SIZE) + 1);
    }
    const raOnlyContribution = team === "all" && !attendantId && !attendantSearch.trim();
    const unitContribution = useMemo(() => {
        if (!report) return [];
        const visibleIds = new Set(ranked.filter(person => !raOnlyContribution || person.sector === "ra").map(person => person.id));
        const byUnit = new Map<string, number>();
        for (const row of report.unitAttributions) {
            if (visibleIds.has(row.attendantId)) byUnit.set(row.unitName, (byUnit.get(row.unitName) ?? 0) + row.appointments);
        }
        return report.units.map(unit => {
            const contributed = byUnit.get(unit.name) ?? 0;
            return { ...unit, contributed, contributionShare: unit.total ? 100 * contributed / unit.total : 0 };
        });
    }, [report, ranked, raOnlyContribution]);
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
        { id: "position", label: "#", width: "7%", align: "center", render: (_, index) => {
            const position = rankingStart + index + 1;
            return <span className={"inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold " + (position === 1 ? "bg-green-soft text-green" : position === 2 ? "bg-blue-soft text-blue" : position === 3 ? "bg-orange-soft text-orange" : "bg-slate-100 text-slate-600")}>{position}</span>;
        } },
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
                            <div><div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold">Ranking comparativo</h2>
                                <InfoTooltip portal widthClassName="w-[340px]" text={`Consultas: marcações do Clinisys, pela data de criação (${number(report.coverage.matchedBookings)} de ${number(report.coverage.totalBookings)} vinculadas). Sem vínculo: só totais por unidade. Tickets sem atendente não entram no ranking. Tempos: análises válidas até 2 h. Score e resolução: apenas conversas avaliadas pela IA. Filtro de unidade: vínculo atual do cliente nos tickets e unidade Clinisys nas marcações.`}>
                                    <Info size={15} className="text-muted" />
                                </InfoTooltip>
                            </div>
                                <p className="mt-1 text-xs text-muted">Clique em um nome para detalhar. Consultas contabilizadas pela data em que foram marcadas.</p>
                                {unitId ? <p className="mt-1 text-xs text-muted">Tickets e tempos por unidade usam o vínculo atual do cliente. Conversas sem unidade identificada não entram no filtro.</p> : null}</div>
                            <div className="flex flex-wrap gap-3">
                                <DropdownSelect icon={<UserRound size={16} />} value={attendantId} widthClassName="w-[250px]" searchable
                                    searchValue={attendantSearch}
                                    searchPlaceholder={report.attendantOptions.find(person => person.id === attendantId)?.name ?? "Todos os atendentes"}
                                    onSearchChange={value => {
                                        setAttendantSearch(value);
                                        setAttendantId("");
                                        setSelectedId(null);
                                    }}
                                    onChange={value => {
                                        setAttendantId(value);
                                        setSelectedId(value || null);
                                        setAttendantSearch("");
                                    }}
                                    options={[{ label: "Todos os atendentes", value: "" }, ...report.attendantOptions
                                        .filter(person => person.name.toLocaleLowerCase("pt-BR").includes(attendantSearch.trim().toLocaleLowerCase("pt-BR")))
                                        .map(person => ({ label: person.name, value: person.id }))]} />
                                <SingleFilterButton icon={<MapPin size={16} />} label="Todas as unidades" options={report.unitOptions.map(unit => ({ label: unit.name, value: unit.id }))}
                                    values={unitId ? [unitId] : []} onChange={values => setUnitId(values[0] ?? "")} widthClassName="w-[200px]" />
                                <DropdownSelect icon={<Users size={16} />} value={team} onChange={setTeam} widthClassName="w-[215px]" options={[
                                    { value: "all", label: "Todas as equipes" }, { value: "ra", label: "RA" }, { value: "other", label: "Demais equipes" }
                                ]} />
                            </div>
                        </div>
                        <DataTable columns={columns} rows={visibleRanked} getRowKey={row => row.id} onRowClick={person => setSelectedId(person.id)} emptyMessage="Nenhum atendente com atividade no período." />
                        {rankingPages > 1 ? (
                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 md:px-6">
                                <span className="text-xs text-muted">
                                    {rankingStart + 1}–{Math.min(rankingStart + RANKING_PAGE_SIZE, ranked.length)} de {number(ranked.length)} atendentes
                                </span>
                                <Pagination totalPages={rankingPages} currentPage={currentRankingPage} onPageChange={setRankingPage} activeTone="brand" />
                            </div>
                        ) : null}
                        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-muted md:px-6">
                            <span><strong className="text-slate-700">{number(totals.tickets)}</strong> tickets · <strong className="text-slate-700">{number(totals.appointments)}</strong> consultas marcadas</span>
                            <span>{number(ranked.length)} atendentes com atividade · Score IA = média da nota de resolução (0–100)</span>
                        </div>
                    </Card>
                    {selected ? <section className="space-y-5" aria-label={"Desempenho de " + selected.name}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-baseline gap-3">
                                <h2 className="text-xl font-bold">{selected.name}</h2>
                                <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{labelForSector(selected.sector)}</span>
                                <span className="text-xs text-muted">{number(selected.analyzed)} de {number(selected.tickets)} tickets analisados pela IA</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="mr-1 text-xs tabular-nums text-muted">{selectedIndex + 1} de {number(ranked.length)}</span>
                                <button type="button" onClick={() => navigateAttendant(-1)} disabled={selectedIndex <= 0}
                                    aria-label="Atendente anterior" title="Atendente anterior"
                                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-slate-600 transition hover:bg-selection disabled:cursor-not-allowed disabled:opacity-40">
                                    <ChevronLeft size={18} />
                                </button>
                                <button type="button" onClick={() => navigateAttendant(1)} disabled={selectedIndex >= ranked.length - 1}
                                    aria-label="Próximo atendente" title="Próximo atendente"
                                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-slate-600 transition hover:bg-selection disabled:cursor-not-allowed disabled:opacity-40">
                                    <ChevronRight size={18} />
                                </button>
                            </div>
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
                                <ChartLegend items={[{ label: "Tickets", color: COLORS.brand }, { label: "Consultas", color: COLORS.green }]} />
                                <div className="mt-5 h-72 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width: 500, height: 288}}>
                                    <ComposedChart data={chart} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11} /><YAxis axisLine={false} tickLine={false} fontSize={11} />
                                        <Tooltip formatter={value => number(Number(value))} />
                                        <Area type="monotone" dataKey="tickets" name="Tickets" stroke={COLORS.brand} fill="#fce8e8" strokeWidth={2} />
                                        <Line type="monotone" dataKey="appointments" name="Consultas" stroke={COLORS.green} strokeWidth={2} dot={{r: 3}} />
                                    </ComposedChart></ResponsiveContainer></div>
                            </Card>
                            <Card className="min-w-0"><h3 className="text-lg font-bold">Evolução do tempo de resposta</h3><p className="mt-1 text-xs text-muted">Média em minutos (somente medições válidas)</p>
                                <ChartLegend items={[{ label: "1ª resposta", color: COLORS.amber }, { label: "Resposta", color: COLORS.blue }]} />
                                <div className="mt-5 h-72 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width: 500, height: 288}}>
                                    <LineChart data={chart} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11} /><YAxis axisLine={false} tickLine={false} fontSize={11} unit=" min" />
                                        <Tooltip formatter={value => value === null ? "—" : Number(value).toLocaleString("pt-BR") + " min"} />
                                        <Line type="monotone" dataKey="firstMinutes" name="1ª resposta" stroke={COLORS.amber} strokeWidth={2} connectNulls={false} />
                                        <Line type="monotone" dataKey="responseMinutes" name="Resposta" stroke={COLORS.blue} strokeWidth={2} connectNulls={false} />
                                    </LineChart></ResponsiveContainer></div>
                            </Card>
                        </div>
                    </section> : null}
                    <section className="space-y-4">
                        <div><h2 className="text-lg font-bold">{raOnlyContribution ? "Contribuição RA por unidade" : "Contribuição dos atendentes filtrados por unidade"}</h2><p className="mt-1 text-xs text-muted">Participação das marcações dos atendentes selecionados sobre o total de cada unidade, no período.</p></div>
                        {unitContribution.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{unitContribution.map(unit =>
                            <Card key={unit.name} className="min-w-0">
                                <div className="flex items-baseline justify-between gap-2"><h3 className="min-w-0 truncate text-sm font-bold" title={unit.name}>{unit.name}</h3>
                                    <span className={"shrink-0 text-lg font-bold tabular-nums " + (unit.contributionShare >= 40 ? "text-green" : unit.contributionShare >= 20 ? "text-orange" : "text-red")}>{percentage(unit.contributionShare)}</span></div>
                                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green" style={{width: Math.min(100,unit.contributionShare) + "%"}} /></div>
                                <p className="mt-3 text-xs text-muted"><strong className="text-slate-700">{number(unit.contributed)}</strong> de {number(unit.total)} marcações</p>
                                {unit.matched < unit.total ? <p className="mt-1 text-[11px] text-muted">{number(unit.total - unit.matched)} sem atendente identificado</p> : null}
                            </Card>
                        )}</div> : <p className="text-sm text-muted">Nenhuma marcação no período.</p>}
                    </section>
                    <section className="min-w-0">
                        {start && end
                            ? <BookingAuthorsTable start={start} end={end} unitIds={unitId ? [unitId] : []} />
                            : <Card className="min-w-0"><h3 className="text-lg font-bold">Marcado por atendente</h3></Card>}
                    </section>
                </> : !isLoadingCurrentUser && !loading ? <p className="py-12 text-center text-sm text-muted">Não há dados para o período.</p> : null}
        </section>
    </main>;
}
