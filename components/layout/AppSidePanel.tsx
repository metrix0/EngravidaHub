// components/layout/AppSidePanel.tsx
"use client";

import { usePathname } from "next/navigation";

import SidePanel from "@/components/layout/SidePanel";

export default function AppSidePanel() {
    const pathname = usePathname();

    if (pathname === "/registrar" || pathname.startsWith("/registrar/")) {
        return null;
    }

    return <SidePanel persistent />;
}
