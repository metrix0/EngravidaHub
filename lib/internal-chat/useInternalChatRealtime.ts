// lib/internal-chat/useInternalChatRealtime.ts
"use client";

import { useEffect } from "react";

import { supabase } from "@/lib/supabase/client";

export function useInternalChatRealtime({
    currentUserId,
    selectedConversationId,
    onConversationListChange,
    onSelectedConversationChange,
}: {
    currentUserId: string | null;
    selectedConversationId: string | null;
    onConversationListChange: () => void;
    onSelectedConversationChange: () => void;
}) {
    useEffect(() => {
        if (!currentUserId) return;

        const channel = supabase
            .channel(`internal-chat-${currentUserId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "internal_conversations",
                },
                () => {
                    onConversationListChange();
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "internal_messages",
                },
                (payload) => {
                    const next = payload.new as { conversation_id?: string } | null;
                    const previous = payload.old as { conversation_id?: string } | null;
                    const changedConversationId =
                        next?.conversation_id ?? previous?.conversation_id ?? null;

                    onConversationListChange();

                    if (
                        changedConversationId &&
                        changedConversationId === selectedConversationId
                    ) {
                        onSelectedConversationChange();
                    }
                },
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [
        currentUserId,
        selectedConversationId,
        onConversationListChange,
        onSelectedConversationChange,
    ]);
}
