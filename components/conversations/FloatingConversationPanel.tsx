// components/conversations/FloatingConversationPanel.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ExternalLink,
  History,
  Menu,
  Mail,
  Phone,
  Send,
  UsersRound,
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
  fetchInternalGroupMessages,
  fetchInternalGroups,
  fetchInternalMessages,
  heartbeatInternalPresence,
  markInternalConversationRead,
  markInternalGroupRead,
  openInternalConversation,
  sendInternalGroupMessage,
  sendInternalMessage,
} from "@/lib/internal-chat/internalChatApi";
import {
  useInternalChatRealtime,
  type InternalChatRealtimeMessageChange,
  type InternalGroupRealtimeMessageChange,
} from "@/lib/internal-chat/useInternalChatRealtime";
import { supabase } from "@/lib/supabase/client";
import type {
  InternalChatUser,
  InternalConversationDetail,
  InternalConversationSummary,
  InternalGroupDetail,
  InternalGroupMessage,
  InternalGroupSummary,
  InternalMessage,
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
  unread_count?: number;
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
  | { kind: "group"; groupId: string }
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

export type InternalChatPreview = Pick<
  InternalChatUser,
  "name" | "email" | "online"
>;
export type InternalGroupPreview = Pick<InternalGroupSummary, "name">;
type PendingChatOpen =
  | {
      kind: "internal";
      userId: string;
      preview: InternalChatPreview | null;
    }
  | {
      kind: "group";
      groupId: string;
      preview: InternalGroupPreview | null;
    };

type OpenFloatingConversationEvent = CustomEvent<FloatingConversationTarget>;
type OpenInternalChatEvent = CustomEvent<{
  userId: string;
  preview?: InternalChatPreview;
}>;
type OpenInternalGroupEvent = CustomEvent<{
  groupId: string;
  preview?: InternalGroupPreview;
}>;

export const OPEN_FLOATING_CONVERSATION_EVENT =
  "engravida:open-floating-conversation";
export const OPEN_INTERNAL_CHAT_EVENT = "engravida:open-internal-chat";
export const OPEN_INTERNAL_GROUP_EVENT = "engravida:open-internal-group";
export const OPEN_CONVERSATION_DETAILS_EVENT =
  "engravida:open-conversation-details";

const LEGACY_STORAGE_KEY = "engravida:floating-conversation";
const RAIL_STORAGE_KEY = "engravida:floating-chat-rail:v2";
const OLD_DOCK_STORAGE_KEY = "engravida:floating-chat-dock:v1";
const PENDING_TICKET_KEY = "engravida:floating-chat-pending-ticket";
const PENDING_INTERNAL_USER_KEY =
  "engravida:floating-chat-pending-internal-user";
const PENDING_INTERNAL_GROUP_KEY =
  "engravida:floating-chat-pending-internal-group";
const ANIMATION_MS = 360;
const COLLAPSED_VISIBLE_HEIGHT_PX = 42;
const PRESENCE_INTERVAL_MS = 30_000;
const REFRESH_INTERVAL_MS = 5_000;
const SCROLLBAR_CLASS =
  "[scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]";

export function openFloatingConversation(target: FloatingConversationTarget) {
  window.localStorage.setItem(PENDING_TICKET_KEY, JSON.stringify(target));
  window.dispatchEvent(
    new CustomEvent(OPEN_FLOATING_CONVERSATION_EVENT, { detail: target }),
  );
}

export function openInternalChat(
  userId: string,
  preview?: InternalChatPreview,
) {
  window.localStorage.setItem(PENDING_INTERNAL_USER_KEY, userId);
  window.dispatchEvent(
    new CustomEvent(OPEN_INTERNAL_CHAT_EVENT, {
      detail: { userId, preview },
    }),
  );
}

export function openInternalGroup(
  groupId: string,
  preview?: InternalGroupPreview,
) {
  window.localStorage.setItem(PENDING_INTERNAL_GROUP_KEY, groupId);
  window.dispatchEvent(
    new CustomEvent(OPEN_INTERNAL_GROUP_EVENT, {
      detail: { groupId, preview },
    }),
  );
}

export function FloatingConversationPanel() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const currentUserId = currentUser?.user?.id ?? null;
  const currentUserName = currentUser?.user?.name ?? "Você";

  const openedSidePanelIds = useRef(new Set<string>());
  const [hydrated, setHydrated] = useState(false);
  const showTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const ticketRequestRef = useRef(0);
  const internalRequestRef = useRef(0);
  const groupRequestRef = useRef(0);
  const internalSendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const groupSendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ticketsRef = useRef<SavedTicketTarget[]>([]);
  const selectedRef = useRef<SelectedChat>(null);
  const collapsedRef = useRef(false);
  const visibleRef = useRef(false);
  const internalUnreadSnapshotRef = useRef(new Map<string, number>());
  const internalUnreadSnapshotReadyRef = useRef(false);
  const groupUnreadSnapshotRef = useRef(new Map<string, number>());
  const groupUnreadSnapshotReadyRef = useRef(false);

  const [tickets, setTickets] = useState<SavedTicketTarget[]>([]);
  const [hiddenInternalConversationIds, setHiddenInternalConversationIds] =
    useState<string[]>([]);
  const [selected, setSelected] = useState<SelectedChat>(null);
  const [pendingOpen, setPendingOpen] = useState<PendingChatOpen | null>(null);

  const [ticketData, setTicketData] =
    useState<FloatingConversationResponse | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);

  const [internalConversations, setInternalConversations] = useState<
    InternalConversationSummary[]
  >([]);
  const [internalDetail, setInternalDetail] =
    useState<InternalConversationDetail | null>(null);
  const [internalLoading, setInternalLoading] = useState(false);

  const [internalGroups, setInternalGroups] = useState<InternalGroupSummary[]>(
    [],
  );
  const [groupDetail, setGroupDetail] = useState<InternalGroupDetail | null>(
    null,
  );
  const [groupLoading, setGroupLoading] = useState(false);

  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(true);
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

  const selectedGroup = useMemo(() => {
    if (selected?.kind !== "group") return null;
    return (
      internalGroups.find((group) => group.id === selected.groupId) ?? null
    );
  }, [internalGroups, selected]);

  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const showDock = useCallback((nextCollapsed: boolean) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }

    collapsedRef.current = nextCollapsed;
    setCollapsed(nextCollapsed);
    setRailCollapsed(true);

    if (visibleRef.current) {
      setVisible(true);
      return;
    }

    visibleRef.current = false;
    setVisible(false);
    showTimerRef.current = window.setTimeout(() => {
      visibleRef.current = true;
      setVisible(true);
      showTimerRef.current = null;
    }, 30);
  }, []);

  const showDockExpanded = useCallback(() => {
    showDock(false);
  }, [showDock]);

  const showDockCollapsedForUnread = useCallback(() => {
    showDock(true);
  }, [showDock]);

  const loadInternalConversations = useCallback(async () => {
    if (!currentUserId) {
      setInternalConversations([]);
      internalUnreadSnapshotRef.current.clear();
      internalUnreadSnapshotReadyRef.current = false;
      return;
    }

    try {
      const conversations = await fetchInternalConversations();
      const previousUnread = internalUnreadSnapshotRef.current;
      const snapshotWasReady = internalUnreadSnapshotReadyRef.current;
      const unreadIncreases = conversations
        .filter((conversation) => {
          if (conversation.unread_count <= 0) return false;

          const previousCount = previousUnread.get(conversation.id) ?? 0;
          return snapshotWasReady
            ? conversation.unread_count > previousCount
            : true;
        })
        .sort((left, right) => {
          const leftTime = left.last_message_at
            ? new Date(left.last_message_at).getTime()
            : 0;
          const rightTime = right.last_message_at
            ? new Date(right.last_message_at).getTime()
            : 0;
          return rightTime - leftTime;
        });

      internalUnreadSnapshotRef.current = new Map(
        conversations.map((conversation) => [
          conversation.id,
          conversation.unread_count,
        ]),
      );
      internalUnreadSnapshotReadyRef.current = true;

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

      const newestUnread = unreadIncreases[0];
      if (newestUnread && (!visibleRef.current || collapsedRef.current)) {
        const nextSelection: SelectedChat = {
          kind: "internal",
          conversationId: newestUnread.id,
        };
        selectedRef.current = nextSelection;
        setSelected(nextSelection);
        showDockCollapsedForUnread();
      }
    } catch (error) {
      console.error(
        "[FloatingConversationPanel] failed to load internal chats",
        error,
      );
    }
  }, [currentUserId, showDockCollapsedForUnread]);

  const loadInternalGroups = useCallback(async () => {
    if (!currentUserId) {
      setInternalGroups([]);
      groupUnreadSnapshotRef.current.clear();
      groupUnreadSnapshotReadyRef.current = false;
      return;
    }

    try {
      const groups = await fetchInternalGroups();
      const previousUnread = groupUnreadSnapshotRef.current;
      const snapshotWasReady = groupUnreadSnapshotReadyRef.current;
      const unreadIncreases = groups
        .filter((group) => {
          if (group.unread_count <= 0) return false;
          const previousCount = previousUnread.get(group.id) ?? 0;
          return snapshotWasReady ? group.unread_count > previousCount : true;
        })
        .sort((left, right) => {
          const leftTime = left.last_message_at
            ? new Date(left.last_message_at).getTime()
            : 0;
          const rightTime = right.last_message_at
            ? new Date(right.last_message_at).getTime()
            : 0;
          return rightTime - leftTime;
        });

      groupUnreadSnapshotRef.current = new Map(
        groups.map((group) => [group.id, group.unread_count]),
      );
      groupUnreadSnapshotReadyRef.current = true;
      setInternalGroups(groups);

      const newestUnread = unreadIncreases[0];
      if (newestUnread && (!visibleRef.current || collapsedRef.current)) {
        const nextSelection: SelectedChat = {
          kind: "group",
          groupId: newestUnread.id,
        };
        selectedRef.current = nextSelection;
        setSelected(nextSelection);
        showDockCollapsedForUnread();
      }
    } catch (error) {
      console.error(
        "[FloatingConversationPanel] failed to load internal groups",
        error,
      );
    }
  }, [currentUserId, showDockCollapsedForUnread]);

  const loadSelectedGroup = useCallback(
    async ({
      markRead = true,
      showLoading = true,
    }: {
      markRead?: boolean;
      showLoading?: boolean;
    } = {}) => {
      if (selected?.kind !== "group") {
        setGroupDetail(null);
        setGroupLoading(false);
        return;
      }

      const requestId = ++groupRequestRef.current;
      if (showLoading) setGroupLoading(true);

      try {
        const detail = await fetchInternalGroupMessages(selected.groupId);
        if (requestId !== groupRequestRef.current) return;

        setGroupDetail(detail);

        if (markRead) {
          const groupId = selected.groupId;
          try {
            await markInternalGroupRead(groupId);
            groupUnreadSnapshotRef.current.set(groupId, 0);
            setInternalGroups((current) =>
              current.map((group) =>
                group.id === groupId ? { ...group, unread_count: 0 } : group,
              ),
            );
          } catch (error) {
            console.warn(
              "[FloatingConversationPanel] failed to mark internal group as read",
              error,
            );
          }
        }
      } catch (error) {
        if (requestId !== groupRequestRef.current) return;
        console.error(
          "[FloatingConversationPanel] failed to load internal group messages",
          error,
        );
        setGroupDetail(null);
      } finally {
        if (showLoading && requestId === groupRequestRef.current) {
          setGroupLoading(false);
        }
      }
    },
    [selected],
  );

  const loadSelectedInternalConversation = useCallback(
    async ({
      markRead = true,
      showLoading = true,
    }: {
      markRead?: boolean;
      showLoading?: boolean;
    } = {}) => {
      if (selected?.kind !== "internal") {
        setInternalDetail(null);
        setInternalLoading(false);
        return;
      }

      const requestId = ++internalRequestRef.current;
      if (showLoading) setInternalLoading(true);

      try {
        const detail = await fetchInternalMessages(selected.conversationId);
        if (requestId !== internalRequestRef.current) return;

        setInternalDetail(detail);

        if (markRead) {
          const conversationId = selected.conversationId;

          try {
            await markInternalConversationRead(conversationId);
            internalUnreadSnapshotRef.current.set(conversationId, 0);
            setInternalConversations((current) =>
              current.map((conversation) =>
                conversation.id === conversationId
                  ? { ...conversation, unread_count: 0 }
                  : conversation,
              ),
            );
          } catch (error) {
            console.warn(
              "[FloatingConversationPanel] failed to mark internal chat as read",
              error,
            );
          }
        }
      } catch (error) {
        if (requestId !== internalRequestRef.current) return;
        console.error(
          "[FloatingConversationPanel] failed to load internal messages",
          error,
        );
        setInternalDetail(null);
      } finally {
        if (showLoading && requestId === internalRequestRef.current) {
          setInternalLoading(false);
        }
      }
    },
    [selected],
  );

  const handleOpenInternalUser = useCallback(
    async (userId: string, preview?: InternalChatPreview) => {
      if (!currentUserId || !userId) return;

      setPendingOpen({
        kind: "internal",
        userId,
        preview: preview ?? null,
      });
      showDockExpanded();

      try {
        const result = await openInternalConversation(userId);

        setHiddenInternalConversationIds((current) =>
          current.filter((id) => id !== result.conversation.id),
        );
        setInternalConversations((current) => {
          if (
            current.some(
              (conversation) => conversation.id === result.conversation.id,
            )
          ) {
            return current;
          }

          return [
            {
              id: result.conversation.id,
              peer: result.peer,
              last_message_text: result.conversation.last_message_text ?? null,
              last_message_at: result.conversation.last_message_at ?? null,
              unread_count: 0,
              created_at: result.conversation.created_at,
              updated_at: result.conversation.updated_at,
            },
            ...current,
          ];
        });
        const nextSelection: SelectedChat = {
          kind: "internal",
          conversationId: result.conversation.id,
        };
        selectedRef.current = nextSelection;
        setSelected(nextSelection);
        await loadInternalConversations();
      } catch (error) {
        console.error(
          "[FloatingConversationPanel] failed to open internal chat",
          error,
        );
      } finally {
        setPendingOpen((current) =>
          current?.kind === "internal" && current.userId === userId
            ? null
            : current,
        );
      }
    },
    [currentUserId, loadInternalConversations, showDockExpanded],
  );

  const handleOpenInternalGroup = useCallback(
    async (groupId: string, preview?: InternalGroupPreview) => {
      if (!currentUserId || !groupId) return;

      setPendingOpen({
        kind: "group",
        groupId,
        preview: preview ?? null,
      });
      setGroupLoading(true);

      const nextSelection: SelectedChat = {
        kind: "group",
        groupId,
      };
      selectedRef.current = nextSelection;
      setSelected(nextSelection);
      showDockExpanded();

      try {
        const groups = await fetchInternalGroups();
        setInternalGroups(groups);
      } catch (error) {
        console.error(
          "[FloatingConversationPanel] failed to refresh internal groups",
          error,
        );
      } finally {
        setPendingOpen((current) =>
          current?.kind === "group" && current.groupId === groupId
            ? null
            : current,
        );
      }
    },
    [currentUserId, showDockExpanded],
  );

  const handleRealtimeConversationListChange = useCallback(() => {
    void loadInternalConversations();
  }, [loadInternalConversations]);

  const handleRealtimeMessageChange = useCallback(
    (change: InternalChatRealtimeMessageChange) => {
      const { conversationId, eventType, message } = change;
      if (!conversationId) return;

      const activeSelection = selectedRef.current;
      const selectedNow =
        activeSelection?.kind === "internal" &&
        activeSelection.conversationId === conversationId;
      const incoming =
        Boolean(message) && message!.sender_auth_user_id !== currentUserId;
      const activelyReading =
        selectedNow &&
        visibleRef.current &&
        !collapsedRef.current &&
        document.visibilityState === "visible";

      if (eventType === "INSERT" && message) {
        setInternalDetail((current) => {
          if (current?.conversation.id !== conversationId) {
            return current;
          }
          if (current.messages.some((item) => item.id === message.id)) {
            return current;
          }

          return {
            ...current,
            conversation: {
              ...current.conversation,
              last_message_text: message.text,
              last_message_at: message.sent_at,
              updated_at: message.sent_at,
            },
            messages: [...current.messages, message],
          };
        });

        if (incoming && !activelyReading) {
          const previousCount =
            internalUnreadSnapshotRef.current.get(conversationId) ?? 0;
          internalUnreadSnapshotRef.current.set(
            conversationId,
            previousCount + 1,
          );
        } else if (activelyReading) {
          internalUnreadSnapshotRef.current.set(conversationId, 0);
        }

        setInternalConversations((current) =>
          current.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  last_message_text: message.text,
                  last_message_at: message.sent_at,
                  updated_at: message.sent_at,
                  unread_count:
                    incoming && !activelyReading
                      ? conversation.unread_count + 1
                      : activelyReading
                        ? 0
                        : conversation.unread_count,
                }
              : conversation,
          ),
        );

        if (incoming && (!visibleRef.current || collapsedRef.current)) {
          setHiddenInternalConversationIds((current) =>
            current.filter((id) => id !== conversationId),
          );
          const nextSelection: SelectedChat = {
            kind: "internal",
            conversationId,
          };
          selectedRef.current = nextSelection;
          setSelected(nextSelection);
          showDockCollapsedForUnread();
        }

        if (incoming && activelyReading) {
          void markInternalConversationRead(conversationId).catch((error) => {
            console.warn(
              "[FloatingConversationPanel] failed to mark internal chat as read",
              error,
            );
          });
        }

        return;
      }

      if (selectedNow) {
        void loadSelectedInternalConversation({
          markRead: activelyReading,
          showLoading: false,
        });
      }
    },
    [
      currentUserId,
      loadSelectedInternalConversation,
      showDockCollapsedForUnread,
    ],
  );

  const handleRealtimeGroupListChange = useCallback(() => {
    void loadInternalGroups();
  }, [loadInternalGroups]);

  const handleRealtimeGroupMessageChange = useCallback(
    (change: InternalGroupRealtimeMessageChange) => {
      const { groupId, eventType, message } = change;
      if (!groupId) return;

      const activeSelection = selectedRef.current;
      const selectedNow =
        activeSelection?.kind === "group" &&
        activeSelection.groupId === groupId;
      const incoming =
        Boolean(message) && message!.sender_auth_user_id !== currentUserId;
      const activelyReading =
        selectedNow &&
        visibleRef.current &&
        !collapsedRef.current &&
        document.visibilityState === "visible";

      if (eventType === "INSERT" && message) {
        if (incoming && !activelyReading) {
          const previousCount =
            groupUnreadSnapshotRef.current.get(groupId) ?? 0;
          groupUnreadSnapshotRef.current.set(groupId, previousCount + 1);
        } else if (activelyReading) {
          groupUnreadSnapshotRef.current.set(groupId, 0);
        }

        setInternalGroups((current) =>
          current.map((group) =>
            group.id === groupId
              ? {
                  ...group,
                  last_message_text: message.text,
                  last_message_at: message.sent_at,
                  updated_at: message.sent_at,
                  unread_count:
                    incoming && !activelyReading
                      ? group.unread_count + 1
                      : activelyReading
                        ? 0
                        : group.unread_count,
                }
              : group,
          ),
        );

        if (incoming && (!visibleRef.current || collapsedRef.current)) {
          const nextSelection: SelectedChat = {
            kind: "group",
            groupId,
          };
          selectedRef.current = nextSelection;
          setSelected(nextSelection);
          showDockCollapsedForUnread();
        }

        if (selectedNow) {
          void loadSelectedGroup({
            markRead: activelyReading,
            showLoading: false,
          });
        }

        if (incoming && activelyReading) {
          void markInternalGroupRead(groupId).catch((error) => {
            console.warn(
              "[FloatingConversationPanel] failed to mark internal group as read",
              error,
            );
          });
        }

        return;
      }

      if (selectedNow) {
        void loadSelectedGroup({
          markRead: activelyReading,
          showLoading: false,
        });
      }
    },
    [currentUserId, loadSelectedGroup, showDockCollapsedForUnread],
  );

  useInternalChatRealtime({
    currentUserId,
    onConversationListChange: handleRealtimeConversationListChange,
    onMessageChange: handleRealtimeMessageChange,
    onGroupListChange: handleRealtimeGroupListChange,
    onGroupMessageChange: handleRealtimeGroupMessageChange,
  });

  useEffect(() => {
    const stored = readRailState();
    const legacyTarget = readFloatingTarget(
      window.localStorage.getItem(LEGACY_STORAGE_KEY),
    );
    const pendingTarget = readFloatingTarget(
      window.localStorage.getItem(PENDING_TICKET_KEY),
    );
    const pendingGroupId = window.localStorage.getItem(
      PENDING_INTERNAL_GROUP_KEY,
    );

    let nextTickets = stored?.tickets ?? [];
    let nextSelected = stored?.selected ?? null;

    for (const target of [legacyTarget, pendingTarget]) {
      if (!target) continue;
      nextTickets = addTicketTarget(nextTickets, target);
      nextSelected = { kind: "ticket", key: ticketKey(target) };
    }

    if (pendingGroupId) {
      nextSelected = { kind: "group", groupId: pendingGroupId };
    }

    setTickets(nextTickets);
    setHiddenInternalConversationIds(
      stored?.hiddenInternalConversationIds ?? [],
    );
    selectedRef.current = nextSelected;
    setSelected(nextSelected);
    if (nextSelected) showDock(true);

    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    window.localStorage.removeItem(PENDING_TICKET_KEY);
    window.localStorage.removeItem(PENDING_INTERNAL_GROUP_KEY);
    window.localStorage.removeItem(OLD_DOCK_STORAGE_KEY);
    setHydrated(true);
  }, [showDock]);

  useEffect(() => {
    if (!hydrated) return;

    const state: PersistedRailState = {
      tickets,
      hiddenInternalConversationIds,
      selected,
    };

    window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify(state));
  }, [hiddenInternalConversationIds, hydrated, selected, tickets]);

  useEffect(() => {
    function handleOpenTicket(event: Event) {
      const target = (event as OpenFloatingConversationEvent).detail;
      if (!isFloatingTarget(target)) return;

      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }

      setTickets((current) =>
        addTicketTarget(current, target).map((ticket) =>
          ticketKey(ticket) === ticketKey(target)
            ? { ...ticket, unread_count: 0 }
            : ticket,
        ),
      );
      const nextSelection: SelectedChat = {
        kind: "ticket",
        key: ticketKey(target),
      };
      selectedRef.current = nextSelection;
      setSelected(nextSelection);
      showDockExpanded();
      window.localStorage.removeItem(PENDING_TICKET_KEY);
    }

    function handleOpenInternal(event: Event) {
      const detail = (event as OpenInternalChatEvent).detail;
      const userId = detail?.userId;
      if (!userId) return;

      void handleOpenInternalUser(userId, detail.preview);
      window.localStorage.removeItem(PENDING_INTERNAL_USER_KEY);
    }

    function handleOpenGroup(event: Event) {
      const detail = (event as OpenInternalGroupEvent).detail;
      const groupId = detail?.groupId;
      if (!groupId) return;

      void handleOpenInternalGroup(groupId, detail.preview);
      window.localStorage.removeItem(PENDING_INTERNAL_GROUP_KEY);
    }

    window.addEventListener(OPEN_FLOATING_CONVERSATION_EVENT, handleOpenTicket);
    window.addEventListener(OPEN_INTERNAL_CHAT_EVENT, handleOpenInternal);
    window.addEventListener(OPEN_INTERNAL_GROUP_EVENT, handleOpenGroup);

    const pendingInternalUser = window.localStorage.getItem(
      PENDING_INTERNAL_USER_KEY,
    );
    if (pendingInternalUser) {
      void handleOpenInternalUser(pendingInternalUser);
      window.localStorage.removeItem(PENDING_INTERNAL_USER_KEY);
    }

    const pendingInternalGroup = window.localStorage.getItem(
      PENDING_INTERNAL_GROUP_KEY,
    );
    if (pendingInternalGroup) {
      void handleOpenInternalGroup(pendingInternalGroup);
      window.localStorage.removeItem(PENDING_INTERNAL_GROUP_KEY);
    }

    return () => {
      window.removeEventListener(
        OPEN_FLOATING_CONVERSATION_EVENT,
        handleOpenTicket,
      );
      window.removeEventListener(OPEN_INTERNAL_CHAT_EVENT, handleOpenInternal);
      window.removeEventListener(OPEN_INTERNAL_GROUP_EVENT, handleOpenGroup);
    };
  }, [handleOpenInternalGroup, handleOpenInternalUser, showDockExpanded]);

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
      void heartbeatInternalPresence();
    }

    heartbeat();
    const interval = window.setInterval(heartbeat, PRESENCE_INTERVAL_MS);

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;

      heartbeat();
      markSelectedChatAsRead();
    }

    function handleOnline() {
      heartbeat();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;

    void Promise.all([loadInternalConversations(), loadInternalGroups()]);
    const interval = window.setInterval(() => {
      void Promise.all([loadInternalConversations(), loadInternalGroups()]);
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [currentUserId, loadInternalConversations, loadInternalGroups]);

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
                    (data.conversation?.ended_at ? "closed" : null),
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
    const channel = supabase
      .channel(`floating-saved-tickets-${currentUserId ?? "anonymous"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const message = payload.new as {
            thread_id?: string | null;
            conversation_id?: string | null;
            sender_type?: string | null;
            from?: string | null;
            text?: string | null;
          } | null;

          if (!message) return;

          const ticket = findTicketForMessage(ticketsRef.current, message);
          if (!ticket) return;

          const key = ticketKey(ticket);
          const activeSelection = selectedRef.current;
          const selectedNow =
            activeSelection?.kind === "ticket" && activeSelection.key === key;
          const activelyReading =
            selectedNow &&
            visibleRef.current &&
            !collapsedRef.current &&
            document.visibilityState === "visible";
          const incoming = isIncomingTicketMessage(message);

          setTickets((current) =>
            current.map((item) => {
              if (ticketKey(item) !== key) return item;

              return {
                ...item,
                preview:
                  typeof message.text === "string" && message.text.trim()
                    ? message.text
                    : item.preview,
                unread_count:
                  incoming && !activelyReading
                    ? (item.unread_count ?? 0) + 1
                    : activelyReading
                      ? 0
                      : (item.unread_count ?? 0),
              };
            }),
          );

          if (incoming && (!visibleRef.current || collapsedRef.current)) {
            const nextSelection: SelectedChat = {
              kind: "ticket",
              key,
            };
            selectedRef.current = nextSelection;
            setSelected(nextSelection);
            showDockCollapsedForUnread();
          }

          if (selectedNow) {
            void refreshSelectedTicket(ticket);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "thread" },
        (payload) => {
          const next = payload.new as {
            id?: string;
            status?: string | null;
            last_message_text?: string | null;
          } | null;
          const previous = payload.old as { id?: string } | null;
          const id = next?.id ?? previous?.id ?? null;
          if (!id) return;

          const ticket = ticketsRef.current.find(
            (item) => item.type === "thread" && item.id === id,
          );
          if (!ticket) return;

          setTickets((current) =>
            current.map((item) =>
              item.type === "thread" && item.id === id
                ? {
                    ...item,
                    status: next?.status ?? item.status,
                    preview: next?.last_message_text ?? item.preview,
                  }
                : item,
            ),
          );

          const activeSelection = selectedRef.current;
          if (
            activeSelection?.kind === "ticket" &&
            activeSelection.key === ticketKey(ticket)
          ) {
            void refreshSelectedTicket(ticket);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, showDockCollapsedForUnread]);

  useEffect(() => {
    const shouldMarkRead =
      visibleRef.current &&
      !collapsedRef.current &&
      document.visibilityState === "visible";
    void loadSelectedInternalConversation({
      markRead: shouldMarkRead,
    });
  }, [loadSelectedInternalConversation]);

  useEffect(() => {
    const shouldMarkRead =
      visibleRef.current &&
      !collapsedRef.current &&
      document.visibilityState === "visible";
    void loadSelectedGroup({
      markRead: shouldMarkRead,
    });
  }, [loadSelectedGroup]);

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

      const activeSelection = selectedRef.current;
      if (
        activeSelection?.kind === "ticket" &&
        activeSelection.key === ticketKey(target)
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
    const key = ticketKey(ticket);

    setTickets((current) =>
      current.map((item) =>
        ticketKey(item) === key ? { ...item, unread_count: 0 } : item,
      ),
    );
    const nextSelection: SelectedChat = { kind: "ticket", key };
    selectedRef.current = nextSelection;
    setSelected(nextSelection);
    collapsedRef.current = false;
    setCollapsed(false);
  }

  function handleSelectInternal(conversation: InternalConversationSummary) {
    setInternalConversations((current) =>
      current.map((item) =>
        item.id === conversation.id ? { ...item, unread_count: 0 } : item,
      ),
    );
    const nextSelection: SelectedChat = {
      kind: "internal",
      conversationId: conversation.id,
    };
    selectedRef.current = nextSelection;
    setSelected(nextSelection);
    collapsedRef.current = false;
    setCollapsed(false);
    void markInternalConversationRead(conversation.id).catch((error) => {
      console.warn(
        "[FloatingConversationPanel] failed to mark internal chat as read",
        error,
      );
    });
  }

  function handleSelectGroup(group: InternalGroupSummary) {
    groupUnreadSnapshotRef.current.set(group.id, 0);
    setInternalGroups((current) =>
      current.map((item) =>
        item.id === group.id ? { ...item, unread_count: 0 } : item,
      ),
    );
    const nextSelection: SelectedChat = {
      kind: "group",
      groupId: group.id,
    };
    selectedRef.current = nextSelection;
    setSelected(nextSelection);
    collapsedRef.current = false;
    setCollapsed(false);
    void markInternalGroupRead(group.id).catch((error) => {
      console.warn(
        "[FloatingConversationPanel] failed to mark internal group as read",
        error,
      );
    });
  }

  function handleCloseTicket(key: string) {
    const nextTickets = tickets.filter((ticket) => ticketKey(ticket) !== key);

    if (selected?.kind !== "ticket" || selected.key !== key) {
      setTickets(nextTickets);
      return;
    }

    const nextSelection = getFirstAvailableSelection(
      nextTickets,
      visibleInternalConversations,
      internalGroups,
    );

    if (nextSelection) {
      setTickets(nextTickets);
      selectedRef.current = nextSelection;
      setSelected(nextSelection);
      return;
    }

    animateLastChatClose(() => {
      setTickets(nextTickets);
      selectedRef.current = null;
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
      internalGroups,
    );

    if (nextSelection) {
      setHiddenInternalConversationIds((current) => [
        ...new Set([...current, conversationId]),
      ]);
      selectedRef.current = nextSelection;
      setSelected(nextSelection);
      return;
    }

    animateLastChatClose(() => {
      setHiddenInternalConversationIds((current) => [
        ...new Set([...current, conversationId]),
      ]);
      selectedRef.current = null;
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

    // Move the rail and chat out as one dock. Reset the rail only after
    // the closing animation finishes so there is no sideways twitch.
    visibleRef.current = false;
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      afterClose();
      collapsedRef.current = false;
      setCollapsed(false);
      setRailCollapsed(true);
      closeTimerRef.current = null;
    }, ANIMATION_MS + 40);
  }

  function clearSelectedUnread() {
    const activeSelection = selectedRef.current;
    if (!activeSelection) return;

    if (activeSelection.kind === "ticket") {
      setTickets((current) =>
        current.map((ticket) =>
          ticketKey(ticket) === activeSelection.key
            ? { ...ticket, unread_count: 0 }
            : ticket,
        ),
      );
      return;
    }

    if (activeSelection.kind === "internal") {
      const conversationId = activeSelection.conversationId;
      internalUnreadSnapshotRef.current.set(conversationId, 0);
      setInternalConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, unread_count: 0 }
            : conversation,
        ),
      );
      void markInternalConversationRead(conversationId).catch((error) => {
        console.warn(
          "[FloatingConversationPanel] failed to mark internal chat as read",
          error,
        );
      });
      return;
    }

    const groupId = activeSelection.groupId;
    groupUnreadSnapshotRef.current.set(groupId, 0);
    setInternalGroups((current) =>
      current.map((group) =>
        group.id === groupId ? { ...group, unread_count: 0 } : group,
      ),
    );
    void markInternalGroupRead(groupId).catch((error) => {
      console.warn(
        "[FloatingConversationPanel] failed to mark internal group as read",
        error,
      );
    });
  }

  function markSelectedChatAsRead() {
    if (
      !visibleRef.current ||
      collapsedRef.current ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    clearSelectedUnread();
  }

  function handleToggleChatCollapsed() {
    if (collapsed) {
      collapsedRef.current = false;
      setCollapsed(false);
      clearSelectedUnread();
      return;
    }

    // The saved-chat rail must disappear together with the minimized chat.
    setRailCollapsed(true);
    collapsedRef.current = true;
    setCollapsed(true);
  }

  function handleCloseDock() {
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }

    visibleRef.current = false;
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      selectedRef.current = null;
      setSelected(null);
      collapsedRef.current = false;
      setCollapsed(false);
      setRailCollapsed(true);
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

  const hasUnreadChats =
    tickets.some((ticket) => (ticket.unread_count ?? 0) > 0) ||
    visibleInternalConversations.some(
      (conversation) => conversation.unread_count > 0,
    ) ||
    internalGroups.some((group) => group.unread_count > 0);
  const hasSavedChats =
    tickets.length > 0 ||
    visibleInternalConversations.length > 0 ||
    internalGroups.length > 0;
  const selectedUnreadCount =
    selected?.kind === "ticket"
      ? (tickets.find((ticket) => ticketKey(ticket) === selected.key)
          ?.unread_count ?? 0)
      : selected?.kind === "internal"
        ? (internalConversations.find(
            (conversation) => conversation.id === selected.conversationId,
          )?.unread_count ?? 0)
        : selected?.kind === "group"
          ? (internalGroups.find((group) => group.id === selected.groupId)
              ?.unread_count ?? 0)
          : 0;

  if (!selected && !pendingOpen && !hasSavedChats) return null;

  const rightOffset = sidePanelOpen ? 484 : 24;
  const hasOpenPanel = Boolean(selected || pendingOpen);
  const dockTransform =
    !hasOpenPanel || !visible
      ? "translate3d(0, calc(100% + 28px), 0) scale(0.98)"
      : collapsed
        ? `translate3d(0, calc(100% - ${COLLAPSED_VISIBLE_HEIGHT_PX}px), 0) scale(1)`
        : "translate3d(0, 0, 0) scale(1)";
  const dockOpacity = hasOpenPanel && visible ? 1 : 0;

  return (
    <div
      className="fixed bottom-6 z-[45] h-[480px] w-[365px] will-change-transform"
      style={{
        right: rightOffset,
        opacity: dockOpacity,
        pointerEvents: visible ? "auto" : "none",
        transform: dockTransform,
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
        internalGroups={internalGroups}
        selected={selected}
        collapsed={railCollapsed}
        hidden={collapsed}
        hasUnread={hasUnreadChats}
        onToggleCollapsed={() => setRailCollapsed((current) => !current)}
        onSelectTicket={handleSelectTicket}
        onCloseTicket={handleCloseTicket}
        onSelectInternal={handleSelectInternal}
        onCloseInternal={handleCloseInternal}
        onSelectGroup={handleSelectGroup}
      />

      {pendingOpen ? (
        <PendingChatPanel
          pending={pendingOpen}
          collapsed={collapsed}
          onToggleCollapsed={handleToggleChatCollapsed}
          onClose={handleCloseDock}
        />
      ) : selected ? (
        <div className="h-full w-full">
          {selected.kind === "ticket" && selectedTicket ? (
            <TicketFloatingPanel
              target={selectedTicket}
              data={ticketData}
              loading={ticketLoading}
              collapsed={collapsed}
              hasUnread={selectedUnreadCount > 0}
              onToggleCollapsed={handleToggleChatCollapsed}
              onClose={handleCloseDock}
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
              hasUnread={selectedUnreadCount > 0}
              onToggleCollapsed={handleToggleChatCollapsed}
              onClose={handleCloseDock}
              onSend={async (text) => {
                const conversationId = selected.conversationId;

                if (!currentUserId) {
                  throw new Error("Usuário atual não disponível para envio");
                }

                const optimisticId = `optimistic:${crypto.randomUUID()}`;
                const optimisticSentAt = new Date().toISOString();
                const optimisticMessage: InternalMessage = {
                  id: optimisticId,
                  conversation_id: conversationId,
                  sender_auth_user_id: currentUserId,
                  sender_name: currentUserName,
                  text,
                  sent_at: optimisticSentAt,
                  read_at: null,
                };

                setInternalDetail((current) => {
                  if (current?.conversation.id !== conversationId) {
                    return current;
                  }

                  return {
                    ...current,
                    conversation: {
                      ...current.conversation,
                      last_message_text: text,
                      last_message_at: optimisticSentAt,
                      updated_at: optimisticSentAt,
                    },
                    messages: [...current.messages, optimisticMessage],
                  };
                });
                setInternalConversations((current) =>
                  current.map((conversation) =>
                    conversation.id === conversationId
                      ? {
                          ...conversation,
                          last_message_text: text,
                          last_message_at: optimisticSentAt,
                          updated_at: optimisticSentAt,
                          unread_count: 0,
                        }
                      : conversation,
                  ),
                );

                const sendTask = internalSendQueueRef.current.then(async () => {
                  try {
                    const message = await sendInternalMessage(
                      conversationId,
                      text,
                    );
                    const displayMessage: InternalMessage = {
                      ...message,
                      sent_at: optimisticSentAt,
                    };

                    setInternalDetail((current) => {
                      if (current?.conversation.id !== conversationId) {
                        return current;
                      }

                      const realAlreadyExists = current.messages.some(
                        (item) => item.id === message.id,
                      );

                      return {
                        ...current,
                        conversation: {
                          ...current.conversation,
                          last_message_text: message.text,
                          last_message_at: message.sent_at,
                          updated_at: message.sent_at,
                        },
                        messages: realAlreadyExists
                          ? current.messages.filter(
                              (item) => item.id !== optimisticId,
                            )
                          : current.messages.map((item) =>
                              item.id === optimisticId ? displayMessage : item,
                            ),
                      };
                    });
                    setInternalConversations((current) =>
                      current.map((conversation) =>
                        conversation.id === conversationId
                          ? {
                              ...conversation,
                              last_message_text: message.text,
                              last_message_at: message.sent_at,
                              updated_at: message.sent_at,
                              unread_count: 0,
                            }
                          : conversation,
                      ),
                    );
                  } catch (error) {
                    setInternalDetail((current) => {
                      if (current?.conversation.id !== conversationId) {
                        return current;
                      }

                      return {
                        ...current,
                        messages: current.messages.filter(
                          (item) => item.id !== optimisticId,
                        ),
                      };
                    });

                    throw error;
                  }
                });

                internalSendQueueRef.current = sendTask.catch(() => undefined);

                return sendTask;
              }}
            />
          ) : selected.kind === "group" ? (
            <GroupFloatingPanel
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              summary={selectedGroup}
              detail={groupDetail}
              loading={groupLoading}
              collapsed={collapsed}
              hasUnread={selectedUnreadCount > 0}
              onToggleCollapsed={handleToggleChatCollapsed}
              onClose={handleCloseDock}
              onSend={async (text) => {
                const groupId = selected.groupId;

                if (!currentUserId) {
                  throw new Error("Usuário atual não disponível para envio");
                }

                const optimisticId = `optimistic-group:${crypto.randomUUID()}`;
                const optimisticSentAt = new Date().toISOString();
                const optimisticMessage: InternalGroupMessage = {
                  id: optimisticId,
                  group_id: groupId,
                  sender_auth_user_id: currentUserId,
                  sender_name: currentUserName,
                  text,
                  sent_at: optimisticSentAt,
                };

                setGroupDetail((current) => {
                  if (current?.group.id !== groupId) return current;

                  return {
                    ...current,
                    group: {
                      ...current.group,
                      last_message_text: text,
                      last_message_at: optimisticSentAt,
                      updated_at: optimisticSentAt,
                    },
                    messages: [...current.messages, optimisticMessage],
                  };
                });
                setInternalGroups((current) =>
                  current.map((group) =>
                    group.id === groupId
                      ? {
                          ...group,
                          last_message_text: text,
                          last_message_at: optimisticSentAt,
                          updated_at: optimisticSentAt,
                          unread_count: 0,
                        }
                      : group,
                  ),
                );

                const sendTask = groupSendQueueRef.current.then(async () => {
                  try {
                    const message = await sendInternalGroupMessage(
                      groupId,
                      text,
                    );
                    const displayMessage: InternalGroupMessage = {
                      ...message,
                      sent_at: optimisticSentAt,
                    };

                    setGroupDetail((current) => {
                      if (current?.group.id !== groupId) {
                        return current;
                      }

                      const realAlreadyExists = current.messages.some(
                        (item) => item.id === message.id,
                      );

                      return {
                        ...current,
                        group: {
                          ...current.group,
                          last_message_text: message.text,
                          last_message_at: message.sent_at,
                          updated_at: message.sent_at,
                        },
                        messages: realAlreadyExists
                          ? current.messages.filter(
                              (item) => item.id !== optimisticId,
                            )
                          : current.messages.map((item) =>
                              item.id === optimisticId ? displayMessage : item,
                            ),
                      };
                    });
                    setInternalGroups((current) =>
                      current.map((group) =>
                        group.id === groupId
                          ? {
                              ...group,
                              last_message_text: message.text,
                              last_message_at: message.sent_at,
                              updated_at: message.sent_at,
                              unread_count: 0,
                            }
                          : group,
                      ),
                    );
                  } catch (error) {
                    setGroupDetail((current) => {
                      if (current?.group.id !== groupId) {
                        return current;
                      }

                      return {
                        ...current,
                        messages: current.messages.filter(
                          (item) => item.id !== optimisticId,
                        ),
                      };
                    });
                    throw error;
                  }
                });

                groupSendQueueRef.current = sendTask.catch(() => undefined);

                return sendTask;
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ChatRail({
  tickets,
  internalConversations,
  internalGroups,
  selected,
  collapsed,
  hidden,
  hasUnread,
  onToggleCollapsed,
  onSelectTicket,
  onCloseTicket,
  onSelectInternal,
  onCloseInternal,
  onSelectGroup,
}: {
  tickets: SavedTicketTarget[];
  internalConversations: InternalConversationSummary[];
  internalGroups: InternalGroupSummary[];
  selected: SelectedChat;
  collapsed: boolean;
  hidden: boolean;
  hasUnread: boolean;
  onToggleCollapsed: () => void;
  onSelectTicket: (ticket: SavedTicketTarget) => void;
  onCloseTicket: (key: string) => void;
  onSelectInternal: (conversation: InternalConversationSummary) => void;
  onCloseInternal: (conversationId: string) => void;
  onSelectGroup: (group: InternalGroupSummary) => void;
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-200 ${
        hidden ? "opacity-0" : "opacity-100"
      }`}
    >
      <aside
        className={`absolute bottom-0 flex h-full w-[220px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          collapsed
            ? "pointer-events-none translate-x-5 opacity-0"
            : "pointer-events-auto translate-x-0 opacity-100"
        }`}
        style={{ right: "calc(100% + 6px)" }}
      >
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
                unread={ticket.unread_count ?? 0}
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
                preview={conversation.last_message_text ?? "Chat interno"}
                active={
                  selected?.kind === "internal" &&
                  selected.conversationId === conversation.id
                }
                unread={conversation.unread_count}
                online={conversation.peer.online}
                onClick={() => onSelectInternal(conversation)}
                onClose={() => onCloseInternal(conversation.id)}
              />
            ))}
            {internalConversations.length === 0 ? (
              <RailEmptyState label="Nenhum chat interno aberto" />
            ) : null}
          </div>

          <div className="my-4 h-px bg-slate-100" />

          <RailSectionTitle label="Grupos" />
          <div className="space-y-2">
            {internalGroups.map((group) => (
              <SavedChatRow
                key={group.id}
                name={group.name}
                preview={
                  group.last_message_text ??
                  `${group.member_count} participante${
                    group.member_count === 1 ? "" : "s"
                  }`
                }
                active={
                  selected?.kind === "group" && selected.groupId === group.id
                }
                unread={group.unread_count}
                icon="group"
                onClick={() => onSelectGroup(group)}
              />
            ))}
            {internalGroups.length === 0 ? (
              <RailEmptyState label="Nenhum grupo disponível" />
            ) : null}
          </div>
        </div>
      </aside>

      <button
        type="button"
        onClick={onToggleCollapsed}
        className={`pointer-events-auto absolute top-3 z-30 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-lg transition-[right,background-color,color,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-slate-50 hover:text-slate-700 active:scale-95 ${
          hidden ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        style={{
          right: collapsed
            ? "calc(100% + 6px)"
            : "calc(100% + 226px)",
        }}
        title={collapsed ? "Mostrar chats" : "Ocultar chats"}
      >
        <span className="relative">
          <Menu size={17} />

          {hasUnread ? (
            <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand" />
          ) : null}
        </span>
      </button>
    </div>
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
  online,
  icon = "avatar",
  onClick,
  onClose,
}: {
  name: string;
  preview: string;
  active: boolean;
  unread?: number;
  online?: boolean;
  icon?: "avatar" | "group";
  onClick: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className={`group grid ${
        onClose
          ? "grid-cols-[36px_minmax(0,1fr)_28px]"
          : "grid-cols-[36px_minmax(0,1fr)]"
      } items-center gap-2 rounded-xl border px-2 py-2 transition-colors ${
        active
          ? "border-brand bg-brand-soft/60"
          : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
      }`}
    >
      <button type="button" onClick={onClick} className="cursor-pointer">
        {icon === "group" ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-soft text-purple">
            <UsersRound size={17} />
          </span>
        ) : (
          <span className="relative inline-flex shrink-0">
            <InitialsAvatar name={name} />
            {typeof online === "boolean" ? (
              <span
                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                  online ? "bg-green" : "bg-slate-400"
                }`}
                title={online ? "Online" : "Offline"}
              />
            ) : null}
          </span>
        )}
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
            <span
              className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
              title="Novas mensagens"
            />
          ) : null}
        </div>
        <div className="mt-1 truncate text-[11px] text-slate-400">
          {preview}
        </div>
      </button>

      {onClose ? (
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
      ) : null}
    </div>
  );
}

function PendingChatPanel({
  pending,
  collapsed,
  onToggleCollapsed,
  onClose,
}: {
  pending: PendingChatOpen;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
}) {
  const isGroup = pending.kind === "group";
  const internalPreview = pending.kind === "internal" ? pending.preview : null;
  const name = pending.preview?.name ?? (isGroup ? "Grupo" : "Usuário");
  const subtitle =
    pending.kind === "internal"
      ? (pending.preview?.email ?? "Sem e-mail")
      : "Grupo";

  return (
    <div className="h-full w-[365px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {isGroup ? (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-soft text-purple">
                <UsersRound size={17} />
              </span>
            ) : (
              <span className="relative inline-flex shrink-0">
                <InitialsAvatar name={name} />
                {typeof internalPreview?.online === "boolean" ? (
                  <span
                    className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                      internalPreview.online ? "bg-green" : "bg-slate-400"
                    }`}
                    title={internalPreview.online ? "Online" : "Offline"}
                  />
                ) : null}
              </span>
            )}

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-bold text-slate-950">
                  {name}
                </div>
                {isGroup ? (
                  <span className="inline-flex shrink-0 rounded-md bg-purple-soft px-2 py-0.5 text-[10px] font-bold text-purple">
                    Grupo
                  </span>
                ) : null}
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">
                {subtitle}
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
        messages={[]}
        isLoading
        skeleton={
          <div className="space-y-3">
            <Skeleton className="h-14 w-[75%] rounded-2xl" />
            <Skeleton className="ml-auto h-14 w-[65%] rounded-2xl" />
            <Skeleton className="h-14 w-[82%] rounded-2xl" />
          </div>
        }
        emptyMessage=""
        className="h-[315px] overflow-y-auto bg-slate-50 px-4 py-4"
        enablePrewrittenMessages={false}
      />

      <div className="border-t border-slate-100 p-2">
        <Skeleton className="h-[52px] w-full rounded-xl" />
      </div>
    </div>
  );
}

function TicketFloatingPanel({
  target,
  data,
  loading,
  collapsed,
  hasUnread,
  onToggleCollapsed,
  onClose,
  onOpenDetails,
}: {
  target: SavedTicketTarget;
  data: FloatingConversationResponse | null;
  loading: boolean;
  collapsed: boolean;
  hasUnread: boolean;
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
          new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime();
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
    <div className="flex h-full w-[365px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div
        onClick={collapsed ? onToggleCollapsed : undefined}
        className={`shrink-0 border-b border-slate-100 px-4 py-3 ${
          collapsed ? "cursor-pointer" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative inline-flex shrink-0">
              <InitialsAvatar name={clientName} />
              {isLive ? (
                <span
                  className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-green"
                  title="Conversa ao vivo"
                />
              ) : (
                <span
                  className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-slate-100 text-slate-500"
                  title="Conversa do histórico"
                >
                  <History size={11} strokeWidth={2.25} />
                </span>
              )}
            </span>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div
                  title={clientName}
                  className="truncate text-sm font-bold text-slate-950"
                >
                  {loading ? "Carregando..." : clientName}
                </div>

                {hasUnread ? (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
                    title="Novas mensagens"
                  />
                ) : null}

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
          onClick={(event) => {
            event.stopPropagation();
            onOpenDetails();
          }}
          className="mt-3 flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 shadow-sm transition hover:bg-selection"
        >
          <ExternalLink size={14} />
          {detailsLabel}
        </button>
      </div>

      <ChatMessageList
        messages={orderedMessages}
        isLoading={loading}
        skeleton={
          <div className="space-y-3">
            <Skeleton className="h-14 w-[75%] rounded-2xl" />
            <Skeleton className="ml-auto h-14 w-[65%] rounded-2xl" />
            <Skeleton className="h-14 w-[82%] rounded-2xl" />
          </div>
        }
        emptyMessage={
          !data
            ? "Não foi possível carregar esta conversa."
            : "Nenhuma mensagem encontrada."
        }
        className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4"
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
  hasUnread,
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
  hasUnread: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const [messageText, setMessageText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const peer = summary?.peer ?? detail?.peer ?? null;
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
          : (peer?.name ?? message.sender_name),
        sent_at: message.sent_at,
        sequence_index: index,
      };
    });
  }, [currentUserId, currentUserName, detail?.messages, peer?.name]);

  useEffect(() => {
    setMessageText("");
  }, [summary?.id]);

  function focusComposer() {
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  }

  function handleSubmit() {
    const text = messageText.trim();
    if (!text) return;

    setMessageText("");

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    focusComposer();

    const sendTask = onSend(text);

    void sendTask
      .catch((error) => {
        console.error(
          "[FloatingConversationPanel] failed to send internal message",
          error,
        );
        setMessageText((current) =>
          current.trim() ? `${text}\n${current}` : text,
        );
      })
      .finally(() => {
        focusComposer();
      });
  }

  const peerName = peer?.name ?? "Usuário";
  const peerEmail = peer?.email ?? "Sem e-mail";

  return (
    <div className="flex h-full w-[365px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div
        onClick={collapsed ? onToggleCollapsed : undefined}
        className={`shrink-0 border-b border-slate-100 px-4 py-3 ${
          collapsed ? "cursor-pointer" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative inline-flex shrink-0">
              <InitialsAvatar name={peerName} />
              {peer ? (
                <span
                  className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                    peer.online ? "bg-green" : "bg-slate-400"
                  }`}
                  title={peer.online ? "Online" : "Offline"}
                />
              ) : null}
            </span>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div
                  title={peerName}
                  className="truncate text-sm font-bold text-slate-950"
                >
                  {loading ? "Carregando..." : peerName}
                </div>

                {hasUnread ? (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
                    title="Novas mensagens"
                  />
                ) : null}

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
        skeleton={
          <div className="space-y-3">
            <Skeleton className="h-14 w-[75%] rounded-2xl" />
            <Skeleton className="ml-auto h-14 w-[65%] rounded-2xl" />
            <Skeleton className="h-14 w-[82%] rounded-2xl" />
          </div>
        }
        emptyMessage="Nenhuma mensagem neste chat."
        className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4"
        enablePrewrittenMessages={false}
        autoScrollToBottom
      />

      <div className="shrink-0 border-t border-slate-100 p-2">
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={messageText}
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
            disabled={!messageText.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleSubmit}
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

function GroupFloatingPanel({
  currentUserId,
  currentUserName,
  summary,
  detail,
  loading,
  collapsed,
  hasUnread,
  onToggleCollapsed,
  onClose,
  onSend,
}: {
  currentUserId: string | null;
  currentUserName: string;
  summary: InternalGroupSummary | null;
  detail: InternalGroupDetail | null;
  loading: boolean;
  collapsed: boolean;
  hasUnread: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const [messageText, setMessageText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const group = detail?.group ?? summary ?? null;

  const messages = useMemo<SharedChatMessage[]>(() => {
    if (!currentUserId) return [];

    return (detail?.messages ?? []).map((message, index) => {
      const own = message.sender_auth_user_id === currentUserId;

      return {
        id: message.id,
        text: message.text,
        sender_type: own ? "attendant" : "client",
        sender_name: message.sender_name,
        sender_label: own ? currentUserName : message.sender_name,
        sent_at: message.sent_at,
        sequence_index: index,
      };
    });
  }, [currentUserId, currentUserName, detail?.messages]);

  useEffect(() => {
    setMessageText("");
  }, [summary?.id]);

  function focusComposer() {
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  }

  function handleSubmit() {
    const text = messageText.trim();
    if (!text) return;

    setMessageText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    focusComposer();

    const sendTask = onSend(text);
    void sendTask
      .catch((error) => {
        console.error(
          "[FloatingConversationPanel] failed to send group message",
          error,
        );
        setMessageText((current) =>
          current.trim() ? `${text}\n${current}` : text,
        );
      })
      .finally(focusComposer);
  }

  const groupName = group?.name ?? "Grupo";
  const memberLabel = group
    ? `${group.member_count} participante${group.member_count === 1 ? "" : "s"}`
    : "Grupo";

  return (
    <div className="flex h-full w-[365px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div
        onClick={collapsed ? onToggleCollapsed : undefined}
        className={`shrink-0 border-b border-slate-100 px-4 py-3 ${
          collapsed ? "cursor-pointer" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-soft text-purple">
              <UsersRound size={17} />
            </span>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div
                  title={groupName}
                  className="truncate text-sm font-bold text-slate-950"
                >
                  {loading ? "Carregando..." : groupName}
                </div>

                {hasUnread ? (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
                    title="Novas mensagens"
                  />
                ) : null}

                <span className="inline-flex shrink-0 rounded-md bg-purple-soft px-2 py-0.5 text-[10px] font-bold text-purple">
                  Grupo
                </span>
              </div>

              <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <UsersRound size={12} />
                <span className="truncate">{memberLabel}</span>
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
        skeleton={
          <div className="space-y-3">
            <Skeleton className="h-14 w-[75%] rounded-2xl" />
            <Skeleton className="ml-auto h-14 w-[65%] rounded-2xl" />
            <Skeleton className="h-14 w-[82%] rounded-2xl" />
          </div>
        }
        emptyMessage="Nenhuma mensagem neste grupo."
        className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4"
        enablePrewrittenMessages={false}
        autoScrollToBottom
      />

      <div className="shrink-0 border-t border-slate-100 p-2">
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSubmit();
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
            disabled={!messageText.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleSubmit}
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
        onClick={(event) => {
          event.stopPropagation();
          onToggleCollapsed();
        }}
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
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
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

function findTicketForMessage(
  tickets: SavedTicketTarget[],
  message: {
    thread_id?: string | null;
    conversation_id?: string | null;
  },
) {
  return (
    tickets.find((ticket) =>
      ticket.type === "thread"
        ? Boolean(message.thread_id) && message.thread_id === ticket.id
        : Boolean(message.conversation_id) &&
          message.conversation_id === ticket.id,
    ) ?? null
  );
}

function isIncomingTicketMessage(message: {
  sender_type?: string | null;
  from?: string | null;
}) {
  const sender = normalize(
    `${message.sender_type ?? ""} ${message.from ?? ""}`.trim(),
  );

  if (!sender) return false;

  if (
    sender.includes("attendant") ||
    sender.includes("atendente") ||
    sender.includes("bot") ||
    sender.includes("system") ||
    sender.includes("sistema")
  ) {
    return false;
  }

  return (
    sender.includes("client") ||
    sender.includes("cliente") ||
    sender.includes("customer") ||
    sender.includes("contact") ||
    sender.includes("lead")
  );
}

function getFirstAvailableSelection(
  tickets: SavedTicketTarget[],
  internalConversations: InternalConversationSummary[],
  internalGroups: InternalGroupSummary[],
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

  const group = internalGroups[0];
  if (group) {
    return { kind: "group", groupId: group.id };
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
      selected: isSelectedChat(parsed?.selected) ? parsed.selected : null,
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
      typeof selected.conversationId === "string") ||
    (selected.kind === "group" && typeof selected.groupId === "string")
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
