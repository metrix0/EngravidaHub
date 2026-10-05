// components/scheduling/AgendaIntelligencePanel.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CalendarCheck, Clock3, LayoutGrid, Users, RefreshCw } from "lucide-react";
import Card from "@/components/ui/Card";
import KpiCard from "@/components/ui/KpiCard";
import ButtonGroup from "@/components/ui/ButtonGroup";
import Skeleton from "@/components/ui/Skeleton";
import type { AgendaIntelligenceReport } from "@/lib/scheduling/agendaIntelligence";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const date = (value: string) => new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export default function AgendaIntelligencePanel({ unitIds, doctorIds, filters }: {
    unitIds: string[]; doctorIds: string[]; filters: ReactNode;
}) {
    const [days, setDays] = useState<"7" | "30">("30");
    const [report, setReport] = useState<AgendaIntelligenceReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refresh, setRefresh] = useState(0);
    const unitKey = unitIds.join(","), doctorKey = doctorIds.join(",");
    useEffect(() => {
        const controller = new AbortController();
        const params = new URLSearchParams({ days });
        unitKey.split(",").filter(Boolean).forEach(id => params.append("unit_ids", id));
        doctorKey.split(",").filter(Boolean).forEach(id => params.append("doctor_ids", id));
        setLoading(true);
        setReport(null);
        setError(null);
        async function load() {
            try {
                const response = await fetch(`/api/scheduling/intelligence?${params}`, { cache: "no-store", signal: controller.signal });
                const json = await response.json();
                if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar a inteligência de agenda.");
                if (!controller.signal.aborted) setReport(json.report);
            } catch (failure) {
                if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar a inteligência de agenda.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void load();
        return () => controller.abort();
    }, [days, unitKey, doctorKey, refresh]);

    return <section className="mx-auto w-full max-w-[1500px] space-y-5">
        <header>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">Inteligência Agenda</h1>
            <div className="mt-4 flex flex-wrap items-center gap-3">
                {filters}
                <ButtonGroup<"7" | "30"> options={[{ value: "7", label: "7 dias" }, { value: "30", label: "30 dias" }]} value={days} onChange={setDays} />
                <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading}
                    className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-border text-muted transition hover:bg-selection disabled:opacity-50" aria-label="Atualizar inteligência de agenda">
                    <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
                </button>
                <p className="text-xs text-muted">Disponibilidade: próximos {days} dias. Demanda e resultados: últimos {days} dias.</p>
            </div>
        </header>
        <div className="space-y-5">
            {error ? <div role="alert" className="rounded-xl border border-red/20 bg-red-soft p-4 text-sm text-red">{error}</div> : null}
            {loading ? <div aria-label="Carregando inteligência de agenda" className="grid gap-4 md:grid-cols-2"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-64 rounded-2xl md:col-span-2" /></div> : null}
            {!loading && report ? <>
                {report.missingDoctors.length ? <div className="rounded-xl border border-orange/20 bg-orange-soft p-3 text-sm text-orange">
                    {report.missingDoctors.length} médico(s) sem agenda sincronizada. A capacidade exibida é parcial.
                </div> : null}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiCard icon={<CalendarCheck size={22} />} label="Ocupação prevista" currentValue={report.occupancy} formatter={value => `${number(value)}%`} color="blue"
                        tooltipText="Minutos ocupados dentro da disponibilidade sincronizada, descontando bloqueios e exceções. Agendamentos sobrepostos contam uma única vez." />
                    <KpiCard icon={<LayoutGrid size={22} />} label="Vagas livres" currentValue={report.freeSlots} formatter={number} color="green"
                        tooltipText="Consultas que cabem sem sobreposição nos intervalos livres, usando a duração padrão de cada agenda. Horários alternativos não são contados como vagas extras." />
                    <KpiCard icon={<Clock3 size={22} />} label="Espera mediana" currentValue={report.medianWaitDays} formatter={value => `${number(value)} dias`} color="orange"
                        tooltipText="Mediana do tempo até a primeira vaga de cada médico/unidade com disponibilidade no período. Médicos sem vaga não entram na mediana." />
                    <KpiCard icon={<Users size={22} />} label="Não comparecimento" currentValue={report.noShowRate} formatter={value => `${number(value)}%`} color="purple"
                        tooltipText={`${report.noShows} não comparecimentos entre consultas concluídas ou registradas como não compareceu nos últimos ${days} dias.`} />
                </div>
                <Card>
                    <h3 className="mb-4 text-lg font-bold">Ocupação por dia e horário</h3>
                    <OccupancyHeatmap report={report} />
                </Card>
                <Card>
                    <h3 className="mb-1 text-lg font-bold">Horários pedidos nas conversas</h3>
                    <p className="mb-4 text-xs text-muted">Conversas distintas por preferência, cruzadas com vagas atuais da unidade. Preferências podem se sobrepor; isso não mede consultas perdidas.{doctorIds.length ? " O filtro de médico afeta as vagas; a demanda continua sendo da unidade." : ""}</p>
                    {report.preferences.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs text-muted"><tr><th className="px-3 py-3">Unidade / preferência</th><th className="px-3 py-3">Conversas</th><th className="px-3 py-3">Vagas compatíveis</th><th className="px-3 py-3">Evidências</th></tr></thead>
                        <tbody>{report.preferences.map(item => <tr key={`${item.unitId}:${item.value}`} className="border-t border-slate-100">
                            <td className="px-3 py-3"><div className="font-semibold">{item.unitName}</div><div className="text-muted">{item.label}</div></td>
                            <td className="px-3 py-3">{item.conversations}</td><td className="px-3 py-3">{item.availableSlots}{!item.coverageComplete ? " (parcial)" : ""}</td>
                            <td className="px-3 py-3"><div className="flex flex-wrap gap-2">{item.examples.map((id, index) => <a key={id} href={`/conversas?conversation_id=${id}`} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Conversa {index + 1}</a>)}</div></td>
                        </tr>)}</tbody>
                    </table></div> : <p className="py-5 text-center text-sm text-muted">Nenhuma preferência de consulta identificada no período.</p>}
                    <p className="mt-4 text-xs text-muted">{report.coverage.signalsProcessed} de {report.coverage.analyzedConversations} conversas analisadas com sinais processados{report.coverage.signalsPending ? ` · ${report.coverage.signalsPending} pendentes` : ""}. Manhã: 6h–12h; tarde: 12h–18h; noite: a partir das 18h.</p>
                </Card>
                <Card>
                    <h3 className="mb-4 text-lg font-bold">Capacidade por médico</h3>
                    {report.doctors.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs text-muted"><tr><th className="px-3 py-3">Médico / unidade</th><th className="px-3 py-3">Capacidade</th><th className="px-3 py-3">Ocupação</th><th className="px-3 py-3">Vagas livres</th><th className="px-3 py-3">Primeira vaga</th></tr></thead>
                        <tbody>{report.doctors.map(item => <tr key={`${item.unitId}:${item.doctorId}`} className="border-t border-slate-100">
                            <td className="px-3 py-3"><div className="font-semibold">{item.doctorName}</div><div className="text-xs text-muted">{item.unitName} · {item.durationMinutes} min</div></td>
                            <td className="px-3 py-3">{number(item.capacityMinutes / 60)}h</td><td className="px-3 py-3">{item.occupancy === null ? "—" : `${number(item.occupancy)}%`}</td><td className="px-3 py-3">{item.freeSlots}</td>
                            <td className="whitespace-nowrap px-3 py-3">{item.firstAvailable ? new Date(item.firstAvailable).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Sem vaga no período"}</td>
                        </tr>)}</tbody>
                    </table></div> : <p className="py-5 text-center text-sm text-muted">Nenhuma agenda sincronizada para os filtros selecionados.</p>}
                </Card>
                <Card>
                    <h3 className="mb-4 text-lg font-bold">Cancelamentos e recuperação de vagas</h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Metric label="Consultas do período canceladas" value={report.cancellations} />
                        <Metric label="Remarcações observadas" value={report.history.reschedules} />
                        <Metric label="Vagas liberadas a menos de 24h" value={report.history.lateReleases} />
                        <Metric label="Vagas recuperadas / já encerradas" value={`${report.history.recovered} / ${report.history.settled}`} />
                    </div>
                    <p className="mt-4 text-xs text-muted">{report.history.startedAt ? `Histórico de alterações disponível desde ${date(report.history.startedAt)}. ` : "Histórico ainda indisponível. "}Recuperação exige outra consulta ocupando todo o intervalo liberado. Vagas futuras ainda podem ser recuperadas.</p>
                </Card>
                {report.recommendations.length ? <Card><h3 className="mb-3 text-lg font-bold">Recomendações</h3><ul className="space-y-3 text-sm text-slate-700">{report.recommendations.map(item => <li key={item}>{item}</li>)}</ul></Card> : null}
            </> : null}
        </div>
    </section>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
    return <div><p className="text-xs text-muted">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>;
}

function OccupancyHeatmap({ report }: { report: AgendaIntelligenceReport }) {
    const hours = [...new Set(report.heatmap.map(cell => cell.hour))].sort((a, b) => a - b);
    const cells = new Map(report.heatmap.map(cell => [`${cell.weekday}:${cell.hour}`, cell]));
    if (!hours.length) return <p className="py-5 text-center text-sm text-muted">Sem disponibilidade no período.</p>;
    return <div className="overflow-x-auto"><table className="w-full text-center text-xs"><thead><tr><th className="p-2 text-muted">Dia</th>{hours.map(hour => <th key={hour} className="p-2 text-muted">{hour}h</th>)}</tr></thead>
        <tbody>{WEEKDAYS.map((day, weekday) => <tr key={day}><th className="p-2 text-left text-muted">{day}</th>{hours.map(hour => {
            const cell = cells.get(`${weekday}:${hour}`);
            const percent = cell ? cell.occupiedMinutes / cell.capacityMinutes * 100 : null;
            return <td key={hour} className="p-1"><div className={`rounded-lg px-3 py-3 font-semibold ${percent === null ? "bg-slate-50 text-slate-300" : percent >= 80 ? "bg-brand text-white" : percent >= 50 ? "bg-brand-soft text-brand" : "bg-green-soft text-green"}`}
                title={cell ? `${number(cell.occupiedMinutes / 60)}h ocupadas de ${number(cell.capacityMinutes / 60)}h disponíveis` : "Sem disponibilidade"}>{percent === null ? "—" : `${Math.round(percent)}%`}</div></td>;
        })}</tr>)}</tbody></table></div>;
}
