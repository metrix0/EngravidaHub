// app/api/current-attendant/online/route.ts
import { NextResponse } from "next/server";
import { createServerAuthClient } from "@/lib/auth/getCurrentAuthUser";

export async function POST() {
    const supabase = await createServerAuthClient();

    const { data, error: userError } = await supabase.auth.getClaims();
    const claims = data?.claims ?? null;

    if (userError || !claims?.sub) {
        return NextResponse.json(
            {
                ok: false,
                error: userError?.message ?? "Not authenticated",
            },
            { status: 401 }
        );
    }

    const { data: attendant, error } = await supabase
        .from("attendants")
        .update({
            is_online: true,
        })
        .eq("auth_user_id", claims.sub)
        .eq("active", true)
        .select(`
            id,
            name,
            email,
            active,
            is_online,
            auth_user_id,
            units (
                id,
                name
            )
        `)
        .maybeSingle();

    if (error) {
        return NextResponse.json(
            { ok: false, error: error.message },
            { status: 500 }
        );
    }

    if (!attendant) {
        return NextResponse.json(
            { ok: false, error: "No active attendant linked to this user" },
            { status: 403 }
        );
    }

    return NextResponse.json({
        ok: true,
        attendant,
    });
}
