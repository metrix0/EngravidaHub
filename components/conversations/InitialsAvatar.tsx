// components/conversations/InitialsAvatar.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";

type ConversationState = "live" | "history" | null;

type PersistedTicket = {
    type?: "thread" | "conversation";
};

type PersistedRailState = {
    tickets?: PersistedTicket[];
};

const RAIL_STORAGE_KEY = "engravida:floating-chat-rail:v2";

export function InitialsAvatar({ name }: { name: string }) {
    const wrapperRef = useRef<HTMLSpanElement | null>(null);
    const [conversationState, setConversationState] =
        useState<ConversationState>(null);
    const initials = getInitials(name);
    const colorClass = getInitialsColor(initials);

    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        function updateState() {
            const inboxState = getInboxConversationState(wrapper);
            if (inboxState) {
                setConversationState(inboxState);
                return;
            }

            setConversationState(getFloatingRailConversationState(wrapper));
        }

        updateState();
        const frame = window.requestAnimationFrame(updateState);
        const timer = window.setTimeout(updateState, 80);

        const observationRoot = wrapper.closest("section, aside") ?? document.body;
        const observer = new MutationObserver(updateState);
        observer.observe(observationRoot, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["class"],
        });

        window.addEventListener("storage", updateState);
        window.addEventListener(
            "engravida:open-floating-conversation",
            updateState,
        );

        return () => {
            window.cancelAnimationFrame(frame);
            window.clearTimeout(timer);
            observer.disconnect();
            window.removeEventListener("storage", updateState);
            window.removeEventListener(
                "engravida:open-floating-conversation",
                updateState,
            );
        };
    }, []);

    return (
        <span ref={wrapperRef} className="relative inline-flex h-9 w-9 shrink-0">
            <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${colorClass}`}
            >
                {initials}
            </span>

            {conversationState === "live" ? (
                <span
                    className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-green"
                    title="Conversa ao vivo"
                />
            ) : conversationState === "history" ? (
                <span
                    className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-slate-100 text-slate-500"
                    title="Conversa do histórico"
                >
                    <History size={11} strokeWidth={2.25} />
                </span>
            ) : null}
        </span>
    );
}

function getInboxConversationState(
    wrapper: HTMLSpanElement,
): ConversationState {
    const listButton = wrapper.closest("button");

    if (!listButton?.className.includes("grid-cols-[52px_minmax(0,1fr)_auto]")) {
        return null;
    }

    const panel = listButton.closest("section");
    const statusButtons = panel?.querySelectorAll<HTMLButtonElement>(
        "div.grid.h-10.grid-cols-2 > button",
    );

    if (!statusButtons || statusButtons.length !== 2) return null;

    return statusButtons[0].classList.contains("bg-brand")
        ? "live"
        : "history";
}

function getFloatingRailConversationState(
    wrapper: HTMLSpanElement,
): ConversationState {
    const rail = wrapper.closest("aside");
    const row = wrapper.closest<HTMLDivElement>("div.group.grid");

    if (!rail || !row) return null;

    const rows = Array.from(
        rail.querySelectorAll<HTMLDivElement>("div.group.grid"),
    );
    const rowIndex = rows.indexOf(row);

    if (rowIndex < 0) return null;

    try {
        const stored = window.localStorage.getItem(RAIL_STORAGE_KEY);
        const state = stored
            ? (JSON.parse(stored) as PersistedRailState)
            : null;
        const ticket = state?.tickets?.[rowIndex];

        if (ticket?.type === "thread") return "live";
        if (ticket?.type === "conversation") return "history";
    } catch {
        return null;
    }

    return null;
}

function getInitials(name: string) {
    return name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
}

function getInitialsColor(initials: string) {
    const colors = [
        "bg-violet-100 text-violet-700",
        "bg-blue-100 text-blue-700",
        "bg-cyan-100 text-cyan-700",
        "bg-indigo-100 text-indigo-700",
        "bg-sky-100 text-sky-700",
        "bg-fuchsia-100 text-fuchsia-700",
        "bg-teal-100 text-teal-700",
        "bg-pink-100 text-pink-700",
    ];

    let hash = 0;

    for (let index = 0; index < initials.length; index += 1) {
        hash = initials.charCodeAt(index) + ((hash << 5) - hash);
    }

    return colors[Math.abs(hash) % colors.length];
}

export const __uiDemo = {
    element: (
        <div className="flex items-center gap-3">
            <InitialsAvatar name="Maria Silva" />
            <InitialsAvatar name="João Santos" />
            <InitialsAvatar name="Ana Paula" />
            <InitialsAvatar name="Pedro Lima" />
        </div>
    ),
    code: `<div className="flex items-center gap-3">
  <InitialsAvatar name="Maria Silva" />
  <InitialsAvatar name="João Santos" />
  <InitialsAvatar name="Ana Paula" />
  <InitialsAvatar name="Pedro Lima" />
</div>`,
};
