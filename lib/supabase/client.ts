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

const supabaseFetch: typeof fetch = async (input, init) => {
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

    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const target = supabaseRequestTarget(input);
    const shouldLogTiming = isServer && process.env.SERVER_LOADING_LOGS !== "false";
    const startedAt = performance.now();

    if (shouldLogTiming) {
        console.info(`[loading:supabase] ${method} ${target} · iniciado`);
    }

    try {
        const response = await fetch(input, { ...init, headers });

        if (shouldLogTiming) {
            console.info(
                `[loading:supabase] ${method} ${target} · ${response.status} · ${Math.round(performance.now() - startedAt)} ms`,
            );
        }

        return response;
    } catch (error) {
        if (shouldLogTiming) {
            console.error(
                `[loading:supabase] ${method} ${target} · falhou após ${Math.round(performance.now() - startedAt)} ms`,
                error,
            );
        }

        throw error;
    }
};

function supabaseRequestTarget(input: RequestInfo | URL) {
    try {
        const rawUrl = input instanceof Request ? input.url : String(input);
        const url = new URL(rawUrl);
        const segments = url.pathname.split("/").filter(Boolean);
        const apiIndex = segments.findIndex((segment) => segment === "v1");
        const resource = apiIndex >= 0
            ? segments.slice(apiIndex + 1, apiIndex + 3).join("/")
            : segments.slice(-2).join("/");

        return resource || url.pathname;
    } catch {
        return "request";
    }
}

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
