// lib/attendants/getCurrentAttendantFromRequest.ts
import { createServerAuthClient } from "@/lib/auth/getCurrentAuthUser";

export async function getCurrentAttendantFromRequest() {
    const supabase = await createServerAuthClient();

    const { data, error: userError } = await supabase.auth.getClaims();
    const claims = data?.claims ?? null;

    if (userError || !claims?.sub) {
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
        .eq("auth_user_id", claims.sub)
        .eq("active", true)
        .maybeSingle();

    if (attendantError) {
        throw attendantError;
    }

    return {
        supabase,
        user: {
            id: claims.sub,
            email:
                typeof claims.email === "string" ? claims.email : null,
        },
        attendant,
    };
}
