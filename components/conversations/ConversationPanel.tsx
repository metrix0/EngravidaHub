// components/conversations/ConversationPanel.tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Calendar, CircleAlert, Clock, Phone, Target, User } from "lucide-react";
import { FaGoogle, FaMeta } from "react-icons/fa6";

import {
    getAdTagsForOutcomeEventType,
    type AdPlatformTag,
    QUALIFIED_LEAD_OUTCOME_EVENTS,
    SCHEDULE_OUTCOME_EVENTS,
} from "@/lib";
import { DetailsSidePanel, Skeleton } from "@/components";
import { InitialsAvatar } from "./InitialsAvatar";
import { OPEN_CONVERSATION_DETAILS_EVENT } from "./FloatingConversationPanel";
import {
    ConversationResultBadge,
    type ConversationResult,
} from "./ConversationResultBadge";

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
        ended_at: string | null;
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

export function ConversationPanel({ conversationId, onClose }: ConversationPanelProps) {
    const [data, setData] = useState<PanelData | null>(null);
    const [loading, setLoading] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>("messages");

    const requestIdRef = useRef(0);

    useEffect(() => {
        if (!conversationId) return;

        openConversation(conversationId);
    }, [conversationId]);

    useEffect(() => {
        function handleOpenConversationDetails(event: Event) {
            const conversationDetail = (event as CustomEvent<{ conversationId?: string }>).detail;

            if (!conversationDetail?.conversationId) return;

            openConversation(conversationDetail.conversationId);
        }

        window.addEventListener(
            OPEN_CONVERSATION_DETAILS_EVENT,
            handleOpenConversationDetails,
        );

        return () => {
            window.removeEventListener(
                OPEN_CONVERSATION_DETAILS_EVENT,
                handleOpenConversationDetails,
            );
        };
    }, []);

    function openConversation(nextConversationId: string) {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        setActiveConversationId(nextConversationId);
        setPanelOpen(false);
        setData(null);
        setLoading(true);
        setTab("messages");

        window.setTimeout(() => {
            if (requestIdRef.current === requestId) {
                setPanelOpen(true);
            }
        }, 20);

        void loadConversation(nextConversationId, requestId);
    }

    async function loadConversation(nextConversationId: string, requestId: number) {
        const startedAt = Date.now();

        try {
            const response = await fetch(`/api/dashboard/conversas/${nextConversationId}`);
            const json: PanelData = await response.json();

            const elapsed = Date.now() - startedAt;
            const minimumLoadingTime = 500;

            if (elapsed < minimumLoadingTime) {
                await new Promise((resolve) =>
                    window.setTimeout(resolve, minimumLoadingTime - elapsed),
                );
            }

            if (requestIdRef.current === requestId) setData(json);
        } finally {
            if (requestIdRef.current === requestId) setLoading(false);
        }
    }

    if (!activeConversationId) return null;

    const clientName = data?.client.name ?? "Cliente sem nome";
    const result = getResult(data?.analysis?.resolution_result);

    function handleClose() {
        setPanelOpen(false);
        window.setTimeout(() => {
            setActiveConversationId(null);
            onClose();
        }, 250);
    }

    return (
        <DetailsSidePanel
            open={panelOpen}
            title="Detalhes da conversa"
            onClose={handleClose}
            headerContent={
                loading || !data ? (
                    <PanelHeaderSkeleton />
                ) : (
                    <>
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-4">
                                <InitialsAvatar name={clientName} />

                                <div className="min-w-0">
                                    <div title={clientName} className="truncate text-base font-bold text-slate-950">
                                        {clientName}
                                    </div>

                                    <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                                        <Phone size={15} />
                                        <span>{data.client.phone}</span>
                                    </div>

                                    <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                                        <Calendar size={15} />
                                        <span
                                            className="truncate"
                                            title={`${formatDateTime(data.conversation.started_at)} - ${formatDateTime(data.conversation.ended_at)}`}
                                        >
                                            {formatDateTime(data.conversation.started_at)} - {formatDateTime(data.conversation.ended_at)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <span title={`Resolução ${result}`}>
                                <ConversationResultBadge result={result} />
                            </span>
                        </div>

                        <div className="grid grid-cols-3 gap-4 text-xs">
                            <InfoItem icon={<User size={18} />} label="Atendente" value={data.conversation.attendant_chat_name ?? "Sem atendente"} />
                            <InfoItem icon={<Target size={18} />} label="Resolução" value={`${data.analysis?.resolution_score ?? 0}%`} />
                            <InfoItem icon={<Clock size={18} />} label="Duração" value={formatDuration(data.conversation.started_at, data.conversation.ended_at)} />
                        </div>
                    </>
                )
            }
            bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
        >
            <div className="flex border-b border-slate-100">
                <PanelTab active={tab === "messages"} onClick={() => setTab("messages")}>Mensagens</PanelTab>
                <PanelTab active={tab === "analysis"} onClick={() => setTab("analysis")}>Análise</PanelTab>
                <PanelTab active={tab === "events"} onClick={() => setTab("events")}>Eventos</PanelTab>
                <PanelTab active={tab === "details"} onClick={() => setTab("details")}>Detalhes</PanelTab>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {loading || !data ? (
                    <PanelBodySkeleton />
                ) : (
                    <>
                        {tab === "messages" && <MessagesTab messages={data.messages} />}
                        {tab === "analysis" && <AnalysisTab analysis={data.analysis} />}
                        {tab === "events" && <EventsTab analysis={data.analysis} />}
                        {tab === "details" && <DetailsTab data={data} />}
                    </>
                )}
            </div>
        </DetailsSidePanel>
    );
}

function MessagesTab({ messages }: { messages: PanelMessage[] }) {
    if (messages.length === 0) {
        return <EmptyPanelMessage text="Nenhuma mensagem encontrada." />;
    }

    return (
        <div className="space-y-5">
            {messages.map((message) => {
                const isClient = message.sender_type === "client";
                const isAttendant = message.sender_type === "attendant";
                const isBot = message.sender_type === "bot";
                const label = isClient ? "Cliente" : isAttendant ? message.sender_name ?? "Atendente" : isBot ? "Bot" : "Sistema";

                return (
                    <div key={message.id} className={`flex gap-3 ${isClient ? "justify-start" : "justify-end"}`}>
                        {isClient && <InitialsAvatar name={message.sender_name ?? "Cliente"} />}

                        <div className={`max-w-[75%] ${isClient ? "items-start" : "items-end"} flex flex-col`}>
                            <div className="mb-1 text-xs font-medium text-slate-500">
                                {label} <span className="font-normal">{formatTime(message.sent_at)}</span>
                            </div>

                            <div
                                title={message.text}
                                className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                                    isClient ? "bg-slate-100 text-slate-800" : "bg-purple-soft text-slate-800"
                                }`}
                            >
                                {message.text}
                            </div>
                        </div>

                        {!isClient && <InitialsAvatar name={message.sender_name ?? label} />}
                    </div>
                );
            })}
        </div>
    );
}

function AnalysisTab({ analysis }: { analysis: any | null }) {
    if (!analysis) return <EmptyPanelMessage text="Essa conversa ainda não possui análise." />;

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
                    <div className="mb-2 flex items-center gap-2 font-bold text-amber-800">
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
        </div>
    );
}

function EventsTab({ analysis }: { analysis: any | null }) {
    const events = analysis?.outcome_events ?? [];

    if (!analysis || events.length === 0) return <EmptyPanelMessage text="Nenhum evento encontrado." />;

    return (
        <div className="space-y-3">
            {events.map((event: any, index: number) => {
                const adTags = getAdTagsForOutcomeEventType(event.type);
                const conversionLabel = getAdConversionLabel(event.type);

                return (
                    <div key={`${event.type}-${index}`} className="rounded-xl border border-slate-100 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div title={getEventLabel(event.type)} className="truncate font-semibold text-slate-800">
                                    {getEventLabel(event.type)}
                                </div>
                                <div className="mt-1 text-sm text-slate-500">Confiança: {Math.round((event.confidence ?? 0) * 100)}%</div>
                                {event.occurred_at && <div className="mt-1 text-sm text-slate-500">{formatDateTime(event.occurred_at)}</div>}
                            </div>

                            {adTags.length > 0 && conversionLabel && (
                                <div className="flex shrink-0 flex-col flex-wrap justify-end gap-2">
                                    {adTags.map((tag) => (
                                        <AdTagBadge key={tag} tag={tag} conversionLabel={conversionLabel} />
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
                        ["Data final", data.conversation.ended_at ? formatDateTime(data.conversation.ended_at) : "-"],
                        ["Duração", formatDuration(data.conversation.started_at, data.conversation.ended_at)],
                        ["Atendente", data.conversation.attendant_chat_name ?? "Sem atendente"],
                        ["Túnel", data.conversation.tunnel ?? "Não definido"],
                        ["Origem", data.conversation.origin ?? "Não definido"],
                    ]}
                />
            </SummaryCard>
        </div>
    );
}

function InfoItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <div className="flex min-w-0 items-start gap-2">
            <div className="mt-0.5 text-slate-400">{icon}</div>
            <div className="min-w-0">
                <div className="text-slate-500">{label}</div>
                <div title={value} className="truncate font-semibold text-slate-700">{value}</div>
            </div>
        </div>
    );
}

function PanelTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 cursor-pointer border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                active ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
        >
            {children}
        </button>
    );
}

function SummaryCard({ title, children }: { title: string | null; children: ReactNode }) {
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
                    <div title={value} className="mt-1 truncate font-semibold text-slate-700">{value}</div>
                </div>
            ))}
        </div>
    );
}

function EmptyPanelMessage({ text }: { text: string }) {
    return <div className="rounded-xl border border-slate-100 p-4 text-sm text-slate-500">{text}</div>;
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
                <Skeleton className="h-7 w-20 rounded-full" />
            </div>
            <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-10 rounded-lg" />
                <Skeleton className="h-10 rounded-lg" />
                <Skeleton className="h-10 rounded-lg" />
            </div>
        </div>
    );
}

function PanelBodySkeleton() {
    return (
        <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-xl" />
            ))}
        </div>
    );
}

function AdTagBadge({ tag, conversionLabel }: { tag: AdPlatformTag; conversionLabel: string }) {
    const className = tag === "Meta Ads" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700";
    const icon = tag === "Meta Ads" ? <FaMeta className="h-4 w-4" /> : <FaGoogle className="h-3 w-3" />;

    return (
        <span title={conversionLabel} className={`inline-flex gap-2 rounded-md px-2 py-1 text-[11px] font-bold ${className}`}>
            {icon} {conversionLabel}
        </span>
    );
}

function getAdConversionLabel(eventType: string) {
    if (QUALIFIED_LEAD_OUTCOME_EVENTS.includes(eventType as any)) return "Qualified Lead";
    if (SCHEDULE_OUTCOME_EVENTS.includes(eventType as any)) return "Schedule";
    return null;
}

function getEventLabel(type: string) {
    const labels: Record<string, string> = {
        lead: "Lead",
        schedule: "Agendamento",
        qualified_lead: "Qualified Lead",
        procedure_scheduled: "Procedimento agendado",
    };

    return labels[type] ?? type;
}

function getResult(value: unknown): ConversationResult {
    if (value === "resolvida" || value === "parcial" || value === "nao_resolvida" || value === "pendente") return value;
    if (value === "resolved") return "resolvida";
    if (value === "partial") return "parcial";
    if (value === "unresolved") return "nao_resolvida";
    return "pendente";
}

function getResultLabel(value: unknown) {
    const result = getResult(value);
    const labels: Record<ConversationResult, string> = {
        resolvida: "Resolvida",
        parcial: "Parcial",
        nao_resolvida: "Não resolvida",
        pendente: "Pendente",
    };
    return labels[result];
}

function getGoalLabel(value: string | null | undefined) {
    if (!value) return "Não identificado";
    const labels: Record<string, string> = {
        answer_information: "Informação",
        schedule_consultation: "Agendar consulta",
        reschedule_consultation: "Reagendar",
        confirm_attendance: "Confirmar presença",
        explain_treatment: "Explicar tratamento",
        handle_price_objection: "Objeção de preço",
        other: "Outro",
    };
    return labels[value] ?? value;
}

function getGoalStatusLabel(value: string | null | undefined) {
    if (!value) return "Não identificado";
    const labels: Record<string, string> = {
        achieved: "Atingido",
        partially_achieved: "Parcial",
        not_achieved: "Não atingido",
        pending: "Pendente",
    };
    return labels[value] ?? value;
}

function getFinalStateLabel(value: string | null | undefined) {
    if (!value) return "Não identificado";
    const labels: Record<string, string> = {
        satisfied: "Satisfeito",
        neutral: "Neutro",
        dissatisfied: "Insatisfeito",
        dropped: "Abandonou",
    };
    return labels[value] ?? value;
}

function formatDateTime(value: string | null | undefined) {
    if (!value) return "-";
    return new Date(value).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatTime(value: string) {
    return new Date(value).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDuration(startValue: string, endValue: string | null) {
    if (!endValue) return "Em andamento";
    const diff = new Date(endValue).getTime() - new Date(startValue).getTime();
    const minutes = Math.max(1, Math.round(diff / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours}h${rest ? ` ${rest}min` : ""}`;
}
