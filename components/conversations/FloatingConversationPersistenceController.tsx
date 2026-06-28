// components/conversations/FloatingConversationPersistenceController.tsx
"use client";

import { useLayoutEffect, useRef } from "react";

const RAIL_STORAGE_KEY = "engravida:floating-chat-rail:v2";
const OLD_DOCK_STORAGE_KEY = "engravida:floating-chat-dock:v1";

// Keys created by the previous broken persistence attempts.
const OLD_VISIBILITY_STORAGE_KEY = "engravida:floating-chat-visibility:v2";
const OLD_LAST_CUSTOMER_CHAT_KEY = "engravida:floating-chat-last-customer:v1";

const COLLAPSE_BUTTON_SELECTOR = 'button[title="Ocultar conversa"]';
const EXPAND_BUTTON_SELECTOR = 'button[title="Mostrar conversa"]';
const CLOSE_BUTTON_SELECTOR = 'button[title="Fechar conversa"]';

type CustomerTarget = {
    type: "thread" | "conversation";
    id: string;
};

type PersistedSelection =
    | { kind: "ticket"; key: string }
    | { kind: "internal"; conversationId: string }
    | { kind: "group"; groupId: string }
    | null;

type PersistedRailState = {
    tickets?: Array<CustomerTarget & Record<string, unknown>>;
    hiddenInternalConversationIds?: string[];
    selected?: PersistedSelection;
};

export function FloatingConversationPersistenceController() {
    const shouldCollapseRestoredChatRef = useRef(false);
    const collapsedRestoredChatRef = useRef(false);

    useLayoutEffect(() => {
        const restoredState = migratePreviousPersistenceState();
        shouldCollapseRestoredChatRef.current = Boolean(restoredState?.selected);

        function collapseRestoredChat() {
            if (
                !shouldCollapseRestoredChatRef.current ||
                collapsedRestoredChatRef.current
            ) {
                return;
            }

            // The restored panel is already collapsed.
            if (document.querySelector(EXPAND_BUTTON_SELECTOR)) {
                collapsedRestoredChatRef.current = true;
                return;
            }

            const collapseButton =
                document.querySelector<HTMLButtonElement>(
                    COLLAPSE_BUTTON_SELECTOR,
                );

            if (!collapseButton) return;

            collapsedRestoredChatRef.current = true;
            collapseButton.click();
        }

        // Try immediately and also observe the first render after the original
        // floating panel hydrates its saved selected chat.
        collapseRestoredChat();

        const observer = new MutationObserver(collapseRestoredChat);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["title"],
        });

        function handleClick(event: MouseEvent) {
            const target =
                event.target instanceof Element ? event.target : null;
            const closeButton = target?.closest<HTMLButtonElement>(
                CLOSE_BUTTON_SELECTOR,
            );

            if (!closeButton) return;

            // The large X hides the dock and clears only the selected chat.
            // Saved tickets remain available for a new message or manual reopen.
            window.setTimeout(clearPersistedSelection, 0);
        }

        document.addEventListener("click", handleClick, true);

        return () => {
            observer.disconnect();
            document.removeEventListener("click", handleClick, true);
        };
    }, []);

    return null;
}

function migratePreviousPersistenceState() {
    const state = readPersistedState();
    const oldVisibility = window.localStorage.getItem(
        OLD_VISIBILITY_STORAGE_KEY,
    );
    const oldLastTarget = readOldLastCustomerTarget();

    // Recover the chat lost by the previous implementation only when it had
    // not been explicitly dismissed with the large X.
    if (!state?.selected && oldVisibility !== "dismissed" && oldLastTarget) {
        const tickets = state?.tickets ?? [];
        const isStillSaved = tickets.some(
            (ticket) =>
                ticket.type === oldLastTarget.type &&
                ticket.id === oldLastTarget.id,
        );

        if (isStillSaved) {
            const recoveredState: PersistedRailState = {
                ...state,
                selected: {
                    kind: "ticket",
                    key: `${oldLastTarget.type}:${oldLastTarget.id}`,
                },
            };

            writePersistedState(recoveredState);
            clearOldPersistenceKeys();
            return recoveredState;
        }
    }

    clearOldPersistenceKeys();
    return state;
}

function clearPersistedSelection() {
    const state = readPersistedState();
    if (!state?.selected) return;

    writePersistedState({
        ...state,
        selected: null,
    });
}

function readPersistedState(): PersistedRailState | null {
    try {
        const raw =
            window.localStorage.getItem(RAIL_STORAGE_KEY) ??
            window.localStorage.getItem(OLD_DOCK_STORAGE_KEY);

        if (!raw) return null;

        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object"
            ? (parsed as PersistedRailState)
            : null;
    } catch {
        return null;
    }
}

function writePersistedState(state: PersistedRailState) {
    window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify(state));
    window.localStorage.removeItem(OLD_DOCK_STORAGE_KEY);
}

function readOldLastCustomerTarget(): CustomerTarget | null {
    try {
        const raw = window.localStorage.getItem(OLD_LAST_CUSTOMER_CHAT_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Partial<CustomerTarget>;

        if (
            typeof parsed.id === "string" &&
            (parsed.type === "thread" || parsed.type === "conversation")
        ) {
            return {
                type: parsed.type,
                id: parsed.id,
            };
        }

        return null;
    } catch {
        return null;
    }
}

function clearOldPersistenceKeys() {
    window.localStorage.removeItem(OLD_VISIBILITY_STORAGE_KEY);
    window.localStorage.removeItem(OLD_LAST_CUSTOMER_CHAT_KEY);
}
