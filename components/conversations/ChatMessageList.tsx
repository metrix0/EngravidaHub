// components/conversations/ChatMessageList.tsx
"use client";

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Send } from "lucide-react";

import InboxPrewrittenMessagesController from "@/components/inbox/InboxPrewrittenMessagesController";
import { sendInboxMessage } from "@/lib/inbox/inboxApi";
import { supabase } from "@/lib/supabase/client";

import { ChatMessageBubble, type SharedChatMessage } from "./ChatMessageBubble";

export type { SharedChatMessage };

const DEFAULT_SCROLLBAR_CLASS =
    "[scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]";
const FLOATING_TICKET_LIST_CLASS =
    "min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4";
const FLOATING_CHAT_RAIL_STORAGE_KEY = "engravida:floating-chat-rail:v2";
const OPEN_FLOATING_CONVERSATION_EVENT =
    "engravida:open-floating-conversation";

type ChatMessageListProps = {
    messages: SharedChatMessage[];
    isLoading?: boolean;
    skeleton?: ReactNode;
    emptyMessage?: string;
    className?: string;
    scrollbarClassName?: string;
    topContent?: ReactNode;
    enablePrewrittenMessages?: boolean;
    autoScrollToBottom?: boolean;
};

type LocalFloatingMessage = SharedChatMessage & {
    localCreatedAt: number;
};

type PersistedFloatingRailState = {
    tickets?: Array<{
        type?: unknown;
        id?: unknown;
        status?: unknown;
    }>;
    selected?: {
        kind?: unknown;
        key?: unknown;
    } | null;
};

export function ChatMessageList({
    messages,
    isLoading = false,
    skeleton,
    emptyMessage = "Nenhuma mensagem nesta conversa.",
    className = "min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-5 py-5",
    scrollbarClassName = DEFAULT_SCROLLBAR_CLASS,
    topContent,
    enablePrewrittenMessages = true,
    autoScrollToBottom = true,
}: ChatMessageListProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const floatingThreadIdRef = useRef<string | null>(null);
    const [floatingThreadId, setFloatingThreadId] = useState<string | null>(null);
    const [localFloatingMessages, setLocalFloatingMessages] = useState<
        LocalFloatingMessage[]
    >([]);
    const [messageText, setMessageText] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);

    const isFloatingTicketList =
        className === FLOATING_TICKET_LIST_CLASS && enablePrewrittenMessages;

    useEffect(() => {
        if (!isFloatingTicketList) {
            setFloatingThreadId(null);
            return;
        }

        function syncSelectedFloatingThread() {
            setFloatingThreadId(readSelectedFloatingThreadId());
        }

        syncSelectedFloatingThread();

        const frame = window.requestAnimationFrame(syncSelectedFloatingThread);
        const timer = window.setTimeout(syncSelectedFloatingThread, 80);

        window.addEventListener(
            OPEN_FLOATING_CONVERSATION_EVENT,
            syncSelectedFloatingThread,
        );

        return () => {
            window.cancelAnimationFrame(frame);
            window.clearTimeout(timer);
            window.removeEventListener(
                OPEN_FLOATING_CONVERSATION_EVENT,
                syncSelectedFloatingThread,
            );
        };
    }, [isFloatingTicketList, messages]);

    useEffect(() => {
        floatingThreadIdRef.current = floatingThreadId;
        setLocalFloatingMessages([]);
        setMessageText("");
        setSendError(null);
        setIsSending(false);
    }, [floatingThreadId]);

    useEffect(() => {
        if (!floatingThreadId) return;

        const channel = supabase
            .channel(`floating-live-ticket-${floatingThreadId}-${crypto.randomUUID()}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "messages",
                    filter: `thread_id=eq.${floatingThreadId}`,
                },
                (payload) => {
                    const incomingMessage = mapRealtimeMessage(payload.new);
                    if (!incomingMessage) return;

                    setLocalFloatingMessages((current) =>
                        reconcileRealtimeMessage(current, incomingMessage),
                    );
                },
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [floatingThreadId]);

    const visibleMessages = useMemo(() => {
        const persistedIds = new Set(messages.map((message) => message.id));
        const localOnly = localFloatingMessages.filter(
            (message) => !persistedIds.has(message.id),
        );

        return dedupeMessages([...messages, ...localOnly]);
    }, [localFloatingMessages, messages]);

    const orderedMessages = [...visibleMessages].sort((a, b) => {
        const dateDiff = getMessageTime(a) - getMessageTime(b);
        if (dateDiff !== 0) return dateDiff;

        return (a.sequence_index ?? 0) - (b.sequence_index ?? 0);
    });

    const groups = groupMessagesByDate(orderedMessages);
    const lastMessageId =
        orderedMessages[orderedMessages.length - 1]?.id ?? null;

    useEffect(() => {
        if (!autoScrollToBottom || isLoading || !lastMessageId) return;

        const frame = window.requestAnimationFrame(() => {
            const root = rootRef.current;
            if (!root) return;
            root.scrollTop = root.scrollHeight;
        });

        return () => window.cancelAnimationFrame(frame);
    }, [autoScrollToBottom, isLoading, lastMessageId]);

    async function handleFloatingSend() {
        const text = messageText.trim();
        const threadId = floatingThreadId;

        if (!threadId || !text || isSending) return;

        const optimisticId = `floating-optimistic:${crypto.randomUUID()}`;
        const optimisticSentAt = new Date().toISOString();
        const optimisticMessage: LocalFloatingMessage = {
            id: optimisticId,
            text,
            sender_type: "attendant",
            sender_name: "Atendente",
            sent_at: optimisticSentAt,
            sequence_index: getNextSequenceIndex(visibleMessages),
            localCreatedAt: Date.now(),
        };

        setMessageText("");
        setSendError(null);
        setIsSending(true);
        setLocalFloatingMessages((current) => [
            ...current,
            optimisticMessage,
        ]);

        try {
            const result = await sendInboxMessage({
                itemId: threadId,
                itemType: "thread",
                text,
            });

            if (floatingThreadIdRef.current !== threadId) return;

            if (!result.message) {
                setLocalFloatingMessages((current) =>
                    current.filter((message) => message.id !== optimisticId),
                );
                return;
            }

            const confirmedMessage: LocalFloatingMessage = {
                id: result.message.id,
                text: result.message.text ?? text,
                sender_type: result.message.sender_type ?? "attendant",
                sender_name: result.message.sender_name ?? "Atendente",
                sent_at: result.message.sent_at ?? optimisticSentAt,
                sequence_index:
                    result.message.sequence_index ??
                    optimisticMessage.sequence_index ??
                    0,
                localCreatedAt: optimisticMessage.localCreatedAt,
            };

            setLocalFloatingMessages((current) => {
                const realAlreadyExists = current.some(
                    (message) => message.id === confirmedMessage.id,
                );

                if (realAlreadyExists) {
                    return current.filter(
                        (message) => message.id !== optimisticId,
                    );
                }

                return current.map((message) =>
                    message.id === optimisticId ? confirmedMessage : message,
                );
            });
        } catch (error) {
            if (floatingThreadIdRef.current !== threadId) return;

            setLocalFloatingMessages((current) =>
                current.filter((message) => message.id !== optimisticId),
            );
            setMessageText((current) =>
                current.trim() ? `${text}\n${current}` : text,
            );
            setSendError(
                error instanceof Error
                    ? error.message
                    : "Não foi possível enviar a mensagem.",
            );
        } finally {
            if (floatingThreadIdRef.current === threadId) {
                setIsSending(false);
            }
        }
    }

    return (
        <>
            <div
                ref={rootRef}
                className={`${className} ${scrollbarClassName}`}
            >
                {topContent ? <div className="mb-5">{topContent}</div> : null}

                {isLoading ? (
                    skeleton ?? null
                ) : groups.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
                        {emptyMessage}
                    </div>
                ) : (
                    <div className="space-y-6">
                        {groups.map((group) => (
                            <div key={group.key} className="space-y-6">
                                <DateDivider label={group.label} />

                                <div className="space-y-6">
                                    {group.messages.map((message) => (
                                        <div key={message.id} className="space-y-6">
                                            {message.conversation_boundary_label ? (
                                                <ConversationDivider
                                                    label={message.conversation_boundary_label}
                                                />
                                            ) : null}

                                            <ChatMessageBubble message={message} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {enablePrewrittenMessages ? (
                <InboxPrewrittenMessagesController messageListRef={rootRef} />
            ) : null}

            {floatingThreadId ? (
                <div className="shrink-0 border-t border-slate-100 bg-white p-2">
                    {sendError ? (
                        <div className="mb-2 rounded-lg bg-red-soft px-3 py-2 text-xs font-semibold text-red">
                            {sendError}
                        </div>
                    ) : null}

                    <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <textarea
                            rows={1}
                            value={messageText}
                            onChange={(event) => {
                                setMessageText(event.target.value);
                                setSendError(null);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    void handleFloatingSend();
                                }
                            }}
                            onInput={(event) => {
                                const target = event.currentTarget;
                                target.style.height = "auto";
                                target.style.height = `${Math.min(target.scrollHeight, 112)}px`;
                            }}
                            placeholder="Responder como atendente..."
                            className="max-h-28 min-h-[34px] min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed outline-none placeholder:text-slate-400"
                        />

                        <button
                            type="button"
                            title="Enviar"
                            disabled={isSending || !messageText.trim()}
                            onClick={() => void handleFloatingSend()}
                            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-brand text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Send size={17} />
                        </button>
                    </div>
                </div>
            ) : null}
        </>
    );
}

function readSelectedFloatingThreadId() {
    try {
        const raw = window.localStorage.getItem(FLOATING_CHAT_RAIL_STORAGE_KEY);
        if (!raw) return null;

        const state = JSON.parse(raw) as PersistedFloatingRailState;
        const selected = state.selected;

        if (
            selected?.kind !== "ticket" ||
            typeof selected.key !== "string" ||
            !selected.key.startsWith("thread:")
        ) {
            return null;
        }

        const threadId = selected.key.slice("thread:".length).trim();
        if (!threadId) return null;

        const matchingTicket = state.tickets?.find(
            (ticket) =>
                ticket.type === "thread" &&
                ticket.id === threadId,
        );

        if (!matchingTicket) return null;

        const status =
            typeof matchingTicket.status === "string"
                ? matchingTicket.status.toLowerCase()
                : null;

        return status === "closed" ? null : threadId;
    } catch {
        return null;
    }
}

function mapRealtimeMessage(value: unknown): LocalFloatingMessage | null {
    if (!value || typeof value !== "object") return null;

    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.text !== "string") {
        return null;
    }

    return {
        id: row.id,
        text: row.text,
        from: typeof row.from === "string" ? row.from : null,
        sender_type:
            typeof row.sender_type === "string" ? row.sender_type : null,
        sender_name:
            typeof row.sender_name === "string" ? row.sender_name : null,
        sent_at: typeof row.sent_at === "string" ? row.sent_at : null,
        sequence_index:
            typeof row.sequence_index === "number" ? row.sequence_index : 0,
        localCreatedAt: Date.now(),
    };
}

function reconcileRealtimeMessage(
    current: LocalFloatingMessage[],
    incoming: LocalFloatingMessage,
) {
    if (current.some((message) => message.id === incoming.id)) {
        return current;
    }

    const incomingIsAttendant = isAttendantSender(incoming);

    if (incomingIsAttendant) {
        const optimisticMatch = current.find(
            (message) =>
                message.id.startsWith("floating-optimistic:") &&
                message.text === incoming.text &&
                Math.abs(message.localCreatedAt - incoming.localCreatedAt) < 15_000,
        );

        if (optimisticMatch) {
            return current.map((message) =>
                message.id === optimisticMatch.id ? incoming : message,
            );
        }
    }

    return [...current, incoming];
}

function isAttendantSender(message: SharedChatMessage) {
    const sender = `${message.sender_type ?? ""} ${message.from ?? ""}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");

    return (
        sender.includes("attendant") ||
        sender.includes("atendente") ||
        sender.includes("bot") ||
        sender.includes("system") ||
        sender.includes("sistema")
    );
}

function dedupeMessages(messages: SharedChatMessage[]) {
    const byId = new Map<string, SharedChatMessage>();

    for (const message of messages) {
        byId.set(message.id, message);
    }

    return Array.from(byId.values());
}

function getNextSequenceIndex(messages: SharedChatMessage[]) {
    return (
        messages.reduce(
            (highest, message) =>
                Math.max(highest, message.sequence_index ?? 0),
            0,
        ) + 1
    );
}

function ConversationDivider({ label }: { label: string }) {
    return (
        <div className="flex items-center justify-center gap-3 py-1">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-500 shadow-sm">
                {label}
            </span>
            <div className="h-px flex-1 bg-slate-200" />
        </div>
    );
}

function DateDivider({ label }: { label: string }) {
    return (
        <div className="flex items-center justify-center gap-4">
            <div className="h-px w-44 bg-slate-200" />
            <span className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm">
                {label}
            </span>
            <div className="h-px w-44 bg-slate-200" />
        </div>
    );
}

function groupMessagesByDate(messages: SharedChatMessage[]) {
    const groups = new Map<string, SharedChatMessage[]>();

    for (const message of messages) {
        const key = getMessageDateKey(message);
        const current = groups.get(key) ?? [];
        current.push(message);
        groups.set(key, current);
    }

    return Array.from(groups.entries()).map(([key, groupMessages]) => ({
        key,
        label: getDateLabel(key),
        messages: groupMessages,
    }));
}

function getMessageTime(message: SharedChatMessage) {
    if (!message.sent_at) return 0;
    return new Date(message.sent_at).getTime();
}

function getMessageDateKey(message: SharedChatMessage) {
    if (!message.sent_at) return "today";
    return new Date(message.sent_at).toISOString().slice(0, 10);
}

function getDateLabel(key: string) {
    if (key === "today") return "Hoje";

    const date = new Date(`${key}T00:00:00`);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (sameDate(date, today)) return "Hoje";
    if (sameDate(date, yesterday)) return "Ontem";

    return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(date);
}

function sameDate(left: Date, right: Date) {
    return left.toDateString() === right.toDateString();
}
