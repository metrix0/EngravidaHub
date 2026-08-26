"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

const DASHBOARD_PATH = "/";
const EXECUTIVE_API_PATH = "/api/dashboard/executivo";
const RESILIENT_API_PATH = "/api/dashboard/executivo-resilient";
const CACHE_PREFIX = "engravida-hub:executive-dashboard:v1:";
const STALE_CACHE_MS = 30 * 60 * 1000;

type CachedDashboardResponse = {
    body: string;
    savedAt: number;
};

export default function DashboardRuntimeGuard({
    children,
}: {
    children: ReactNode;
}) {
    const pathname = usePathname() || "/";
    const [ready, setReady] = useState(pathname !== DASHBOARD_PATH);

    useEffect(() => {
        if (pathname !== DASHBOARD_PATH) {
            setReady(true);
            return;
        }

        const originalFetch = window.fetch.bind(window);

        const guardedFetch: typeof window.fetch = async (input, init) => {
            const requestUrl = resolveRequestUrl(input);
            if (!requestUrl || !isExecutiveDashboardRequest(requestUrl)) {
                return originalFetch(input, init);
            }

            const resilientUrl = new URL(RESILIENT_API_PATH, window.location.origin);
            resilientUrl.search = requestUrl.search;
            const cacheKey = `${CACHE_PREFIX}${resilientUrl.search}`;

            try {
                const response = await originalFetch(resilientUrl.toString(), {
                    ...init,
                    cache: "default",
                });

                if (response.ok) {
                    void persistSuccessfulResponse(cacheKey, response.clone());
                    return response;
                }

                const cachedResponse = readCachedResponse(cacheKey);
                if (cachedResponse) return cachedResponse;
                return response;
            } catch (error) {
                const cachedResponse = readCachedResponse(cacheKey);
                if (cachedResponse) return cachedResponse;
                throw error;
            }
        };

        window.fetch = guardedFetch;
        setReady(true);

        return () => {
            if (window.fetch === guardedFetch) {
                window.fetch = originalFetch;
            }
        };
    }, [pathname]);

    if (pathname === DASHBOARD_PATH && !ready) {
        return <div className="h-full min-h-dvh w-full bg-white" />;
    }

    return children;
}

function resolveRequestUrl(input: RequestInfo | URL) {
    try {
        if (typeof input === "string") {
            return new URL(input, window.location.origin);
        }
        if (input instanceof URL) return input;
        return new URL(input.url, window.location.origin);
    } catch {
        return null;
    }
}

function isExecutiveDashboardRequest(url: URL) {
    return (
        url.origin === window.location.origin &&
        url.pathname === EXECUTIVE_API_PATH &&
        url.searchParams.get("section") !== "word_map"
    );
}

async function persistSuccessfulResponse(cacheKey: string, response: Response) {
    try {
        const body = await response.text();
        const value: CachedDashboardResponse = {
            body,
            savedAt: Date.now(),
        };
        window.localStorage.setItem(cacheKey, JSON.stringify(value));
    } catch (error) {
        console.warn("[dashboard] failed to persist last successful response", error);
    }
}

function readCachedResponse(cacheKey: string) {
    try {
        const rawValue = window.localStorage.getItem(cacheKey);
        if (!rawValue) return null;

        const value = JSON.parse(rawValue) as Partial<CachedDashboardResponse>;
        if (
            typeof value.body !== "string" ||
            typeof value.savedAt !== "number" ||
            Date.now() - value.savedAt > STALE_CACHE_MS
        ) {
            window.localStorage.removeItem(cacheKey);
            return null;
        }

        return new Response(value.body, {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "X-Dashboard-Fallback": "stale-success",
            },
        });
    } catch (error) {
        console.warn("[dashboard] failed to read last successful response", error);
        return null;
    }
}
