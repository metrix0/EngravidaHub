// lib/auth/userAccess.ts

export const APP_TAB_IDS = [
    "dashboard",
    "financeiro",
    "conversas",
    "jornada",
    "eventos",
    "assistente",
    "usuarios",
    "inbox",
    "agendamentos",
    "mensagem_ativa",
    "internos",
    "clientes",
    "funil",
] as const;

export type AppTabId = (typeof APP_TAB_IDS)[number];

export type CurrentUserUnitLock = {
    id: string;
    name: string;
    city: string;
};

export type CurrentUserPermission = {
    auth_user_id: string;
    preset: string;
    allowed_tabs: AppTabId[];
    attendant_id: string | null;
    active: boolean;
    unit_lock?: CurrentUserUnitLock | null;
};

export const UNIT_LOCK_COOKIE_NAME = "engravida-unit-lock-v1";

export type UnitLockCookieState = {
    userId: string;
    unitId: string | null;
};

export function serializeUnitLockCookie(
    userId: string,
    unitId: string | null,
) {
    return `${userId}:${unitId ?? ""}`;
}

export function parseUnitLockCookie(
    value: string | null | undefined,
): UnitLockCookieState | null {
    if (!value) return null;

    const separatorIndex = value.indexOf(":");
    if (separatorIndex <= 0) return null;

    const userId = value.slice(0, separatorIndex).trim();
    const unitId = value.slice(separatorIndex + 1).trim() || null;

    if (!userId) return null;

    return { userId, unitId };
}

export const APP_TAB_HREFS: Record<AppTabId, string> = {
    dashboard: "/",
    financeiro: "/financeiro",
    conversas: "/conversas",
    jornada: "/jornada",
    eventos: "/eventos",
    assistente: "/assistente",
    usuarios: "/usuarios",
    inbox: "/inbox",
    agendamentos: "/agendamentos",
    mensagem_ativa: "/mensagem-ativa",
    internos: "/internos",
    clientes: "/clientes",
    funil: "/funil",
};

const APP_TAB_ROUTE_ORDER: AppTabId[] = [
    "dashboard",
    "financeiro",
    "assistente",
    "jornada",
    "eventos",
    "inbox",
    "agendamentos",
    "mensagem_ativa",
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
