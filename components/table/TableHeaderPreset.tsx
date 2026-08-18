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
        <div className="flex flex-col gap-4 border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-bold text-text">
                {title}{" "}
                <span className="text-slate-500">
                    ({count})
                </span>
            </h2>

            <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:flex-nowrap">
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
