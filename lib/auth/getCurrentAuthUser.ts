// lib/auth/getCurrentAuthUser.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const AUTH_REQUEST_TIMEOUT_MS = 8_000;

export type CurrentAuthUser = {
    id: string;
    email: string | null;
    user_metadata: Record<string, unknown>;
};

export async function getCurrentAuthUser() {
    const supabase = await createServerAuthClient();
    let claimsResult: Awaited<ReturnType<typeof supabase.auth.getClaims>>;

    try {
        claimsResult = await supabase.auth.getClaims();
    } catch (error) {
        console.warn("[auth] failed to verify the current session", error);
        return null;
    }

    const { data, error } = claimsResult;

    if (error || !data?.claims?.sub) return null;

    return {
        id: data.claims.sub,
        email:
            typeof data.claims.email === "string"
                ? data.claims.email
                : null,
        user_metadata:
            data.claims.user_metadata &&
            typeof data.claims.user_metadata === "object"
                ? (data.claims.user_metadata as Record<string, unknown>)
                : {},
    } satisfies CurrentAuthUser;
}

export async function createServerAuthClient() {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            global: {
                fetch(input, init) {
                    const timeoutSignal = AbortSignal.timeout(
                        AUTH_REQUEST_TIMEOUT_MS,
                    );
                    const signal = init?.signal
                        ? AbortSignal.any([init.signal, timeoutSignal])
                        : timeoutSignal;

                    return fetch(input, { ...init, signal });
                },
            },
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
        },
    );
}
