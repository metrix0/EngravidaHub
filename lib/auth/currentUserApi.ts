// lib/auth/currentUserApi.ts
import type { CurrentUserPermission } from "@/lib/auth/userAccess";

export type CurrentAuthUser = {
    id: string;
    email: string | null;
    name: string;
};

export type CurrentUserResponse = {
    ok: boolean;
    user: CurrentAuthUser | null;
    permission: CurrentUserPermission | null;
};

type CacheRecord = {
    storedAt: number;
    data: CurrentUserResponse;
};

type FetchOptions = {
    force?: boolean;
};

const CACHE_KEY = "engravida:current-user-access:v1";
const OLD_CACHE_KEY = "engravida:current-user:v2";
const CACHE_TTL_MS = 30 * 60 * 1000;

let memoryCache: CacheRecord | null = null;
let pendingRequest: Promise<CurrentUserResponse> | null = null;
const listeners = new Set<(data: CurrentUserResponse | null) => void>();

function canUseSessionStorage() {
    return typeof window !== "undefined" && !!window.sessionStorage;
}

function readSessionCache(): CacheRecord | null {
    if (!canUseSessionStorage()) return null;

    try {
        window.sessionStorage.removeItem(OLD_CACHE_KEY);

        const raw = window.sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as CacheRecord;

        if (!parsed?.data || typeof parsed.storedAt !== "number") {
            window.sessionStorage.removeItem(CACHE_KEY);
            return null;
        }

        return parsed;
    } catch {
        window.sessionStorage.removeItem(CACHE_KEY);
        return null;
    }
}

function writeSessionCache(record: CacheRecord | null) {
    if (!canUseSessionStorage()) return;

    if (!record) {
        window.sessionStorage.removeItem(CACHE_KEY);
        return;
    }

    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(record));
}

function emit(data: CurrentUserResponse | null) {
    for (const listener of listeners) {
        listener(data);
    }
}

export function getCachedCurrentUser() {
    if (!memoryCache) {
        memoryCache = readSessionCache();
    }

    return memoryCache?.data ?? null;
}

export function subscribeCurrentUser(
    listener: (data: CurrentUserResponse | null) => void,
) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

export function clearCurrentUserCache() {
    pendingRequest = null;
    memoryCache = null;
    writeSessionCache(null);
    emit(null);
}

function setCurrentUserCache(data: CurrentUserResponse) {
    memoryCache = {
        storedAt: Date.now(),
        data,
    };

    writeSessionCache(memoryCache);
    emit(data);
}

export async function fetchCurrentUser(options: FetchOptions = {}) {
    const { force = false } = options;

    if (!memoryCache) {
        memoryCache = readSessionCache();
    }

    const cacheIsFresh =
        memoryCache && Date.now() - memoryCache.storedAt < CACHE_TTL_MS;

    if (!force && cacheIsFresh) {
        return memoryCache!.data;
    }

    if (pendingRequest) {
        return pendingRequest;
    }

    pendingRequest = (async () => {
        const response = await fetch("/api/current-user", {
            credentials: "include",
            cache: "no-store",
        });

        const json = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                clearCurrentUserCache();
            }

            throw new Error(json.error ?? "Failed to load current user");
        }

        const data = json as CurrentUserResponse;
        setCurrentUserCache(data);

        return data;
    })();

    try {
        return await pendingRequest;
    } finally {
        pendingRequest = null;
    }
}
