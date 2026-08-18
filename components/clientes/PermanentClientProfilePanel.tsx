// components/clientes/PermanentClientProfilePanel.tsx
"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import ClientPanel from "@/components/clientes/ClientPanel";

const OPEN_CLIENT_PROFILE_EVENT = "client-profile:open";

type OpenClientProfileDetail = {
    clientId: string;
};

let activeClientId: string | null = null;
const clientProfileListeners = new Set<() => void>();

function emitClientProfileChange() {
    for (const listener of clientProfileListeners) listener();
}

function setActiveClientProfile(clientId: string | null) {
    if (activeClientId === clientId) return;
    activeClientId = clientId;
    emitClientProfileChange();
}

export function openClientProfile(clientId: string) {
    if (!clientId || typeof window === "undefined") return;

    setActiveClientProfile(clientId);
    window.dispatchEvent(
        new CustomEvent<OpenClientProfileDetail>(OPEN_CLIENT_PROFILE_EVENT, {
            detail: { clientId },
        }),
    );
}

function subscribeToClientProfile(listener: () => void) {
    clientProfileListeners.add(listener);

    function handleOpen(event: Event) {
        const customEvent = event as CustomEvent<OpenClientProfileDetail>;
        const nextClientId = customEvent.detail?.clientId;
        if (!nextClientId) return;

        activeClientId = nextClientId;
        listener();
    }

    window.addEventListener(OPEN_CLIENT_PROFILE_EVENT, handleOpen);

    return () => {
        clientProfileListeners.delete(listener);
        window.removeEventListener(OPEN_CLIENT_PROFILE_EVENT, handleOpen);
    };
}

function getClientProfileSnapshot() {
    return activeClientId;
}

function getServerClientProfileSnapshot() {
    return null;
}

export default function PermanentClientProfilePanel() {
    const pathname = usePathname();
    const clientId = useSyncExternalStore(
        subscribeToClientProfile,
        getClientProfileSnapshot,
        getServerClientProfileSnapshot,
    );

    useEffect(() => {
        if (pathname !== "/clientes") return;

        const requestedClientId = new URLSearchParams(
            window.location.search,
        ).get("client_id");

        if (requestedClientId) setActiveClientProfile(requestedClientId);
    }, [pathname]);

    const handleClose = useCallback(() => {
        setActiveClientProfile(null);

        if (window.location.pathname !== "/clientes") return;

        const url = new URL(window.location.href);
        if (!url.searchParams.has("client_id")) return;

        url.searchParams.delete("client_id");
        window.history.replaceState(
            {},
            "",
            `${url.pathname}${url.search}${url.hash}`,
        );
    }, []);

    return <ClientPanel clientId={clientId} onClose={handleClose} />;
}
