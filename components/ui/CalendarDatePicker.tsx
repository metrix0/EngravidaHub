// components/ui/CalendarDatePicker.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

type CalendarDatePickerProps = {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
};

export function CalendarDatePicker({
    value,
    onChange,
    placeholder = "Selecione a data",
    disabled = false,
    invalid = false,
}: CalendarDatePickerProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [visibleDate, setVisibleDate] = useState(() =>
        parseDateInput(value) ?? new Date(),
    );

    useEffect(() => {
        if (!open) return;

        function handleClickOutside(event: MouseEvent) {
            if (!wrapperRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    useEffect(() => {
        const selectedDate = parseDateInput(value);
        if (selectedDate) setVisibleDate(selectedDate);
    }, [value]);

    const days = useMemo(
        () => getCalendarDays(visibleDate.getFullYear(), visibleDate.getMonth()),
        [visibleDate],
    );

    const label = value ? formatDateLabel(value) : placeholder;

    return (
        <div ref={wrapperRef} className="relative w-full">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
                className={`group flex h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border bg-white px-4 text-left text-sm font-semibold shadow-sm outline-none transition hover:bg-selection disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 ${
                    invalid ? "border-red" : "border-border"
                }`}
                aria-haspopup="dialog"
                aria-expanded={open}
            >
                <span className="flex min-w-0 items-center gap-2">
                    <CalendarDays
                        size={17}
                        className="shrink-0 cursor-pointer text-slate-400 transition-colors group-hover:text-slate-700"
                    />
                    <span className={value ? "truncate text-slate-700" : "truncate text-slate-400"}>
                        {label}
                    </span>
                </span>
                <ChevronRight
                    size={16}
                    className={`shrink-0 cursor-pointer text-slate-400 transition-all group-hover:text-slate-700 ${
                        open ? "rotate-90" : "rotate-0"
                    }`}
                />
            </button>

            <div
                className={`absolute left-0 z-[70] mt-2 w-[320px] max-w-[calc(100vw-3rem)] origin-top rounded-2xl border border-border bg-white p-4 shadow-xl transition-all duration-150 ${
                    open
                        ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                        : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0"
                }`}
                role="dialog"
                aria-label="Selecionar data"
            >
                <div className="mb-4 flex items-center justify-between">
                    <button
                        type="button"
                        onClick={() =>
                            setVisibleDate(
                                new Date(
                                    visibleDate.getFullYear(),
                                    visibleDate.getMonth() - 1,
                                    1,
                                ),
                            )
                        }
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                        aria-label="Mês anterior"
                    >
                        <ChevronLeft size={18} />
                    </button>

                    <div className="text-sm font-bold capitalize text-slate-900">
                        {visibleDate.toLocaleDateString("pt-BR", {
                            month: "long",
                            year: "numeric",
                        })}
                    </div>

                    <button
                        type="button"
                        onClick={() =>
                            setVisibleDate(
                                new Date(
                                    visibleDate.getFullYear(),
                                    visibleDate.getMonth() + 1,
                                    1,
                                ),
                            )
                        }
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                        aria-label="Próximo mês"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>

                <div className="mb-2 grid grid-cols-7 text-center text-xs font-bold text-slate-400">
                    <span>D</span>
                    <span>S</span>
                    <span>T</span>
                    <span>Q</span>
                    <span>Q</span>
                    <span>S</span>
                    <span>S</span>
                </div>

                <div className="grid grid-cols-7 gap-1">
                    {days.map((day) => {
                        const selected = day.dateString === value;
                        const today = day.dateString === toDateInputValue(new Date());

                        return (
                            <button
                                key={day.dateString}
                                type="button"
                                onClick={() => {
                                    onChange(day.dateString);
                                    setOpen(false);
                                }}
                                className={`relative h-9 cursor-pointer rounded-lg text-sm transition ${
                                    selected
                                        ? "bg-brand font-bold text-white shadow-sm"
                                        : day.currentMonth
                                          ? "text-slate-700 hover:bg-slate-100 hover:text-slate-950"
                                          : "text-slate-300 hover:bg-slate-50 hover:text-slate-500"
                                }`}
                            >
                                {day.day}
                                {today && !selected ? (
                                    <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand" />
                                ) : null}
                            </button>
                        );
                    })}
                </div>

                {value ? (
                    <div className="mt-4 border-t border-border pt-3">
                        <button
                            type="button"
                            onClick={() => {
                                onChange("");
                                setOpen(false);
                            }}
                            className="cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                        >
                            Limpar data
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function getCalendarDays(year: number, month: number) {
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(year, month, 1 - firstDay.getDay());

    return Array.from({ length: 42 }, (_, index) => {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + index);

        return {
            day: date.getDate(),
            currentMonth: date.getMonth() === month,
            dateString: toDateInputValue(date),
        };
    });
}

function parseDateInput(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
}

function toDateInputValue(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string) {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value;
}
