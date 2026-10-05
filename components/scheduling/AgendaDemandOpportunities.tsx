"use client";

import { ArrowUpRight, CalendarCheck, HelpCircle } from "lucide-react";
import Card from "@/components/ui/Card";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { formatDoctorName } from "@/lib/scheduling/formatDoctorName";
import type { AgendaIntelligenceReport } from "@/lib/scheduling/agendaIntelligence";

const number = (value: number) => value.toLocaleString("pt-BR");
const actions = {
    expand: { title: "Avalie abrir horários", classes: "border-orange/20 bg-orange-soft text-orange" },
    fill: { title: "Use as vagas existentes", classes: "border-green/20 bg-green-soft text-green" },
};

export default function AgendaDemandOpportunities({ report }: { report: AgendaIntelligenceReport }) {
    return <Card className="@container">
        <div className="mb-5">
            <h3 className="flex items-center gap-2 text-lg font-bold">Demanda × disponibilidade<InfoTooltip portal text={`Compara conversas distintas no período selecionado com vagas compatíveis nos próximos ${report.days} dias. Destaca até 3 preferências com pelo menos 3 conversas, priorizando a maior diferença entre interesse e vagas. Agendas incompletas não geram sugestões de expansão. Conversas podem já ter sido atendidas; isto não prevê novos agendamentos. Preferências podem compartilhar vagas.`}><HelpCircle size={14} className="shrink-0 text-slate-400" /></InfoTooltip></h3>
            <p className="mt-1 text-sm text-muted">Onde abrir horários e onde aproveitar as vagas que já existem.</p>
        </div>
        {report.opportunities.length ? <div className="grid gap-4 @3xl:grid-cols-3">
            {report.opportunities.map(item => {
                const action = actions[item.action], scale = Math.max(item.conversations, item.availableSlots);
                const first = item.firstCompatibleSlot;
                return <article key={`${item.unitId}:${item.value}`} className="flex min-w-0 flex-col rounded-xl border border-slate-200 p-4">
                    <span className={`mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${action.classes}`}>
                        {item.action === "expand" ? <ArrowUpRight size={14} /> : <CalendarCheck size={14} />}{action.title}
                    </span>
                    <h4 className="font-bold">{item.unitName}</h4>
                    <p className="mt-1 min-h-8 text-sm text-muted">{item.label}</p>
                    <div className="my-5 space-y-3">
                        <ComparisonBar label="Conversas que pediram" value={item.conversations} scale={scale} color="bg-brand" />
                        <ComparisonBar label={`Vagas compatíveis${item.coverageComplete ? "" : " (parcial)"}`} value={item.availableSlots} scale={scale} color="bg-blue" />
                    </div>
                    <div className="mt-auto border-t border-slate-100 pt-3 text-sm">
                        <p className="font-semibold">{item.action === "expand" ? item.availableSlots === 0 ? "Nenhuma vaga nesse horário." : "Menos vagas que conversas interessadas." : "Há vagas para esse interesse registrado."}</p>
                        {first ? <div className="mt-2 text-xs text-muted"><p>Primeira vaga: <span className="font-semibold text-slate-700">{new Date(first.startsAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></p><p className="mt-1">{formatDoctorName(first.doctorName)}</p></div> : null}
                    </div>
                </article>;
            })}
        </div> : <p className="py-5 text-center text-sm text-muted">Sem oportunidades com dados suficientes para comparar.</p>}
    </Card>;
}

function ComparisonBar({ label, value, scale, color }: { label: string; value: number; scale: number; color: string }) {
    return <div>
        <div className="mb-1.5 flex items-center justify-between gap-2"><span className="text-xs text-muted">{label}</span><span className="text-lg font-bold tabular-nums">{number(value)}</span></div>
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${value / scale * 100}%` }} /></div>
    </div>;
}
