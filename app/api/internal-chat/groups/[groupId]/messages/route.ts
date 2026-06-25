// app/api/internal-chat/groups/[groupId]/messages/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import {
    getCurrentAuthUserName,
    getInternalGroupSummaryById,
    getInternalUserNamesByIds,
    requireInternalGroupMember,
} from "@/lib/internal-chat/internalChatServer";
import type { InternalGroupMessage } from "@/types/internalChat";

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ groupId: string }> },
) {
    try {
        const user = await getCurrentAuthUser();
        const { groupId } = await params;

        if (!user) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 },
            );
        }

        const membership = await requireInternalGroupMember({
            groupId,
            authUserId: user.id,
        });

        if (!membership) {
            return NextResponse.json(
                { error: "Group not found or access denied" },
                { status: 404 },
            );
        }

        const { data: messages, error } = await supabase
            .from("internal_group_messages")
            .select("*")
            .eq("group_id", groupId)
            .order("sent_at", { ascending: true })
            .order("id", { ascending: true });

        if (error) throw error;

        const senderIds: string[] = [
            ...new Set<string>(
                (messages ?? []).map(
                    (message) => message.sender_auth_user_id as string,
                ),
            ),
        ];
        const senderNames = await getInternalUserNamesByIds(senderIds);
        senderNames.set(user.id, getCurrentAuthUserName(user));

        const normalizedMessages = (messages ?? []).map((message) => ({
            id: message.id,
            group_id: message.group_id,
            sender_auth_user_id: message.sender_auth_user_id,
            sender_name:
                senderNames.get(message.sender_auth_user_id) ?? "Usuário",
            text: message.text,
            sent_at: message.sent_at,
        })) satisfies InternalGroupMessage[];

        const group = await getInternalGroupSummaryById({
            groupId,
            authUserId: user.id,
        });

        if (!group) {
            return NextResponse.json(
                { error: "Group not found" },
                { status: 404 },
            );
        }

        return NextResponse.json({ group, messages: normalizedMessages });
    } catch (error) {
        console.error("[internal-chat/group-messages] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load internal group messages",
            },
            { status: 500 },
        );
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ groupId: string }> },
) {
    try {
        const user = await getCurrentAuthUser();
        const { groupId } = await params;

        if (!user) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 },
            );
        }

        const membership = await requireInternalGroupMember({
            groupId,
            authUserId: user.id,
        });

        if (!membership) {
            return NextResponse.json(
                { error: "Group not found or access denied" },
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
            .from("internal_group_messages")
            .insert({
                group_id: groupId,
                sender_auth_user_id: user.id,
                text,
                sent_at: sentAt,
            })
            .select("*")
            .single();

        if (error) throw error;

        return NextResponse.json({
            message: {
                id: message.id,
                group_id: message.group_id,
                sender_auth_user_id: message.sender_auth_user_id,
                sender_name: getCurrentAuthUserName(user),
                text: message.text,
                sent_at: message.sent_at,
            } satisfies InternalGroupMessage,
        });
    } catch (error) {
        console.error("[internal-chat/group-messages] POST failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to send internal group message",
            },
            { status: 500 },
        );
    }
}
