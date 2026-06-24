// app/api/internal-chat/presence/route.ts
import { NextResponse } from "next/server";

import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import { supabase } from "@/lib";

export async function POST() {
    try {
        const user = await getCurrentAuthUser();

        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const now = new Date().toISOString();
        const { error } = await supabase.from("user_presence").upsert(
            {
                auth_user_id: user.id,
                last_seen_at: now,
                updated_at: now,
            },
            { onConflict: "auth_user_id" },
        );

        if (error) {
            return NextResponse.json(
                { ok: false, error: error.message },
                { status: 500 },
            );
        }

        return NextResponse.json({ ok: true, last_seen_at: now });
    } catch (error) {
        console.error("[internal-chat/presence] POST failed", error);
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to update presence",
            },
            { status: 500 },
        );
    }
}
