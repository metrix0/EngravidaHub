// components/dashboard/DashboardHeader.tsx

"use client";

import { useEffect, useState } from "react";

import ButtonGroup from "@/components/ui/ButtonGroup";
import CalendarButton from "@/components/ui/CalendarButton";
import {
    DEFAULT_CALENDAR_PRESETS,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";

const DATE_FILTER_STORAGE_PREFIX = "engravida-hub:date-filter:v1:";

type StoredDateFilter = {
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
};

type DashboardHeaderProps = {
    title: string;
    description: string;
    period: CalendarPresetValue | null;
    setPeriod: (value: CalendarPresetValue | null) => void;
    selectedRange: DateRange;
    setSelectedRange: (value: DateRange) => void;
    presets?: typeof DEFAULT_CALENDAR_PRESETS;
};

export function DashboardHeader({
                                    title,
                                    description,
                                    period,
                                    setPeriod,
                                    selectedRange,
                                    setSelectedRange,
                                    presets = DEFAULT_CALENDAR_PRESETS,
                                }: DashboardHeaderProps) {
    const [storageReady, setStorageReady] = useState(false);

    useEffect(() => {
        const storageKey = getStorageKey();

        try {
            const storedValue = window.localStorage.getItem(storageKey);

            if (storedValue) {
                const storedFilter = JSON.parse(storedValue) as unknown;

                if (isStoredDateFilter(storedFilter, presets)) {
                    setPeriod(storedFilter.period);
                    setSelectedRange(
                        storedFilter.period === null
                            ? storedFilter.selectedRange
                            : {start: null, end: null},
                    );
                }
            }
        } catch (error) {
            console.warn(
                "[DashboardHeader] failed to restore date filter",
                error,
            );
        } finally {
            setStorageReady(true);
        }
    }, [presets, setPeriod, setSelectedRange]);

    useEffect(() => {
        if (!storageReady) return;

        const storedFilter: StoredDateFilter = {
            period,
            selectedRange,
        };

        try {
            window.localStorage.setItem(
                getStorageKey(),
                JSON.stringify(storedFilter),
            );
        } catch (error) {
            console.warn(
                "[DashboardHeader] failed to save date filter",
                error,
            );
        }
    }, [period, selectedRange, storageReady]);

    return (
        <header className="mb-8 flex items-start justify-between">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                    {title}
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                    {description}
                </p>
            </div>

            <ButtonGroup
                value={period}
                onChange={(value) => {
                    setPeriod(value);
                    setSelectedRange({
                        start: null,
                        end: null,
                    });
                }}
                options={presets.map((preset) => ({
                    value: preset.value,
                    label: preset.label,
                }))}
            >
                <CalendarButton
                    value={selectedRange}
                    onChange={setSelectedRange}
                    onApply={(range) => {
                        if (range.start) {
                            setPeriod(null);
                            return;
                        }

                        setPeriod(presets[0]?.value ?? "yesterday");
                    }}
                />
            </ButtonGroup>
        </header>
    );
}

function getStorageKey() {
    return `${DATE_FILTER_STORAGE_PREFIX}${window.location.pathname}`;
}

function isStoredDateFilter(
    value: unknown,
    presets: typeof DEFAULT_CALENDAR_PRESETS,
): value is StoredDateFilter {
    if (!value || typeof value !== "object") return false;

    const candidate = value as Partial<StoredDateFilter>;

    if (!isDateRange(candidate.selectedRange)) return false;

    if (candidate.period === null) {
        return Boolean(candidate.selectedRange.start);
    }

    if (typeof candidate.period !== "string") return false;

    return presets.some((preset) => preset.value === candidate.period);
}

function isDateRange(value: unknown): value is DateRange {
    if (!value || typeof value !== "object") return false;

    const candidate = value as Partial<DateRange>;

    if (!isDateValue(candidate.start) || !isDateValue(candidate.end)) {
        return false;
    }

    if (candidate.start === null) return candidate.end === null;
    if (candidate.end === null) return true;

    return candidate.end >= candidate.start;
}

function isDateValue(value: unknown): value is string | null {
    return value === null || (
        typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    );
}
