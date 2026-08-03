// lib/supabase/authAdmin.ts
import type { User } from "@supabase/supabase-js";

type AuthUsersResponse = {
    users?: unknown;
    message?: unknown;
    msg?: unknown;
    error?: unknown;
};

const AUTH_USERS_CACHE_MS = 60_000;
const authUsersCache = new Map<
    string,
    { users: User[]; expiresAt: number }
>();
const authUsersRequests = new Map<string, Promise<User[]>>();

export async function listAuthUsers({
    page = 1,
    perPage = 1_000,
}: {
    page?: number;
    perPage?: number;
} = {}): Promise<User[]> {
    if (typeof window !== "undefined") {
        throw new Error("Auth Admin can only run on the server");
    }

    const cacheKey = `${page}:${perPage}`;
    const cached = authUsersCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.users;

    const activeRequest = authUsersRequests.get(cacheKey);
    if (activeRequest) return activeRequest;

    const request = fetchAuthUsers({ page, perPage })
        .then((users) => {
            authUsersCache.set(cacheKey, {
                users,
                expiresAt: Date.now() + AUTH_USERS_CACHE_MS,
            });
            return users;
        })
        .catch((error) => {
            const stale = authUsersCache.get(cacheKey);
            if (stale) return stale.users;
            throw error;
        })
        .finally(() => {
            authUsersRequests.delete(cacheKey);
        });

    authUsersRequests.set(cacheKey, request);
    return request;
}

async function fetchAuthUsers({
    page,
    perPage,
}: {
    page: number;
    perPage: number;
}) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !adminKey) {
        throw new Error("Missing Supabase Auth Admin configuration");
    }

    if (adminKey.startsWith("sb_publishable_")) {
        throw new Error("Supabase Auth Admin requires a secret key");
    }

    const url = new URL("/auth/v1/admin/users", supabaseUrl);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));

    const headers = new Headers({ apikey: adminKey });

    // Modern `sb_secret_` keys are API keys, not JWTs. Sending one as a
    // Bearer token makes Auth try to verify it as a user JWT. Legacy
    // `service_role` JWTs still require the Authorization header.
    if (!adminKey.startsWith("sb_secret_")) {
        headers.set("Authorization", `Bearer ${adminKey}`);
    }

    const response = await fetch(url, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
    });
    const body = await readJson(response);

    if (response.ok && Array.isArray(body.users)) {
        return body.users as User[];
    }

    throw new Error(
        response.ok
            ? "Supabase Auth Admin returned an invalid user list"
            : readAuthAdminError(body, response.status),
    );
}

async function readJson(response: Response): Promise<AuthUsersResponse> {
    try {
        return (await response.json()) as AuthUsersResponse;
    } catch {
        return {};
    }
}

function readAuthAdminError(body: AuthUsersResponse, status: number) {
    for (const value of [body.message, body.msg, body.error]) {
        if (typeof value === "string" && value.trim()) return value.trim();

        if (
            value &&
            typeof value === "object" &&
            "message" in value &&
            typeof value.message === "string" &&
            value.message.trim()
        ) {
            return value.message.trim();
        }
    }

    return `Supabase Auth Admin failed (${status})`;
}
