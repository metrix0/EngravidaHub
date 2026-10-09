"use client";

import { ArrowUpRight, CalendarCheck, HelpCircle } from "lucide-react";
import Card from "@/components/ui/Card";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { HoverBadgeList } from "@/components/ui/HoverBadgeList";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
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
            <h3 className="flex items-center gap-2 text-lg font-bold">Demanda × disponibilidade<InfoTooltip portal text={`Compara clientes sem agendamento identificado com vagas compatíveis nos próximos ${report.days} dias. Usa a análise existente e consultas posteriores ao pedido. Exclui quem já agendou, inclusive em outro horário, e casos incertos. Cada cliente conta uma vez por preferência. Mostra até 3 preferências registradas em pelo menos 3 conversas. Confirme o interesse antes de oferecer vagas ou ampliar a agenda. Médicos sem agenda sincronizada são ignorados no cálculo. Preferências podem compartilhar vagas.`}><HelpCircle size={14} className="shrink-0 text-slate-400" /></InfoTooltip></h3>
            <p className="mt-1 text-sm text-muted">Casos para revisar e vagas nos horários pedidos.</p>
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
                        <ComparisonBar label="Casos sem agendamento" value={item.conversations} scale={scale} color="bg-brand" />
                        <ComparisonBar label="Vagas compatíveis" value={item.availableSlots} scale={scale} color="bg-blue" />
                    </div>
                    <div className="mt-auto border-t border-slate-100 pt-3 text-sm">
                        <p className="font-semibold">{item.action === "expand" ? "Confirme o interesse antes de abrir horários." : "Revise as conversas antes de oferecer uma vaga."}</p>
                        {first ? <div className="mt-2 text-xs text-muted"><p>Primeira vaga: <span className="font-semibold text-slate-700">{new Date(first.startsAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></p><p className="mt-1">{formatDoctorName(first.doctorName)}</p></div> : null}
                        {item.contacts.length ? <div className="mt-3 border-t border-slate-100 pt-3">
                            <p className="mb-2 text-xs font-semibold text-muted">Sem agendamento</p>
                            <HoverBadgeList items={item.contacts.map(id => {
                                const contact = report.evidenceDetails[id];
                                return { key: id, label: contact?.name ?? "Ver conversa", className: "bg-blue-soft text-blue", title: contact?.name ?? "Ver conversa", ariaLabel: `Abrir conversa de ${contact?.name ?? "cliente"}`, onClick: () => openFloatingConversation({ type: "conversation", id }) };
                            })} badgeClassName="rounded-md px-2.5 py-1 text-xs font-bold" maxBadgeWidthClassName="max-w-full" />
                        </div> : null}
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
