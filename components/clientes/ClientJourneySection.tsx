// components/clientes/ClientJourneySection.tsx
"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ChevronDown, CircleCheck, Megaphone, MessageCircle, PhoneCall, Receipt } from "lucide-react";
import ClientAcquisitionSection from "@/components/clientes/ClientAcquisitionSection";
import type { ClientAcquisition } from "@/lib/clients/acquisition";
import { Skeleton } from "@/components";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
import type { IndividualJourney, IndividualJourneyEvent, JourneyCategory } from "@/lib/clients/individualJourney";

const icons: Record<JourneyCategory, typeof CalendarClock> = {
    origem: Megaphone,
    conversa: MessageCircle,
    contato: PhoneCall,
    agendamento: CalendarClock,
    procedimento: CircleCheck,
    financeiro: Receipt,
};
const dateTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
});
function formatWhen(event: IndividualJourneyEvent) {
    if (event.dateOnly) {
        const parts = event.occurredAt.slice(0, 10).split("-");
        return parts[2] + "/" + parts[1] + "/" + parts[0];
    }
    return dateTime.format(new Date(event.occurredAt));
}

export default function ClientJourneySection({ clientId }: { clientId: string }) {
    const [journey, setJourney] = useState<(IndividualJourney & { acquisition?: ClientAcquisition }) | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [visible, setVisible] = useState(80);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setJourney(null);
        setError(null);
        setVisible(80);
        // Schedule independently of the profile API and initial panel paint.
        const timer = window.setTimeout(() => {
            void (async () => {
                try {
                    const response = await fetch(
                        "/api/clientes/" + encodeURIComponent(clientId) + "/journey",
                        { cache: "no-store", signal: controller.signal },
                    );
                    const payload = await response.json();
                    if (!response.ok) throw new Error(payload?.error ?? "Falha ao carregar jornada.");
                    if (!controller.signal.aborted) setJourney(payload as IndividualJourney);
                } catch (cause) {
                    if (!controller.signal.aborted) setError(
                        cause instanceof Error ? cause.message : "Falha ao carregar jornada.",
                    );
                }
            })();
        }, 150);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [clientId, retry]);

    return (
        <>
        {journey?.acquisition ? <ClientAcquisitionSection data={journey.acquisition} /> : null}
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-lg font-bold text-text">Jornada individual</h3>
                    <p className="mt-1 text-xs text-muted">Do primeiro contato aos procedimentos registrados</p>
                </div>
            </div>
            {!journey && !error ? (
                <div className="mt-5 space-y-3" aria-busy="true">
                    <Skeleton className="h-12 rounded-lg" />
                    <Skeleton className="h-12 rounded-lg" />
                    <Skeleton className="h-12 rounded-lg" />
                </div>
            ) : error ? (
                <div className="mt-4">
                    <p role="alert" className="text-sm text-red">{error}</p>
                    <button type="button" onClick={() => setRetry(count => count + 1)}
                        className="mt-2 cursor-pointer text-sm font-semibold text-brand">
                        Tentar novamente
                    </button>
                </div>
            ) : journey?.events.length === 0 ? (
                <p className="mt-4 text-sm text-muted">Ainda não há eventos vinculados a este cliente.</p>
            ) : journey ? (
                <>
                    <p className="mt-3 text-xs font-semibold text-slate-500">
                        {journey.events.length.toLocaleString("pt-BR")} eventos identificados
                    </p>
                    {journey.partial && (
                        <p className="mt-2 text-xs text-orange">Há mais registros históricos do que o limite por fonte; a lista pode estar incompleta.</p>
                    )}
                    <ol className="mt-4 space-y-0">
                        {journey.events.slice(0, visible).map((event, index) => {
                            const Icon = icons[event.category];
                            return (
                                <li key={event.id} className="relative flex items-start gap-3 pb-5 last:pb-0">
                                    {index < Math.min(visible, journey.events.length) - 1 && (
                                        <span className="absolute bottom-0 left-[13px] top-7 w-px bg-slate-200" aria-hidden="true" />
                                    )}
                                    <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500">
                                        <Icon size={14} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-semibold text-slate-500">
                                            {formatWhen(event)}{event.dateOnly ? " · Sem horário" : ""}
                                        </p>
                                        {event.conversationId ? (
                                            <button type="button"
                                                onClick={() => openFloatingConversation({ type: "conversation", id: event.conversationId! })}
                                                className="mt-0.5 cursor-pointer text-left text-sm font-semibold text-slate-800 hover:text-brand">
                                                {event.title}
                                            </button>
                                        ) : (
                                            <p className="mt-0.5 text-sm font-semibold text-slate-800">{event.title}</p>
                                        )}
                                        {event.detail && <p className="mt-0.5 break-words text-xs leading-relaxed text-slate-600">{event.detail}</p>}
                                        <p className="mt-1 text-[11px] text-slate-400">
                                            {event.source}{event.evidence === "inferido" ? " · Inferido por IA" : ""}
                                        </p>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                    {journey.events.length > visible && (
                        <button type="button" onClick={() => setVisible(count => count + 80)}
                            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                            <ChevronDown size={15} /> Mostrar mais eventos
                        </button>
                    )}
                </>
            ) : null}
        </section>
        </>
    );
}
