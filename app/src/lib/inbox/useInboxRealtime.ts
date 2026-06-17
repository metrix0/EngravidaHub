// apps/crm/src/lib/inbox/useInboxRealtime.ts
"use client";

import { useEffect } from "react";

import { supabase } from "@engravida/lib/supabase/client";

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
            supabase.removeChannel(channel);
        };
    }, [
        selectedThreadId,
        selectedClientId,
        onThreadChange,
        onSelectedThreadChange,
    ]);
}