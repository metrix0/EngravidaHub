// components/conversations/FloatingConversationPanel.tsx
"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useRouter } from "next/navigation";
import {
    ChevronDown,
    ExternalLink,
    Mail,
    Phone,
    Send,
    X,
} from "lucide-react";

import { useCurrentUser } from "@/components/auth/CurrentUserProvider";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import {
    ChatMessageList,
    type SharedChatMessage,
} from "@/components/conversations/ChatMessageList";
import Skeleton from "@/components/ui/Skeleton";
import { DETAILS_SIDE_PANEL_STATE_EVENT } from "@/components/ui/DetailsSidePanel";
import {
    fetchInternalConversations,
    fetchInternalMessages,
    heartbeatInternalPresence,
    markInternalConversationRead,
    openInternalConversation,
    sendInternalMessage,
} from "@/lib/internal-chat/internalChatApi";
import { useInternalChatRealtime } from "@/lib/internal-chat/useInternalChatRealtime";
import { supabase } from "@/lib/supabase/client";
import type {
    InternalConversationDetail,
    InternalConversationSummary,
} from "@/types/internalChat";

type FloatingConversationTarget = {
    type: "thread" | "conversation";
    id: string;
};

type SavedTicketTarget = FloatingConversationTarget & {
    name?: string | null;
    preview?: string | null;
    phone?: string | null;
    channel?: string | null;
    status?: string | null;
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
    analysis: unknown | null;
    messages: ConversationMessage[];
};

type SelectedChat =
    | { kind: "ticket"; key: string }
    | { kind: "internal"; conversationId: string }
    | null;

type PersistedRailState = {
    tickets: SavedTicketTarget[];
    hiddenInternalConversationIds: string[];
    selected: SelectedChat;
};

type SidePanelStateEvent = CustomEvent<{
    id: string;
    open: boolean;
}>;

type OpenFloatingConversationEvent = CustomEvent<FloatingConversationTarget>;
type OpenInternalChatEvent = CustomEvent<{ userId: string }>;

export const OPEN_FLOATING_CONVERSATION_EVENT =
    "engravida:open-floating-conversation";
export const OPEN_INTERNAL_CHAT_EVENT = "engravida:open-internal-chat";
export const OPEN_CONVERSATION_DETAILS_EVENT =
    "engravida:open-conversation-details";

const LEGACY_STORAGE_KEY = "engravida:floating-conversation";
const RAIL_STORAGE_KEY = "engravida:floating-chat-rail:v2";
const OLD_DOCK_STORAGE_KEY = "engravida:floating-chat-dock:v1";
const PENDING_TICKET_KEY = "engravida:floating-chat-pending-ticket";
const PENDING_INTERNAL_USER_KEY =
    "engravida:floating-chat-pending-internal-user";
const ANIMATION_MS = 360;
const COLLAPSED_VISIBLE_HEIGHT_PX = 54;
const PRESENCE_INTERVAL_MS = 30_000;
const REFRESH_INTERVAL_MS = 20_000;
const SCROLLBAR_CLASS =
    "[scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]";

export function openFloatingConversation(target: FloatingConversationTarget) {
    window.localStorage.setItem(PENDING_TICKET_KEY, JSON.stringify(target));
    window.dispatchEvent(
        new CustomEvent(OPEN_FLOATING_CONVERSATION_EVENT, { detail: target }),
    );
}

export function openInternalChat(userId: string) {
    window.localStorage.setItem(PENDING_INTERNAL_USER_KEY, userId);
    window.dispatchEvent(
        new CustomEvent(OPEN_INTERNAL_CHAT_EVENT, {
            detail: { userId },
        }),
    );
}

export function FloatingConversationPanel() {
    const router = useRouter();
    const { currentUser } = useCurrentUser();
    const currentUserId = currentUser?.user?.id ?? null;
    const currentUserName = currentUser?.user?.name ?? "Você";

    const openedSidePanelIds = useRef(new Set<string>());
    const hydratedRef = useRef(false);
    const showTimerRef = useRef<number | null>(null);
    const closeTimerRef = useRef<number | null>(null);
    const ticketRequestRef = useRef(0);
    const internalRequestRef = useRef(0);

    const [tickets, setTickets] = useState<SavedTicketTarget[]>([]);
    const [hiddenInternalConversationIds, setHiddenInternalConversationIds] =
        useState<string[]>([]);
    const [selected, setSelected] = useState<SelectedChat>(null);

    const [ticketData, setTicketData] =
        useState<FloatingConversationResponse | null>(null);
    const [ticketLoading, setTicketLoading] = useState(false);

    const [internalConversations, setInternalConversations] = useState<
        InternalConversationSummary[]
    >([]);
    const [internalDetail, setInternalDetail] =
        useState<InternalConversationDetail | null>(null);
    const [internalLoading, setInternalLoading] = useState(false);

    const [sidePanelOpen, setSidePanelOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [visible, setVisible] = useState(false);

    const visibleInternalConversations = useMemo(() => {
        const hidden = new Set(hiddenInternalConversationIds);
        return internalConversations.filter(
            (conversation) => !hidden.has(conversation.id),
        );
    }, [hiddenInternalConversationIds, internalConversations]);

    const selectedTicket = useMemo(() => {
        if (selected?.kind !== "ticket") return null;
        return tickets.find((ticket) => ticketKey(ticket) === selected.key) ?? null;
    }, [selected, tickets]);

    const selectedInternalConversation = useMemo(() => {
        if (selected?.kind !== "internal") return null;
        return (
            internalConversations.find(
                (conversation) => conversation.id === selected.conversationId,
            ) ?? null
        );
    }, [internalConversations, selected]);

    const selectedKey =
        selected?.kind === "ticket"
            ? `ticket:${selected.key}`
            : selected?.kind === "internal"
                ? `internal:${selected.conversationId}`
                : null;

    const loadInternalConversations = useCallback(async () => {
        if (!currentUserId) {
            setInternalConversations([]);
            return;
        }

        try {
            const conversations = await fetchInternalConversations();
            setInternalConversations(conversations);

            const unreadConversationIds = new Set(
                conversations
                    .filter((conversation) => conversation.unread_count > 0)
                    .map((conversation) => conversation.id),
            );

            if (unreadConversationIds.size > 0) {
                setHiddenInternalConversationIds((current) =>
                    current.filter((id) => !unreadConversationIds.has(id)),
                );
            }
        } catch (error) {
            console.error(
                "[FloatingConversationPanel] failed to load internal chats",
                error,
            );
        }
    }, [currentUserId]);

    const loadSelectedInternalConversation = useCallback(async () => {
        if (selected?.kind !== "internal") {
            setInternalDetail(null);
            setInternalLoading(false);
            return;
        }

        const requestId = ++internalRequestRef.current;
        setInternalLoading(true);

        try {
            const detail = await fetchInternalMessages(selected.conversationId);
            if (requestId !== internalRequestRef.current) return;

            setInternalDetail(detail);
            await markInternalConversationRead(selected.conversationId);
            setInternalConversations((current) =>
                current.map((conversation) =>
                    conversation.id === selected.conversationId
                        ? { ...conversation, unread_count: 0 }
                        : conversation,
                ),
            );
        } catch (error) {
            if (requestId !== internalRequestRef.current) return;
            console.error(
                "[FloatingConversationPanel] failed to load internal messages",
                error,
            );
            setInternalDetail(null);
        } finally {
            if (requestId === internalRequestRef.current) {
                setInternalLoading(false);
            }
        }
    }, [selected]);

    const handleOpenInternalUser = useCallback(
        async (userId: string) => {
            if (!currentUserId || !userId) return;

            try {
                const result = await openInternalConversation(userId);

                setHiddenInternalConversationIds((current) =>
                    current.filter((id) => id !== result.conversation.id),
                );
                setInternalConversations((current) => {
                    if (
                        current.some(
                            (conversation) =>
                                conversation.id === result.conversation.id,
                        )
                    ) {
                        return current;
                    }

                    return [
                        {
                            id: result.conversation.id,
                            peer: result.peer,
                            last_message_text:
                                result.conversation.last_message_text ?? null,
                            last_message_at:
                                result.conversation.last_message_at ?? null,
                            unread_count: 0,
                            created_at: result.conversation.created_at,
                            updated_at: result.conversation.updated_at,
                        },
                        ...current,
                    ];
                });
                setSelected({
                    kind: "internal",
                    conversationId: result.conversation.id,
                });
                await loadInternalConversations();
            } catch (error) {
                console.error(
                    "[FloatingConversationPanel] failed to open internal chat",
                    error,
                );
            }
        },
        [currentUserId, loadInternalConversations],
    );

    const handleRealtimeConversationListChange = useCallback(() => {
        void loadInternalConversations();
    }, [loadInternalConversations]);

    const handleRealtimeSelectedConversationChange = useCallback(() => {
        void loadSelectedInternalConversation();
    }, [loadSelectedInternalConversation]);

    useInternalChatRealtime({
        currentUserId,
        selectedConversationId:
            selected?.kind === "internal" ? selected.conversationId : null,
        onConversationListChange: handleRealtimeConversationListChange,
        onSelectedConversationChange: handleRealtimeSelectedConversationChange,
    });

    useEffect(() => {
        const stored = readRailState();
        const legacyTarget = readFloatingTarget(
            window.localStorage.getItem(LEGACY_STORAGE_KEY),
        );
        const pendingTarget = readFloatingTarget(
            window.localStorage.getItem(PENDING_TICKET_KEY),
        );

        let nextTickets = stored?.tickets ?? [];
        let nextSelected = stored?.selected ?? null;

        for (const target of [legacyTarget, pendingTarget]) {
            if (!target) continue;
            nextTickets = addTicketTarget(nextTickets, target);
            nextSelected = { kind: "ticket", key: ticketKey(target) };
        }

        setTickets(nextTickets);
        setHiddenInternalConversationIds(
            stored?.hiddenInternalConversationIds ?? [],
        );
        setSelected(nextSelected);

        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        window.localStorage.removeItem(PENDING_TICKET_KEY);
        window.localStorage.removeItem(OLD_DOCK_STORAGE_KEY);
        hydratedRef.current = true;
    }, []);

    useEffect(() => {
        if (!hydratedRef.current) return;

        const state: PersistedRailState = {
            tickets,
            hiddenInternalConversationIds,
            selected,
        };

        window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify(state));
    }, [hiddenInternalConversationIds, selected, tickets]);

    useEffect(() => {
        function handleOpenTicket(event: Event) {
            const target = (event as OpenFloatingConversationEvent).detail;
            if (!isFloatingTarget(target)) return;

            if (closeTimerRef.current) {
                window.clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
            }

            setTickets((current) => addTicketTarget(current, target));
            setSelected({ kind: "ticket", key: ticketKey(target) });
            window.localStorage.removeItem(PENDING_TICKET_KEY);
        }

        function handleOpenInternal(event: Event) {
            const userId = (event as OpenInternalChatEvent).detail?.userId;
            if (!userId) return;

            void handleOpenInternalUser(userId);
            window.localStorage.removeItem(PENDING_INTERNAL_USER_KEY);
        }

        window.addEventListener(
            OPEN_FLOATING_CONVERSATION_EVENT,
            handleOpenTicket,
        );
        window.addEventListener(OPEN_INTERNAL_CHAT_EVENT, handleOpenInternal);

        const pendingInternalUser = window.localStorage.getItem(
            PENDING_INTERNAL_USER_KEY,
        );
        if (pendingInternalUser) {
            void handleOpenInternalUser(pendingInternalUser);
            window.localStorage.removeItem(PENDING_INTERNAL_USER_KEY);
        }

        return () => {
            window.removeEventListener(
                OPEN_FLOATING_CONVERSATION_EVENT,
                handleOpenTicket,
            );
            window.removeEventListener(
                OPEN_INTERNAL_CHAT_EVENT,
                handleOpenInternal,
            );
        };
    }, [handleOpenInternalUser]);

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

        window.addEventListener(
            DETAILS_SIDE_PANEL_STATE_EVENT,
            handleSidePanelState,
        );

        return () => {
            window.removeEventListener(
                DETAILS_SIDE_PANEL_STATE_EVENT,
                handleSidePanelState,
            );
        };
    }, []);

    useEffect(() => {
        if (!currentUserId) return;

        function heartbeat() {
            void heartbeatInternalPresence().catch((error) => {
                console.error(
                    "[FloatingConversationPanel] presence heartbeat failed",
                    error,
                );
            });
        }

        heartbeat();
        const interval = window.setInterval(heartbeat, PRESENCE_INTERVAL_MS);

        function handleVisibilityChange() {
            if (document.visibilityState === "visible") heartbeat();
        }

        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            window.clearInterval(interval);
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );
        };
    }, [currentUserId]);

    useEffect(() => {
        if (!currentUserId) return;

        void loadInternalConversations();
        const interval = window.setInterval(
            () => void loadInternalConversations(),
            REFRESH_INTERVAL_MS,
        );

        return () => window.clearInterval(interval);
    }, [currentUserId, loadInternalConversations]);

    useEffect(() => {
        if (!selectedTicket) {
            setTicketData(null);
            setTicketLoading(false);
            return;
        }

        const requestId = ++ticketRequestRef.current;
        setTicketLoading(true);
        setTicketData(null);

        void loadTicketConversation(selectedTicket)
            .then((data) => {
                if (requestId !== ticketRequestRef.current) return;

                setTicketData(data);
                setTickets((current) =>
                    current.map((ticket) =>
                        ticketKey(ticket) === ticketKey(selectedTicket)
                            ? {
                                  ...ticket,
                                  name: data.client?.name ?? "Cliente sem nome",
                                  phone: data.client?.phone ?? null,
                                  preview:
                                      data.thread?.last_message_text ??
                                      data.messages.at(-1)?.text ??
                                      null,
                                  channel: data.thread?.channel ?? null,
                                  status:
                                      data.thread?.status ??
                                      (data.conversation?.ended_at
                                          ? "closed"
                                          : null),
                              }
                            : ticket,
                    ),
                );
            })
            .catch((error) => {
                if (requestId !== ticketRequestRef.current) return;
                console.error(
                    "[FloatingConversationPanel] failed to load ticket",
                    error,
                );
            })
            .finally(() => {
                if (requestId === ticketRequestRef.current) {
                    setTicketLoading(false);
                }
            });
    }, [selectedTicket?.id, selectedTicket?.type]);

    useEffect(() => {
        if (!selectedTicket) return;

        const channel = supabase
            .channel(
                `floating-ticket-${selectedTicket.type}-${selectedTicket.id}`,
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "messages" },
                (payload) => {
                    const next = payload.new as {
                        thread_id?: string;
                        conversation_id?: string;
                    } | null;
                    const previous = payload.old as {
                        thread_id?: string;
                        conversation_id?: string;
                    } | null;
                    const matches =
                        selectedTicket.type === "thread"
                            ? next?.thread_id === selectedTicket.id ||
                              previous?.thread_id === selectedTicket.id
                            : next?.conversation_id === selectedTicket.id ||
                              previous?.conversation_id === selectedTicket.id;

                    if (matches) {
                        void refreshSelectedTicket(selectedTicket);
                    }
                },
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "thread" },
                (payload) => {
                    const next = payload.new as { id?: string } | null;
                    const previous = payload.old as { id?: string } | null;

                    if (
                        selectedTicket.type === "thread" &&
                        (next?.id === selectedTicket.id ||
                            previous?.id === selectedTicket.id)
                    ) {
                        void refreshSelectedTicket(selectedTicket);
                    }
                },
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [selectedTicket?.id, selectedTicket?.type]);

    useEffect(() => {
        void loadSelectedInternalConversation();
    }, [loadSelectedInternalConversation]);

    useEffect(() => {
        if (!hydratedRef.current || selected) return;

        const next = getFirstAvailableSelection(
            tickets,
            visibleInternalConversations,
        );
        if (next) setSelected(next);
    }, [selected, tickets, visibleInternalConversations]);

    useEffect(() => {
        if (!selectedKey) {
            setVisible(false);
            return;
        }

        if (showTimerRef.current) {
            window.clearTimeout(showTimerRef.current);
        }
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }

        setCollapsed(false);
        setVisible(false);

        showTimerRef.current = window.setTimeout(() => {
            setVisible(true);
            showTimerRef.current = null;
        }, 30);

        return () => {
            if (showTimerRef.current) {
                window.clearTimeout(showTimerRef.current);
                showTimerRef.current = null;
            }
        };
    }, [selectedKey]);

    useEffect(() => {
        return () => {
            if (showTimerRef.current) {
                window.clearTimeout(showTimerRef.current);
            }
            if (closeTimerRef.current) {
                window.clearTimeout(closeTimerRef.current);
            }
        };
    }, []);

    async function refreshSelectedTicket(target: SavedTicketTarget) {
        try {
            const data = await loadTicketConversation(target);

            if (
                selected?.kind === "ticket" &&
                selected.key === ticketKey(target)
            ) {
                setTicketData(data);
            }

            setTickets((current) =>
                current.map((ticket) =>
                    ticketKey(ticket) === ticketKey(target)
                        ? {
                              ...ticket,
                              name: data.client?.name ?? ticket.name,
                              phone: data.client?.phone ?? ticket.phone,
                              preview:
                                  data.thread?.last_message_text ??
                                  data.messages.at(-1)?.text ??
                                  ticket.preview,
                              channel: data.thread?.channel ?? ticket.channel,
                              status: data.thread?.status ?? ticket.status,
                          }
                        : ticket,
                ),
            );
        } catch (error) {
            console.error(
                "[FloatingConversationPanel] realtime refresh failed",
                error,
            );
        }
    }

    function handleSelectTicket(ticket: SavedTicketTarget) {
        setSelected({ kind: "ticket", key: ticketKey(ticket) });
    }

    function handleSelectInternal(conversation: InternalConversationSummary) {
        setSelected({
            kind: "internal",
            conversationId: conversation.id,
        });
    }

    function handleCloseTicket(key: string) {
        const nextTickets = tickets.filter(
            (ticket) => ticketKey(ticket) !== key,
        );

        if (selected?.kind !== "ticket" || selected.key !== key) {
            setTickets(nextTickets);
            return;
        }

        const nextSelection = getFirstAvailableSelection(
            nextTickets,
            visibleInternalConversations,
        );

        if (nextSelection) {
            setTickets(nextTickets);
            setSelected(nextSelection);
            return;
        }

        animateLastChatClose(() => {
            setTickets(nextTickets);
            setSelected(null);
        });
    }

    function handleCloseInternal(conversationId: string) {
        const nextVisibleInternal = visibleInternalConversations.filter(
            (conversation) => conversation.id !== conversationId,
        );

        if (
            selected?.kind !== "internal" ||
            selected.conversationId !== conversationId
        ) {
            setHiddenInternalConversationIds((current) => [
                ...new Set([...current, conversationId]),
            ]);
            return;
        }

        const nextSelection = getFirstAvailableSelection(
            tickets,
            nextVisibleInternal,
        );

        if (nextSelection) {
            setHiddenInternalConversationIds((current) => [
                ...new Set([...current, conversationId]),
            ]);
            setSelected(nextSelection);
            return;
        }

        animateLastChatClose(() => {
            setHiddenInternalConversationIds((current) => [
                ...new Set([...current, conversationId]),
            ]);
            setSelected(null);
        });
    }

    function animateLastChatClose(afterClose: () => void) {
        if (showTimerRef.current) {
            window.clearTimeout(showTimerRef.current);
            showTimerRef.current = null;
        }
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
        }

        setVisible(false);
        closeTimerRef.current = window.setTimeout(() => {
            afterClose();
            setCollapsed(false);
            closeTimerRef.current = null;
        }, ANIMATION_MS + 40);
    }

    function handleOpenDetails(target: SavedTicketTarget) {
        if (target.type === "thread") {
            router.push(`/inbox?thread_id=${target.id}`);
            return;
        }

        window.dispatchEvent(
            new CustomEvent(OPEN_CONVERSATION_DETAILS_EVENT, {
                detail: { conversationId: target.id },
            }),
        );
    }

    if (!selected) return null;

    const rightOffset = sidePanelOpen ? 484 : 24;
    const panelTransform = !visible
        ? "translate3d(0, calc(100% + 28px), 0) scale(0.98)"
        : collapsed
            ? `translate3d(0, calc(100% - ${COLLAPSED_VISIBLE_HEIGHT_PX}px), 0) scale(1)`
            : "translate3d(0, 0, 0) scale(1)";
    const panelOpacity = visible ? 1 : 0;

    return (
        <div
            className="fixed bottom-6 z-[35] flex items-end gap-2 will-change-transform"
            style={{
                right: rightOffset,
                opacity: panelOpacity,
                pointerEvents: visible ? "auto" : "none",
                transform: panelTransform,
                transition: [
                    `right ${ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                    `transform ${ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                    `opacity ${Math.round(ANIMATION_MS * 0.7)}ms ease`,
                ].join(", "),
            }}
        >
            <ChatRail
                tickets={tickets}
                internalConversations={visibleInternalConversations}
                selected={selected}
                onSelectTicket={handleSelectTicket}
                onCloseTicket={handleCloseTicket}
                onSelectInternal={handleSelectInternal}
                onCloseInternal={handleCloseInternal}
            />

            {selected.kind === "ticket" && selectedTicket ? (
                <TicketFloatingPanel
                    target={selectedTicket}
                    data={ticketData}
                    loading={ticketLoading}
                    collapsed={collapsed}
                    onToggleCollapsed={() =>
                        setCollapsed((current) => !current)
                    }
                    onClose={() => handleCloseTicket(ticketKey(selectedTicket))}
                    onOpenDetails={() => handleOpenDetails(selectedTicket)}
                />
            ) : selected.kind === "internal" ? (
                <InternalFloatingPanel
                    currentUserId={currentUserId}
                    currentUserName={currentUserName}
                    summary={selectedInternalConversation}
                    detail={internalDetail}
                    loading={internalLoading}
                    collapsed={collapsed}
                    onToggleCollapsed={() =>
                        setCollapsed((current) => !current)
                    }
                    onClose={() =>
                        handleCloseInternal(selected.conversationId)
                    }
                    onSend={async (text) => {
                        await sendInternalMessage(
                            selected.conversationId,
                            text,
                        );
                        await Promise.all([
                            loadSelectedInternalConversation(),
                            loadInternalConversations(),
                        ]);
                    }}
                />
            ) : null}
        </div>
    );
}

function ChatRail({
    tickets,
    internalConversations,
    selected,
    onSelectTicket,
    onCloseTicket,
    onSelectInternal,
    onCloseInternal,
}: {
    tickets: SavedTicketTarget[];
    internalConversations: InternalConversationSummary[];
    selected: SelectedChat;
    onSelectTicket: (ticket: SavedTicketTarget) => void;
    onCloseTicket: (key: string) => void;
    onSelectInternal: (conversation: InternalConversationSummary) => void;
    onCloseInternal: (conversationId: string) => void;
}) {
    return (
        <aside className="flex h-[480px] w-[220px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div
                className={`min-h-0 flex-1 overflow-y-auto p-3 ${SCROLLBAR_CLASS}`}
            >
                <RailSectionTitle label="Atendimentos" />
                <div className="space-y-2">
                    {tickets.map((ticket) => (
                        <SavedChatRow
                            key={ticketKey(ticket)}
                            name={ticket.name ?? "Conversa"}
                            preview={
                                ticket.preview ??
                                (ticket.type === "thread"
                                    ? "Atendimento em andamento"
                                    : "Conversa do histórico")
                            }
                            active={
                                selected?.kind === "ticket" &&
                                selected.key === ticketKey(ticket)
                            }
                            onClick={() => onSelectTicket(ticket)}
                            onClose={() => onCloseTicket(ticketKey(ticket))}
                        />
                    ))}
                    {tickets.length === 0 ? (
                        <RailEmptyState label="Nenhum atendimento aberto" />
                    ) : null}
                </div>

                <div className="my-4 h-px bg-slate-100" />

                <RailSectionTitle label="Internos" />
                <div className="space-y-2">
                    {internalConversations.map((conversation) => (
                        <SavedChatRow
                            key={conversation.id}
                            name={conversation.peer.name}
                            preview={
                                conversation.last_message_text ??
                                "Chat interno"
                            }
                            active={
                                selected?.kind === "internal" &&
                                selected.conversationId === conversation.id
                            }
                            unread={conversation.unread_count}
                            onClick={() => onSelectInternal(conversation)}
                            onClose={() =>
                                onCloseInternal(conversation.id)
                            }
                        />
                    ))}
                    {internalConversations.length === 0 ? (
                        <RailEmptyState label="Nenhum chat interno aberto" />
                    ) : null}
                </div>
            </div>
        </aside>
    );
}

function RailSectionTitle({ label }: { label: string }) {
    return (
        <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {label}
        </div>
    );
}

function RailEmptyState({ label }: { label: string }) {
    return (
        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
            {label}
        </div>
    );
}

function SavedChatRow({
    name,
    preview,
    active,
    unread = 0,
    onClick,
    onClose,
}: {
    name: string;
    preview: string;
    active: boolean;
    unread?: number;
    onClick: () => void;
    onClose: () => void;
}) {
    return (
        <div
            className={`group grid grid-cols-[36px_minmax(0,1fr)_28px] items-center gap-2 rounded-xl border px-2 py-2 transition-colors ${
                active
                    ? "border-brand bg-brand-soft/60"
                    : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
            }`}
        >
            <button type="button" onClick={onClick} className="cursor-pointer">
                <InitialsAvatar name={name} />
            </button>

            <button
                type="button"
                onClick={onClick}
                className="min-w-0 cursor-pointer text-left"
            >
                <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-bold text-slate-800">
                        {name}
                    </span>
                    {unread > 0 ? (
                        <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                            {unread > 99 ? "99+" : unread}
                        </span>
                    ) : null}
                </div>
                <div className="mt-1 truncate text-[11px] text-slate-400">
                    {preview}
                </div>
            </button>

            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                }}
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-soft hover:text-red"
                title="Fechar chat"
            >
                <X size={14} />
            </button>
        </div>
    );
}

function TicketFloatingPanel({
    target,
    data,
    loading,
    collapsed,
    onToggleCollapsed,
    onClose,
    onOpenDetails,
}: {
    target: SavedTicketTarget;
    data: FloatingConversationResponse | null;
    loading: boolean;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onClose: () => void;
    onOpenDetails: () => void;
}) {
    const clientName = data?.client?.name ?? target.name ?? "Cliente sem nome";
    const phone = formatPhone(data?.client?.phone ?? target.phone ?? null);
    const isLive = target.type === "thread";
    const detailsLabel = isLive ? "Abrir inbox" : "Abrir detalhes";
    const attendantName = data?.conversation?.attendant_chat_name ?? null;

    const orderedMessages = useMemo(() => {
        return [...(data?.messages ?? [])]
            .sort((a, b) => {
                const dateDiff =
                    new Date(a.sent_at).getTime() -
                    new Date(b.sent_at).getTime();
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
    }, [attendantName, data?.messages]);

    return (
        <div className="w-[365px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
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

                    <PanelControls
                        collapsed={collapsed}
                        onToggleCollapsed={onToggleCollapsed}
                        onClose={onClose}
                    />
                </div>

                <button
                    type="button"
                    onClick={onOpenDetails}
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
                emptyMessage={
                    !data
                        ? "Não foi possível carregar esta conversa."
                        : "Nenhuma mensagem encontrada."
                }
                className="h-[360px] overflow-y-auto bg-slate-50 px-4 py-4"
            />
        </div>
    );
}

function InternalFloatingPanel({
    currentUserId,
    currentUserName,
    summary,
    detail,
    loading,
    collapsed,
    onToggleCollapsed,
    onClose,
    onSend,
}: {
    currentUserId: string | null;
    currentUserName: string;
    summary: InternalConversationSummary | null;
    detail: InternalConversationDetail | null;
    loading: boolean;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onClose: () => void;
    onSend: (text: string) => Promise<void>;
}) {
    const [messageText, setMessageText] = useState("");
    const [sending, setSending] = useState(false);

    const peer = detail?.peer ?? summary?.peer ?? null;
    const messages = useMemo<SharedChatMessage[]>(() => {
        if (!currentUserId) return [];

        return (detail?.messages ?? []).map((message, index) => {
            const own = message.sender_auth_user_id === currentUserId;

            return {
                id: message.id,
                text: message.text,
                sender_type: own ? "attendant" : "client",
                sender_name: message.sender_name,
                sender_label: own
                    ? currentUserName
                    : peer?.name ?? message.sender_name,
                sent_at: message.sent_at,
                sequence_index: index,
            };
        });
    }, [currentUserId, currentUserName, detail?.messages, peer?.name]);

    useEffect(() => {
        setMessageText("");
    }, [summary?.id]);

    async function handleSubmit() {
        const text = messageText.trim();
        if (!text || sending) return;

        setSending(true);
        setMessageText("");

        try {
            await onSend(text);
        } catch (error) {
            console.error(
                "[FloatingConversationPanel] failed to send internal message",
                error,
            );
            setMessageText(text);
        } finally {
            setSending(false);
        }
    }

    const peerName = peer?.name ?? "Usuário";
    const peerEmail = peer?.email ?? "Chat interno";

    return (
        <div className="w-[365px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <InitialsAvatar name={peerName} />

                        <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                                <div
                                    title={peerName}
                                    className="truncate text-sm font-bold text-slate-950"
                                >
                                    {loading ? "Carregando..." : peerName}
                                </div>

                                <span className="inline-flex shrink-0 rounded-md bg-purple-soft px-2 py-0.5 text-[10px] font-bold text-purple">
                                    Interno
                                </span>
                            </div>

                            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                                <Mail size={12} />
                                <span className="truncate">{peerEmail}</span>
                            </div>
                        </div>
                    </div>

                    <PanelControls
                        collapsed={collapsed}
                        onToggleCollapsed={onToggleCollapsed}
                        onClose={onClose}
                    />
                </div>
            </div>

            <ChatMessageList
                messages={messages}
                isLoading={loading}
                skeleton={(
                    <div className="space-y-3">
                        <Skeleton className="h-14 w-[75%] rounded-2xl" />
                        <Skeleton className="ml-auto h-14 w-[65%] rounded-2xl" />
                        <Skeleton className="h-14 w-[82%] rounded-2xl" />
                    </div>
                )}
                emptyMessage="Nenhuma mensagem neste chat."
                className="h-[315px] overflow-y-auto bg-slate-50 px-4 py-4"
                enablePrewrittenMessages={false}
                autoScrollToBottom
            />

            <div className="border-t border-slate-100 p-2">
                <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <textarea
                        rows={1}
                        value={messageText}
                        disabled={sending}
                        onChange={(event) => setMessageText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                void handleSubmit();
                            }
                        }}
                        placeholder="Escrever mensagem..."
                        className="max-h-24 min-h-[34px] min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed outline-none placeholder:text-slate-400"
                        onInput={(event) => {
                            const target = event.currentTarget;
                            target.style.height = "auto";
                            target.style.height = `${target.scrollHeight}px`;
                        }}
                    />

                    <button
                        type="button"
                        disabled={sending || !messageText.trim()}
                        onClick={() => void handleSubmit()}
                        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-brand text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Enviar"
                    >
                        <Send size={17} />
                    </button>
                </div>
            </div>
        </div>
    );
}

function PanelControls({
    collapsed,
    onToggleCollapsed,
    onClose,
}: {
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onClose: () => void;
}) {
    return (
        <div className="flex shrink-0 items-center gap-1">
            <button
                type="button"
                onClick={onToggleCollapsed}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                title={collapsed ? "Mostrar conversa" : "Ocultar conversa"}
            >
                <ChevronDown
                    size={16}
                    className={`transition-transform duration-300 ease-out ${
                        collapsed ? "rotate-180" : "rotate-0"
                    }`}
                />
            </button>

            <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                title="Fechar conversa"
            >
                <X size={16} />
            </button>
        </div>
    );
}

async function loadTicketConversation(target: FloatingConversationTarget) {
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
        throw new Error(json.error ?? "Não foi possível carregar a conversa");
    }

    return json as FloatingConversationResponse;
}

function addTicketTarget(
    current: SavedTicketTarget[],
    target: FloatingConversationTarget,
) {
    const key = ticketKey(target);
    const existing = current.find((item) => ticketKey(item) === key);

    if (existing) {
        return current.map((item) =>
            ticketKey(item) === key ? { ...item, ...target } : item,
        );
    }

    return [...current, target];
}

function ticketKey(target: FloatingConversationTarget) {
    return `${target.type}:${target.id}`;
}

function getFirstAvailableSelection(
    tickets: SavedTicketTarget[],
    internalConversations: InternalConversationSummary[],
): SelectedChat {
    const ticket = tickets[0];
    if (ticket) {
        return { kind: "ticket", key: ticketKey(ticket) };
    }

    const internalConversation = internalConversations[0];
    if (internalConversation) {
        return {
            kind: "internal",
            conversationId: internalConversation.id,
        };
    }

    return null;
}

function readRailState(): PersistedRailState | null {
    try {
        const raw =
            window.localStorage.getItem(RAIL_STORAGE_KEY) ??
            window.localStorage.getItem(OLD_DOCK_STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as PersistedRailState;
        return {
            tickets: Array.isArray(parsed?.tickets)
                ? parsed.tickets.filter(isFloatingTarget)
                : [],
            hiddenInternalConversationIds: Array.isArray(
                parsed?.hiddenInternalConversationIds,
            )
                ? parsed.hiddenInternalConversationIds.filter(
                      (id): id is string => typeof id === "string",
                  )
                : [],
            selected: isSelectedChat(parsed?.selected)
                ? parsed.selected
                : null,
        };
    } catch {
        window.localStorage.removeItem(RAIL_STORAGE_KEY);
        return null;
    }
}

function readFloatingTarget(raw: string | null) {
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        return isFloatingTarget(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function isFloatingTarget(value: unknown): value is FloatingConversationTarget {
    if (!value || typeof value !== "object") return false;

    const target = value as Record<string, unknown>;
    return (
        typeof target.id === "string" &&
        (target.type === "thread" || target.type === "conversation")
    );
}

function isSelectedChat(value: unknown): value is Exclude<SelectedChat, null> {
    if (!value || typeof value !== "object") return false;

    const selected = value as Record<string, unknown>;
    return (
        (selected.kind === "ticket" && typeof selected.key === "string") ||
        (selected.kind === "internal" &&
            typeof selected.conversationId === "string")
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
    if (fallbackAttendantName && !isEmail(fallbackAttendantName)) {
        return fallbackAttendantName;
    }
    if (normalizedSenderType.includes("bot")) return "Bot";
    if (
        normalizedSenderType.includes("system") ||
        normalizedSenderType.includes("sistema")
    ) {
        return "Sistema";
    }

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
