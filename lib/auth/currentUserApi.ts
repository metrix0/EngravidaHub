// lib/auth/currentUserApi.ts
import {
    parseUnitLockCookie,
    UNIT_LOCK_COOKIE_NAME,
    type CurrentUserPermission,
} from "@/lib/auth/userAccess";

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

const EMPTY_CURRENT_USER: CurrentUserResponse = {
    ok: true,
    user: null,
    permission: null,
};

const CACHE_KEY = "engravida:current-user-access:v2";
const OLD_CACHE_KEYS = [
    "engravida:current-user-access:v1",
    "engravida:current-user:v2",
];
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
        for (const oldKey of OLD_CACHE_KEYS) {
            window.sessionStorage.removeItem(oldKey);
        }

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

function readUnitLockCookie() {
    if (typeof document === "undefined") return null;

    const prefix = `${UNIT_LOCK_COOKIE_NAME}=`;
    const raw = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith(prefix))
        ?.slice(prefix.length);

    if (raw === undefined) return null;

    try {
        return parseUnitLockCookie(decodeURIComponent(raw));
    } catch {
        return null;
    }
}

export function applyCurrentUserUnitLockOverride(
    data: CurrentUserResponse | null,
): CurrentUserResponse | null {
    if (!data?.user || !data.permission) return data;

    const cookieLock = readUnitLockCookie();
    if (!cookieLock || cookieLock.userId !== data.user.id) return data;

    const currentLock = data.permission.unit_lock ?? null;

    if (!cookieLock.unitId) {
        if (!currentLock) return data;

        return {
            ...data,
            permission: {
                ...data.permission,
                unit_lock: null,
            },
        };
    }

    if (currentLock?.id === cookieLock.unitId) return data;

    return {
        ...data,
        permission: {
            ...data.permission,
            unit_lock: {
                id: cookieLock.unitId,
                name: "",
                city: "",
            },
        },
    };
}

function emit(data: CurrentUserResponse | null) {
    const effectiveData = applyCurrentUserUnitLockOverride(data);

    for (const listener of listeners) {
        listener(effectiveData);
    }
}

export function getCachedCurrentUser() {
    if (!memoryCache) {
        memoryCache = readSessionCache();
    }

    return applyCurrentUserUnitLockOverride(memoryCache?.data ?? null);
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
        return getCachedCurrentUser()!;
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

        if (response.status === 401) {
            clearCurrentUserCache();
            return EMPTY_CURRENT_USER;
        }

        if (!response.ok) {
            throw new Error(json.error ?? "Failed to load current user");
        }

        const data = json as CurrentUserResponse;

        if (!data.user) {
            clearCurrentUserCache();
            return EMPTY_CURRENT_USER;
        }

        setCurrentUserCache(data);

        return applyCurrentUserUnitLockOverride(data) ?? data;
    })();

    try {
        return await pendingRequest;
    } finally {
        pendingRequest = null;
    }
}
