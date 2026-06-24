// lib/auth/userAccess.ts

export const APP_TAB_IDS = [
    "dashboard",
    "conversas",
    "jornada",
    "eventos",
    "usuarios",
    "inbox",
    "internos",
    "clientes",
    "funil",
] as const;

export type AppTabId = (typeof APP_TAB_IDS)[number];

export type CurrentUserPermission = {
    auth_user_id: string;
    preset: string;
    allowed_tabs: AppTabId[];
    attendant_id: string | null;
    active: boolean;
};

export const APP_TAB_HREFS: Record<AppTabId, string> = {
    dashboard: "/",
    conversas: "/conversas",
    jornada: "/jornada",
    eventos: "/eventos",
    usuarios: "/usuarios",
    inbox: "/inbox",
    internos: "/internos",
    clientes: "/clientes",
    funil: "/funil",
};

const APP_TAB_ROUTE_ORDER: AppTabId[] = [
    "dashboard",
    "jornada",
    "eventos",
    "inbox",
    "internos",
    "clientes",
    "conversas",
    "funil",
    "usuarios",
];

export function isAppTabId(value: unknown): value is AppTabId {
    return typeof value === "string" && APP_TAB_IDS.includes(value as AppTabId);
}

export function normalizeAllowedTabs(value: unknown): AppTabId[] {
    if (!Array.isArray(value)) return [];

    return [...new Set(value.filter(isAppTabId))];
}

export function getTabIdForPathname(pathname: string): AppTabId | null {
    if (pathname === "/") return "dashboard";

    for (const tabId of APP_TAB_ROUTE_ORDER) {
        if (tabId === "dashboard") continue;

        const href = APP_TAB_HREFS[tabId];

        if (pathname === href || pathname.startsWith(`${href}/`)) {
            return tabId;
        }
    }

    return null;
}

export function canAccessPathname(
    pathname: string,
    allowedTabs: readonly AppTabId[],
) {
    const tabId = getTabIdForPathname(pathname);

    if (!tabId) return true;

    return allowedTabs.includes(tabId);
}

export function getFirstAllowedHref(allowedTabs: readonly AppTabId[]) {
    for (const tabId of APP_TAB_ROUTE_ORDER) {
        if (allowedTabs.includes(tabId)) {
            return APP_TAB_HREFS[tabId];
        }
    }

    return null;
}
