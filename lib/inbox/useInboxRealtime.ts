// lib/inbox/useInboxRealtime.ts
"use client";

import { useEffect } from "react";

import { supabase } from "@/lib/supabase/client";
import { INBOX_THREAD_CACHE_CHANGED_EVENT } from "@/lib/inbox/inboxApi";

type InboxThreadCacheChangedDetail = {
    threadId: string;
};

export function useInboxRealtime({
                                      selectedThreadId,
                                      selectedClientId,
                                      onThreadChange,
                                      onSelectedThreadChange,
                                  }: {
    selectedThreadId: string | null;
    selectedClientId: string | null;
    onThreadChange: () => void;
    onSelectedThreadChange: () => void;
}) {
    useEffect(() => {
        function handleThreadCacheChanged(event: Event) {
            const customEvent = event as CustomEvent<InboxThreadCacheChangedDetail>;

            if (customEvent.detail?.threadId === selectedThreadId) {
                onSelectedThreadChange();
            }
        }

        window.addEventListener(
            INBOX_THREAD_CACHE_CHANGED_EVENT,
            handleThreadCacheChanged,
        );

        const channel = supabase
            .channel("inbox-realtime")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "thread",
                },
                (payload) => {
                    const newRecord = payload.new as { id?: string } | null;
                    const oldRecord = payload.old as { id?: string } | null;
                    const changedThreadId = newRecord?.id ?? oldRecord?.id ?? null;

                    onThreadChange();

                    if (changedThreadId && changedThreadId === selectedThreadId) {
                        onSelectedThreadChange();
                    }
                }
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "messages",
                },
                (payload) => {
                    const newRecord = payload.new as { thread_id?: string } | null;
                    const oldRecord = payload.old as { thread_id?: string } | null;

                    const changedThreadId =
                        newRecord?.thread_id ?? oldRecord?.thread_id ?? null;

                    onThreadChange();

                    if (changedThreadId && changedThreadId === selectedThreadId) {
                        onSelectedThreadChange();
                    }
                }
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "clients",
                },
                (payload) => {
                    const newRecord = payload.new as { id?: string } | null;
                    const oldRecord = payload.old as { id?: string } | null;

                    const changedClientId = newRecord?.id ?? oldRecord?.id ?? null;

                    if (changedClientId && changedClientId === selectedClientId) {
                        onThreadChange();
                        onSelectedThreadChange();
                    }
                }
            )
            .subscribe();

        return () => {
            window.removeEventListener(
                INBOX_THREAD_CACHE_CHANGED_EVENT,
                handleThreadCacheChanged,
            );
            supabase.removeChannel(channel);
        };
    }, [
        selectedThreadId,
        selectedClientId,
        onThreadChange,
        onSelectedThreadChange,
    ]);
}
