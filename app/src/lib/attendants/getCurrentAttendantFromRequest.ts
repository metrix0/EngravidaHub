// apps/crm/src/lib/attendants/getCurrentAttendantFromRequest.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function getCurrentAttendantFromRequest() {
    const supabase = await createRouteSupabaseClient();

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        return {
            supabase,
            user: null,
            attendant: null,
        };
    }

    const { data: attendant, error: attendantError } = await supabase
        .from("attendants")
        .select(`
            id,
            name,
            email,
            active,
            is_online,
            auth_user_id
        `)
        .eq("auth_user_id", user.id)
        .eq("active", true)
        .maybeSingle();

    if (attendantError) {
        throw attendantError;
    }

    return {
        supabase,
        user,
        attendant,
    };
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