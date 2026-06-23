// components/conversations/ChatMessageList.tsx
"use client";

import {useRef, type ReactNode} from "react";

import InboxPrewrittenMessagesController from "@/components/inbox/InboxPrewrittenMessagesController";

import { ChatMessageBubble, type SharedChatMessage } from "./ChatMessageBubble";

export type { SharedChatMessage };

const DEFAULT_SCROLLBAR_CLASS =
    "[scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]";

type ChatMessageListProps = {
    messages: SharedChatMessage[];
    isLoading?: boolean;
    skeleton?: ReactNode;
    emptyMessage?: string;
    className?: string;
    scrollbarClassName?: string;
    topContent?: ReactNode;
};

export function ChatMessageList({
    messages,
    isLoading = false,
    skeleton,
    emptyMessage = "Nenhuma mensagem nesta conversa.",
    className = "min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-5 py-5",
    scrollbarClassName = DEFAULT_SCROLLBAR_CLASS,
    topContent,
}: ChatMessageListProps) {
    const rootRef = useRef<HTMLDivElement>(null);

    const orderedMessages = [...messages].sort((a, b) => {
        const dateDiff = getMessageTime(a) - getMessageTime(b);
        if (dateDiff !== 0) return dateDiff;

        return (a.sequence_index ?? 0) - (b.sequence_index ?? 0);
    });

    const groups = groupMessagesByDate(orderedMessages);

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

            <InboxPrewrittenMessagesController messageListRef={rootRef} />
        </>
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
