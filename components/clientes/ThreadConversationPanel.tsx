// components/clientes/ThreadConversationPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { Skeleton } from "@/components";

type ClientLiveThread = {
    id: string;
    client_id: string;
    latest_conversation_id: string | null;
    status: string;
    channel: string;
    source: string;
    assigned_attendant_id: string | null;
    last_message_text: string | null;
    last_message_at: string | null;
    unread_count: number;
    created_at: string;
    updated_at: string;
};

type ConversationMessage = {
    id: string;
    client_id: string;
    conversation_id: string | null;
    thread_id: string | null;
    sender_type: string;
    sender_name: string | null;
    text: string;
    sent_at: string;
    sequence_index: number;
};

type ThreadPanelResponse = {
    type: "thread" | "conversation";
    conversation: {
        id: string;
        started_at: string;
        ended_at: string | null;
        attendant_chat_name: string | null;
        source: string;
        conversation_analysis_id: string | null;
    } | null;
    thread: ClientLiveThread | null;
    client: {
        id: string;
        name: string | null;
        phone: string | null;
        email: string | null;
    } | null;
    analysis: any | null;
    messages: ConversationMessage[];
};

export default function ThreadConversationPanel({
                                                    threadId,
                                                    onClose,
                                                }: {
    threadId: string | null;
    onClose: () => void;
}) {
    const [data, setData] = useState<ThreadPanelResponse | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!threadId) {
            setData(null);
            return;
        }

        let cancelled = false;

        async function loadThread() {
            setLoading(true);

            try {
                const params = new URLSearchParams({ thread_id: threadId });
                const response = await fetch(
                    `/api/clientes/conversation-panel?${params.toString()}`,
                    { cache: "no-store" },
                );

                const json = await response.json();

                if (!response.ok) {
                    console.error("[ThreadConversationPanel] failed to load thread", json);
                    if (!cancelled) setData(null);
                    return;
                }

                if (!cancelled) {
                    setData(json as ThreadPanelResponse);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        loadThread();

        return () => {
            cancelled = true;
        };
    }, [threadId]);

    if (!threadId) return null;

    const title = data?.client?.name ?? "Cliente sem nome";

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <button
                type="button"
                aria-label="Fechar conversa"
                onClick={onClose}
                className="absolute inset-0 cursor-default bg-slate-900/25"
            />

            <aside className="relative flex h-full w-[620px] max-w-[calc(100vw-64px)] flex-col bg-white shadow-2xl">
                <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-6 py-5">
                    <div className="min-w-0">
                        <div className="mb-2 flex items-center gap-2">
              <span className="relative flex h-3 w-3 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
              </span>

                            <p className="text-xs font-bold uppercase tracking-wide text-muted">
                                Conversa ao vivo
                            </p>
                        </div>

                        <h2 className="truncate text-2xl font-bold text-text">
                            {loading ? "Carregando..." : title}
                        </h2>

                        <p className="mt-1 text-sm text-muted">
                            {formatPhone(data?.client?.phone ?? null)}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-6 py-5">
                    {loading ? (
                        <div className="space-y-4">
                            <Skeleton className="h-16 w-[75%] rounded-2xl" />
                            <Skeleton className="ml-auto h-16 w-[65%] rounded-2xl" />
                            <Skeleton className="h-16 w-[82%] rounded-2xl" />
                        </div>
                    ) : !data ? (
                        <EmptyMessage message="Não foi possível carregar esta conversa." />
                    ) : data.messages.length === 0 ? (
                        <EmptyMessage message="Nenhuma mensagem encontrada." />
                    ) : (
                        <div className="space-y-3">
                            {data.messages.map((message) => (
                                <MessageBubble key={message.id} message={message} />
                            ))}
                        </div>
                    )}
                </div>
            </aside>
        </div>
    );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
    const fromClient = isClientSender(message.sender_type);

    return (
        <div className={fromClient ? "flex justify-start" : "flex justify-end"}>
            <div
                className={[
                    "max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm",
                    fromClient ? "bg-white text-slate-700" : "bg-brand text-white",
                ].join(" ")}
            >
                <div
                    className={[
                        "mb-1 text-xs font-bold",
                        fromClient ? "text-muted" : "text-white/75",
                    ].join(" ")}
                >
                    {message.sender_name || getSenderLabel(message.sender_type)} • {formatTime(message.sent_at)}
                </div>

                <div className="whitespace-pre-wrap leading-relaxed">{message.text}</div>
            </div>
        </div>
    );
}

function EmptyMessage({ message }: { message: string }) {
    return (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm font-medium text-slate-400">
            {message}
        </div>
    );
}

function formatPhone(phone: string | null) {
    if (!phone) return "Sem telefone";

    return phone.split("+55")[1] ?? phone;
}

function formatTime(date: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(date));
}

function normalize(value: string) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
}

function isClientSender(senderType: string) {
    const normalized = normalize(senderType);

    return ["client", "cliente", "customer", "user", "contact"].some((value) =>
        normalized.includes(value),
    );
}

function getSenderLabel(senderType: string) {
    return isClientSender(senderType) ? "Cliente" : "Atendente";
}

