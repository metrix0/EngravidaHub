// lib/supabase/client.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isServer = typeof window === "undefined";

if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

const supabaseKey =
    isServer
        ? supabaseServiceRoleKey ?? supabaseAnonKey
        : supabaseAnonKey;

if (!supabaseKey) {
    throw new Error("Missing Supabase key");
}

const supabaseFetch: typeof fetch = (input, init) => {
    const headers = new Headers(
        input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => {
        headers.set(key, value);
    });
    const apiKey = headers.get("apikey");
    const authorization = headers.get("authorization");

    // `sb_publishable_` and `sb_secret_` are opaque API keys, not JWTs.
    // supabase-js currently mirrors the API key into Authorization when there
    // is no user session. Keep it only in `apikey`; authenticated user JWTs
    // remain untouched.
    if (
        apiKey?.startsWith("sb_secret_") ||
        (apiKey?.startsWith("sb_publishable_") &&
            authorization === `Bearer ${apiKey}`)
    ) {
        headers.delete("authorization");
    }

    return fetch(input, { ...init, headers });
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { fetch: supabaseFetch },
    auth: isServer
        ? {
              autoRefreshToken: false,
              persistSession: false,
              detectSessionInUrl: false,
          }
        : undefined,
});
