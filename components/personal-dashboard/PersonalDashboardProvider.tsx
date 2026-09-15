"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

type DashboardPayload = {
    widget_ids: string[];
    preset: string;
    version: number;
    error?: string;
};

type DashboardStatus = "idle" | "loading" | "ready" | "error";

type PersonalDashboardContextValue = {
    widget_ids: string[];
    preset: string | null;
    version: number;
    status: DashboardStatus;
    saving: boolean;
    ensureLoaded: () => Promise<void>;
    addWidget: (widgetId: string) => Promise<void>;
    removeWidget: (widgetId: string) => Promise<void>;
    reorderWidgets: (widgetIds: string[]) => Promise<void>;
    hasWidget: (widgetId: string) => boolean;
};

const PersonalDashboardContext = createContext<PersonalDashboardContextValue | null>(null);

export function PersonalDashboardProvider({ children }: { children: ReactNode }) {
    const [widgetIds, setWidgetIds] = useState<string[]>([]);
    const [preset, setPreset] = useState<string | null>(null);
    const [version, setVersion] = useState(0);
    const [status, setStatus] = useState<DashboardStatus>("idle");
    const [saving, setSaving] = useState(false);
    const loadPromiseRef = useRef<Promise<void> | null>(null);
    const widgetIdsRef = useRef<string[]>([]);
    const versionRef = useRef(0);
    const statusRef = useRef<DashboardStatus>("idle");

    const applyPayload = useCallback((payload: DashboardPayload) => {
        const nextIds = payload.widget_ids ?? [];
        const nextVersion = payload.version ?? 0;
        widgetIdsRef.current = nextIds;
        versionRef.current = nextVersion;
        statusRef.current = "ready";
        setWidgetIds(nextIds);
        setPreset(payload.preset ?? null);
        setVersion(nextVersion);
        setStatus("ready");
    }, []);

    const ensureLoaded = useCallback(async () => {
        if (statusRef.current === "ready") return;
        if (loadPromiseRef.current) return loadPromiseRef.current;

        const promise = (async () => {
            statusRef.current = "loading";
            setStatus("loading");
            try {
                const response = await fetch("/api/personal-dashboard", {
                    cache: "no-store",
                    credentials: "include",
                });
                const payload = (await response.json()) as DashboardPayload;
                if (!response.ok) {
                    throw new Error(payload.error ?? "Não foi possível carregar o dashboard.");
                }
                applyPayload(payload);
            } catch (error) {
                console.error("[personal-dashboard] load failed", error);
                statusRef.current = "error";
                setStatus("error");
                throw error;
            } finally {
                loadPromiseRef.current = null;
            }
        })();

        loadPromiseRef.current = promise;
        return promise;
    }, [applyPayload]);

    const save = useCallback(
        async (nextIds: string[], retry = true) => {
            setSaving(true);
            try {
                const response = await fetch("/api/personal-dashboard", {
                    method: "PUT",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        widget_ids: nextIds,
                        version: versionRef.current,
                    }),
                });
                const payload = (await response.json()) as DashboardPayload;

                if (response.status === 409 && retry) {
                    applyPayload(payload);
                    const retryResponse = await fetch("/api/personal-dashboard", {
                        method: "PUT",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            widget_ids: nextIds,
                            version: versionRef.current,
                        }),
                    });
                    const retryPayload = (await retryResponse.json()) as DashboardPayload;
                    if (!retryResponse.ok) {
                        throw new Error(
                            retryPayload.error ?? "Não foi possível salvar o dashboard.",
                        );
                    }
                    applyPayload(retryPayload);
                    return;
                }

                if (!response.ok) {
                    throw new Error(payload.error ?? "Não foi possível salvar o dashboard.");
                }
                applyPayload(payload);
            } finally {
                setSaving(false);
            }
        },
        [applyPayload],
    );

    const addWidget = useCallback(
        async (widgetId: string) => {
            await ensureLoaded();
            const current = widgetIdsRef.current;
            if (current.includes(widgetId)) return;
            await save([...current, widgetId]);
        },
        [ensureLoaded, save],
    );

    const removeWidget = useCallback(
        async (widgetId: string) => {
            await ensureLoaded();
            await save(widgetIdsRef.current.filter((id) => id !== widgetId));
        },
        [ensureLoaded, save],
    );

    const reorderWidgets = useCallback(
        async (nextIds: string[]) => {
            await ensureLoaded();
            await save([...new Set(nextIds)]);
        },
        [ensureLoaded, save],
    );

    const value = useMemo<PersonalDashboardContextValue>(
        () => ({
            widget_ids: widgetIds,
            preset,
            version,
            status,
            saving,
            ensureLoaded,
            addWidget,
            removeWidget,
            reorderWidgets,
            hasWidget: (widgetId) => widgetIds.includes(widgetId),
        }),
        [
            addWidget,
            ensureLoaded,
            preset,
            removeWidget,
            reorderWidgets,
            saving,
            status,
            version,
            widgetIds,
        ],
    );

    return (
        <PersonalDashboardContext.Provider value={value}>
            {children}
        </PersonalDashboardContext.Provider>
    );
}

export function usePersonalDashboard() {
    const context = useContext(PersonalDashboardContext);
    if (!context) {
        throw new Error("usePersonalDashboard must be used inside PersonalDashboardProvider");
    }
    return context;
}
