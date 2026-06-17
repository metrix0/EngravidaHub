// app/src/components/auth/InviteRedirect.tsx
"use client";

import { useEffect } from "react";

export function InviteRedirect() {
    useEffect(() => {
        if (typeof window === "undefined") return;

        const hash = window.location.hash;

        if (!hash.includes("type=invite")) return;

        window.location.replace(`/login${hash}`);
    }, []);

    return null;
}