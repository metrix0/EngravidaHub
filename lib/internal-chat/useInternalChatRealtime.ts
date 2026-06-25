// lib/internal-chat/useInternalChatRealtime.ts
"use client";

import { useEffect, useRef } from "react";

import { supabase } from "@/lib/supabase/client";
import type {
    InternalGroupMessage,
    InternalMessage,
} from "@/types/internalChat";

export type InternalChatRealtimeMessageChange = {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    conversationId: string | null;
    message: InternalMessage | null;
};

export type InternalGroupRealtimeMessage = Omit<
    InternalGroupMessage,
    "sender_name"
> & {
    sender_name?: string;
};

export type InternalGroupRealtimeMessageChange = {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    groupId: string | null;
    message: InternalGroupRealtimeMessage | null;
};

export function useInternalChatRealtime({
    currentUserId,
    onConversationListChange,
    onMessageChange,
    onGroupListChange,
    onGroupMessageChange,
}: {
    currentUserId: string | null;
    onConversationListChange: () => void;
    onMessageChange: (change: InternalChatRealtimeMessageChange) => void;
    onGroupListChange?: () => void;
    onGroupMessageChange?: (change: InternalGroupRealtimeMessageChange) => void;
}) {
    const onConversationListChangeRef = useRef(onConversationListChange);
    const onMessageChangeRef = useRef(onMessageChange);
    const onGroupListChangeRef = useRef(onGroupListChange);
    const onGroupMessageChangeRef = useRef(onGroupMessageChange);

    useEffect(() => {
        onConversationListChangeRef.current = onConversationListChange;
    }, [onConversationListChange]);

    useEffect(() => {
        onMessageChangeRef.current = onMessageChange;
    }, [onMessageChange]);

    useEffect(() => {
        onGroupListChangeRef.current = onGroupListChange;
    }, [onGroupListChange]);

    useEffect(() => {
        onGroupMessageChangeRef.current = onGroupMessageChange;
    }, [onGroupMessageChange]);

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
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "internal_group_members",
                    filter: `auth_user_id=eq.${currentUserId}`,
                },
                () => {
                    onGroupListChangeRef.current?.();
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "internal_group_messages",
                },
                (payload) => {
                    const next =
                        payload.new as InternalGroupRealtimeMessage | null;
                    const previous =
                        payload.old as InternalGroupRealtimeMessage | null;
                    const message = next ?? previous;
                    const groupId = message?.group_id ?? null;

                    onGroupMessageChangeRef.current?.({
                        eventType: payload.eventType,
                        groupId,
                        message,
                    });
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
