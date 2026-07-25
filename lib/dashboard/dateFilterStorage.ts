// lib/dashboard/dateFilterStorage.ts
import type {
    CalendarPresetValue,
    DateRange,
} from "@/components/ui/CalendarButton";

export const DATE_FILTER_STORAGE_PREFIX =
    "engravida-hub:date-filter:v1:";
export const DATE_FILTER_COOKIE_NAME =
    "engravida_hub_date_filters_v1";

export type StoredDashboardDateFilter = {
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
};

export type StoredDashboardDateFilterMap = Record<
    string,
    StoredDashboardDateFilter
>;

export function parseDashboardDateFilterCookie(
    rawValue: string | null | undefined,
): StoredDashboardDateFilterMap {
    if (!rawValue) return {};

    try {
        const decoded = safeDecodeURIComponent(rawValue);
        const parsed = JSON.parse(decoded) as unknown;
        if (!parsed || typeof parsed !== "object") return {};

        return Object.fromEntries(
            Object.entries(parsed).filter(
                (entry): entry is [string, StoredDashboardDateFilter] =>
                    isStoredDashboardDateFilter(entry[1]),
            ),
        );
    } catch {
        return {};
    }
}

export function serializeDashboardDateFilterCookie(
    filters: StoredDashboardDateFilterMap,
) {
    return encodeURIComponent(JSON.stringify(filters));
}

export function writeDashboardDateFilterCookie(
    pathname: string,
    filter: StoredDashboardDateFilter,
) {
    if (typeof document === "undefined") return;

    const current = parseDashboardDateFilterCookie(
        readCookieValue(DATE_FILTER_COOKIE_NAME),
    );
    current[pathname] = filter;

    document.cookie = `${DATE_FILTER_COOKIE_NAME}=${serializeDashboardDateFilterCookie(
        current,
    )}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function dashboardDateFilterBootstrapScript() {
    return `(function(){try{var p=window.location.pathname;var k=${JSON.stringify(
        DATE_FILTER_STORAGE_PREFIX,
    )}+p;var raw=window.localStorage.getItem(k);if(!raw)return;var f=JSON.parse(raw);if(!f||typeof f!=="object"||!("period" in f)||!("selectedRange" in f))return;var n=${JSON.stringify(
        DATE_FILTER_COOKIE_NAME,
    )};var pair=document.cookie.split("; ").find(function(item){return item.indexOf(n+"=")===0;});var map={};if(pair){try{map=JSON.parse(decodeURIComponent(pair.slice(n.length+1)))||{};}catch(_){map={};}}if(JSON.stringify(map[p])===JSON.stringify(f))return;map[p]=f;document.cookie=n+"="+encodeURIComponent(JSON.stringify(map))+"; Path=/; Max-Age=31536000; SameSite=Lax";window.location.reload();}catch(_){}})();`;
}

export function isStoredDashboardDateFilter(
    value: unknown,
): value is StoredDashboardDateFilter {
    if (!value || typeof value !== "object") return false;

    const candidate = value as Partial<StoredDashboardDateFilter>;
    if (!isDateRange(candidate.selectedRange)) return false;

    return (
        candidate.period === null ||
        typeof candidate.period === "string"
    );
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

function readCookieValue(name: string) {
    const match = document.cookie.match(
        new RegExp(`(?:^|; )${escapeRegExp(name)}=([^;]*)`),
    );
    return match?.[1] ?? null;
}

function safeDecodeURIComponent(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
