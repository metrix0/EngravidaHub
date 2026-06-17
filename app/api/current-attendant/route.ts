// app/api/current-attendant/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET() {
    const supabase = await createRouteSupabaseClient();

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

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

    if (!user) {
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
        .eq("auth_user_id", user.id)
        .maybeSingle();

    if (attendantError) {
        return NextResponse.json(
            {
                ok: false,
                error: attendantError.message,
                debug: {
                    reason: "attendant_query_error",
                    searchedAuthUserId: user.id,
                    code: attendantError.code,
                },
            },
            { status: 500 }
        );
    }

    return NextResponse.json({
        ok: true,
        user: {
            id: user.id,
            email: user.email ?? null,
        },
        attendant,
        debug: {
            reason: attendant ? "attendant_found" : "attendant_not_found",
            searchedAuthUserId: user.id,
            hasAttendant: !!attendant,
        },
    });
}

async function createRouteSupabaseClient() {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        cookieStore.set(name, value, options);
                    });
                },
            },
        }
    );
}
