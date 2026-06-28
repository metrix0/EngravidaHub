// components/conversations/PersistentFloatingConversationPanel.tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { FloatingConversationPanel } from "@/components/conversations/FloatingConversationPanel";

const RAIL_STORAGE_KEY = "engravida:floating-chat-rail:v2";
const OLD_DOCK_STORAGE_KEY = "engravida:floating-chat-dock:v1";

const PENDING_TICKET_KEY = "engravida:floating-chat-pending-ticket";
const PENDING_INTERNAL_USER_KEY =
    "engravida:floating-chat-pending-internal-user";
const PENDING_INTERNAL_GROUP_KEY =
    "engravida:floating-chat-pending-internal-group";

const CLOSE_ANIMATION_MS = 420;

type PersistedTicket = {
    type?: unknown;
    id?: unknown;
};

type PersistedSelection =
    | {
          kind: "ticket";
          key: string;
      }
    | {
          kind: "internal";
          conversationId: string;
      }
    | {
          kind: "group";
          groupId: string;
      }
    | null;

type PersistedRailState = {
    tickets?: PersistedTicket[];
    hiddenInternalConversationIds?: string[];
    selected?: PersistedSelection;
};

export function PersistentFloatingConversationPanel() {
    const [ready, setReady] = useState(false);
    const [panelKey, setPanelKey] = useState(0);
    const remountTimerRef = useRef<number | null>(null);

    useEffect(() => {
        hidePersistedPanelAfterRefresh();
        setReady(true);

        return () => {
            if (remountTimerRef.current !== null) {
                window.clearTimeout(remountTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!ready) return;

        function handleDocumentClick(event: MouseEvent) {
            const element =
                event.target instanceof Element ? event.target : null;
            const closeButton = element?.closest<HTMLButtonElement>(
                'button[title="Fechar conversa"]',
            );

            if (!closeButton) return;

            closePersistedSelectedChat();

            if (remountTimerRef.current !== null) {
                window.clearTimeout(remountTimerRef.current);
            }

            remountTimerRef.current = window.setTimeout(() => {
                setPanelKey((current) => current + 1);
                remountTimerRef.current = null;
            }, CLOSE_ANIMATION_MS);
        }

        document.addEventListener("click", handleDocumentClick, true);

        return () => {
            document.removeEventListener("click", handleDocumentClick, true);
        };
    }, [ready]);

    if (!ready) return null;

    return <FloatingConversationPanel key={panelKey} />;
}

function hidePersistedPanelAfterRefresh() {
    const state = readPersistedState();
    if (!state) return;

    writePersistedState({
        ...state,
        selected: null,
    });
}

function closePersistedSelectedChat() {
    const state = readPersistedState();
    const selected = state?.selected ?? null;

    if (!state || !selected) {
        clearPendingOpenRequests();
        return;
    }

    const nextState: PersistedRailState = {
        ...state,
        selected: null,
    };

    if (selected.kind === "ticket") {
        nextState.tickets = (state.tickets ?? []).filter(
            (ticket) => getTicketKey(ticket) !== selected.key,
        );
    }

    if (selected.kind === "internal") {
        nextState.hiddenInternalConversationIds = Array.from(
            new Set([
                ...(state.hiddenInternalConversationIds ?? []),
                selected.conversationId,
            ]),
        );
    }

    writePersistedState(nextState);
    clearPendingOpenRequests();
}

function readPersistedState(): PersistedRailState | null {
    try {
        const raw =
            window.localStorage.getItem(RAIL_STORAGE_KEY) ??
            window.localStorage.getItem(OLD_DOCK_STORAGE_KEY);

        if (!raw) return null;

        const parsed = JSON.parse(raw);

        if (!parsed || typeof parsed !== "object") {
            return null;
        }

        return parsed as PersistedRailState;
    } catch {
        window.localStorage.removeItem(RAIL_STORAGE_KEY);
        window.localStorage.removeItem(OLD_DOCK_STORAGE_KEY);
        return null;
    }
}

function writePersistedState(state: PersistedRailState) {
    window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify(state));
    window.localStorage.removeItem(OLD_DOCK_STORAGE_KEY);
}

function getTicketKey(ticket: PersistedTicket) {
    if (
        (ticket.type !== "thread" && ticket.type !== "conversation") ||
        typeof ticket.id !== "string"
    ) {
        return null;
    }

    return `${ticket.type}:${ticket.id}`;
}

function clearPendingOpenRequests() {
    window.localStorage.removeItem(PENDING_TICKET_KEY);
    window.localStorage.removeItem(PENDING_INTERNAL_USER_KEY);
    window.localStorage.removeItem(PENDING_INTERNAL_GROUP_KEY);
}
