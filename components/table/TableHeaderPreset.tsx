// components/table/TableHeaderPreset.tsx
"use client";

import type { ReactNode } from "react";

import { SearchFilter } from "@/components/ui/SearchFilter";

type TableHeaderPresetProps = {
    title: string;
    count: number;
    searchValue: string;
    onSearchChange: (value: string) => void;
    searchPlaceholder?: string;
    searchWidthClassName?: string;
    children?: ReactNode;
};

export function TableHeaderPreset({
    title,
    count,
    searchValue,
    onSearchChange,
    searchPlaceholder = "Buscar por cliente ou telefone...",
    searchWidthClassName = "w-[310px]",
    children,
}: TableHeaderPresetProps) {
    return (
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-bold text-text">
                {title}{" "}
                <span className="text-slate-500">
                    ({count})
                </span>
            </h2>

            <div className="flex items-center gap-3">
                <SearchFilter
                    value={searchValue}
                    onChange={onSearchChange}
                    placeholder={searchPlaceholder}
                    widthClassName={searchWidthClassName}
                />

                {children}
            </div>
        </div>
    );
}
