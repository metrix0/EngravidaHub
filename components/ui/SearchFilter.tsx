// components/ui/SearchFilter.tsx
"use client";

import { Search } from "lucide-react";

export function SearchFilter({
    value,
    onChange,
    placeholder = "Buscar por cliente ou telefone...",
    widthClassName = "w-[310px]",
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    widthClassName?: string;
}) {
    return (
        <div
            className={`flex h-11 cursor-text items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-500 shadow-sm transition-colors hover:bg-slate-50 ${widthClassName}`}
        >
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="w-full bg-transparent outline-none placeholder:text-slate-400 focus:outline-none focus-visible:outline-none"
            />

            <Search size={16} className="shrink-0 text-slate-500" />
        </div>
    );
}
