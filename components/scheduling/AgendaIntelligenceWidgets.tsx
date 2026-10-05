// components/scheduling/AgendaIntelligenceWidgets.tsx
"use client";

import { useState } from "react";
import { CalendarCheck, Clock3, HelpCircle, LayoutGrid, Sparkles, Users } from "lucide-react";
import Card from "@/components/ui/Card";
import KpiCard from "@/components/ui/KpiCard";
import InfoTooltip from "@/components/ui/InfoTooltip";
import Pagination from "@/components/ui/Pagination";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { HoverBadgeList } from "@/components/ui/HoverBadgeList";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
import { formatDoctorName } from "@/lib/scheduling/formatDoctorName";
import AgendaDemandOpportunities from "@/components/scheduling/AgendaDemandOpportunities";
import type { AgendaIntelligenceReport } from "@/lib/scheduling/agendaIntelligence";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PAGE_SIZE = 10;
const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const date = (value: string) => new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function AgendaIntelligenceWidget({ widgetId, report, doctorFiltered = false }: {
    widgetId: string; report: AgendaIntelligenceReport; doctorFiltered?: boolean;
}) {
    const future = `Próximos ${report.days} dias, usando a agenda atual.`;
    const results = `Consultas entre ${date(report.resultsStart)} e ${date(new Date(Date.parse(report.resultsEnd) - 1).toISOString())}.`;
    switch (widgetId) {
        case "inteligencia_agenda.ocupacao": return <KpiCard icon={<CalendarCheck size={22} />} label="Ocupação prevista" currentValue={report.occupancy} formatter={value => `${number(value)}%`} color="blue" tooltipText={`${future} Minutos ocupados ÷ minutos disponíveis, descontando bloqueios. Sobreposições contam uma única vez.`} />;
        case "inteligencia_agenda.vagas": return <KpiCard icon={<LayoutGrid size={22} />} label="Vagas livres" currentValue={report.freeSlots} formatter={number} color="green" tooltipText={`${future} Consultas sem sobreposição que cabem nos intervalos livres, usando a duração de cada agenda.`} />;
        case "inteligencia_agenda.espera": return <KpiCard icon={<Clock3 size={22} />} label="Espera mediana" currentValue={report.medianWaitDays} formatter={value => `${number(value)} dias`} color="orange" tooltipText={`${future} Mediana do tempo até a primeira vaga por médico/unidade. Médicos sem vaga ficam fora do cálculo.`} />;
        case "inteligencia_agenda.nao_comparecimento": return <KpiCard icon={<Users size={22} />} label="Não comparecimento" currentValue={report.noShowRate} formatter={value => `${number(value)}%`} color="purple" tooltipText={`${results} ${report.noShows} não comparecimentos ÷ consultas concluídas ou registradas como não compareceu.`} />;
        case "inteligencia_agenda.mapa": return <Card><h3 className="mb-4 text-lg font-bold">Ocupação por dia e horário</h3><OccupancyHeatmap report={report} /></Card>;
        case "inteligencia_agenda.oportunidades": return <AgendaDemandOpportunities report={report} />;
        case "inteligencia_agenda.recomendacoes": return <RecommendationsCard report={report} />;
        case "inteligencia_agenda.preferencias": return <PreferencesCard report={report} doctorFiltered={doctorFiltered} />;
        case "inteligencia_agenda.medicos": return <DoctorsCard report={report} />;
        case "inteligencia_agenda.recuperacao": return <RecoveryCard report={report} />;
        default: return null;
    }
}

function RecommendationsCard({ report }: { report: AgendaIntelligenceReport }) {
    return <Card>
        <h3 className="mb-4 text-lg font-bold">Recomendações de Inteligência de Agenda</h3>
        {report.recommendations.length ? <ul className="space-y-3">
            {report.recommendations.map(item => {
                return <li key={`${item.unitId}:${item.value}`} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <span aria-hidden="true" className="rounded-lg bg-brand/10 p-2 text-brand"><Sparkles size={16} /></span>
                    <div className="min-w-0">
                        <p className="font-bold">{item.unitName}</p>
                        <p className="mb-2 text-xs text-muted">{item.label}</p>
                        <p className="text-sm leading-relaxed text-slate-700"><strong>{number(item.casesToReview)} {item.casesToReview === 1 ? "caso sem agendamento identificado" : "casos sem agendamento identificado"}</strong> · <strong>{number(item.availableSlots)} {item.availableSlots === 1 ? "vaga compatível" : "vagas compatíveis"}</strong>.</p>
                        <p className="mt-1 text-sm text-slate-700">{item.action === "fill" ? "Revise as conversas e confirme o interesse antes de oferecer esses horários." : "Confirme o interesse desses casos antes de avaliar novos horários."}</p>
                    </div>
                </li>;
            })}
        </ul> : <p className="text-sm text-muted">Nenhuma recomendação para os filtros selecionados.</p>}
    </Card>;
}

function PreferencesCard({ report, doctorFiltered }: { report: AgendaIntelligenceReport; doctorFiltered: boolean }) {
    const [page, setPage] = useState(1);
    const pages = Math.max(1, Math.ceil(report.preferences.length / PAGE_SIZE)), currentPage = Math.min(page, pages);
    const columns: DataTableColumn<AgendaIntelligenceReport["preferences"][number]>[] = [
        { id: "preference", label: "Unidade / preferência", width: "25%", render: item => <><div className="font-semibold">{item.unitName}</div><div className="text-xs text-muted">{item.label}</div></> },
        { id: "conversations", label: "Conversas", width: "10%", render: item => <><div>{number(item.conversations)}</div><p className="mt-1 text-xs text-muted">{number(item.casesToReview)} a revisar</p></> },
        { id: "available", label: <span className="inline-flex items-center gap-1.5">Vagas compatíveis<Info text={`Vagas livres nos próximos ${report.days} dias que atendem ao dia ou horário pedido. Usa a duração de cada agenda e não conta horários sobrepostos como vagas extras. Preferências distintas podem compartilhar vagas.`} /></span>, width: "20%", render: item => number(item.availableSlots) },
        { id: "evidence", label: "Evidências", width: "45%", render: item => <HoverBadgeList items={item.examples.map(id => {
            const evidence = report.evidenceDetails[id];
            return { key: id, label: evidence?.name ?? "Ver conversa", className: "bg-blue-soft text-blue", title: `${evidence?.name ?? "Ver conversa"}${evidence?.startedAt ? ` · ${dateTime(evidence.startedAt)}` : ""}`, ariaLabel: `Abrir conversa de ${evidence?.name ?? "cliente"}`, onClick: () => openFloatingConversation({ type: "conversation", id }) };
        })} badgeClassName="rounded-md px-2.5 py-1 text-xs font-bold" maxBadgeWidthClassName="" /> },
    ];
    return <Card className="!p-0">
        <div className="px-4 py-5 md:px-6"><h3 className="text-lg font-bold">Horários pedidos nas conversas</h3><p className="mt-1 text-xs text-muted">Total de conversas por preferência e casos sem agendamento para revisar. {doctorFiltered ? "O filtro de médico afeta as vagas; os pedidos são da unidade." : "Preferências podem se sobrepor."}</p></div>
        <DataTable columns={columns} rows={report.preferences.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)} getRowKey={item => `${item.unitId}:${item.value}`} emptyMessage="Nenhuma preferência de consulta identificada no período." />
        <TablePagination count={report.preferences.length} page={currentPage} pages={pages} setPage={setPage} />
    </Card>;
}

function DoctorsCard({ report }: { report: AgendaIntelligenceReport }) {
    const [page, setPage] = useState(1);
    const pages = Math.max(1, Math.ceil(report.doctors.length / PAGE_SIZE)), currentPage = Math.min(page, pages);
    const columns: DataTableColumn<AgendaIntelligenceReport["doctors"][number]>[] = [
        { id: "doctor", label: "Médico / unidade", width: "35%", render: item => <><div className="font-semibold">{formatDoctorName(item.doctorName)}</div><div className="text-xs text-muted">{item.unitName} · {item.durationMinutes} min</div></> },
        { id: "capacity", label: "Capacidade", width: "15%", render: item => `${number(item.capacityMinutes / 60)}h` },
        { id: "occupancy", label: <span className="inline-flex items-center gap-1.5">Ocupação<Info text={`Nos próximos ${report.days} dias, a partir de hoje. Minutos ocupados ÷ minutos disponíveis na agenda, descontando bloqueios. O filtro de datas define a duração dessa janela futura.`} /></span>, width: "15%", render: item => item.occupancy === null ? "—" : `${number(item.occupancy)}%` },
        { id: "free", label: "Vagas livres", width: "15%", render: item => number(item.freeSlots) },
        { id: "first", label: "Primeira vaga", width: "20%", render: item => item.firstAvailable ? dateTime(item.firstAvailable) : "Sem vaga no período" },
    ];
    return <Card className="!p-0"><h3 className="px-4 py-5 text-lg font-bold md:px-6">Capacidade por médico</h3>
        <DataTable columns={columns} rows={report.doctors.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)} getRowKey={item => `${item.unitId}:${item.doctorId}`} emptyMessage="Nenhuma agenda sincronizada para os filtros selecionados." />
        <TablePagination count={report.doctors.length} page={currentPage} pages={pages} setPage={setPage} />
    </Card>;
}

function TablePagination({ count, page, pages, setPage }: { count: number; page: number; pages: number; setPage: (page: number) => void }) {
    return <div className="flex flex-wrap items-center justify-between gap-3 py-4 pl-4 pr-14 md:pl-6 md:pr-16"><p className="text-xs text-muted">{count ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, count)} de ${count}` : "0 resultados"}</p><Pagination totalPages={pages} currentPage={page} onPageChange={setPage} /></div>;
}

function RecoveryCard({ report }: { report: AgendaIntelligenceReport }) {
    const history = report.history, available = Boolean(history.observedFrom);
    const observed = history.observedFrom ? `Alterações registradas desde ${dateTime(history.observedFrom)}.` : "Sem histórico de alterações para o período selecionado.";
    const pending = history.released - history.settled;
    return <Card><h3 className="mb-5 text-lg font-bold">Cancelamentos e recuperação de vagas</h3>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Consultas canceladas" value={number(report.cancellations)} tooltip={`Consultas com status cancelado e data entre ${date(report.resultsStart)} e ${date(new Date(Date.parse(report.resultsEnd) - 1).toISOString())}. Não é a data em que o cancelamento foi registrado.`} />
            <Metric label="Remarcações registradas" value={available ? number(history.reschedules) : "—"} tooltip={`${observed} Mudanças de horário, médico ou unidade de consultas agendadas/confirmadas.`} />
            <Metric label="Liberações a menos de 24h" value={available ? number(history.lateReleases) : "—"} tooltip={`${observed} Cancelamentos, exclusões ou remarcações que liberaram uma vaga menos de 24h antes da consulta.`} />
            <Metric label="Recuperação de vagas" value={available && history.settled ? `${number(history.recovered / history.settled * 100)}%` : "—"} caption={available ? history.settled ? `${number(history.recovered)} de ${number(history.settled)} vagas encerradas${pending ? ` · ${number(pending)} futuras` : ""}` : pending ? `${number(pending)} vagas ainda futuras` : "Sem vagas liberadas encerradas" : "Sem dados no período"} tooltip={`${observed} Vagas recuperadas ÷ vagas liberadas já encerradas. Outra consulta deve ocupar todo o intervalo. Vagas futuras não entram na taxa.`} />
        </div>
    </Card>;
}

function Metric({ label, value, caption, tooltip }: { label: string; value: string; caption?: string; tooltip: string }) {
    return <div className="min-w-0"><p className="flex items-center gap-1.5 text-xs text-muted">{label}<Info text={tooltip} /></p><p className="mt-2 text-2xl font-bold">{value}</p>{caption ? <p className="mt-1 text-xs text-muted">{caption}</p> : null}</div>;
}

function Info({ text }: { text: string }) {
    return <InfoTooltip text={text} portal><HelpCircle className="shrink-0 text-slate-400" size={13} /></InfoTooltip>;
}

function heatmapColor(percent: number) {
    const stops = [[240, 253, 244], [187, 247, 208], [253, 230, 138], [251, 146, 60], [239, 68, 68]];
    const position = Math.max(0, Math.min(100, percent)) / 25, index = Math.min(3, Math.floor(position)), mix = position - index;
    return `rgb(${stops[index].map((value, channel) => Math.round(value + (stops[index + 1][channel] - value) * mix)).join(", ")})`;
}

function OccupancyHeatmap({ report }: { report: AgendaIntelligenceReport }) {
    const hours = [...new Set(report.heatmap.map(cell => cell.hour))].sort((a, b) => a - b);
    const cells = new Map(report.heatmap.map(cell => [`${cell.weekday}:${cell.hour}`, cell]));
    if (!hours.length) return <p className="py-5 text-center text-sm text-muted">Sem disponibilidade no período.</p>;
    return <>
        <div className="overflow-x-auto"><table className="w-full text-center text-xs"><thead><tr><th className="p-2 text-muted">Dia</th>{hours.map(hour => <th key={hour} className="p-2 text-muted">{hour}h</th>)}</tr></thead>
            <tbody>{WEEKDAYS.map((day, weekday) => <tr key={day}><th className="p-2 text-left text-muted">{day}</th>{hours.map(hour => {
                const cell = cells.get(`${weekday}:${hour}`), percent = cell ? cell.occupiedMinutes / cell.capacityMinutes * 100 : null;
                return <td key={hour} className="p-1"><div className="rounded-lg px-3 py-3 font-semibold" style={{ backgroundColor: percent === null ? "#f8fafc" : heatmapColor(percent), color: percent === null ? "#cbd5e1" : percent >= 75 ? "#fff" : "#334155" }} title={cell ? `${number(cell.occupiedMinutes / 60)}h ocupadas de ${number(cell.capacityMinutes / 60)}h disponíveis` : "Sem disponibilidade"}>{percent === null ? "—" : `${Math.round(percent)}%`}</div></td>;
            })}</tr>)}</tbody></table></div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 pr-10 text-xs text-muted"><span>0%</span><div aria-label="Escala contínua de ocupação de 0 a 100%" className="h-2 w-36 rounded-full" style={{ background: "linear-gradient(to right, #f0fdf4, #bbf7d0, #fde68a, #fb923c, #ef4444)" }} /><span>100%</span><span className="ml-3 inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded bg-slate-100" />Sem disponibilidade</span></div>
    </>;
}
