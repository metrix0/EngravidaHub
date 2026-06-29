// components/ui/DropdownSelect.tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";

export type DropdownSelectOption = {
    label: string;
    value: string;
    description?: string;
};

type DropdownSelectProps = {
    value: string;
    onChange: (value: string) => void;
    options: DropdownSelectOption[];
    placeholder?: string;
    icon?: ReactNode;
    disabled?: boolean;
    widthClassName?: string;
    dropdownWidthClassName?: string;
    searchable?: boolean;
    searchValue?: string;
    onSearchChange?: (value: string) => void;
    searchPlaceholder?: string;
    loading?: boolean;
    loadingLabel?: string;
    emptyLabel?: string;
    invalid?: boolean;
};

export function DropdownSelect({
    value,
    onChange,
    options,
    placeholder = "Selecionar",
    icon,
    disabled = false,
    widthClassName = "w-[240px]",
    dropdownWidthClassName = "w-full",
    searchable = false,
    searchValue = "",
    onSearchChange,
    searchPlaceholder = "Buscar",
    loading = false,
    loadingLabel = "Carregando...",
    emptyLabel = "Nenhuma opção encontrada.",
    invalid = false,
}: DropdownSelectProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);

    const selectedOption = options.find((option) => option.value === value);
    const displayLabel = selectedOption?.label ?? placeholder;

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (!wrapperRef.current) return;

            if (!wrapperRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }

        if (open) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [open]);

    function selectValue(nextValue: string) {
        onChange(nextValue);
        setOpen(false);
    }

    return (
        <div ref={wrapperRef} className={`relative inline-block ${widthClassName}`}>
            {searchable ? (
                <div className={`flex h-11 w-full items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition ${invalid ? "border-red" : "border-border focus-within:border-brand"}`}>
                    {icon}
                    <input
                        value={searchValue}
                        disabled={disabled}
                        autoComplete="off"
                        placeholder={searchPlaceholder}
                        onFocus={() => setOpen(true)}
                        onChange={(event) => {
                            onSearchChange?.(event.target.value);
                            setOpen(true);
                        }}
                        className="min-w-0 flex-1 bg-transparent font-medium text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                    />
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setOpen((current) => !current)}
                        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed"
                        aria-label={open ? "Fechar opções" : "Abrir opções"}
                    >
                        <ChevronDown
                            size={16}
                            className={`transition-transform duration-150 ${
                                open ? "rotate-180" : "rotate-0"
                            }`}
                        />
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setOpen((current) => !current)}
                    className={`flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm outline-none transition hover:bg-selection disabled:cursor-not-allowed disabled:opacity-60 ${invalid ? "border-red" : "border-border"}`}
                >
                    <span className="flex min-w-0 items-center gap-2">
                        {icon}
                        <span className="truncate">{displayLabel}</span>
                    </span>

                    <ChevronDown
                        size={16}
                        className={`shrink-0 transition-transform duration-150 ${
                            open ? "rotate-180" : "rotate-0"
                        }`}
                    />
                </button>
            )}

            <div
                className={`absolute right-0 z-50 mt-2 origin-top overflow-hidden rounded-xl border border-border bg-card shadow-lg transition-all duration-150 ${dropdownWidthClassName} ${
                    open
                        ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                        : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0"
                }`}
            >
                <div className="max-h-72 overflow-y-auto py-1">
                    {loading ? (
                        <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-muted">
                            <LoaderCircle size={15} className="animate-spin" />
                            {loadingLabel}
                        </div>
                    ) : options.length === 0 ? (
                        <div className="px-4 py-3 text-sm font-medium text-slate-400">
                            {emptyLabel}
                        </div>
                    ) : (
                        options.map((option) => {
                            const selected = option.value === value;

                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => selectValue(option.value)}
                                    className={`flex w-full cursor-pointer flex-col items-start px-4 py-2.5 text-left transition hover:bg-slate-50 ${
                                        selected ? "text-brand" : "text-muted"
                                    }`}
                                >
                                    <span className="w-full truncate text-sm font-medium">
                                        {option.label}
                                    </span>
                                    {option.description ? (
                                        <span className="mt-0.5 w-full truncate text-xs font-normal text-slate-400">
                                            {option.description}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}

function DropdownSelectDemo() {
    const [value, setValue] = useState("gestor");

    return (
        <DropdownSelect
            value={value}
            onChange={setValue}
            options={[
                { label: "Admin", value: "admin" },
                { label: "Gestor", value: "gestor" },
                { label: "Atendente", value: "atendente" },
            ]}
        />
    );
}

export const __uiDemo = {
    element: <DropdownSelectDemo />,
    code: `<DropdownSelect
  value={value}
  onChange={setValue}
  options={options}
/>`,
};
