// app/api/current-attendant/route.ts
import { NextResponse } from "next/server";
import { createServerAuthClient } from "@/lib/auth/getCurrentAuthUser";

export async function GET() {
    const supabase = await createServerAuthClient();

    const { data, error: userError } = await supabase.auth.getClaims();
    const claims = data?.claims ?? null;

    if (userError) {
        return NextResponse.json(
            {
                ok: false,
                error: userError.message,
                debug: {
                    reason: "auth_get_user_error",
                },
            },
            { status: 401 }
        );
    }

    if (!claims?.sub) {
        return NextResponse.json({
            ok: true,
            user: null,
            attendant: null,
            debug: {
                reason: "no_user_from_supabase_cookie",
            },
        });
    }

    const { data: attendant, error: attendantError } = await supabase
        .from("attendants")
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
        .eq("auth_user_id", claims.sub)
        .maybeSingle();

    if (attendantError) {
        return NextResponse.json(
            {
                ok: false,
                error: attendantError.message,
                debug: {
                    reason: "attendant_query_error",
                    searchedAuthUserId: claims.sub,
                    code: attendantError.code,
                },
            },
            { status: 500 }
        );
    }

    return NextResponse.json({
        ok: true,
        user: {
            id: claims.sub,
            email: typeof claims.email === "string" ? claims.email : null,
        },
        attendant,
        debug: {
            reason: attendant ? "attendant_found" : "attendant_not_found",
            searchedAuthUserId: claims.sub,
            hasAttendant: !!attendant,
        },
    });
}
