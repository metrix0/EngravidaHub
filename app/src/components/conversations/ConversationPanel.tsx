// src/components/conversations/ConversationPanel.tsx
"use client";

import { useEffect, useState } from "react";
import {
    Calendar,
    Clock,
    Target,
    Phone,
    User,
    X, CircleAlert,
} from "lucide-react";
import { FaGoogle, FaMeta } from "react-icons/fa6";

import {
    getAdTagsForOutcomeEventType,
    type AdPlatformTag, QUALIFIED_LEAD_OUTCOME_EVENTS, SCHEDULE_OUTCOME_EVENTS,
} from "@engravida/lib";
import { InitialsAvatar } from "./InitialsAvatar";
import { ConversationResultBadge, type ConversationResult } from "./ConversationResultBadge";
import { Skeleton } from "../index";

type SenderType = "client" | "attendant" | "bot" | "system";

type PanelMessage = {
    id: string;
    sender_type: SenderType;
    sender_name: string | null;
    text: string;
    sent_at: string;
};

type PanelData = {
    conversation: {
        id: string;
        started_at: string;
        ended_at: string;
        attendant_chat_name: string | null;
        tunnel: string | null;
        origin: string | null;
    };
    client: {
        name: string | null;
        phone: string;
    };
    messages: PanelMessage[];
    analysis: any | null;
};

type ConversationPanelProps = {
    conversationId: string | null;
    onClose: () => void;
};

type Tab = "messages" | "analysis" | "events" | "details";

export function ConversationPanel({
                                      conversationId,
                                      onClose,
                                  }: ConversationPanelProps) {
    const [data, setData] = useState<PanelData | null>(null);
    const [loading, setLoading] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const [tab, setTab] = useState<Tab>("messages");

    useEffect(() => {
        if (!conversationId) return;

        setIsOpen(false);
        setData(null);
        setLoading(true);
        setTab("messages");

        const openTimer = window.setTimeout(() => {
            setIsOpen(true);
        }, 20);

        async function loadConversation() {
            const startedAt = Date.now();

            try {
                const response = await fetch(
                    `/api/dashboard/mensagens/${conversationId}`
                );

                const json: PanelData = await response.json();

                const elapsed = Date.now() - startedAt;
                const minimumLoadingTime = 500;

                if (elapsed < minimumLoadingTime) {
                    await new Promise((resolve) =>
                        window.setTimeout(resolve, minimumLoadingTime - elapsed)
                    );
                }

                setData(json);
            } finally {
                setLoading(false);
            }
        }

        loadConversation();

        return () => window.clearTimeout(openTimer);
    }, [conversationId]);

    if (!conversationId) return null;

    function handleClose() {
        setIsOpen(false);

        window.setTimeout(() => {
            onClose();
        }, 250);
    }

    const clientName = data?.client.name ?? "Cliente sem nome";
    const result = getResult(data?.analysis?.resolution_result);

    return (
        <div className="fixed inset-0 z-50 pointer-events-none">
            <div
                className={`pointer-events-auto absolute right-0 top-0 h-full w-[460px] border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-out ${
                    isOpen ? "translate-x-0" : "translate-x-full"
                }`}
            >
                <div className="flex h-full flex-col">
                    <div className="border-b border-slate-100 px-6 py-5">
                        <div className="mb-6 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-950">
                                Detalhes da conversa
                            </h2>

                            <button
                                type="button"
                                onClick={handleClose}
                                className="cursor-pointer rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-900"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {loading || !data ? (
                            <PanelHeaderSkeleton />
                        ) : (
                            <>
                                <div className="mb-5 flex items-start justify-between gap-4">
                                    <div className="flex min-w-0 items-center gap-4">
                                        <InitialsAvatar name={clientName} />

                                        <div className="min-w-0">
                                            <div
                                                title={clientName}
                                                className="truncate text-base font-bold text-slate-950"
                                            >
                                                {clientName}
                                            </div>

                                            <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                                                <Phone size={15} />
                                                <span>{data.client.phone}</span>
                                            </div>

                                            <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                                                <Calendar size={15} />
                                                <span className={"truncate"} title={`${formatDateTime(data.conversation.started_at)} - ${formatDateTime(data.conversation.ended_at)}`}>
                                                    {formatDateTime(data.conversation.started_at)} - {formatDateTime(data.conversation.ended_at)}
                                                        </span>
                                            </div>
                                        </div>
                                    </div>

                                    <span title={`Resolução ${result}`}><ConversationResultBadge result={result} /></span>
                                </div>

                                <div className="grid grid-cols-3 gap-4 text-xs">
                                    <InfoItem
                                        icon={<User size={18} />}
                                        label="Atendente"
                                        value={
                                            data.conversation.attendant_chat_name ??
                                            "Sem atendente"
                                        }
                                    />

                                    <InfoItem
                                        icon={<Target size={18} />}
                                        label="Resolução"
                                        value={
                                            data.analysis.resolution_score+"%"
                                        }
                                    />

                                    <InfoItem
                                        icon={<Clock size={18} />}
                                        label="Duração"
                                        value={formatDuration(
                                            data.conversation.started_at,
                                            data.conversation.ended_at
                                        )}
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex border-b border-slate-100">
                        <PanelTab
                            active={tab === "messages"}
                            onClick={() => setTab("messages")}
                        >
                            Mensagens
                        </PanelTab>

                        <PanelTab
                            active={tab === "analysis"}
                            onClick={() => setTab("analysis")}
                        >
                            Análise
                        </PanelTab>

                        <PanelTab
                            active={tab === "events"}
                            onClick={() => setTab("events")}
                        >
                            Eventos
                        </PanelTab>

                        <PanelTab
                            active={tab === "details"}
                            onClick={() => setTab("details")}
                        >
                            Detalhes
                        </PanelTab>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                        {loading || !data ? (
                            <PanelBodySkeleton />
                        ) : (
                            <>
                                {tab === "messages" && (
                                    <MessagesTab messages={data.messages} />
                                )}

                                {tab === "analysis" && (
                                    <AnalysisTab analysis={data.analysis} />
                                )}

                                {tab === "events" && (
                                    <EventsTab analysis={data.analysis} />
                                )}

                                {tab === "details" && (
                                    <DetailsTab data={data} />
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function MessagesTab({ messages }: { messages: PanelMessage[] }) {
    if (messages.length === 0) {
        return (
            <div className="rounded-xl border border-slate-100 p-4 text-sm text-slate-500">
                Nenhuma mensagem encontrada.
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {messages.map((message) => {
                const isClient = message.sender_type === "client";
                const isAttendant = message.sender_type === "attendant";
                const isBot = message.sender_type === "bot";

                const label = isClient
                    ? "Cliente"
                    : isAttendant
                        ? message.sender_name ?? "Atendente"
                        : isBot
                            ? "Bot"
                            : "Sistema";

                return (
                    <div
                        key={message.id}
                        className={`flex gap-3 ${
                            isClient ? "justify-start" : "justify-end"
                        }`}
                    >
                        {isClient && (
                            <InitialsAvatar name={message.sender_name ?? "Cliente"} />
                        )}

                        <div
                            className={`max-w-[75%] ${
                                isClient ? "items-start" : "items-end"
                            } flex flex-col`}
                        >
                            <div className="mb-1 text-xs font-medium text-slate-500">
                                {label}{" "}
                                <span className="font-normal">
                                    {formatTime(message.sent_at)}
                                </span>
                            </div>

                            <div
                                title={message.text}
                                className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                                    isClient
                                        ? "bg-slate-100 text-slate-800"
                                        : "bg-purple-soft text-slate-800"
                                }`}
                            >
                                {message.text}
                            </div>
                        </div>

                        {!isClient && (
                            <InitialsAvatar name={message.sender_name ?? label} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function AnalysisTab({ analysis }: { analysis: any | null }) {
    if (!analysis) {
        return <EmptyPanelMessage text="Essa conversa ainda não possui análise." />;
    }

    return (
        <div className="space-y-4">
            <SummaryCard title="Resumo da análise">
                <InfoGrid
                    items={[
                        ["Objetivo", getGoalLabel(analysis.conversation_goal)],
                        ["Status do objetivo", getGoalStatusLabel(analysis.goal_status)],
                        ["Resultado", getResultLabel(analysis.resolution_result)],
                        ["Estado final", getFinalStateLabel(analysis.customer_final_state)],
                        ["Satisfação", `${analysis.satisfaction_score ?? 0}%`],
                        ["Resolução", `${analysis.resolution_score ?? 0}%`],
                    ]}
                />
            </SummaryCard>

            {analysis.notable && (
                <SummaryCard title={null}>
                    <div className="mb-2 flex items-center gap-2 font-bold text-amber-800 ">
                        <CircleAlert className="h-4 w-4" />Conversa notável
                    </div>

                    <p className="text-sm leading-relaxed text-amber-800/80">
                        {analysis.notable_reason ?? "Motivo não descrito."}
                    </p>
                </SummaryCard>
            )}

            <SummaryCard title="Intenção inicial">
                <p className="text-sm leading-relaxed text-slate-600">
                    {getGoalLabel(analysis.customer_start_intent) ?? "Sem intenção registrada."}
                </p>
            </SummaryCard>

            {analysis.dropoff_happened && (
                <SummaryCard title="Perda / abandono">
                    <InfoGrid
                        items={[
                            ["Momento", getDropoffLabel(analysis.dropoff_moment)],
                            ["Motivo provável", analysis.dropoff_likely_reason ?? "-"],
                            ["Confiança", `${Math.round((analysis.dropoff_confidence ?? 0) * 100)}%`],
                        ]}
                    />
                </SummaryCard>
            )}
        </div>
    );
}

function EventsTab({ analysis }: { analysis: any | null }) {
    const events = analysis?.outcome_events ?? [];

    if (!analysis || events.length === 0) {
        return <EmptyPanelMessage text="Nenhum evento encontrado." />;
    }

    return (
        <div className="space-y-3">
            {events.map((event: any, index: number) => {
                const adTags = getAdTagsForOutcomeEventType(event.type);
                const conversionLabel = getAdConversionLabel(event.type);

                return (
                    <div
                        key={`${event.type}-${index}`}
                        className="rounded-xl border border-slate-100 p-4"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div
                                    title={getEventLabel(event.type)}
                                    className="truncate font-semibold text-slate-800"
                                >
                                    {getEventLabel(event.type)}
                                </div>

                                <div className="mt-1 text-sm text-slate-500">
                                    Confiança: {Math.round((event.confidence ?? 0) * 100)}%
                                </div>

                                {event.occurred_at && (
                                    <div className="mt-1 text-sm text-slate-500">
                                        {formatDateTime(event.occurred_at)}
                                    </div>
                                )}
                            </div>

                            {adTags.length > 0 && conversionLabel && (
                                <div className="flex flex-col shrink-0 flex-wrap justify-end gap-2">
                                    {adTags.map((tag) => (
                                        <AdTagBadge
                                            key={tag}
                                            tag={tag}
                                            conversionLabel={conversionLabel}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function getAdConversionLabel(eventType: string) {
    if (
        QUALIFIED_LEAD_OUTCOME_EVENTS.includes(eventType as any)
    ) {
        return "Qualified Lead";
    }

    if (
        SCHEDULE_OUTCOME_EVENTS.includes(eventType as any)
    ) {
        return "Schedule";
    }

    return null;
}

function AdTagBadge({
                        tag,
                        conversionLabel,
                    }: {
    tag: AdPlatformTag;
    conversionLabel: string;
}) {
    const className =
        tag === "Meta Ads"
            ? "bg-blue-100 text-blue-700"
            : "bg-amber-100 text-amber-700";
    const icon = tag === "Meta Ads" ? <FaMeta className="h-4 w-4" /> : <FaGoogle className="h-3 w-3" />;

    return (
        <span
            title={conversionLabel}
            className={`inline-flex gap-2 rounded-md px-2 py-1 text-[11px] font-bold ${className}`}
        >
            {icon} {conversionLabel}
        </span>
    );
}


function DetailsTab({ data }: { data: PanelData }) {
    return (
        <div className="space-y-4">
            <SummaryCard title="Conversa">
                <InfoGrid
                    items={[
                        ["ID", data.conversation.id],
                        ["Cliente", data.client.name ?? "Cliente sem nome"],
                        ["Telefone", data.client.phone],
                        ["Data inicial", formatDateTime(data.conversation.started_at)],
                        [
                            "Data final",
                            data.conversation.ended_at
                                ? formatDateTime(data.conversation.ended_at)
                                : "-",
                        ],
                        [
                            "Duração",
                            formatDuration(
                                data.conversation.started_at,
                                data.conversation.ended_at
                            ),
                        ],
                        [
                            "Atendente",
                            data.conversation.attendant_chat_name ?? "Sem atendente",
                        ],
                        ["Túnel", data.conversation.tunnel ?? "Não definido"],
                        ["Origem", data.conversation.origin ?? "Não definido"],
                    ]}
                />
            </SummaryCard>
        </div>
    );
}

function InfoItem({
                      icon,
                      label,
                      value,
                  }: {
    icon: React.ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="flex min-w-0 items-start gap-2">
            <div className="mt-0.5 text-slate-400">{icon}</div>

            <div className="min-w-0">
                <div className="text-slate-500">{label}</div>
                <div title={value} className="truncate font-semibold text-slate-700">
                    {value}
                </div>
            </div>
        </div>
    );
}

function PanelTab({
                      active,
                      onClick,
                      children,
                  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 cursor-pointer border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                active
                    ? "border-brand text-brand"
                    : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
        >
            {children}
        </button>
    );
}

function SummaryCard({
                         title,
                         children,
                     }: {
    title: string | null;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-xl border border-slate-100 p-4">
            {title && <h3 className="mb-4 font-bold text-slate-900">{title}</h3>}
            {children}
        </div>
    );
}

function InfoGrid({ items }: { items: [string, string][] }) {
    return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            {items.map(([label, value]) => (
                <div key={label} className="min-w-0">
                    <div className="text-xs text-slate-500">{label}</div>
                    <div title={value} className="mt-1 truncate font-semibold text-slate-700">
                        {value}
                    </div>
                </div>
            ))}
        </div>
    );
}

function EmptyPanelMessage({ text }: { text: string }) {
    return (
        <div className="rounded-xl border border-slate-100 p-4 text-sm text-slate-500">
            {text}
        </div>
    );
}

function PanelHeaderSkeleton() {
    return (
        <div>
            <div className="mb-5 flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                    <Skeleton className="h-9 w-9 rounded-full" />

                    <div className="min-w-0 flex-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="mt-3 h-3 w-28" />
                        <Skeleton className="mt-3 h-3 w-36" />
                    </div>
                </div>

                <Skeleton className="h-6 w-20 rounded-md" />
            </div>

            <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
            </div>
        </div>
    );
}
function PanelBodySkeleton() {
    return (
        <div className="space-y-5">
            <div className="flex gap-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />

                <div className="max-w-[75%]">
                    <Skeleton className="mb-2 h-3 w-24" />
                    <Skeleton className="h-16 w-56" />
                </div>
            </div>

            <div className="flex justify-end gap-3">
                <div className="max-w-[75%]">
                    <Skeleton className="mb-2 ml-auto h-3 w-28" />
                    <Skeleton className="h-20 w-64" />
                </div>

                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            </div>

            <div className="flex gap-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />

                <div className="max-w-[75%]">
                    <Skeleton className="mb-2 h-3 w-24" />
                    <Skeleton className="h-12 w-48" />
                </div>
            </div>

            <div className="flex justify-end gap-3">
                <div className="max-w-[75%]">
                    <Skeleton className="mb-2 ml-auto h-3 w-28" />
                    <Skeleton className="h-16 w-60" />
                </div>

                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            </div>
        </div>
    );
}
function getResult(value: string | null | undefined): ConversationResult {
    if (value === "resolved") return "resolvida";
    if (value === "partial") return "parcial";
    if (value === "not_resolved") return "nao_resolvida";

    return "pendente";
}
function formatDateTime(value: string) {
    const date = new Date(value);

    return `${date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    })} às ${date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
    })}`;
}

function formatTime(value: string) {
    return new Date(value).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDuration(startValue: string, endValue: string | null) {
    if (!endValue) return "-";

    const start = new Date(startValue).getTime();
    const end = new Date(endValue).getTime();

    const diffMinutes = Math.max(0, Math.round((end - start) / 1000 / 60));

    if (diffMinutes < 60) return `${diffMinutes} min`;

    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;

    return `${hours}h ${minutes}min`;
}

function getGoalLabel(value: string) {
    const labels: Record<string, string> = {
        answer_information: "Informação",
        schedule_consultation: "Agendar consulta",
        reschedule_consultation: "Reagendar",
        confirm_attendance: "Confirmar presença",
        recover_inactive_lead: "Recuperar lead",
        explain_treatment: "Explicar tratamento",
        handle_price_objection: "Objeção de preço",
        collect_documents_or_exams: "Documentos/exames",
        post_consultation_followup: "Pós-consulta",
        asked_to_think: "Pediu para pensar",
        other: "Outro",
    };

    return labels[value] ?? value ?? "-";
}

function getGoalStatusLabel(value: string) {
    const labels: Record<string, string> = {
        achieved: "Alcançado",
        partially_achieved: "Parcial",
        not_achieved: "Não alcançado",
        unclear: "Incerto",
    };

    return labels[value] ?? value ?? "-";
}

function getFinalStateLabel(value: string) {
    const labels: Record<string, string> = {
        scheduled: "Agendado",
        rescheduled: "Reagendado",
        confirmed_attendance: "Presença confirmada",
        received_information: "Recebeu informação",
        asked_to_think: "Pediu para pensar",
        objected_to_price: "Objeção de preço",
        stopped_responding: "Parou de responder",
        redirected: "Redirecionado",
        not_qualified: "Não qualificado",
        unclear: "Incerto",
    };

    return labels[value] ?? value ?? "-";
}

function getResultLabel(value: string) {
    const labels: Record<string, string> = {
        resolved: "Resolvida",
        partial: "Parcial",
        not_resolved: "Não resolvida",
    };

    return labels[value] ?? value ?? "-";
}

function getDropoffLabel(value: string | null) {
    const labels: Record<string, string> = {
        after_price: "Após preço",
        after_consultation_online: "Após consulta online",
        after_unit_presented: "Após unidade apresentada",
        after_schedule_options: "Após opções de agendamento",
        after_payment_info: "Após informação de pagamento",
        after_medical_question: "Após pergunta médica",
        after_delay: "Após demora",
        unknown: "Desconhecido",
    };

    if (!value) return "-";

    return labels[value] ?? value;
}

function getEventLabel(value: string) {
    const labels: Record<string, string> = {
        information_requested: "Informação solicitada",
        information_answered: "Informação respondida",
        consultation_offered: "Consulta oferecida",
        price_presented: "Preço apresentado",
        objection_raised: "Objeção levantada",
        appointment_scheduled: "Agendamento realizado",
        appointment_rescheduled: "Agendamento remarcado",
        attendance_confirmed: "Presença confirmada",
        customer_stopped_responding: "Cliente parou de responder",
        attendant_followed_up: "Atendente fez follow-up",
        customer_returned: "Cliente retornou",
        handoff_to_human: "Transferido para humano",
        handoff_to_unit: "Transferido para unidade",
    };

    return labels[value] ?? value;
}