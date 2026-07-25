// components/dashboard/DashboardDateFilterProvider.tsx
"use client";

import {
    createContext,
    useContext,
    type ReactNode,
} from "react";

import type { StoredDashboardDateFilterMap } from "@/lib/dashboard/dateFilterStorage";

const DashboardDateFilterContext =
    createContext<StoredDashboardDateFilterMap>({});

export function DashboardDateFilterProvider({
    initialFilters,
    children,
}: {
    initialFilters: StoredDashboardDateFilterMap;
    children: ReactNode;
}) {
    return (
        <DashboardDateFilterContext.Provider value={initialFilters}>
            {children}
        </DashboardDateFilterContext.Provider>
    );
}

export function useServerDashboardDateFilters() {
    return useContext(DashboardDateFilterContext);
}
