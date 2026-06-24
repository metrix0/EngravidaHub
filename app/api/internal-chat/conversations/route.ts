// app/api/internal-chat/conversations/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import {
    getInternalChatUserById,
    getInternalChatUsers,
    getPeerUserId,
    makeParticipantKey,
} from "@/lib/internal-chat/internalChatServer";
import type { InternalConversationSummary } from "@/types/internalChat";

export async function GET() {
    try {
        const user = await getCurrentAuthUser();

        if (!user) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 },
            );
        }

        const { data: conversations, error: conversationsError } = await supabase
            .from("internal_conversations")
            .select("*")
            .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
            .order("last_message_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false });

        if (conversationsError) throw conversationsError;

        const rows = conversations ?? [];
        const conversationIds = rows.map((row) => row.id);
        const allUsers = await getInternalChatUsers();
        const usersById = new Map(allUsers.map((item) => [item.id, item]));

        let unreadCounts = new Map<string, number>();

        if (conversationIds.length > 0) {
            const { data: unreadMessages, error: unreadError } = await supabase
                .from("internal_messages")
                .select("conversation_id")
                .in("conversation_id", conversationIds)
                .neq("sender_auth_user_id", user.id)
                .is("read_at", null);

            if (unreadError) throw unreadError;

            unreadCounts = new Map<string, number>();
            for (const message of unreadMessages ?? []) {
                unreadCounts.set(
                    message.conversation_id,
                    (unreadCounts.get(message.conversation_id) ?? 0) + 1,
                );
            }
        }

        const summaries = rows
            .map((conversation) => {
                const peerId = getPeerUserId(conversation, user.id);
                const peer = usersById.get(peerId);
                if (!peer) return null;

                return {
                    id: conversation.id,
                    peer,
                    last_message_text: conversation.last_message_text,
                    last_message_at: conversation.last_message_at,
                    unread_count: unreadCounts.get(conversation.id) ?? 0,
                    created_at: conversation.created_at,
                    updated_at: conversation.updated_at,
                } satisfies InternalConversationSummary;
            })
            .filter((item): item is InternalConversationSummary => Boolean(item));

        return NextResponse.json({ conversations: summaries });
    } catch (error) {
        console.error("[internal-chat/conversations] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load internal conversations",
            },
            { status: 500 },
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentAuthUser();

        if (!user) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 },
            );
        }

        const body = await request.json();
        const peerUserId =
            typeof body.peer_user_id === "string"
                ? body.peer_user_id.trim()
                : "";

        if (!peerUserId) {
            return NextResponse.json(
                { error: "peer_user_id is required" },
                { status: 400 },
            );
        }

        if (peerUserId === user.id) {
            return NextResponse.json(
                { error: "You cannot start a chat with yourself" },
                { status: 400 },
            );
        }

        const peer = await getInternalChatUserById(peerUserId);

        if (!peer) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 404 },
            );
        }

        const participantKey = makeParticipantKey(user.id, peerUserId);
        const [userAId, userBId] = [user.id, peerUserId].sort();
        const now = new Date().toISOString();

        const { data: conversation, error } = await supabase
            .from("internal_conversations")
            .upsert(
                {
                    participant_key: participantKey,
                    user_a_id: userAId,
                    user_b_id: userBId,
                    updated_at: now,
                },
                {
                    onConflict: "participant_key",
                    ignoreDuplicates: false,
                },
            )
            .select("*")
            .single();

        if (error) throw error;

        return NextResponse.json({ conversation, peer });
    } catch (error) {
        console.error("[internal-chat/conversations] POST failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to open internal conversation",
            },
            { status: 500 },
        );
    }
}
