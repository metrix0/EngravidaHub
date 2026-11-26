// lib/inbox/useInboxRealtime.ts
"use client";

import { useEffect, useRef } from "react";
import { createBrowserClient } from "@supabase/ssr";

import { supabase } from "@/lib/supabase/client";
import {
    INBOX_THREAD_CACHE_CHANGED_EVENT,
    isInboxOptimisticSendPending,
} from "@/lib/inbox/inboxApi";
import type { InboxItemType } from "@/types/inbox";

type InboxThreadCacheChangedDetail = {
    threadId: string;
};

type InboxChangeNotification = {
    thread_id?: string;
    conversation_id?: string;
    unread_count?: number;
    sender_type?: string;
    table?: string;
};

type RealtimeStateResponse = {
    ok: true;
    thread_id: string;
    version: string;
    unread_count: number;
};

const POLL_INTERVAL_MS = 2_500;
const ACTIVE_CONVERSATION_SELECTOR =
    'button[class*="grid-cols-[52px_minmax"][class*="border-brand"]';

export function useInboxRealtime({
    attendantId,
    selectedItemId,
    selectedItemType,
    selectedThreadId,
    selectedClientId,
    onThreadChange,
    onSelectedThreadChange,
}: {
    attendantId: string | null;
    selectedItemId: string | null;
    selectedItemType: InboxItemType;
    selectedThreadId: string | null;
    selectedClientId: string | null;
    onThreadChange: () => void;
    onSelectedThreadChange: (options?: { force?: boolean }) => void;
}) {
    const notificationHandlerRef = useRef<(change: InboxChangeNotification) => void>(() => {});
    const subscribedHandlerRef = useRef<() => void>(() => {});
    const notificationCleanupRef = useRef<Promise<unknown>>(Promise.resolve());
    const notificationConnectedRef = useRef(false);
    const selectedStateVersionRef = useRef<string | null>(null);
    const pollInFlightRef = useRef(false);
    const markReadInFlightRef = useRef<Promise<void> | null>(null);

    useEffect(() => {
        const styleId = "inbox-active-conversation-fixes";
        const existingStyle = document.getElementById(styleId);
        const style = existingStyle ?? document.createElement("style");

        if (!existingStyle) {
            style.id = styleId;
            style.textContent = `
                ${ACTIVE_CONVERSATION_SELECTOR} > div:last-child > span.bg-brand {
                    display: none !important;
                }
            `;

            document.head.appendChild(style);
        }

        function preventSelectingActiveConversation(event: MouseEvent) {
            const target = event.target;

            if (!(target instanceof Element)) return;

            const activeConversation = target.closest(
                ACTIVE_CONVERSATION_SELECTOR,
            );

            if (!activeConversation || activeConversation.getAttribute("data-manually-unread") === "true") return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }

        document.addEventListener(
            "click",
            preventSelectingActiveConversation,
            true,
        );

        return () => {
            document.removeEventListener(
                "click",
                preventSelectingActiveConversation,
                true,
            );

            if (!existingStyle) {
                style.remove();
            }
        };
    }, []);

    useEffect(() => {
        selectedStateVersionRef.current = null;

        let disposed = false;
        let threadRefreshTimer: ReturnType<typeof setTimeout> | null = null;
        let selectedRefreshTimer: ReturnType<typeof setTimeout> | null = null;
        let shouldMarkReadOnSelectedRefresh = false;
        let forceSelectedRefresh = false;

        function scheduleThreadRefresh() {
            if (threadRefreshTimer) return;

            threadRefreshTimer = setTimeout(() => {
                threadRefreshTimer = null;

                if (!disposed) {
                    onThreadChange();
                }
            }, 100);
        }

        function scheduleSelectedRefresh({
            markRead = false,
            force = true,
        }: {
            markRead?: boolean;
            force?: boolean;
        } = {}) {
            shouldMarkReadOnSelectedRefresh ||= markRead;
            forceSelectedRefresh ||= force;

            if (selectedRefreshTimer) return;

            selectedRefreshTimer = setTimeout(() => {
                selectedRefreshTimer = null;

                if (disposed) return;

                onSelectedThreadChange({ force: forceSelectedRefresh });
                forceSelectedRefresh = false;

                if (shouldMarkReadOnSelectedRefresh) {
                    shouldMarkReadOnSelectedRefresh = false;
                    void markSelectedThreadRead();
                }
            }, 100);
        }

        async function markSelectedThreadRead() {
            if (
                selectedItemType !== "thread" ||
                !selectedThreadId ||
                disposed
            ) {
                return;
            }

            if (markReadInFlightRef.current) {
                return markReadInFlightRef.current;
            }

            const request = fetch(
                `/api/inbox/threads/${encodeURIComponent(selectedThreadId)}`,
                {
                    method: "PATCH",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        read: true,
                    }),
                },
            )
                .then(async (response) => {
                    if (!response.ok) {
                        const json = await response.json().catch(() => null);

                        throw new Error(
                            json?.error ??
                                "Failed to mark selected thread as read",
                        );
                    }

                    scheduleThreadRefresh();
                })
                .catch((error) => {
                    console.error(
                        "[inbox-realtime] failed to mark selected thread as read",
                        error,
                    );
                })
                .finally(() => {
                    markReadInFlightRef.current = null;
                });

            markReadInFlightRef.current = request;

            return request;
        }

        async function pollSelectedThreadState() {
            if (attendantId && !notificationConnectedRef.current) scheduleThreadRefresh();
            if (
                !selectedThreadId ||
                disposed ||
                pollInFlightRef.current
            ) {
                return;
            }

            pollInFlightRef.current = true;

            try {
                const params = new URLSearchParams({
                    thread_id: selectedThreadId,
                });

                const response = await fetch(
                    `/api/inbox/realtime-state?${params.toString()}`,
                    {
                        credentials: "include",
                        cache: "no-store",
                    },
                );

                if (!response.ok) {
                    return;
                }

                const state = (await response.json()) as RealtimeStateResponse;
                const previousVersion = selectedStateVersionRef.current;

                selectedStateVersionRef.current = state.version;

                if (state.unread_count > 0) {
                    void markSelectedThreadRead();
                }

                if (
                    previousVersion !== null &&
                    previousVersion !== state.version
                ) {
                    scheduleThreadRefresh();
                    scheduleSelectedRefresh({
                        markRead: state.unread_count > 0,
                    });
                }
            } catch (error) {
                console.error(
                    "[inbox-realtime] failed to poll selected thread state",
                    error,
                );
            } finally {
                pollInFlightRef.current = false;
            }
        }

        function handleThreadCacheChanged(event: Event) {
            const customEvent =
                event as CustomEvent<InboxThreadCacheChangedDetail>;

            if (customEvent.detail?.threadId === selectedThreadId) {
                scheduleSelectedRefresh({
                    markRead: selectedItemType === "thread",
                    force: false,
                });
            }
        }

        window.addEventListener(
            INBOX_THREAD_CACHE_CHANGED_EVENT,
            handleThreadCacheChanged,
        );

        notificationHandlerRef.current = (change) => {
            if (disposed) return;
            if (isInboxOptimisticSendPending(change.thread_id) &&
                (change.table === "thread" || change.sender_type === "attendant")) return;
            scheduleThreadRefresh();
            if (change.thread_id === selectedThreadId ||
                selectedItemType === "conversation" && change.conversation_id === selectedItemId) {
                selectedStateVersionRef.current = null;
                scheduleSelectedRefresh({
                    markRead: selectedItemType === "thread" && (change.unread_count ?? 0) > 0,
                });
            }
        };
        subscribedHandlerRef.current = () => {
            scheduleThreadRefresh();
            if (selectedItemId) scheduleSelectedRefresh();
        };

        const channel = supabase
            .channel(`inbox-realtime-${crypto.randomUUID()}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "thread",
                },
                (payload) => {
                    const newRecord = payload.new as {
                        id?: string;
                        unread_count?: number;
                    } | null;
                    const oldRecord = payload.old as {
                        id?: string;
                        unread_count?: number;
                    } | null;
                    const changedThreadId =
                        newRecord?.id ?? oldRecord?.id ?? null;

                    if (isInboxOptimisticSendPending(changedThreadId)) {
                        return;
                    }

                    scheduleThreadRefresh();

                    if (
                        changedThreadId &&
                        changedThreadId === selectedThreadId
                    ) {
                        selectedStateVersionRef.current = null;

                        scheduleSelectedRefresh({
                            markRead:
                                selectedItemType === "thread" &&
                                (newRecord?.unread_count ?? 0) > 0,
                        });
                    }
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "conversations",
                },
                (payload) => {
                    const newRecord = payload.new as {
                        id?: string;
                    } | null;
                    const oldRecord = payload.old as {
                        id?: string;
                    } | null;
                    const changedConversationId =
                        newRecord?.id ?? oldRecord?.id ?? null;

                    scheduleThreadRefresh();

                    if (
                        selectedItemType === "conversation" &&
                        changedConversationId === selectedItemId
                    ) {
                        scheduleSelectedRefresh();
                    }
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "messages",
                },
                (payload) => {
                    const newRecord = payload.new as {
                        thread_id?: string;
                        conversation_id?: string;
                        sender_type?: string;
                    } | null;
                    const oldRecord = payload.old as {
                        thread_id?: string;
                        conversation_id?: string;
                        sender_type?: string;
                    } | null;

                    const changedThreadId =
                        newRecord?.thread_id ??
                        oldRecord?.thread_id ??
                        null;
                    const changedConversationId =
                        newRecord?.conversation_id ??
                        oldRecord?.conversation_id ??
                        null;
                    const senderType =
                        newRecord?.sender_type ??
                        oldRecord?.sender_type ??
                        null;

                    if (
                        senderType === "attendant" &&
                        isInboxOptimisticSendPending(changedThreadId)
                    ) {
                        return;
                    }

                    scheduleThreadRefresh();

                    const selectedChanged =
                        selectedItemType === "thread"
                            ? changedThreadId === selectedThreadId
                            : changedConversationId === selectedItemId;

                    if (selectedChanged) {
                        selectedStateVersionRef.current = null;

                        scheduleSelectedRefresh({
                            markRead: selectedItemType === "thread",
                        });
                    }
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "clients",
                },
                (payload) => {
                    const newRecord = payload.new as {
                        id?: string;
                    } | null;
                    const oldRecord = payload.old as {
                        id?: string;
                    } | null;
                    const changedClientId =
                        newRecord?.id ?? oldRecord?.id ?? null;

                    if (
                        changedClientId &&
                        changedClientId === selectedClientId
                    ) {
                        scheduleThreadRefresh();
                        scheduleSelectedRefresh();
                    }
                },
            )
            .subscribe();

        if (selectedItemType === "thread" && selectedThreadId) {
            void markSelectedThreadRead();
        }

        void pollSelectedThreadState();

        const pollInterval = window.setInterval(
            () => void pollSelectedThreadState(),
            POLL_INTERVAL_MS,
        );

        return () => {
            disposed = true;

            window.clearInterval(pollInterval);

            if (threadRefreshTimer) {
                clearTimeout(threadRefreshTimer);
            }

            if (selectedRefreshTimer) {
                clearTimeout(selectedRefreshTimer);
            }

            window.removeEventListener(
                INBOX_THREAD_CACHE_CHANGED_EVENT,
                handleThreadCacheChanged,
            );

            supabase.removeChannel(channel);
        };
    }, [
        attendantId,
        selectedItemId,
        selectedItemType,
        selectedThreadId,
        selectedClientId,
        onThreadChange,
        onSelectedThreadChange,
    ]);

    // Keep the authenticated notification subscription while the selection or
    // filters change; only its handlers need the latest conversation state.
    useEffect(() => {
        if (!attendantId) return;
        const realtimeClient = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        let disposed = false;
        let channel: ReturnType<typeof realtimeClient.channel> | null = null;
        void (async () => {
            // React Strict Mode can unmount and remount before unsubscribe
            // finishes. Do not reuse a channel that is still being removed.
            await notificationCleanupRef.current;
            if (disposed) return;
            channel = realtimeClient.channel("inbox:social", { config: { private: true } })
                .on("broadcast", { event: "changed" }, ({ payload }) => {
                    notificationHandlerRef.current(payload as InboxChangeNotification);
                })
                .subscribe((status, error) => {
                    if (disposed) return;
                    notificationConnectedRef.current = status === "SUBSCRIBED";
                    if (status === "SUBSCRIBED") {
                        subscribedHandlerRef.current();
                    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                        console.warn("[inbox-realtime] notification subscription failed", status, error?.message ?? null);
                    }
                });
        })();
        return () => {
            disposed = true;
            notificationConnectedRef.current = false;
            if (channel) notificationCleanupRef.current = realtimeClient.removeChannel(channel);
        };
    }, [attendantId]);

}
