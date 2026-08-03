// app/api/internal-chat/conversations/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import {
    getInternalConversationSummaries,
    getInternalChatUserById,
    makeParticipantKey,
} from "@/lib/internal-chat/internalChatServer";

export async function GET() {
    try {
        const user = await getCurrentAuthUser();

        if (!user) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 },
            );
        }

        const summaries = await getInternalConversationSummaries(user.id);

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
