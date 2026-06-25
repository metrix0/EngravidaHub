// app/api/internal-chat/groups/[groupId]/read/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import { requireInternalGroupMember } from "@/lib/internal-chat/internalChatServer";

export async function POST(
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

        const now = new Date().toISOString();
        const { error } = await supabase
            .from("internal_group_members")
            .update({
                unread_count: 0,
                last_read_at: now,
                updated_at: now,
            })
            .eq("group_id", groupId)
            .eq("auth_user_id", user.id);

        if (error) throw error;

        return NextResponse.json({ ok: true, read_at: now });
    } catch (error) {
        console.error("[internal-chat/group-read] POST failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to mark internal group as read",
            },
            { status: 500 },
        );
    }
}
