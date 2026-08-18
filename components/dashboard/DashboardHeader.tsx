// components/dashboard/DashboardHeader.tsx

"use client";

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
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
import {
    isIsoDate,
    readUrlFilterValue,
    replaceUrlFilterParams,
} from "@/lib/dashboard/urlFilterParams";

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
    options: { syncUrl?: boolean } = {},
) {
    const pathname = usePathname() || "/";
    const serverFilters = useServerDashboardDateFilters();
    const syncUrl = options.syncUrl === true;
    const [urlReady, setUrlReady] = useState(!syncUrl);
    const [filter, setFilter] = useState<StoredDashboardDateFilter>(() =>
        resolveInitialFilter({
            pathname,
            defaultPeriod,
            presets,
            serverFilter: serverFilters[pathname],
        }),
    );

    useBrowserLayoutEffect(() => {
        if (!syncUrl || urlReady) return;

        const urlFilter = readDateFilterFromUrl(presets);
        if (urlFilter) {
            setFilter((current) =>
                sameStoredDateFilter(current, urlFilter)
                    ? current
                    : urlFilter,
            );
        }
        setUrlReady(true);
    }, [presets, syncUrl, urlReady]);

    useEffect(() => {
        if (!urlReady) return;
        writeStoredDateFilter(pathname, filter);
    }, [filter, pathname, urlReady]);

    useEffect(() => {
        if (!syncUrl || !urlReady) return;

        replaceUrlFilterParams([
            {
                key: "period",
                value: filter.period,
                aliases: ["date_period"],
            },
            {
                key: "start_date",
                value:
                    filter.period === null
                        ? filter.selectedRange.start
                        : null,
                aliases: ["date_start", "from", "start"],
            },
            {
                key: "end_date",
                value:
                    filter.period === null
                        ? filter.selectedRange.end ??
                          filter.selectedRange.start
                        : null,
                aliases: ["date_end", "to", "end"],
            },
            {
                key: "date",
                value: null,
            },
        ]);
    }, [filter, syncUrl, urlReady]);

    const setPeriod = useCallback((period: CalendarPresetValue | null) => {
        setFilter((current) => ({ ...current, period }));
    }, []);
    const setSelectedRange = useCallback((selectedRange: DateRange) => {
        setFilter((current) => ({ ...current, selectedRange }));
    }, []);

    return {
        period: filter.period,
        setPeriod,
        selectedRange: filter.selectedRange,
        setSelectedRange,
        // URL dates override the saved route filter before dependent pages
        // become ready, so copied links never issue a request with stale dates.
        ready: urlReady,
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
            if (!internalStorageReady) setInternalStorageReady(true);
            return;
        }

        // Restore the persisted value only once. Several pages intentionally
        // wrap their setters to reset pagination, so those callback references
        // change after every render. Re-running the restoration in response to
        // a new callback can repeatedly replace the range with an equivalent
        // object and trigger React's maximum-update-depth guard.
        if (internalStorageReady) return;

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
        internalStorageReady,
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
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-0">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">
                    {title}
                </h1>

                <p className="mt-2 text-sm text-slate-500">{description}</p>
            </div>

            <div
                aria-hidden={!controlsReady}
                className={
                    controlsReady
                        ? "max-w-full"
                        : "invisible pointer-events-none max-w-full select-none"
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


function readDateFilterFromUrl(
    presets: typeof DEFAULT_CALENDAR_PRESETS,
): StoredDashboardDateFilter | null {
    if (typeof window === "undefined") return null;

    const params = new URLSearchParams(window.location.search);
    const dateValue = readUrlFilterValue(params, ["date"]);
    const startDate = readUrlFilterValue(params, [
        "start_date",
        "date_start",
        "from",
        "start",
    ]);
    const endDate = readUrlFilterValue(params, [
        "end_date",
        "date_end",
        "to",
        "end",
    ]);
    const customStart = isIsoDate(startDate)
        ? startDate
        : isIsoDate(dateValue)
          ? dateValue
          : null;

    if (customStart) {
        return {
            period: null,
            selectedRange: {
                start: customStart,
                end: isIsoDate(endDate) ? endDate : customStart,
            },
        };
    }

    const periodValue =
        readUrlFilterValue(params, ["period", "date_period"]) ??
        dateValue;
    const allowedPeriod = presets.find(
        (preset) => preset.value === periodValue,
    )?.value;

    return allowedPeriod
        ? {
              period: allowedPeriod,
              selectedRange: EMPTY_DATE_RANGE,
          }
        : null;
}

function sameStoredDateFilter(
    first: StoredDashboardDateFilter,
    second: StoredDashboardDateFilter,
) {
    return (
        first.period === second.period &&
        sameDateRange(first.selectedRange, second.selectedRange)
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
