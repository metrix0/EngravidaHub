// app/api/internal-chat/conversations/[conversationId]/read/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import { requireInternalConversationParticipant } from "@/lib/internal-chat/internalChatServer";

export async function POST(
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

        const { error } = await supabase
            .from("internal_messages")
            .update({ read_at: new Date().toISOString() })
            .eq("conversation_id", conversationId)
            .neq("sender_auth_user_id", user.id)
            .is("read_at", null);

        if (error) throw error;

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[internal-chat/read] POST failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to mark messages as read",
            },
            { status: 500 },
        );
    }
}
