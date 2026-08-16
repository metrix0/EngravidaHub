// components/clientes/PermanentClientProfilePanel.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import ClientPanel from "@/components/clientes/ClientPanel";

const OPEN_CLIENT_PROFILE_EVENT = "client-profile:open";

type OpenClientProfileDetail = {
    clientId: string;
};

export function openClientProfile(clientId: string) {
    if (!clientId || typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent<OpenClientProfileDetail>(OPEN_CLIENT_PROFILE_EVENT, {
            detail: { clientId },
        }),
    );
}

export default function PermanentClientProfilePanel() {
    const pathname = usePathname();
    const [clientId, setClientId] = useState<string | null>(null);

    useEffect(() => {
        function handleOpen(event: Event) {
            const customEvent = event as CustomEvent<OpenClientProfileDetail>;
            const nextClientId = customEvent.detail?.clientId;

            if (nextClientId) setClientId(nextClientId);
        }

        window.addEventListener(OPEN_CLIENT_PROFILE_EVENT, handleOpen);
        return () =>
            window.removeEventListener(OPEN_CLIENT_PROFILE_EVENT, handleOpen);
    }, []);

    useEffect(() => {
        if (pathname !== "/clientes") return;

        const requestedClientId = new URLSearchParams(
            window.location.search,
        ).get("client_id");

        if (requestedClientId) setClientId(requestedClientId);
    }, [pathname]);

    const handleClose = useCallback(() => {
        setClientId(null);

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
