// app/api/internal-chat/directory/route.ts
import { NextResponse } from "next/server";

import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import {
    getInternalChatUsers,
    getInternalGroupSummaries,
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

        const allUsers = await getInternalChatUsers();
        const groups = await getInternalGroupSummaries(user.id, allUsers);

        return NextResponse.json({
            users: allUsers.filter((item) => item.id !== user.id),
            groups,
        });
    } catch (error) {
        console.error("[internal-chat/directory] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load internal directory",
            },
            { status: 500 },
        );
    }
}
