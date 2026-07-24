// components/dashboard/DashboardHeader.tsx

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import ButtonGroup from "@/components/ui/ButtonGroup";
import CalendarButton from "@/components/ui/CalendarButton";
import {
    DEFAULT_CALENDAR_PRESETS,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";

const DATE_FILTER_STORAGE_PREFIX = "engravida-hub:date-filter:v1:";
const EMPTY_DATE_RANGE: DateRange = { start: null, end: null };
const useBrowserLayoutEffect =
    typeof window === "undefined" ? useEffect : useLayoutEffect;

export type StoredDashboardDateFilter = {
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
    storageManaged?: boolean;
    storageReady?: boolean;
};

export function useDashboardDateFilter(
    defaultPeriod: CalendarPresetValue,
    presets: typeof DEFAULT_CALENDAR_PRESETS = DEFAULT_CALENDAR_PRESETS,
) {
    const [period, setPeriod] = useState<CalendarPresetValue | null>(
        defaultPeriod,
    );
    const [selectedRange, setSelectedRange] = useState<DateRange>(
        EMPTY_DATE_RANGE,
    );
    const [ready, setReady] = useState(false);

    useBrowserLayoutEffect(() => {
        const storedFilter = readStoredDateFilter(presets);

        if (storedFilter) {
            setPeriod(storedFilter.period);
            setSelectedRange(
                storedFilter.period === null
                    ? storedFilter.selectedRange
                    : EMPTY_DATE_RANGE,
            );
        }

        // State restoration and readiness are committed in the same layout
        // effect, before the browser paints the dashboard.
        setReady(true);
    }, [presets]);

    useEffect(() => {
        if (!ready) return;

        writeStoredDateFilter({ period, selectedRange });
    }, [period, ready, selectedRange]);

    return {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready,
    };
}

export function getInitialDashboardDateFilter(
    defaultPeriod: CalendarPresetValue,
    presets: typeof DEFAULT_CALENDAR_PRESETS = DEFAULT_CALENDAR_PRESETS,
): StoredDashboardDateFilter {
    const fallback: StoredDashboardDateFilter = {
        period: defaultPeriod,
        selectedRange: EMPTY_DATE_RANGE,
    };

    if (typeof window === "undefined") return fallback;

    const storedFilter = readStoredDateFilter(presets);
    if (!storedFilter) return fallback;

    return storedFilter.period === null
        ? storedFilter
        : {
              period: storedFilter.period,
              selectedRange: EMPTY_DATE_RANGE,
          };
}

export function DashboardHeader({
    title,
    description,
    period,
    setPeriod,
    selectedRange,
    setSelectedRange,
    presets = DEFAULT_CALENDAR_PRESETS,
    storageManaged = false,
    storageReady = true,
}: DashboardHeaderProps) {
    const [internalStorageReady, setInternalStorageReady] = useState(
        storageManaged,
    );
    const initialFilterRef = useRef({ period, selectedRange });
    const controlsReady = storageManaged
        ? storageReady
        : internalStorageReady;

    useBrowserLayoutEffect(() => {
        if (storageManaged) {
            setInternalStorageReady(true);
            return;
        }

        const storedFilter = readStoredDateFilter(presets);

        if (storedFilter) {
            const restoredRange =
                storedFilter.period === null
                    ? storedFilter.selectedRange
                    : EMPTY_DATE_RANGE;
            const initialFilter = initialFilterRef.current;

            if (initialFilter.period !== storedFilter.period) {
                setPeriod(storedFilter.period);
            }
            if (!sameDateRange(initialFilter.selectedRange, restoredRange)) {
                setSelectedRange(restoredRange);
            }
        }

        setInternalStorageReady(true);
    }, [presets, setPeriod, setSelectedRange, storageManaged]);

    useEffect(() => {
        if (storageManaged || !internalStorageReady) return;

        writeStoredDateFilter({ period, selectedRange });
    }, [
        internalStorageReady,
        period,
        selectedRange,
        storageManaged,
    ]);

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

            <div
                aria-hidden={!controlsReady}
                className={
                    controlsReady
                        ? ""
                        : "invisible pointer-events-none select-none"
                }
            >
                <ButtonGroup
                    value={period}
                    onChange={(value) => {
                        setPeriod(value);
                        setSelectedRange(EMPTY_DATE_RANGE);
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
            </div>
        </header>
    );
}

function readStoredDateFilter(
    presets: typeof DEFAULT_CALENDAR_PRESETS,
): StoredDashboardDateFilter | null {
    if (typeof window === "undefined") return null;

    try {
        const storedValue = window.localStorage.getItem(getStorageKey());
        if (!storedValue) return null;

        const storedFilter = JSON.parse(storedValue) as unknown;
        return isStoredDateFilter(storedFilter, presets) ? storedFilter : null;
    } catch (error) {
        console.warn(
            "[DashboardHeader] failed to restore date filter",
            error,
        );
        return null;
    }
}

function writeStoredDateFilter(value: StoredDashboardDateFilter) {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(getStorageKey(), JSON.stringify(value));
    } catch (error) {
        console.warn("[DashboardHeader] failed to save date filter", error);
    }
}

function getStorageKey() {
    return `${DATE_FILTER_STORAGE_PREFIX}${window.location.pathname}`;
}

function isStoredDateFilter(
    value: unknown,
    presets: typeof DEFAULT_CALENDAR_PRESETS,
): value is StoredDashboardDateFilter {
    if (!value || typeof value !== "object") return false;

    const candidate = value as Partial<StoredDashboardDateFilter>;

    if (!isDateRange(candidate.selectedRange)) return false;

    if (candidate.period === null) {
        return Boolean(candidate.selectedRange.start);
    }

    if (typeof candidate.period !== "string") return false;

    return presets.some((preset) => preset.value === candidate.period);
}

function sameDateRange(first: DateRange, second: DateRange) {
    return first.start === second.start && first.end === second.end;
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
    return (
        value === null ||
        (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    );
}
