// components/ui/FilterButton.tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Crosshair, MapPin } from "lucide-react";
import { SearchFilter } from "./SearchFilter";

export type FilterOption = {
    label: string;
    value: string;
};

export type FilterButtonProps = {
    icon?: ReactNode;
    label: string;
    options?: FilterOption[];
    values?: string[];
    onChange?: (values: string[]) => void;
    widthClassName?: string;
    disabled?: boolean;
    singleSelect?: boolean;
    searchable?: boolean;
    searchPlaceholder?: string;
    explicitSelection?: boolean;
    dynamic?: boolean;
};

export default function FilterButton({
                                         icon,
                                         label,
                                         options = [],
                                         values,
                                         onChange,
                                         widthClassName = "w-[220px]",
                                         disabled = false,
                                         singleSelect = false,
                                         searchable = false,
                                         searchPlaceholder = "Buscar",
                                         explicitSelection = false,
                                         dynamic = false,
                                     }: FilterButtonProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    const isControlled = values !== undefined;
    const [internalValues, setInternalValues] = useState<string[]>([]);
    const appliedValues = isControlled ? values : internalValues;

    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [menuSpace, setMenuSpace] = useState<{ above: boolean; height: number } | null>(null);
    const [draftValues, setDraftValues] = useState<string[]>(appliedValues);

    const allOptionValues = options.map((option) => option.value);
    const dropdownOptions = singleSelect ? [{ label, value: "" }, ...options] : options;
    const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const visibleOptions = searchable && search.trim()
        ? dropdownOptions.filter((option) => normalizeSearch(option.label).includes(normalizeSearch(search)))
        : dropdownOptions;

    const allApplied =
        (!explicitSelection && appliedValues.length === 0) || (!singleSelect && allOptionValues.length > 0 && appliedValues.length === allOptionValues.length);

    const allDraftSelected =
        !singleSelect && ((!explicitSelection && draftValues.length === 0) || (allOptionValues.length > 0 && draftValues.length === allOptionValues.length));

    const displayLabel = allApplied
        ? label
        : explicitSelection && appliedValues.length === 0
            ? "Nenhum selecionado"
            : appliedValues.length === 1
            ? options.find((option) => option.value === appliedValues[0])?.label ?? label
            : `${appliedValues.length} selecionados`;

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

    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    useLayoutEffect(() => {
        if (!dynamic || !open) return;
        function updateMenuSpace() {
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (!rect) return;
            const below = window.innerHeight - rect.bottom - 20;
            const above = rect.top - 20;
            const overhead = (searchable ? 65 : 0) + (singleSelect ? 0 : 54);
            const openAbove = below < 288 + overhead && above > below;
            setMenuSpace({ above: openAbove, height: Math.max(48, Math.min(288, Math.floor((openAbove ? above : below) - overhead))) });
        }
        updateMenuSpace();
        window.addEventListener("resize", updateMenuSpace);
        window.addEventListener("scroll", updateMenuSpace, true);
        return () => {
            window.removeEventListener("resize", updateMenuSpace);
            window.removeEventListener("scroll", updateMenuSpace, true);
        };
    }, [dynamic, open, searchable, singleSelect]);

    function updateAppliedValues(nextValues: string[]) {
        if (!isControlled) {
            setInternalValues(nextValues);
        }

        onChange?.(nextValues);
    }

    function handleToggleOpen() {
        if (disabled) return;

        if (!open) {
            if (searchable) setSearch("");
            setDraftValues(
                singleSelect
                    ? [...appliedValues]
                    : !explicitSelection && appliedValues.length === 0
                        ? allOptionValues
                        : [...appliedValues],
            );
        }
        setOpen((current) => !current);
    }

    function toggleOption(value: string) {
        if (singleSelect) {
            updateAppliedValues(!value || appliedValues.includes(value) ? [] : [value]);
            setOpen(false);
            return;
        }

        const normalizedValues = allDraftSelected ? allOptionValues : draftValues;

        if (normalizedValues.includes(value)) {
            setDraftValues(normalizedValues.filter((item) => item !== value));
            return;
        }

        setDraftValues([...normalizedValues, value]);
    }

    function selectAllDraft() {
        if (singleSelect) {
            updateAppliedValues([]);
            setOpen(false);
            return;
        }
        setDraftValues(allOptionValues);
    }

    function selectOnlyDraft(value: string) {
        setDraftValues([value]);
    }

    function applySelection() {
        if (!explicitSelection && (draftValues.length === 0 || draftValues.length === allOptionValues.length)) {
            updateAppliedValues([]);
        } else {
            updateAppliedValues(draftValues);
        }

        setOpen(false);
    }

    return (
        <div ref={wrapperRef} className={`relative inline-block max-w-full ${widthClassName}`}>
            <button
                type="button"
                disabled={disabled}
                onClick={handleToggleOpen}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
                    disabled
                        ? "cursor-default"
                        : "cursor-pointer hover:bg-selection"
                }`}
                style={{borderColor: "var(--color-border)",
                    color: "var(--color-muted)",
                }}
            >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
            <span className="truncate">{displayLabel}</span>
        </span>

                {!disabled && (
                    <ChevronDown
                        size={16}
                        className={`shrink-0 transition-transform duration-150 ${
                            open ? "rotate-180" : "rotate-0"
                        }`}
                    />
                )}
            </button>

            <div
                className={`absolute right-0 z-50 w-full overflow-hidden rounded-xl border shadow-lg transition-all duration-150 ${dynamic && menuSpace?.above ? "bottom-full mb-2 origin-bottom" : "mt-2 origin-top"} ${
                    open
                        ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                        : "pointer-events-none -translate-y-1 scale-98 opacity-0"
                }`}
                style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-card)",
                }}
            >
                {searchable && (
                    <div className="p-2" onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}>
                        {open && <SearchFilter value={search} onChange={setSearch} placeholder={searchPlaceholder} widthClassName="w-full" />}
                    </div>
                )}
                <div className="max-h-72 overflow-y-auto py-1" style={dynamic && menuSpace ? { maxHeight: menuSpace.height } : undefined}>
                    {searchable && visibleOptions.length === 0 && (
                        <div className="px-4 py-3 text-sm font-medium text-slate-400">Nenhuma opção encontrada.</div>
                    )}
                    {visibleOptions.map((option) => {
                        const selected = singleSelect
                            ? option.value === "" ? appliedValues.length === 0 : appliedValues.includes(option.value)
                            : allDraftSelected || draftValues.includes(option.value);

                        return (
                            <div
                                key={option.value}
                                className="group flex items-center transition hover:bg-slate-50"
                            >
                                <button
                                    type="button"
                                    onClick={() => toggleOption(option.value)}
                                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm"
                                    style={{
                                        color: selected ? "var(--color-brand)" : "var(--color-muted)",
                                    }}
                                >
                                    {!singleSelect && (
                                        <span
                                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                                            style={{
                                                borderColor: selected
                                                    ? "var(--color-brand)"
                                                    : "var(--color-border)",
                                                backgroundColor: selected
                                                    ? "var(--color-brand)"
                                                    : "transparent",
                                            }}
                                        >
                                            {selected && <Check size={12} className="text-white" />}
                                        </span>
                                    )}

                                    <span className="truncate">{option.label}</span>
                                </button>

                                {!singleSelect && <button
                                    type="button"
                                    onClick={() => selectOnlyDraft(option.value)}
                                    className="mr-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 opacity-100 transition hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                                    title="Selecionar apenas esta"
                                    aria-label={`Selecionar apenas ${option.label}`}
                                >
                                    <Crosshair size={14} />
                                </button>}
                            </div>
                        );
                    })}
                </div>

                {!singleSelect && (
                    <div className="flex items-center justify-between border-t border-border p-2">
                        <button
                            type="button"
                            onClick={selectAllDraft}
                            className="cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-muted transition hover:bg-slate-50"
                        >
                            Todos
                        </button>

                        <button
                            type="button"
                            onClick={applySelection}
                            className="cursor-pointer rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
                        >
                            Aplicar
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export const __uiDemo = {
    element: (
        <FilterButton
            icon={<MapPin size={16} />}
            label="Todas as unidades"
            options={[
                { label: "Bauru", value: "bauru" },
                { label: "São Paulo", value: "sao-paulo" },
                { label: "Rio de Janeiro", value: "rio" },
            ]}
        />
    ),
    code: `<FilterButton
  icon={<MapPin size={16} />}
  label="Todas as unidades"
  options={[
    { label: "Bauru", value: "bauru" },
    { label: "São Paulo", value: "sao-paulo" },
    { label: "Rio de Janeiro", value: "rio" },
  ]}
/>`,
};
