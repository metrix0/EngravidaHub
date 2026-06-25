// app/api/internal-chat/groups/route.ts
import { NextResponse } from "next/server";

import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import { getInternalGroupSummaries } from "@/lib/internal-chat/internalChatServer";

export async function GET() {
    try {
        const user = await getCurrentAuthUser();

        if (!user) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 },
            );
        }

        const groups = await getInternalGroupSummaries(user.id);
        return NextResponse.json({ groups });
    } catch (error) {
        console.error("[internal-chat/groups] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load internal groups",
            },
            { status: 500 },
        );
    }
}
