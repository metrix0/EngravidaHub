// components/table/DataTableCell.tsx
"use client";

import { type ReactNode } from "react";

type DataTableCellProps = {
    children?: ReactNode;
    className?: string;
    title?: string;
};

export function DataTableCell({
    children,
    className = "",
    title,
}: DataTableCellProps) {
    return (
        <div title={title} className={`min-w-0 ${className}`}>
            {children}
        </div>
    );
}
