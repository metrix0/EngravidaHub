// components/table/DataTableRow.tsx
"use client";

import type { MouseEvent } from "react";

import type { DataTableColumn } from "./DataTable";

type DataTableRowProps<TRow> = {
    row: TRow;
    index: number;
    columns: DataTableColumn<TRow>[];
    gridTemplateColumns: string;
    cardPadding?: boolean;
    rowClassName?: string;
    onClick?: (
        row: TRow,
        index: number,
        event: MouseEvent<HTMLElement>,
    ) => void;
};

export function DataTableRow<TRow,>({
    row,
    index,
    columns,
    gridTemplateColumns,
    onClick,
    cardPadding = false,
    rowClassName,
}: DataTableRowProps<TRow>) {
    const cells = columns.map((column, columnIndex) => (
        <div
            key={column.id}
            className={[
                "min-w-0 max-w-full",
                columnIndex === columns.length - 1 ? "pr-0" : "pr-4",
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
        "group grid w-full items-center border-b border-slate-100 py-3 text-left text-xs font-normal text-slate-600 transition-colors hover:bg-selection/80",
        cardPadding ? "px-4 md:px-6" : "px-3",
        onClick ? "cursor-pointer" : "cursor-default",
        rowClassName,
    ].join(" ");

    if (onClick) {
        return (
            <div
                role="button"
                tabIndex={0}
                onClick={(event) => onClick(row, index, event)}
                onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.currentTarget.click();
                }}
                className={className}
                style={{ gridTemplateColumns }}
            >
                {cells}
            </div>
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
