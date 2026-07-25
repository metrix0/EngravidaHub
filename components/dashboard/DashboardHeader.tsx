// components/dashboard/DashboardHeader.tsx

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import ButtonGroup from "@/components/ui/ButtonGroup";
import CalendarButton from "@/components/ui/CalendarButton";
import {
    DEFAULT_CALENDAR_PRESETS,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import { useServerDashboardDateFilters } from "@/components/dashboard/DashboardDateFilterProvider";
import {
    DATE_FILTER_STORAGE_PREFIX,
    isStoredDashboardDateFilter,
    type StoredDashboardDateFilter,
    writeDashboardDateFilterCookie,
} from "@/lib/dashboard/dateFilterStorage";

const EMPTY_DATE_RANGE: DateRange = { start: null, end: null };
const useBrowserLayoutEffect =
    typeof window === "undefined" ? useEffect : useLayoutEffect;

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
    const pathname = usePathname() || "/";
    const serverFilters = useServerDashboardDateFilters();
    const [filter, setFilter] = useState<StoredDashboardDateFilter>(() =>
        resolveInitialFilter({
            pathname,
            defaultPeriod,
            presets,
            serverFilter: serverFilters[pathname],
        }),
    );

    useEffect(() => {
        writeStoredDateFilter(pathname, filter);
    }, [filter, pathname]);

    return {
        period: filter.period,
        setPeriod: (period: CalendarPresetValue | null) => {
            setFilter((current) => ({ ...current, period }));
        },
        selectedRange: filter.selectedRange,
        setSelectedRange: (selectedRange: DateRange) => {
            setFilter((current) => ({ ...current, selectedRange }));
        },
        // The initial value is supplied by the server cookie. The cookie is
        // mirrored from localStorage before the first visible page paint.
        ready: true,
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
    const pathname = usePathname() || "/";
    const serverFilters = useServerDashboardDateFilters();
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

        const storedFilter = resolveStoredFilter(
            pathname,
            presets,
            serverFilters[pathname],
        );

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
    }, [
        pathname,
        presets,
        serverFilters,
        setPeriod,
        setSelectedRange,
        storageManaged,
    ]);

    useEffect(() => {
        if (storageManaged || !internalStorageReady) return;

        writeStoredDateFilter(pathname, { period, selectedRange });
    }, [
        internalStorageReady,
        pathname,
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

function resolveInitialFilter({
    pathname,
    defaultPeriod,
    presets,
    serverFilter,
}: {
    pathname: string;
    defaultPeriod: CalendarPresetValue;
    presets: typeof DEFAULT_CALENDAR_PRESETS;
    serverFilter?: StoredDashboardDateFilter;
}): StoredDashboardDateFilter {
    const fallback: StoredDashboardDateFilter = {
        period: defaultPeriod,
        selectedRange: EMPTY_DATE_RANGE,
    };
    const storedFilter = resolveStoredFilter(
        pathname,
        presets,
        serverFilter,
    );

    if (!storedFilter) return fallback;
    return storedFilter.period === null
        ? storedFilter
        : {
              period: storedFilter.period,
              selectedRange: EMPTY_DATE_RANGE,
          };
}

function resolveStoredFilter(
    pathname: string,
    presets: typeof DEFAULT_CALENDAR_PRESETS,
    serverFilter?: StoredDashboardDateFilter,
) {
    const localFilter = readStoredDateFilter(pathname);
    const candidate = localFilter ?? serverFilter ?? null;
    if (!candidate || !isAllowedFilter(candidate, presets)) return null;
    return candidate;
}

function readStoredDateFilter(pathname: string) {
    if (typeof window === "undefined") return null;

    try {
        const storedValue = window.localStorage.getItem(
            `${DATE_FILTER_STORAGE_PREFIX}${pathname}`,
        );
        if (!storedValue) return null;

        const storedFilter = JSON.parse(storedValue) as unknown;
        return isStoredDashboardDateFilter(storedFilter)
            ? storedFilter
            : null;
    } catch (error) {
        console.warn(
            "[DashboardHeader] failed to restore date filter",
            error,
        );
        return null;
    }
}

function writeStoredDateFilter(
    pathname: string,
    value: StoredDashboardDateFilter,
) {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(
            `${DATE_FILTER_STORAGE_PREFIX}${pathname}`,
            JSON.stringify(value),
        );
        writeDashboardDateFilterCookie(pathname, value);
    } catch (error) {
        console.warn("[DashboardHeader] failed to save date filter", error);
    }
}

function isAllowedFilter(
    value: StoredDashboardDateFilter,
    presets: typeof DEFAULT_CALENDAR_PRESETS,
) {
    if (value.period === null) return Boolean(value.selectedRange.start);
    return presets.some((preset) => preset.value === value.period);
}

function sameDateRange(first: DateRange, second: DateRange) {
    return first.start === second.start && first.end === second.end;
}
