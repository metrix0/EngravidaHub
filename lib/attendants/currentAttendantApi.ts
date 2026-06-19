// lib/attendants/currentAttendantApi.ts
export type CurrentAttendant = {
    id: string;
    name: string;
    email: string | null;
    active: boolean;
    is_online: boolean;
    auth_user_id: string | null;
    units?: {
        id: string;
        name: string;
    } | null;
};

export type CurrentAttendantResponse = {
    ok: boolean;
    debug?: unknown;
    user: {
        id: string;
        email: string | null;
    } | null;
    attendant: CurrentAttendant | null;
};

type CacheRecord = {
    storedAt: number;
    data: CurrentAttendantResponse;
};

type FetchCurrentAttendantOptions = {
    force?: boolean;
    userId?: string | null;
};

const CACHE_KEY = "engravida:current-attendant:v1";
const CACHE_TTL_MS = 30 * 60 * 1000;

let memoryCache: CacheRecord | null = null;
let pendingRequest: Promise<CurrentAttendantResponse> | null = null;

function canUseSessionStorage() {
    return typeof window !== "undefined" && !!window.sessionStorage;
}

function readSessionCache(): CacheRecord | null {
    if (!canUseSessionStorage()) return null;

    try {
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

function setCurrentAttendantCache(data: CurrentAttendantResponse) {
    memoryCache = {
        storedAt: Date.now(),
        data,
    };

    writeSessionCache(memoryCache);
}

function cachedResponseMatchesUser(
    response: CurrentAttendantResponse,
    userId?: string | null,
) {
    if (!userId) return true;
    return response.user?.id === userId;
}

export function getCachedCurrentAttendant(userId?: string | null) {
    if (!memoryCache) {
        memoryCache = readSessionCache();
    }

    if (!memoryCache) return null;

    if (!cachedResponseMatchesUser(memoryCache.data, userId)) {
        return null;
    }

    return memoryCache.data;
}

export function clearCurrentAttendantCache() {
    pendingRequest = null;
    memoryCache = null;
    writeSessionCache(null);
}

export async function fetchCurrentAttendant(
    options: FetchCurrentAttendantOptions = {},
) {
    const { force = false, userId = null } = options;

    if (!memoryCache) {
        memoryCache = readSessionCache();
    }

    const cacheIsFresh =
        memoryCache &&
        Date.now() - memoryCache.storedAt < CACHE_TTL_MS &&
        cachedResponseMatchesUser(memoryCache.data, userId);

    if (!force && cacheIsFresh) {
        return memoryCache!.data;
    }

    if (pendingRequest) {
        return pendingRequest;
    }

    pendingRequest = (async () => {
        const response = await fetch("/api/current-attendant", {
            credentials: "include",
            cache: "no-store",
        });

        const json = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                clearCurrentAttendantCache();
            }

            throw new Error(json.error ?? "Failed to load current attendant");
        }

        const data = json as CurrentAttendantResponse;

        if (!data.user) {
            clearCurrentAttendantCache();
            return data;
        }

        setCurrentAttendantCache(data);
        return data;
    })();

    try {
        return await pendingRequest;
    } finally {
        pendingRequest = null;
    }
}

function updateCachedAttendant(attendant: CurrentAttendant | null) {
    const cached = getCachedCurrentAttendant();
    if (!cached) return;

    setCurrentAttendantCache({
        ...cached,
        attendant,
    });
}

export async function setCurrentAttendantOnline() {
    const response = await fetch("/api/current-attendant/online", {
        method: "POST",
        credentials: "include",
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to set attendant online");
    }

    const result = json as {
        ok: boolean;
        attendant: CurrentAttendant;
    };

    updateCachedAttendant(result.attendant);
    return result;
}

export async function setCurrentAttendantOffline() {
    const response = await fetch("/api/current-attendant/offline", {
        method: "POST",
        credentials: "include",
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to set attendant offline");
    }

    const result = json as {
        ok: boolean;
        attendant: CurrentAttendant | null;
    };

    updateCachedAttendant(result.attendant);
    return result;
}
