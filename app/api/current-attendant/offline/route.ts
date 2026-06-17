// app/api/current-attendant/offline/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST() {
    const supabase = await createRouteSupabaseClient();

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
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
            is_online: false,
        })
        .eq("auth_user_id", user.id)
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

    return NextResponse.json({
        ok: true,
        attendant,
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
