// src/components/ui/FilterButton.tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, MapPin } from "lucide-react";

export type FilterOption = {
    label: string;
    value: string;
};

type FilterButtonProps = {
    icon?: ReactNode;
    label: string;
    options?: FilterOption[];
    values?: string[];
    onChange?: (values: string[]) => void;
    widthClassName?: string;
};

export default function FilterButton({
                                         icon,
                                         label,
                                         options = [],
                                         values,
                                         onChange,
                                         widthClassName = "w-[220px]",
                                     }: FilterButtonProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    const isControlled = values !== undefined;
    const [internalValues, setInternalValues] = useState<string[]>([]);
    const appliedValues = isControlled ? values : internalValues;

    const [open, setOpen] = useState(false);
    const [draftValues, setDraftValues] = useState<string[]>(appliedValues);

    const allOptionValues = options.map((option) => option.value);

    const allApplied =
        appliedValues.length === 0 || appliedValues.length === allOptionValues.length;

    const allDraftSelected =
        draftValues.length === 0 || draftValues.length === allOptionValues.length;

    const displayLabel = allApplied
        ? label
        : appliedValues.length === 1
            ? options.find((option) => option.value === appliedValues[0])?.label ?? label
            : `${appliedValues.length} selecionados`;

    useEffect(() => {
        setDraftValues(appliedValues.length === 0 ? allOptionValues : appliedValues);
    }, [appliedValues, options.length]);

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

    function updateAppliedValues(nextValues: string[]) {
        if (!isControlled) {
            setInternalValues(nextValues);
        }

        onChange?.(nextValues);
    }

    function toggleOption(value: string) {
        const normalizedValues = allDraftSelected ? allOptionValues : draftValues;

        if (normalizedValues.includes(value)) {
            setDraftValues(normalizedValues.filter((item) => item !== value));
            return;
        }

        setDraftValues([...normalizedValues, value]);
    }

    function selectAllDraft() {
        setDraftValues(allOptionValues);
    }

    function applySelection() {
        if (draftValues.length === 0 || draftValues.length === allOptionValues.length) {
            updateAppliedValues([]);
        } else {
            updateAppliedValues(draftValues);
        }

        setOpen(false);
    }

    return (
        <div ref={wrapperRef} className={`relative inline-block ${widthClassName}`}>
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-sm transition hover:bg-selection focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                style={{borderColor: "var(--color-border)",
                    color: "var(--color-muted)",
                }}
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

            <div
                className={`absolute right-0 z-50 mt-2 w-full origin-top overflow-hidden rounded-xl border shadow-lg transition-all duration-150 ${
                    open
                        ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                        : "pointer-events-none -translate-y-1 scale-98 opacity-0"
                }`}
                style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-card)",
                }}
            >
                <div className="max-h-72 overflow-y-auto py-1">
                    {options.map((option) => {
                        const selected = allDraftSelected || draftValues.includes(option.value);

                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => toggleOption(option.value)}
                                className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm transition hover:bg-slate-50"
                                style={{
                                    color: selected ? "var(--color-brand)" : "var(--color-muted)",
                                }}
                            >
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

                                <span className="truncate">{option.label}</span>
                            </button>
                        );
                    })}
                </div>

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