// app/src/components/ui/ButtonGroup.tsx
"use client";

import { useState, type ReactNode } from "react";

export type ButtonGroupOption<T extends string> = {
    value: T;
    label?: string;
    content?: ReactNode;
};

type ButtonGroupProps<T extends string> = {
    options: ButtonGroupOption<T>[];

    value?: T | null;
    defaultValue?: T;
    onChange?: (value: T) => void;

    className?: string;
    children?: ReactNode;
};

export default function ButtonGroup<T extends string>({
                                                          options,
                                                          value,
                                                          defaultValue,
                                                          onChange,
                                                          className = "",
                                                          children,
                                                      }: ButtonGroupProps<T>) {
    const firstValue = options[0]?.value;
    const [internalValue, setInternalValue] = useState<T | null>(
        defaultValue ?? firstValue ?? null
    );

    const selectedValue = value !== undefined ? value : internalValue;

    function handleChange(nextValue: T) {
        if (value === undefined) {
            setInternalValue(nextValue);
        }

        onChange?.(nextValue);
    }

    return (
        <div
            className={`flex items-center rounded-xl border bg-white p-1 ${className}`}
            style={{ borderColor: "var(--color-border)" }}
        >
            {options.map((option) => {
                const active = option.value === selectedValue;

                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => handleChange(option.value)}
                        className={`cursor-pointer rounded-lg truncate px-6 py-3 text-sm font-semibold transition-all duration-200 ${
                            active
                                ? "bg-brand text-white"
                                : "text-muted hover:bg-selection"
                        }`}
                    >
                        {option.content ?? option.label}
                    </button>
                );
            })}

            {children}
        </div>
    );
}

export const __uiDemo = {
    element: (
        <ButtonGroup
            defaultValue="7"
            options={[
                { value: "7", label: "7 dias" },
                { value: "30", label: "30 dias" },
                { value: "90", label: "90 dias" },
            ]}
        />
    ),
    code: `<ButtonGroup
  value={period}
  onChange={setPeriod}
  options={[
    { value: "7", label: "7 dias" },
    { value: "30", label: "30 dias" },
    { value: "90", label: "90 dias" },
  ]}
/>`,
};