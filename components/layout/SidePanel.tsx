// components/layout/SidePanel.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    BriefcaseBusiness,
    CalendarDays,
    ChevronRight,
    Flag,
    Funnel,
    HelpCircle,
    LayoutDashboard,
    Megaphone,
    MessageCircle,
    MessagesSquare,
    Send,
    UserCog,
    Users,
} from "lucide-react";

import { useCurrentUser } from "@/components/auth/CurrentUserProvider";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import {
    type CurrentAttendant,
    fetchCurrentAttendant,
    getCachedCurrentAttendant,
    setCurrentAttendantOffline,
    setCurrentAttendantOnline,
} from "@/lib/attendants/currentAttendantApi";
import {
    getFirstAllowedHref,
    getTabIdForPathname,
    type AppTabId,
} from "@/lib/auth/userAccess";

type SidePanelItem = {
    type?: "item";
    label: string;
    href: string;
    icon: ReactNode;
    tabId?: AppTabId;
};

type SidePanelSeparator = {
    type: "separator";
    id: string;
};

type SidePanelEntry = SidePanelItem | SidePanelSeparator;

type SidePanelProps = {
    items?: SidePanelEntry[];

    /**
     * true  = expanded sidebar changes page layout width
     * false = expanded sidebar floats over page
     */
    affectLayout?: boolean;

    /** Initial open state. */
    defaultExpanded?: boolean;

    /**
     * Only the root layout instance remains mounted between page changes.
     * Existing page-level instances render nothing.
     */
    persistent?: boolean;
};

const COLLAPSED_WIDTH = 76;
const EXPANDED_WIDTH = 250;
const ACTIVE_MESSAGE_PRESET_IDS = new Set(["admin", "atendente", "marketing"]);

const defaultItems: SidePanelEntry[] = [
    { label: "Dashboard", href: "/", icon: <LayoutDashboard size={18} />, tabId: "dashboard" },
    { label: "Jornada", href: "/jornada", icon: <Flag size={18} />, tabId: "jornada" },
    { label: "Eventos", href: "/eventos", icon: <Megaphone size={18} />, tabId: "eventos" },

    { type: "separator", id: "crm" },
    { label: "Inbox", href: "/inbox", icon: <MessagesSquare size={18} />, tabId: "inbox" },
    { label: "Agendamentos", href: "/agendamentos", icon: <CalendarDays size={18} />, tabId: "inbox" },
    { label: "Mensagem Ativa", href: "/mensagem-ativa", icon: <Send size={18} />, tabId: "mensagem_ativa" },
    { label: "Clientes", href: "/clientes", icon: <Users size={18} />, tabId: "clientes" },
    { label: "Conversas", href: "/conversas", icon: <MessageCircle size={18} />, tabId: "conversas" },
    { label: "Funil", href: "/funil", icon: <Funnel size={18} />, tabId: "funil" },

    { type: "separator", id: "usuarios" },
    { label: "Internos", href: "/internos", icon: <BriefcaseBusiness size={18} />, tabId: "internos" },
    { label: "Usuários", href: "/usuarios", icon: <UserCog size={18} />, tabId: "usuarios" },
];

function isSeparator(item: SidePanelEntry): item is SidePanelSeparator {
    return item.type === "separator";
}

function filterEntriesByPermission(
    entries: SidePanelEntry[],
    allowedTabs: readonly AppTabId[],
) {
    const allowed = new Set(allowedTabs);

    const filtered = entries.filter((entry) => {
        if (isSeparator(entry)) return true;

        const tabId = entry.tabId ?? getTabIdForPathname(entry.href);

        return tabId ? allowed.has(tabId) : true;
    });

    const compacted: SidePanelEntry[] = [];

    for (const entry of filtered) {
        if (isSeparator(entry)) {
            if (
                compacted.length === 0 ||
                isSeparator(compacted[compacted.length - 1])
            ) {
                continue;
            }
        }

        compacted.push(entry);
    }

    while (
        compacted.length > 0 &&
        isSeparator(compacted[compacted.length - 1])
    ) {
        compacted.pop();
    }

    return compacted;
}

export default function SidePanel(props: SidePanelProps) {
    const pathname = usePathname();

    const shouldHideSidePanel =
        pathname === "/login" ||
        pathname.startsWith("/dev");

    if (!props.persistent || shouldHideSidePanel) {
        return null;
    }

    return <PersistentSidePanel {...props} />;
}

function PersistentSidePanel({
    items = defaultItems,
    affectLayout,
    defaultExpanded,
}: SidePanelProps) {
    const router = useRouter();
    const pathname = usePathname();
    const { currentUser } = useCurrentUser();
    const currentUserId = currentUser?.user?.id ?? null;
    const cachedAttendant = getCachedCurrentAttendant(currentUserId);

    const isInbox =
        pathname.startsWith("/inbox") ||
        pathname.startsWith("/agendamentos");
    const resolvedAffectLayout = affectLayout ?? !isInbox;

    const [isExpanded, setIsExpanded] = useState(
        () => defaultExpanded ?? !isInbox,
    );

    useEffect(() => {
        if (isInbox) {
            setIsExpanded(false);
        }
    }, [isInbox]);
    const [currentAttendant, setCurrentAttendant] =
        useState<CurrentAttendant | null>(() => cachedAttendant?.attendant ?? null);
    const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
    const [isStatusUpdating, setIsStatusUpdating] = useState(false);

    useEffect(() => {
        let isMounted = true;

        async function loadCurrentAttendant(force = false) {
            if (!currentUserId) {
                if (isMounted) setCurrentAttendant(null);
                return;
            }

            const cached = getCachedCurrentAttendant(currentUserId);

            if (cached && isMounted) {
                setCurrentAttendant(cached.attendant);
            }

            try {
                const response = await fetchCurrentAttendant({
                    force,
                    userId: currentUserId,
                });

                if (!isMounted) return;

                setCurrentAttendant(response.attendant);
            } catch (error) {
                console.error(
                    "[SidePanel] failed to load current attendant",
                    error,
                );
            }
        }

        function handleAttendantStatusChanged() {
            void loadCurrentAttendant(true);
        }

        function handleCurrentUserPermissionsChanged() {
            void loadCurrentAttendant(true);
        }

        // Same behavior as CurrentUserProvider:
        // show the cached value immediately, but always revalidate once
        // when the protected app/sidebar mounts for this authenticated user.
        void loadCurrentAttendant(true);

        window.addEventListener(
            "attendant-status-changed",
            handleAttendantStatusChanged,
        );
        window.addEventListener(
            "current-user-permissions-changed",
            handleCurrentUserPermissionsChanged,
        );

        return () => {
            isMounted = false;
            window.removeEventListener(
                "attendant-status-changed",
                handleAttendantStatusChanged,
            );
            window.removeEventListener(
                "current-user-permissions-changed",
                handleCurrentUserPermissionsChanged,
            );
        };
    }, [currentUserId]);

    const permission = currentUser?.permission ?? null;
    const hasAuthenticatedUser = Boolean(currentUser?.user);
    const allowedTabs = permission?.active
        ? ACTIVE_MESSAGE_PRESET_IDS.has(permission.preset)
            ? permission.allowed_tabs
            : permission.allowed_tabs.filter(
                  (tabId) => tabId !== "mensagem_ativa",
              )
        : [];

    const visibleItems = useMemo(
        () =>
            hasAuthenticatedUser
                ? filterEntriesByPermission(items, allowedTabs)
                : [],
        [items, allowedTabs, hasAuthenticatedUser],
    );

    const sidebarWidth = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
    const layoutWidth = resolvedAffectLayout ? sidebarWidth : COLLAPSED_WIDTH;

    const profileName =
        currentAttendant?.name ??
        currentUser?.user?.name ??
        currentUser?.user?.email ??
        "Usuário";

    const profileSubtitle = currentAttendant
        ? currentAttendant.is_online
            ? "Online"
            : "Offline"
        : "";

    const homeHref = getFirstAllowedHref(allowedTabs) ?? pathname;

    async function handleToggleAttendantStatus() {
        if (!currentAttendant || isStatusUpdating) return;

        setIsStatusUpdating(true);

        try {
            const response = currentAttendant.is_online
                ? await setCurrentAttendantOffline()
                : await setCurrentAttendantOnline();

            window.dispatchEvent(new Event("attendant-status-changed"));

            setCurrentAttendant((current) => {
                if (response.attendant) return response.attendant;
                if (!current) return null;

                return {
                    ...current,
                    is_online: !current.is_online,
                };
            });

            setIsStatusMenuOpen(false);

            if (pathname.startsWith("/inbox")) {
                window.location.reload();
                return;
            }

            router.refresh();
        } catch (error) {
            console.error(
                "[SidePanel] failed to update attendant status",
                error,
            );
        } finally {
            setIsStatusUpdating(false);
        }
    }

    return (
        <div
            className="relative z-50 h-screen shrink-0 transition-[width] duration-400 ease-out"
            style={{ width: layoutWidth }}
        >
            <aside
                className="group fixed left-0 top-0 z-50 h-screen max-h-screen overflow-visible border-r border-border bg-card shadow-sm transition-[width,box-shadow] duration-300 ease-out"
                style={{
                    width: sidebarWidth,
                    boxShadow:
                        !resolvedAffectLayout && isExpanded
                            ? "0 25px 50px -12px rgb(15 23 42 / 0.18)"
                            : undefined,
                }}
            >
                <button
                    type="button"
                    onClick={() => setIsExpanded((value) => !value)}
                    className={`absolute top-[46px] z-[60] flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-border bg-white text-muted shadow-sm transition-all duration-200 hover:bg-selection hover:text-text ${
                        isExpanded
                            ? "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
                            : "pointer-events-auto opacity-100"
                    } ${!isExpanded ? "right-5" : "-right-5"}`}
                    title={isExpanded ? "Recolher menu" : "Expandir menu"}
                >
                    <ChevronRight
                        size={18}
                        className={`transition-transform duration-300 ${
                            isExpanded ? "rotate-180" : "rotate-0"
                        }`}
                    />
                </button>

                {isStatusMenuOpen && currentAttendant && (
                    <div
                        className={`fixed bottom-7 z-[90] w-44 rounded-xl border border-border bg-white p-2 shadow-lg duration-200 ${
                            isExpanded ? "left-[258px]" : "left-[84px]"
                        }`}
                    >
                        <button
                            type="button"
                            onClick={handleToggleAttendantStatus}
                            disabled={isStatusUpdating}
                            className="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <span>
                                {isStatusUpdating
                                    ? "Atualizando..."
                                    : currentAttendant.is_online
                                        ? "Ficar offline"
                                        : "Ficar online"}
                            </span>

                            <span
                                className={`h-2.5 w-2.5 rounded-full ${
                                    currentAttendant.is_online
                                        ? "bg-slate-400"
                                        : "bg-green"
                                }`}
                            />
                        </button>
                    </div>
                )}

                <div className="flex h-full max-h-screen flex-col overflow-hidden py-7">
                    <div className="relative mb-6 flex h-10 shrink-0 items-center px-5">
                        <Link
                            href={homeHref}
                            className={`flex h-10 min-w-0 cursor-pointer items-center rounded-xl transition ${
                                isExpanded ? "w-full" : "w-9"
                            }`}
                        >
                            {isExpanded && (
                                <img
                                    src="/logo.png"
                                    className="block max-h-9 w-full object-contain"
                                    alt="Engravida"
                                />
                            )}
                        </Link>
                    </div>

                    <div className="relative min-h-0 flex-1">
                        <div
                            className={`sidepanel-scrollbar h-full overflow-y-auto overflow-x-hidden px-4 pb-8 pt-2 ${
                                isExpanded
                                    ? "sidepanel-scrollbar-visible"
                                    : "sidepanel-scrollbar-hidden"
                            }`}
                        >
                            <nav className="space-y-2">
                                {visibleItems.map((item) => {
                                    if (isSeparator(item)) {
                                        return (
                                            <div
                                                key={item.id}
                                                className={`my-3 flex ${
                                                    isExpanded
                                                        ? "justify-start px-4"
                                                        : "justify-center"
                                                }`}
                                            >
                                                <div
                                                    className={`h-px bg-border ${
                                                        isExpanded ? "w-full" : "w-8"
                                                    }`}
                                                />
                                            </div>
                                        );
                                    }

                                    const isActive =
                                        item.href === "/"
                                            ? pathname === "/"
                                            : pathname.startsWith(item.href);

                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            title={item.label}
                                            className={`flex h-11 cursor-pointer items-center gap-4 rounded-xl px-4 py-3 text-sm leading-none transition-colors duration-150 ${
                                                isActive
                                                    ? "bg-brand-soft font-semibold text-brand"
                                                    : "font-medium text-muted hover:bg-selection"
                                            } ${
                                                isExpanded
                                                    ? "justify-start"
                                                    : "justify-center"
                                            }`}
                                        >
                                            <span className="shrink-0">{item.icon}</span>

                                            {isExpanded && (
                                                <span className="min-w-0 truncate leading-none">
                                                    {item.label}
                                                </span>
                                            )}
                                        </Link>
                                    );
                                })}
                            </nav>

                            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent" />
                        </div>
                    </div>

                    <div className="shrink-0 px-4 pt-4">
                        <button
                            type="button"
                            title="Precisa de ajuda?"
                            className={`flex w-full cursor-pointer truncate items-center rounded-xl border p-3 text-xs text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-text ${
                                isExpanded
                                    ? "gap-3 border-border"
                                    : "justify-center border-transparent"
                            }`}
                        >
                            <HelpCircle
                                className="shrink-0 text-brand"
                                size={22}
                            />

                            {isExpanded && <div>Precisa de ajuda?</div>}
                        </button>
                    </div>

                    <div className="shrink-0 px-4 pt-4">
                        <button
                            type="button"
                            onClick={
                                currentAttendant
                                    ? () => setIsStatusMenuOpen((value) => !value)
                                    : undefined
                            }
                            title={profileName}
                            className={`flex w-full min-w-0 items-center rounded-xl border bg-white p-3 text-left transition-colors duration-150 ${
                                currentAttendant
                                    ? "cursor-pointer hover:bg-slate-50"
                                    : "cursor-default"
                            } ${
                                isExpanded
                                    ? "gap-3 border-border"
                                    : "justify-center border-transparent"
                            }`}
                        >
                            <div className="relative shrink-0">
                                <InitialsAvatar name={profileName} />

                                {currentAttendant && (
                                    <span
                                        className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
                                            currentAttendant.is_online
                                                ? "bg-green"
                                                : "bg-slate-400"
                                        }`}
                                    />
                                )}
                            </div>

                            {isExpanded && (
                                <div className="min-w-0 flex-1">
                                    <div
                                        title={profileName}
                                        className="truncate text-sm font-bold text-slate-950"
                                    >
                                        {profileName}
                                    </div>

                                    {profileSubtitle && (
                                        <div
                                            title={profileSubtitle}
                                            className="mt-0.5 truncate text-xs text-slate-500"
                                        >
                                            {profileSubtitle}
                                        </div>
                                    )}
                                </div>
                            )}
                        </button>
                    </div>
                </div>
            </aside>
        </div>
    );
}
