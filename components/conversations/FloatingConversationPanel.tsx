// components/conversations/FloatingConversationPanel.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    ChevronDown,
    ExternalLink,
    Phone,
    X,
} from "lucide-react";

import Skeleton from "@/components/ui/Skeleton";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { ChatMessageList, type SharedChatMessage } from "@/components/conversations/ChatMessageList";
import { DETAILS_SIDE_PANEL_STATE_EVENT } from "@/components/ui/DetailsSidePanel";

type FloatingConversationTarget = {
    type: "thread" | "conversation";
    id: string;
};

type ConversationMessage = SharedChatMessage & {
    client_id: string;
    conversation_id: string | null;
    thread_id: string | null;
    sender_type: string;
    sender_name: string | null;
    sent_at: string;
    sequence_index: number;
};

type FloatingConversationResponse = {
    type: "thread" | "conversation";
    conversation: {
        id: string;
        started_at: string;
        ended_at: string | null;
        attendant_chat_name: string | null;
        source: string;
        conversation_analysis_id: string | null;
    } | null;
    thread: {
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
    } | null;
    client: {
        id: string;
        name: string | null;
        phone: string | null;
        email: string | null;
    } | null;
    analysis: any | null;
    messages: ConversationMessage[];
};

type SidePanelStateEvent = CustomEvent<{
    id: string;
    open: boolean;
}>;

type OpenFloatingConversationEvent = CustomEvent<FloatingConversationTarget>;

export const OPEN_FLOATING_CONVERSATION_EVENT = "engravida:open-floating-conversation";
export const OPEN_CONVERSATION_DETAILS_EVENT = "engravida:open-conversation-details";

const STORAGE_KEY = "engravida:floating-conversation";

export function openFloatingConversation(target: FloatingConversationTarget) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(target));
    window.dispatchEvent(
        new CustomEvent(OPEN_FLOATING_CONVERSATION_EVENT, { detail: target }),
    );
}

export function FloatingConversationPanel() {
    const router = useRouter();
    const openedSidePanelIds = useRef(new Set<string>());
    const [target, setTarget] = useState<FloatingConversationTarget | null>(null);
    const [data, setData] = useState<FloatingConversationResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [sidePanelOpen, setSidePanelOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const stored = window.localStorage.getItem(STORAGE_KEY);

        if (!stored) return;

        try {
            const parsed = JSON.parse(stored) as FloatingConversationTarget;

            if (parsed?.id && (parsed.type === "thread" || parsed.type === "conversation")) {
                setTarget(parsed);
            }
        } catch {
            window.localStorage.removeItem(STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        if (!target) return;

        const timer = window.setTimeout(() => setVisible(true), 20);
        setCollapsed(false);

        return () => window.clearTimeout(timer);
    }, [target]);

    useEffect(() => {
        function handleOpen(event: Event) {
            const detail = (event as OpenFloatingConversationEvent).detail;

            if (!detail?.id || (detail.type !== "thread" && detail.type !== "conversation")) return;

            setTarget(detail);
            setVisible(false);
            setCollapsed(false);
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(detail));
        }

        window.addEventListener(OPEN_FLOATING_CONVERSATION_EVENT, handleOpen);

        return () => {
            window.removeEventListener(OPEN_FLOATING_CONVERSATION_EVENT, handleOpen);
        };
    }, []);

    useEffect(() => {
        function handleSidePanelState(event: Event) {
            const detail = (event as SidePanelStateEvent).detail;

            if (!detail?.id) return;

            if (detail.open) {
                openedSidePanelIds.current.add(detail.id);
            } else {
                openedSidePanelIds.current.delete(detail.id);
            }

            setSidePanelOpen(openedSidePanelIds.current.size > 0);
        }

        window.addEventListener(DETAILS_SIDE_PANEL_STATE_EVENT, handleSidePanelState);

        return () => {
            window.removeEventListener(DETAILS_SIDE_PANEL_STATE_EVENT, handleSidePanelState);
        };
    }, []);

    useEffect(() => {
        if (!target) {
            setData(null);
            return;
        }

        let cancelled = false;

        async function loadConversation() {
            setLoading(true);
            setData(null);

            try {
                const params = new URLSearchParams(
                    target.type === "thread"
                        ? { thread_id: target.id }
                        : { conversation_id: target.id },
                );
                const response = await fetch(
                    `/api/clientes/conversation-panel?${params.toString()}`,
                    { cache: "no-store" },
                );
                const json = await response.json();

                if (!response.ok) {
                    console.error("[FloatingConversationPanel] failed to load", json);
                    if (!cancelled) setData(null);
                    return;
                }

                if (!cancelled) setData(json as FloatingConversationResponse);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void loadConversation();

        return () => {
            cancelled = true;
        };
    }, [target]);

    const clientName = data?.client?.name ?? "Cliente sem nome";
    const phone = formatPhone(data?.client?.phone ?? null);
    const isLive = target?.type === "thread";
    const detailsLabel = isLive ? "Abrir inbox" : "Abrir detalhes";

    const rightOffset = sidePanelOpen ? 484 : 24;
    const panelStateClass = !visible
        ? "translate-y-4 opacity-0"
        : collapsed
            ? "translate-y-[calc(100%-52px)] opacity-100"
            : "translate-y-0 opacity-100";

    const attendantName = data?.conversation?.attendant_chat_name ?? null;

    const orderedMessages = useMemo(() => {
        return [...(data?.messages ?? [])]
            .sort((a, b) => {
                const dateDiff = new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime();
                if (dateDiff !== 0) return dateDiff;
                return a.sequence_index - b.sequence_index;
            })
            .map((message) => ({
                ...message,
                sender_name: getDisplaySenderName(
                    message.sender_name,
                    message.sender_type,
                    attendantName,
                ),
            }));
    }, [data?.messages, attendantName]);

    if (!target) return null;

    function handleClose() {
        setVisible(false);

        window.setTimeout(() => {
            setTarget(null);
            setData(null);
            setCollapsed(false);
            window.localStorage.removeItem(STORAGE_KEY);
        }, 180);
    }

    function handleOpenDetails() {
        if (!target) return;

        if (target.type === "thread") {
            router.push(`/inbox?thread_id=${target.id}`);
            return;
        }

        window.dispatchEvent(
            new CustomEvent(OPEN_CONVERSATION_DETAILS_EVENT, {
                detail: { conversationId: target.id },
            })
        );
    }

    return (
        <div
            className={`fixed bottom-6 z-[35] w-[365px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-[right,transform,opacity] duration-300 ease-out ${panelStateClass}`}
            style={{ right: rightOffset }}
        >
            <div className="border-b border-slate-100 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <InitialsAvatar name={clientName} />

                        <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                                <div
                                    title={clientName}
                                    className="truncate text-sm font-bold text-slate-950"
                                >
                                    {loading ? "Carregando..." : clientName}
                                </div>

                                {isLive ? (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-soft px-2 py-0.5 text-[10px] font-bold text-green">
                                        <span className="h-1.5 w-1.5 rounded-full bg-green" />
                                        Ao vivo
                                    </span>
                                ) : (
                                    <span className="inline-flex shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                        Histórico
                                    </span>
                                )}
                            </div>

                            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                                <Phone size={12} />
                                <span className="truncate">{phone}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setCollapsed((current) => !current)}
                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            title={collapsed ? "Mostrar conversa" : "Ocultar conversa"}
                        >
                            <ChevronDown
                                size={16}
                                className={`transition-transform duration-300 ${collapsed ? "rotate-180" : "rotate-0"}`}
                            />
                        </button>

                        <button
                            type="button"
                            onClick={handleClose}
                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            title="Fechar conversa"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleOpenDetails}
                    className="mt-3 flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 shadow-sm transition hover:bg-selection"
                >
                    <ExternalLink size={14} />
                    {detailsLabel}
                </button>
            </div>

            <ChatMessageList
                messages={orderedMessages}
                isLoading={loading}
                skeleton={(
                    <div className="space-y-3">
                        <Skeleton className="h-14 w-[75%] rounded-2xl" />
                        <Skeleton className="ml-auto h-14 w-[65%] rounded-2xl" />
                        <Skeleton className="h-14 w-[82%] rounded-2xl" />
                    </div>
                )}
                emptyMessage={!data ? "Não foi possível carregar esta conversa." : "Nenhuma mensagem encontrada."}
                className="h-[360px] overflow-y-auto bg-slate-50 px-4 py-4"
            />
        </div>
    );
}


function getDisplaySenderName(
    senderName: string | null,
    senderType: string | null,
    fallbackAttendantName: string | null,
) {
    const rawName = senderName?.trim() ?? "";
    const normalizedSenderType = normalize(senderType ?? "");
    const fromAttendant =
        normalizedSenderType.includes("attendant") ||
        normalizedSenderType.includes("atendente") ||
        normalizedSenderType.includes("bot") ||
        normalizedSenderType.includes("system") ||
        normalizedSenderType.includes("sistema");

    if (!fromAttendant) return rawName || senderName;
    if (rawName && !isEmail(rawName)) return rawName;
    if (fallbackAttendantName && !isEmail(fallbackAttendantName)) return fallbackAttendantName;
    if (normalizedSenderType.includes("bot")) return "Bot";
    if (normalizedSenderType.includes("system") || normalizedSenderType.includes("sistema")) return "Sistema";

    return "Atendente";
}

function isEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function formatPhone(phone: string | null) {
    if (!phone) return "Sem telefone";
    return phone.split("+55")[1] ?? phone;
}


function normalize(value: string) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
}
