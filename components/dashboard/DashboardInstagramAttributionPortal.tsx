"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

import InstagramAdAttributionInsights from "@/components/dashboard/InstagramAdAttributionInsights";

const INSTAGRAM_HEADING = "Análise das conversas do Instagram";

export default function DashboardInstagramAttributionPortal() {
    const pathname = usePathname();
    const [host, setHost] = useState<HTMLDivElement | null>(null);
    const [searchParams, setSearchParams] = useState("");

    useEffect(() => {
        if (pathname !== "/") {
            setHost(null);
            return;
        }

        let currentHost: HTMLDivElement | null = null;

        const syncSearch = () => {
            const next = window.location.search.replace(/^\?/, "");
            setSearchParams((current) => (current === next ? current : next));
        };

        const install = () => {
            syncSearch();
            if (currentHost?.isConnected) return;

            const root = document.querySelector<HTMLElement>(".app-content > main");
            if (!root) return;

            const heading = [...root.querySelectorAll<HTMLElement>("h1, h2, h3")].find(
                (element) => element.textContent?.trim() === INSTAGRAM_HEADING,
            );
            const section = heading?.closest<HTMLElement>(
                "section.mt-6.min-w-0.max-w-full",
            );
            const headerBlock = heading?.closest<HTMLElement>("div.px-1");
            if (!section || !headerBlock) return;

            currentHost?.remove();
            currentHost = document.createElement("div");
            currentHost.dataset.instagramAdAttribution = "true";
            headerBlock.insertAdjacentElement("afterend", currentHost);
            setHost(currentHost);
        };

        install();

        const observer = new MutationObserver(install);
        observer.observe(document.body, { childList: true, subtree: true });
        const intervalId = window.setInterval(syncSearch, 500);

        return () => {
            observer.disconnect();
            window.clearInterval(intervalId);
            currentHost?.remove();
            setHost(null);
        };
    }, [pathname]);

    if (pathname !== "/" || !host) return null;

    return createPortal(
        <InstagramAdAttributionInsights searchParams={searchParams} />,
        host,
    );
}
