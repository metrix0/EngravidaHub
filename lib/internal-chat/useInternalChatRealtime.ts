// lib/internal-chat/useInternalChatRealtime.ts
"use client";

import { useEffect, useRef } from "react";

import { supabase } from "@/lib/supabase/client";
import type { InternalMessage } from "@/types/internalChat";

export type InternalChatRealtimeMessageChange = {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    conversationId: string | null;
    message: InternalMessage | null;
};

export function useInternalChatRealtime({
    currentUserId,
    onConversationListChange,
    onMessageChange,
}: {
    currentUserId: string | null;
    onConversationListChange: () => void;
    onMessageChange: (change: InternalChatRealtimeMessageChange) => void;
}) {
    const onConversationListChangeRef = useRef(onConversationListChange);
    const onMessageChangeRef = useRef(onMessageChange);

    useEffect(() => {
        onConversationListChangeRef.current = onConversationListChange;
    }, [onConversationListChange]);

    useEffect(() => {
        onMessageChangeRef.current = onMessageChange;
    }, [onMessageChange]);

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
                    onConversationListChangeRef.current();
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
                    const next = payload.new as InternalMessage | null;
                    const previous = payload.old as InternalMessage | null;
                    const message = next ?? previous;
                    const conversationId = message?.conversation_id ?? null;

                    onMessageChangeRef.current({
                        eventType: payload.eventType,
                        conversationId,
                        message,
                    });
                    onConversationListChangeRef.current();
                },
            )
            .subscribe((status) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    console.warn(
                        `[internal-chat-realtime] subscription status: ${status}`,
                    );
                }
            });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [currentUserId]);
}
