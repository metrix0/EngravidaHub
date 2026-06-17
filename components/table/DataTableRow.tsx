// components/table/DataTableRow.tsx
"use client";

import type { DataTableColumn } from "./DataTable";

type DataTableRowProps<TRow> = {
    row: TRow;
    index: number;
    columns: DataTableColumn<TRow>[];
    gridTemplateColumns: string;
    onClick?: (row: TRow, index: number) => void;
};

export function DataTableRow<TRow,>({
    row,
    index,
    columns,
    gridTemplateColumns,
    onClick,
}: DataTableRowProps<TRow>) {
    const cells = columns.map((column) => (
        <div
            key={column.id}
            className={[
                "min-w-0",
                getCellAlignClass(column.align),
                column.className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {column.render(row, index)}
        </div>
    ));

    const className = [
        "group grid w-full items-center border-b border-slate-100 px-6 py-4 text-left text-sm text-text transition-colors hover:bg-selection/80",
        onClick ? "cursor-pointer" : "cursor-default",
    ].join(" ");

    if (onClick) {
        return (
            <button
                type="button"
                onClick={() => onClick(row, index)}
                className={className}
                style={{ gridTemplateColumns }}
            >
                {cells}
            </button>
        );
    }

    return (
        <div className={className} style={{ gridTemplateColumns }}>
            {cells}
        </div>
    );
}

function getCellAlignClass(align: DataTableColumn<unknown>["align"]) {
    if (align === "center") return "text-center";
    if (align === "right") return "text-right";
    return "text-left";
}
