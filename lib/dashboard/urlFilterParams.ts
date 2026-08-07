// lib/dashboard/urlFilterParams.ts

export type UrlFilterValue = string | readonly string[] | null | undefined;

export type UrlFilterEntry = {
    key: string;
    value: UrlFilterValue;
    aliases?: readonly string[];
};

export type UrlFilterOption = {
    label: string;
    value: string;
};

export function readUrlFilterValues(
    params: URLSearchParams,
    keys: readonly string[],
) {
    return uniqueUrlFilterValues(
        keys.flatMap((key) =>
            params.getAll(key).flatMap(expandUrlFilterValue),
        ),
    );
}

export function readUrlFilterValue(
    params: URLSearchParams,
    keys: readonly string[],
) {
    return readUrlFilterValues(params, keys)[0] ?? null;
}

export function normalizeUrlFilterName(value: string) {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function normalizeUrlFilterNames(values: readonly string[]) {
    return uniqueUrlFilterValues(
        values.map(normalizeUrlFilterName).filter(Boolean),
    );
}

// Compatibility alias for existing callers. All names use the same
// universal normalization function; there is no per-filter dictionary.
export const normalizeUrlOptionName = normalizeUrlFilterName;

export function resolveUrlOptionValues(
    values: readonly string[],
    options: readonly UrlFilterOption[],
) {
    const optionValueSet = new Set(options.map((option) => option.value));
    const valueByNormalizedName = new Map<string, string>();

    for (const option of options) {
        const normalizedName = normalizeUrlFilterName(option.label);
        if (normalizedName && !valueByNormalizedName.has(normalizedName)) {
            valueByNormalizedName.set(normalizedName, option.value);
        }
    }

    const resolvedValues: string[] = [];

    for (const value of values) {
        const resolvedValue = optionValueSet.has(value)
            ? value
            : valueByNormalizedName.get(normalizeUrlFilterName(value));

        if (resolvedValue && !resolvedValues.includes(resolvedValue)) {
            resolvedValues.push(resolvedValue);
        }
    }

    return resolvedValues;
}

export function getNormalizedUrlOptionNames(
    values: readonly string[],
    options: readonly UrlFilterOption[],
) {
    const labelByValue = new Map(
        options.map((option) => [option.value, option.label]),
    );

    return uniqueUrlFilterValues(
        values
            .map((value) => labelByValue.get(value))
            .filter((label): label is string => Boolean(label))
            .map(normalizeUrlFilterName)
            .filter(Boolean),
    );
}

export function replaceUrlFilterParams(entries: readonly UrlFilterEntry[]) {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);

    for (const entry of entries) {
        url.searchParams.delete(entry.key);
        for (const alias of entry.aliases ?? []) {
            url.searchParams.delete(alias);
        }

        const rawValues = Array.isArray(entry.value)
            ? entry.value
            : entry.value
              ? [entry.value]
              : [];
        const normalizedValues = uniqueUrlFilterValues(
            rawValues.flatMap(expandUrlFilterValue),
        );

        for (const value of normalizedValues) {
            url.searchParams.append(entry.key, value);
        }
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
        window.history.replaceState(window.history.state, "", nextUrl);
    }
}

export function isIsoDate(value: string | null): value is string {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function expandUrlFilterValue(rawValue: string): string[] {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) return [];

    if (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) {
        try {
            const parsedValue = JSON.parse(trimmedValue) as unknown;
            if (Array.isArray(parsedValue)) {
                return parsedValue.flatMap((value) =>
                    typeof value === "string"
                        ? expandUrlFilterValue(value)
                        : [],
                );
            }
        } catch {
            // Fall through to the legacy comma-separated format.
        }
    }

    return trimmedValue.split(",");
}

function uniqueUrlFilterValues(values: readonly string[]) {
    const uniqueValues = new Map<string, string>();

    for (const value of values) {
        const normalizedValue = value.trim().replace(/\s+/g, " ");
        if (!normalizedValue) continue;

        const comparisonKey = normalizedValue
            .normalize("NFC")
            .toLocaleLowerCase("pt-BR");

        if (!uniqueValues.has(comparisonKey)) {
            uniqueValues.set(comparisonKey, normalizedValue);
        }
    }

    return [...uniqueValues.values()];
}
