// components/assistant/AssistantConversationCard.tsx
"use client";

import {
    Calendar,
    Clock,
    ExternalLink,
    Target,
    User,
    type LucideIcon,
} from "lucide-react";

import AssistantClientCard from "@/components/assistant/AssistantClientCard";
import { Badge, type ConversationResult } from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
import type {
    AssistantConversationCardData,
    AssistantConversationMessage,
} from "@/types/assistant";

export default function AssistantConversationCard({
    conversation,
    onOpenClient,
}: {
    conversation: AssistantConversationCardData;
    onOpenClient: (clientId: string) => void;
}) {
    const messages = conversation.messages ?? [];

    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {conversation.client_profile ? (
                <AssistantClientCard
                    client={conversation.client_profile}
                    onOpen={() => onOpenClient(conversation.client_id)}
                    embedded
                />
            ) : (
                <button
                    type="button"
                    onClick={() => onOpenClient(conversation.client_id)}
                    className="flex w-full cursor-pointer items-center gap-3 px-5 py-5 text-left transition hover:bg-slate-50"
                >
                    <InitialsAvatar name={conversation.client_name} />
                    <div className="min-w-0">
                        <div className="truncate font-bold text-slate-950">
                            {conversation.client_name}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                            {conversation.unit_name ?? "Sem unidade"}
                        </div>
                    </div>
                </button>
            )}

            <div className="border-t border-slate-100 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div
                            title={conversation.short_label ?? "Resumo da conversa"}
                            className="truncate text-sm font-bold text-slate-900"
                        >
                            {conversation.short_label ?? "Resumo da conversa"}
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                            <Calendar size={14} className="shrink-0" />
                            <span className="truncate">
                                {formatDateTime(conversation.started_at)} -{" "}
                                {formatDateTime(conversation.ended_at)}
                            </span>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        <Badge value={getResult(conversation.resolution_result)} />
                        <button
                            type="button"
                            onClick={() =>
                                openFloatingConversation({
                                    type: "conversation",
                                    id: conversation.id,
                                })
                            }
                            className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                        >
                            Abrir completa
                            <ExternalLink size={13} />
                        </button>
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                    <ConversationInfo
                        icon={User}
                        label="Atendente"
                        value={conversation.attendant_name ?? "Sem atendente"}
                    />
                    <ConversationInfo
                        icon={Target}
                        label="Resolução"
                        value={
                            conversation.resolution_score == null
                                ? "Não analisada"
                                : `${conversation.resolution_score}%`
                        }
                    />
                    <ConversationInfo
                        icon={Clock}
                        label="Duração"
                        value={formatDuration(
                            conversation.started_at,
                            conversation.ended_at,
                        )}
                    />
                </div>
            </div>

            <div className="border-t border-slate-100">
                <div className="max-h-[380px] overflow-y-auto px-5 py-5">
                    {messages.length === 0 ? (
                        <div className="py-8 text-center text-sm text-slate-400">
                            Nenhuma mensagem disponível.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {messages.map((message, index) => (
                                <ConversationMessage
                                    key={`${message.sent_at}:${index}`}
                                    message={message}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {conversation.messages_truncated && (
                    <div className="border-t border-slate-100 px-5 py-2.5 text-center text-[11px] text-slate-400">
                        Exibindo as mensagens mais recentes.
                    </div>
                )}
            </div>
        </section>
    );
}

function ConversationInfo({
    icon: Icon,
    label,
    value,
}: {
    icon: LucideIcon;
    label: string;
    value: string;
}) {
    return (
        <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-3">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <Icon size={14} className="shrink-0" />
                <span>{label}</span>
            </div>
            <div
                title={value}
                className="mt-1.5 truncate text-xs font-bold text-slate-700"
            >
                {value}
            </div>
        </div>
    );
}

function ConversationMessage({
    message,
}: {
    message: AssistantConversationMessage;
}) {
    const isClient = message.sender_type === "client";
    const label = senderLabel(message);

    return (
        <div
            className={`flex gap-3 ${
                isClient ? "justify-start" : "justify-end"
            }`}
        >
            {isClient && (
                <InitialsAvatar
                    name={message.sender_name ?? "Cliente"}
                />
            )}

            <div
                className={`flex max-w-[76%] flex-col ${
                    isClient ? "items-start" : "items-end"
                }`}
            >
                <div className="mb-1 text-xs font-medium text-slate-500">
                    {label}{" "}
                    <span className="font-normal">
                        {formatTime(message.sent_at)}
                    </span>
                </div>

                <div
                    className={`whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-relaxed ${
                        isClient
                            ? "bg-slate-100 text-slate-800"
                            : "bg-purple-soft text-slate-800"
                    }`}
                >
                    {message.text}
                </div>
            </div>

            {!isClient && (
                <InitialsAvatar
                    name={message.sender_name ?? label}
                />
            )}
        </div>
    );
}

function senderLabel(message: AssistantConversationMessage) {
    if (message.sender_type === "client") return "Cliente";
    if (message.sender_type === "attendant") {
        return message.sender_name ?? "Atendente";
    }
    if (message.sender_type === "bot") return "Bot";
    return "Sistema";
}

function formatTime(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
    }).format(new Date(value));
}

function formatDateTime(value: string | null) {
    if (!value) return "Em andamento";

    return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
    }).format(new Date(value));
}

function formatDuration(startValue: string, endValue: string | null) {
    if (!endValue) return "Em andamento";

    const difference =
        new Date(endValue).getTime() - new Date(startValue).getTime();
    const minutes = Math.max(1, Math.round(difference / 60_000));

    if (minutes < 60) return `${minutes} min`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h${remainingMinutes ? ` ${remainingMinutes}min` : ""}`;
}

function getResult(value: string | null): ConversationResult {
    if (
        value === "resolvida" ||
        value === "parcial" ||
        value === "nao_resolvida" ||
        value === "pendente"
    ) {
        return value;
    }

    if (value === "resolved") return "resolvida";
    if (value === "partial") return "parcial";
    if (value === "unresolved" || value === "not_resolved") {
        return "nao_resolvida";
    }

    return "pendente";
}
