// components/table/DataTableContext.tsx
"use client";

import { createContext, useContext } from "react";

export type DataTableContextValue = {
    gridTemplateColumns: string;
};

export const DataTableContext = createContext<DataTableContextValue | null>(null);

export function useDataTableContext() {
    const context = useContext(DataTableContext);

    if (!context) {
        throw new Error("DataTableRow must be used inside DataTable");
    }

    return context;
}
