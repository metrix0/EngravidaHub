// components/table/DataTable.tsx
"use client";

import type { ReactNode } from "react";

import { DataTableRow } from "./DataTableRow";

export type DataTableColumn<TRow> = {
    id: string;
    label: ReactNode;
    width: `${number}%`;
    align?: "left" | "center" | "right";
    className?: string;
    headerClassName?: string;
    render: (row: TRow, index: number) => ReactNode;
};

type DataTableProps<TRow> = {
    columns: DataTableColumn<TRow>[];
    rows: TRow[];
    getRowKey: (row: TRow, index: number) => string;
    onRowClick?: (row: TRow, index: number) => void;
    emptyMessage?: string;
};

export function DataTable<TRow,>({
    columns,
    rows,
    getRowKey,
    onRowClick,
    emptyMessage = "Nenhum item encontrado.",
}: DataTableProps<TRow>) {
    const gridTemplateColumns = columns
        .map((column) => `minmax(0, ${column.width})`)
        .join(" ");

    return (
        <div className="overflow-hidden">
            <div
                className="grid border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-bold text-slate-500"
                style={{ gridTemplateColumns }}
            >
                {columns.map((column) => (
                    <div
                        key={column.id}
                        className={[
                            "min-w-0 truncate",
                            getAlignClass(column.align),
                            column.headerClassName,
                        ]
                            .filter(Boolean)
                            .join(" ")}
                    >
                        {column.label}
                    </div>
                ))}
            </div>

            {rows.length > 0 ? (
                rows.map((row, index) => (
                    <DataTableRow
                        key={getRowKey(row, index)}
                        row={row}
                        index={index}
                        columns={columns}
                        gridTemplateColumns={gridTemplateColumns}
                        onClick={onRowClick}
                    />
                ))
            ) : (
                <div className="border-b border-slate-100 px-6 py-8 text-center text-sm text-slate-500">
                    {emptyMessage}
                </div>
            )}
        </div>
    );
}

function getAlignClass(align: DataTableColumn<unknown>["align"]) {
    if (align === "center") return "text-center";
    if (align === "right") return "text-right";
    return "text-left";
}
