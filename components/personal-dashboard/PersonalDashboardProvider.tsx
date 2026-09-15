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

    const applyPayload = useCallback((payload: DashboardPayload) => {
        setWidgetIds(payload.widget_ids ?? []);
        setPreset(payload.preset ?? null);
        setVersion(payload.version ?? 0);
        setStatus("ready");
    }, []);

    const ensureLoaded = useCallback(async () => {
        if (status === "ready") return;
        if (loadPromiseRef.current) return loadPromiseRef.current;

        const promise = (async () => {
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
                setStatus("error");
            } finally {
                loadPromiseRef.current = null;
            }
        })();

        loadPromiseRef.current = promise;
        return promise;
    }, [applyPayload, status]);

    const save = useCallback(
        async (nextIds: string[], retry = true) => {
            setSaving(true);
            try {
                const response = await fetch("/api/personal-dashboard", {
                    method: "PUT",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ widget_ids: nextIds, version }),
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
                            version: payload.version,
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
            } catch (error) {
                console.error("[personal-dashboard] save failed", error);
                throw error;
            } finally {
                setSaving(false);
            }
        },
        [applyPayload, version],
    );

    const addWidget = useCallback(
        async (widgetId: string) => {
            await ensureLoaded();
            if (widgetIds.includes(widgetId)) return;
            await save([...widgetIds, widgetId]);
        },
        [ensureLoaded, save, widgetIds],
    );

    const removeWidget = useCallback(
        async (widgetId: string) => {
            await ensureLoaded();
            await save(widgetIds.filter((id) => id !== widgetId));
        },
        [ensureLoaded, save, widgetIds],
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
