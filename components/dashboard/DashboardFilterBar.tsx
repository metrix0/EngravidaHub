// components/dashboard/DashboardFilterBar.tsx
import type { ReactNode } from "react";

import Skeleton from "@/components/ui/Skeleton";

type DashboardFilterBarProps = { children: ReactNode; className?: string };
type DashboardFilterBarSkeletonProps = { widths: string[]; className?: string };

export function DashboardFilterBar({ children, className = "" }: DashboardFilterBarProps) {
    return (
        <div className={`mb-8 flex flex-wrap justify-start gap-3 md:justify-end ${className}`.trim()}>
            {children}
        </div>
    );
}

export function DashboardFilterBarSkeleton({ widths, className = "" }: DashboardFilterBarSkeletonProps) {
    return (
        <DashboardFilterBar className={className}>
            {widths.map((width, index) => (
                <Skeleton key={`${width}-${index}`} className={`h-11 rounded-xl ${width}`} />
            ))}
        </DashboardFilterBar>
    );
}
