// components/clientes/ClientAcquisitionSection.tsx
"use client";

import Image from "next/image";
import type { ClientAcquisition } from "@/lib/clients/acquisition";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";

const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const when = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? formatter.format(new Date(value)) : "Data não registrada";
const statusLabels: Record<string, string> = { scheduled: "Agendado", confirmed: "Confirmado", completed: "Concluído", cancelled: "Cancelado", no_show: "Não compareceu" };

export default function ClientAcquisitionSection({ data }: { data: ClientAcquisition }) {
    return <section aria-label="Origem e rastreamento" className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-text">Origem e rastreamento</h3>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {data.fields.map(field => <div key={field.key} className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{field.label}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-slate-700">{field.value ?? "Não registrado"}</dd>
            </div>)}
        </dl>
        <p className="mt-3 text-xs text-muted">O termo UTM é a palavra-chave registrada; o texto exato pesquisado no Google não está disponível neste cadastro.</p>
        {data.trackingUpdatedAt ? <p className="mt-2 text-xs text-muted">Rastreamento atualizado em {when(data.trackingUpdatedAt)}</p> : null}
        {data.identifiers.length ? <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-slate-600">Identificadores de rastreamento</summary>
            <dl className="mt-3 space-y-3">{data.identifiers.map(field => <div key={field.key}>
                <dt className="text-xs font-semibold text-slate-500">{field.label}</dt>
                <dd className="mt-1 break-all text-xs text-slate-600">{field.value}</dd>
            </div>)}</dl>
        </details> : null}
        {data.socialProfiles.length ? <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-500">Perfis sociais vinculados</p>
            {data.socialProfiles.map(profile => <p key={profile.id} className="mt-1 break-words text-sm text-slate-700">
                {profile.name}{profile.username ? ` · @${profile.username.replace(/^@+/, "")}` : ""}
            </p>)}
        </div> : null}
        {data.appointments.length ? <div className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="text-sm font-bold text-slate-800">Agendamentos pelo Hub · Direct / Messenger</h4>
            <ul className="mt-3 space-y-4">{data.appointments.map(appointment => {
                const ad = data.ads.find(item => item.id === appointment.adAttributionId);
                return <li key={appointment.id} className="rounded-xl border border-slate-200 p-3">
                    <p className="break-words text-sm font-semibold text-slate-800">{appointment.procedure ?? "Consulta"}</p>
                    <p className="mt-1 text-xs text-slate-600">{when(appointment.startsAt)} · {statusLabels[appointment.status ?? ""] ?? appointment.status ?? "Status não registrado"}</p>
                    <p className="mt-1 text-xs text-muted">Marcado em {when(appointment.createdAt)} · {appointment.channel}</p>
                    <p className="mt-2 break-words text-xs text-slate-600">{ad ? `Anúncio: ${ad.name ?? ad.adId ?? "Referência registrada"}` : "Sem referência de anúncio registrada antes deste agendamento na conversa."}</p>
                    <button type="button" onClick={() => openFloatingConversation({ type: "thread", id: appointment.threadId })}
                        className="mt-2 cursor-pointer text-xs font-semibold text-brand">Abrir conversa do agendamento</button>
                </li>;
            })}</ul>
        </div> : null}
        {data.ads.length ? <div className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="text-sm font-bold text-slate-800">Histórico de anúncios</h4>
            <ul className="mt-3 space-y-4">{data.ads.map(ad => <li key={ad.id} className="min-w-0 rounded-xl border border-slate-200 p-3">
                <p className="break-words text-sm font-semibold text-slate-800">{ad.name ?? (ad.adId ? `Anúncio ${ad.adId}` : "Referência de anúncio")}</p>
                <p className="mt-1 text-xs text-muted">{when(ad.receivedAt)} · {ad.channel ?? "Meta"}</p>
                <dl className="mt-3 space-y-2 text-xs text-slate-600">
                    {ad.adId ? <div><dt className="font-semibold">ID do anúncio</dt><dd className="break-all">{ad.adId}</dd></div> : null}
                    {ad.campaignName || ad.campaignId ? <div><dt className="font-semibold">Campanha</dt><dd className="break-words">{ad.campaignName ?? ad.campaignId}</dd></div> : null}
                    {ad.adSetName || ad.adSetId ? <div><dt className="font-semibold">Conjunto</dt><dd className="break-words">{ad.adSetName ?? ad.adSetId}</dd></div> : null}
                </dl>
                {ad.imageUrl ? <Image src={ad.imageUrl} alt={ad.name ?? "Criativo do anúncio"} width={640} height={400} unoptimized className="mt-3 max-h-64 w-full rounded-lg object-contain" /> : null}
                {ad.videoUrl ? <video src={ad.videoUrl} controls preload="none" className="mt-3 max-h-64 w-full rounded-lg" /> : null}
                {!ad.name || (!ad.imageUrl && !ad.videoUrl) ? <p className="mt-2 text-xs text-muted">A integração não disponibilizou { !ad.name ? "o nome" : "o criativo"}{!ad.name && !ad.imageUrl && !ad.videoUrl ? " e o criativo" : ""} deste anúncio.</p> : null}
                {ad.threadId ? <button type="button" onClick={() => openFloatingConversation({ type: "thread", id: ad.threadId! })}
                    className="mt-2 cursor-pointer text-xs font-semibold text-brand">Abrir conversa deste anúncio</button> : null}
            </li>)}</ul>
        </div> : null}
    </section>;
}
