// app/api/internal-chat/conversations/[conversationId]/messages/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import {
    getInternalChatUserById,
    getPeerUserId,
    requireInternalConversationParticipant,
} from "@/lib/internal-chat/internalChatServer";
import type { InternalMessage } from "@/types/internalChat";

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ conversationId: string }> },
) {
    try {
        const user = await getCurrentAuthUser();
        const { conversationId } = await params;

        if (!user) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 },
            );
        }

        const conversation = await requireInternalConversationParticipant({
            conversationId,
            authUserId: user.id,
        });

        if (!conversation) {
            return NextResponse.json(
                { error: "Conversation not found" },
                { status: 404 },
            );
        }

        const { data: messages, error } = await supabase
            .from("internal_messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .order("sent_at", { ascending: true })
            .order("id", { ascending: true });

        if (error) throw error;

        const peerId = getPeerUserId(conversation, user.id);
        const peer = await getInternalChatUserById(peerId);

        if (!peer) {
            return NextResponse.json(
                { error: "Conversation user not found" },
                { status: 404 },
            );
        }

        const senderIds = [user.id, peer.id];
        const senderNames = new Map<string, string>([
            [user.id, getCurrentUserName(user)],
            [peer.id, peer.name],
        ]);

        const normalizedMessages = (messages ?? [])
            .filter((message) => senderIds.includes(message.sender_auth_user_id))
            .map((message) => ({
                id: message.id,
                conversation_id: message.conversation_id,
                sender_auth_user_id: message.sender_auth_user_id,
                sender_name:
                    senderNames.get(message.sender_auth_user_id) ?? "Usuário",
                text: message.text,
                sent_at: message.sent_at,
                read_at: message.read_at,
            })) satisfies InternalMessage[];

        return NextResponse.json({
            conversation,
            peer,
            messages: normalizedMessages,
        });
    } catch (error) {
        console.error("[internal-chat/messages] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load internal messages",
            },
            { status: 500 },
        );
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ conversationId: string }> },
) {
    try {
        const user = await getCurrentAuthUser();
        const { conversationId } = await params;

        if (!user) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 },
            );
        }

        const conversation = await requireInternalConversationParticipant({
            conversationId,
            authUserId: user.id,
        });

        if (!conversation) {
            return NextResponse.json(
                { error: "Conversation not found" },
                { status: 404 },
            );
        }

        const body = await request.json();
        const text = typeof body.text === "string" ? body.text.trim() : "";

        if (!text) {
            return NextResponse.json(
                { error: "Message text is required" },
                { status: 400 },
            );
        }

        if (text.length > 5000) {
            return NextResponse.json(
                { error: "Message is too long" },
                { status: 400 },
            );
        }

        const sentAt = new Date().toISOString();
        const { data: message, error } = await supabase
            .from("internal_messages")
            .insert({
                conversation_id: conversationId,
                sender_auth_user_id: user.id,
                text,
                sent_at: sentAt,
            })
            .select("*")
            .single();

        if (error) throw error;

        return NextResponse.json({
            message: {
                ...message,
                sender_name: getCurrentUserName(user),
            } satisfies InternalMessage,
        });
    } catch (error) {
        console.error("[internal-chat/messages] POST failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to send internal message",
            },
            { status: 500 },
        );
    }
}

function getCurrentUserName(user: {
    email?: string | null;
    user_metadata?: Record<string, unknown>;
}) {
    const metadata = user.user_metadata ?? {};

    return (
        getMetadataString(metadata, "name") ??
        getMetadataString(metadata, "full_name") ??
        getMetadataString(metadata, "display_name") ??
        getMetadataString(metadata, "user_name") ??
        user.email?.split("@")[0] ??
        "Usuário"
    );
}

function getMetadataString(
    metadata: Record<string, unknown>,
    key: string,
) {
    const value = metadata[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
