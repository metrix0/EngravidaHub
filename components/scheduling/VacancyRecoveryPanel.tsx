"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, MessageCircle, Send } from "lucide-react";
import { formatDoctorName } from "@/lib/scheduling/formatDoctorName";
import type { AgendaFreeSlot } from "@/lib/scheduling/operationalAgenda";
import type { RecoveryCandidate } from "@/lib/scheduling/slotRecoveryServer";

type Detail = { filled: boolean; candidates: RecoveryCandidate[] };

const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short",
}).format(new Date(value));

const labels: Record<RecoveryCandidate["status"], string> = {
    available: "Disponível",
    pending: "Enviando",
    contacted: "Contatado",
    responded: "Respondeu",
    booked: "Agendado",
    failed: "Falha no envio",
};

export default function VacancyRecoveryPanel({
    slot, vacancyId, onUpdate, onBook,
}: {
    slot: AgendaFreeSlot;
    vacancyId: number;
    onUpdate: () => void;
    onBook: (slot: AgendaFreeSlot) => void;
}) {
    const [data, setData] = useState<Detail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState<string | null>(null);
    const reload = useCallback(async (signal?: AbortSignal) => {
        try {
            const response = await fetch(`/api/scheduling/recovery?vacancy_id=${vacancyId}`, {
                cache: "no-store", signal,
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? "Erro ao carregar candidatos.");
            if (!signal?.aborted) { setData(body); setError(null); }
        } catch (reason) {
            if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Erro ao carregar candidatos.");
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, [vacancyId]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setData(null);
        void reload(controller.signal);
        const timer = window.setInterval(() => void reload(controller.signal), 30_000);
        return () => { controller.abort(); window.clearInterval(timer); };
    }, [reload]);

    async function contact(clientId: string) {
        if (sending || data?.filled) return;
        setSending(clientId);
        setError(null);
        try {
            const response = await fetch("/api/scheduling/recovery", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vacancy_id: vacancyId, client_id: clientId }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? "Não foi possível enviar.");
            await reload();
            onUpdate();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Falha no contato.");
            await reload();
        } finally {
            setSending(null);
        }
    }

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-orange/30 bg-orange-soft p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <CalendarClock size={17} className="text-orange" />
                    {dateTime(slot.startsAt)}
                </div>
                <p className="mt-2 text-sm text-slate-700">
                    {formatDoctorName(slot.doctorName)} · {slot.unitName}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                    Horário liberado por cancelamento ou reagendamento
                </p>
            </div>

            {error && <p role="alert" className="rounded-xl border border-red/30 bg-red-soft p-3 text-sm text-red">{error}</p>}

            {data?.filled ? (
                <div className="flex items-center gap-2 rounded-xl border border-green/20 bg-green-soft p-3 text-sm font-semibold text-green">
                    <CheckCircle2 size={17} /> Horário preenchido. Novos contatos desativados.
                </div>
            ) : (
                <button type="button" onClick={() => onBook(slot)}
                    className="w-full cursor-pointer rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    Agendar neste horário
                </button>
            )}

            <div>
                <h3 className="text-sm font-bold text-slate-900">Melhores candidatos</h3>
                <p className="mt-1 text-xs text-slate-500">
                    Prioridade para pacientes da unidade com consulta mais distante, serviço compatível e interesse recente.
                    A preferência por médico não é presumida.
                </p>
            </div>

            {loading && <p className="py-8 text-center text-sm text-muted">Buscando candidatos...</p>}
            {!loading && data?.candidates.length === 0 &&
                <p className="rounded-xl border border-slate-200 p-4 text-sm text-muted">
                    Nenhum candidato compatível encontrado.
                </p>}
            <div className="space-y-3">
                {data?.candidates.map((candidate, index) => (
                    <div key={candidate.clientId} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-900">{index + 1}. {candidate.name}</p>
                                <div className="mt-1 space-y-1">
                                    {candidate.reasons.map(reason =>
                                        <p key={reason} className="text-xs text-slate-500">{reason}</p>)}
                                </div>
                            </div>
                            <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                                {labels[candidate.status]}
                            </span>
                        </div>
                        {candidate.contactedAt &&
                            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                                <MessageCircle size={13} />
                                Contatado em {dateTime(candidate.contactedAt)}
                            </p>}
                        {candidate.recentContact && candidate.status === "available" &&
                            <p className="mt-2 text-xs text-orange">Contato recente — aguarde antes de reenviar.</p>}
                        {candidate.error && <p className="mt-2 text-xs text-red">{candidate.error}</p>}
                        {candidate.canContact && !data?.filled &&
                            <button type="button" disabled={Boolean(sending)}
                                onClick={() => void contact(candidate.clientId)}
                                className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
                                <Send size={14} />
                                {sending === candidate.clientId ? "Enviando..." : "Contatar automaticamente"}
                            </button>}
                    </div>
                ))}
            </div>
        </div>
    );
}
