// app/api/internal-chat/overview/route.ts
import { NextResponse } from "next/server";

import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import {
    getInternalChatUsers,
    getInternalConversationSummaries,
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

        // Users are the expensive shared dependency of both lists. Load them
        // once so opening a page never performs two Auth Admin requests.
        const allUsers = await getInternalChatUsers();
        const [conversations, groups] = await Promise.all([
            getInternalConversationSummaries(user.id, allUsers),
            getInternalGroupSummaries(user.id, allUsers),
        ]);

        return NextResponse.json({ conversations, groups });
    } catch (error) {
        console.error("[internal-chat/overview] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load internal chat overview",
            },
            { status: 500 },
        );
    }
}
