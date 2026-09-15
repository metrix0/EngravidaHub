"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import DashboardAddControl from "@/components/personal-dashboard/DashboardAddControl";

export default function DashboardWidget({
    widgetId,
    children,
    className = "",
}: {
    widgetId: string;
    children: ReactNode;
    className?: string;
}) {
    const pathname = usePathname();
    const showControl = pathname !== "/";

    return (
        <div className={`group/dashboard-widget relative min-w-0 ${className}`}>
            {children}
            {showControl ? <DashboardAddControl widgetId={widgetId} /> : null}
        </div>
    );
}
