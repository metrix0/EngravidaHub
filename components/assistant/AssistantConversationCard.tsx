// components/assistant/AssistantConversationCard.tsx
"use client";

import { ExternalLink } from "lucide-react";

import AssistantClientCard from "@/components/assistant/AssistantClientCard";
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

            <div className="border-t border-slate-100">
                <div className="flex justify-end px-5 py-3">
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

                <div className="max-h-[380px] overflow-y-auto border-t border-slate-100 px-5 py-5">
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
