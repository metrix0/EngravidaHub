import type { ReactNode } from "react";

import Skeleton from "@/components/ui/Skeleton";

type DashboardFilterBarProps = { children: ReactNode; className?: string };
type DashboardFilterBarSkeletonProps = { widths: string[]; className?: string };

export function DashboardFilterBar({ children, className = "" }: DashboardFilterBarProps) {
    return (
        <div className={`mb-8 flex justify-end gap-3 ${className}`.trim()}>
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
