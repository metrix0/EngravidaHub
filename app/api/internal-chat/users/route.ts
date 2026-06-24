// app/api/internal-chat/users/route.ts
import { NextResponse } from "next/server";

import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import { getInternalChatUsers } from "@/lib/internal-chat/internalChatServer";

export async function GET() {
    try {
        const user = await getCurrentAuthUser();

        if (!user) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 },
            );
        }

        const users = await getInternalChatUsers({ excludeUserId: user.id });

        return NextResponse.json({ users });
    } catch (error) {
        console.error("[internal-chat/users] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load internal users",
            },
            { status: 500 },
        );
    }
}
