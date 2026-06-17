// src/components/ui/AdvancedFilterButton.tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, SlidersHorizontal } from "lucide-react";

export type AdvancedFilterOption = {
    label: string;
    value: string;
};

export type AdvancedFilterSection = {
    id: string;
    title: string;
    options: AdvancedFilterOption[];
    values: string[];
    onChange: (values: string[]) => void;
    multi?: boolean;
};

type AdvancedFilterButtonProps = {
    icon?: ReactNode;
    label?: string;
    sections: AdvancedFilterSection[];
    widthClassName?: string;
    dropdownWidthClassName?: string;
};

export default function AdvancedFilterButton({
                                                 icon = <SlidersHorizontal size={16} />,
                                                 label = "Mais filtros",
                                                 sections,
                                                 widthClassName = "w-[150px]",
                                                 dropdownWidthClassName = "w-[320px]",
                                             }: AdvancedFilterButtonProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    const [open, setOpen] = useState(false);
    const [draftValuesBySection, setDraftValuesBySection] = useState<
        Record<string, string[]>
    >({});

    const activeCount = sections.reduce(
        (total, section) => total + section.values.length,
        0
    );

    const displayLabel =
        activeCount === 0
            ? label
            : activeCount === 1
                ? `${activeCount} filtro`
                : `${activeCount} filtros`;


    useEffect(() => {
        const nextDrafts: Record<string, string[]> = {};

        for (const section of sections) {
            nextDrafts[section.id] = section.values;
        }

        setDraftValuesBySection(nextDrafts);
    }, [sections]);

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
        if (open) return;

        const nextDrafts: Record<string, string[]> = {};

        for (const section of sections) {
            nextDrafts[section.id] = section.values;
        }

        setTimeout(() => setDraftValuesBySection(nextDrafts), 200)
    }, [open, sections]);

    function toggleOption(section: AdvancedFilterSection, value: string) {
        const currentValues = draftValuesBySection[section.id] ?? [];

        const nextValues = section.multi === false
            ? toggleSingleValue(currentValues, value)
            : toggleValue(currentValues, value);

        setDraftValuesBySection((current) => ({
            ...current,
            [section.id]: nextValues,
        }));
    }

    function applySelection() {
        for (const section of sections) {
            section.onChange(draftValuesBySection[section.id] ?? []);
        }

        setOpen(false);
    }

    function clearSelection() {
        const emptyDrafts: Record<string, string[]> = {};

        for (const section of sections) {
            emptyDrafts[section.id] = [];
            section.onChange([]);
        }

        setDraftValuesBySection(emptyDrafts);
        setOpen(false);
    }

    return (
        <div ref={wrapperRef} className={`relative inline-block ${widthClassName}`}>
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className={`flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-selection focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${activeCount > 0 ? "!bg-brand !border-brand text-white" : `${open ? "!bg-slate-200 hover:!bg-selection" : ""}`}`}>
                <span className="flex min-w-0 items-center gap-2">
                    {icon}
                    <span className="truncate">{displayLabel}</span>
                </span>

            </button>

            <div
                className={`absolute right-0 z-50 mt-2 origin-top overflow-hidden rounded-xl border border-border bg-card shadow-lg transition-all duration-150 ${dropdownWidthClassName} ${
                    open
                        ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                        : "pointer-events-none -translate-y-1 scale-98 opacity-0"
                }`}
            >
                <div className="max-h-[420px] overflow-y-auto p-3">
                    {sections.map((section) => {
                        const draftValues = draftValuesBySection[section.id] ?? [];

                        return (
                            <div
                                key={section.id}
                                className="border-b border-slate-100 py-3 last:border-b-0"
                            >
                                <div className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">
                                    {section.title}
                                </div>

                                <div className="space-y-1">
                                    {section.options.map((option) => {
                                        const selected = draftValues.includes(option.value);

                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => toggleOption(section, option.value)}
                                                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-slate-50"
                                                style={{
                                                    color: selected
                                                        ? "var(--color-brand)"
                                                        : "var(--color-muted)",
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
                            </div>
                        );
                    })}
                </div>

                <div className="flex items-center justify-between border-t border-border p-2">
                    <button
                        type="button"
                        onClick={clearSelection}
                        className="cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-muted transition hover:bg-slate-50"
                    >
                        Limpar
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

function toggleValue(values: string[], value: string) {
    if (values.includes(value)) {
        return values.filter((item) => item !== value);
    }

    return [...values, value];
}

function toggleSingleValue(values: string[], value: string) {
    if (values.includes(value)) return [];

    return [value];
}

export const __uiDemo = {
    element: (
        <AdvancedFilterButton
            sections={[
                {
                    id: "status",
                    title: "Status",
                    values: [],
                    onChange: () => {},
                    options: [
                        { label: "Ativo", value: "active" },
                        { label: "Inativo", value: "inactive" },
                    ],
                },
                {
                    id: "type",
                    title: "Tipo",
                    values: [],
                    onChange: () => {},
                    multi: false,
                    options: [
                        { label: "Lead", value: "lead" },
                        { label: "Agendamento", value: "schedule" },
                    ],
                },
            ]}
        />
    ),
    code: `<AdvancedFilterButton
  sections={[
    {
      id: "status",
      title: "Status",
      values,
      onChange,
      options,
    },
  ]}
/>`,
};