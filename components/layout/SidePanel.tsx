// components/layout/SidePanel.tsx
"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    ChevronRight,
    Flag,
    Funnel,
    HelpCircle,
    LayoutDashboard,
    Megaphone,
    MessageCircle,
    MessagesSquare,
    RefreshCcw,
    Users,
} from "lucide-react";

import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import {
    fetchCurrentAttendant,
    setCurrentAttendantOffline,
    setCurrentAttendantOnline,
    type CurrentAttendant,
} from "@/lib/attendants/currentAttendantApi";

type SidePanelItem = {
    label: string;
    href: string;
    icon: ReactNode;
};

type SidePanelProps = {
    items?: SidePanelItem[];

    /**
     * true  = expanded sidebar changes page layout width
     * false = expanded sidebar floats over page
     */
    affectLayout?: boolean;

    /**
     * Initial open state.
     * Example: inbox can use defaultExpanded={false}
     */
    defaultExpanded?: boolean;
};

const COLLAPSED_WIDTH = 76;
const EXPANDED_WIDTH = 250;

const defaultItems: SidePanelItem[] = [
    { label: "Dashboard", href: "/", icon: <LayoutDashboard size={18} /> },

    // Insights
    { label: "Mensagens", href: "/mensagens", icon: <MessageCircle size={18} /> },
    { label: "Jornada", href: "/jornada", icon: <Flag size={18} /> },
    { label: "Eventos", href: "/eventos", icon: <Megaphone size={18} /> },

    // CRM
    { label: "Inbox", href: "/inbox", icon: <MessagesSquare size={18} /> },
    { label: "Clientes", href: "/clientes", icon: <Users size={18} /> },
    { label: "Funil", href: "/funil", icon: <Funnel size={18} /> },
];

export default function SidePanel({
                                         items = defaultItems,
                                         affectLayout = true,
                                         defaultExpanded = true,
                                     }: SidePanelProps) {
    const router = useRouter();
    const pathname = usePathname();

    const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>(new Date());
    const [now, setNow] = useState<Date>(new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [isSidebarHovered, setIsSidebarHovered] = useState(false);

    const [currentAttendant, setCurrentAttendant] =
        useState<CurrentAttendant | null>(null);
    const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
    const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
    const [isStatusUpdating, setIsStatusUpdating] = useState(false);

    useEffect(() => {
        const interval = window.setInterval(() => {
            setNow(new Date());
        }, 30_000);

        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        let isMounted = true;

        async function loadCurrentAttendant() {
            try {
                const response = await fetchCurrentAttendant();

                if (!isMounted) return;

                setCurrentAttendant(response.attendant);
                setCurrentUserEmail(response.user?.email ?? null);
            } catch (error) {
                console.error(
                    "[SidePanel] failed to load current attendant",
                    error
                );
            }
        }

        function handleAttendantStatusChanged() {
            void loadCurrentAttendant();
        }

        void loadCurrentAttendant();

        window.addEventListener(
            "attendant-status-changed",
            handleAttendantStatusChanged
        );

        return () => {
            isMounted = false;
            window.removeEventListener(
                "attendant-status-changed",
                handleAttendantStatusChanged
            );
        };
    }, []);

    const updatedLabel = useMemo(() => {
        return formatTimeAgo(lastUpdatedAt, now);
    }, [lastUpdatedAt, now]);

    const sidebarWidth = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

    const layoutWidth = affectLayout ? sidebarWidth : COLLAPSED_WIDTH;

    const profileName =
        currentAttendant?.name ?? currentUserEmail ?? "Usuário";

    const profileSubtitle = currentAttendant
        ? currentAttendant.units?.name ?? "Sem unidade"
        : "Não vinculado a atendente";

    function handleRefresh() {
        setIsRefreshing(true);
        setLastUpdatedAt(new Date());
        setNow(new Date());

        router.refresh();

        window.setTimeout(() => {
            setIsRefreshing(false);
        }, 500);
    }

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
                error
            );
        } finally {
            setIsStatusUpdating(false);
        }
    }

    return (
        <div
            className="relative z-50 h-screen shrink-0 transition-[width] duration-300 ease-out"
            style={{ width: layoutWidth }}
        >
            <aside
                onMouseEnter={() => setIsSidebarHovered(true)}
                onMouseLeave={() => setIsSidebarHovered(false)}
                className="fixed left-0 top-0 z-50 h-screen max-h-screen overflow-visible border-r border-border bg-card shadow-sm transition-[width,box-shadow] duration-300 ease-out"
                style={{
                    width: sidebarWidth,
                    boxShadow:
                        !affectLayout && isExpanded
                            ? "0 25px 50px -12px rgb(15 23 42 / 0.18)"
                            : undefined,
                }}
            >
                <button
                    type="button"
                    onClick={() => setIsExpanded((value) => !value)}
                    className={`absolute top-[46px] z-[60] flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-border bg-white text-muted shadow-sm transition-all duration-200 hover:bg-selection hover:text-text ${
                        !isExpanded || isSidebarHovered
                            ? "pointer-events-auto opacity-100"
                            : "pointer-events-none opacity-0"
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
                                        ? "bg-red"
                                        : "bg-green"
                                }`}
                            />
                        </button>
                    </div>
                )}

                <div className="flex h-full max-h-screen flex-col overflow-y-auto overflow-x-hidden py-7">
                    <div className="relative mb-10 flex h-10 items-center px-5">
                        <Link
                            href="/"
                            className={`flex h-10 min-w-0 cursor-pointer items-center rounded-xl transition hover:bg-slate-50 ${
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

                    <nav className="space-y-2 px-4">
                        {items.map((item) => {
                            const isActive =
                                item.href === "/"
                                    ? pathname === "/"
                                    : pathname.startsWith(item.href);

                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    title={item.label}
                                    className={`flex cursor-pointer items-center gap-4 rounded-xl px-4 py-3 text-sm transition-colors duration-150 ${
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
                                        <span className="min-w-0 truncate">
                                            {item.label}
                                        </span>
                                    )}
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="mt-auto space-y-4 px-4">
                        {/*<button*/}
                        {/*    type="button"*/}
                        {/*    onClick={handleRefresh}*/}
                        {/*    title={`Atualizado ${updatedLabel}`}*/}
                        {/*    className={`flex w-full min-w-0 cursor-pointer items-center truncate rounded-xl border p-4 text-left text-sm text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-text ${*/}
                        {/*        isExpanded*/}
                        {/*            ? "justify-between gap-3 border-border"*/}
                        {/*            : "justify-center border-transparent px-0"*/}
                        {/*    }`}*/}
                        {/*>*/}
                        {/*    {isExpanded && (*/}
                        {/*        <div className="min-w-0 flex-1 truncate">*/}
                        {/*            Atualizado {updatedLabel}*/}
                        {/*        </div>*/}
                        {/*    )}*/}

                        {/*    <RefreshCcw*/}
                        {/*        size={18}*/}
                        {/*        className={`min-w-[18px] ${*/}
                        {/*            isRefreshing ? "animate-spin" : ""*/}
                        {/*        }`}*/}
                        {/*    />*/}
                        {/*</button>*/}

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

                        <button
                            type="button"
                            onClick={() =>
                                setIsStatusMenuOpen((value) => !value)
                            }
                            title={profileName}
                            className={`flex w-full min-w-0 cursor-pointer items-center rounded-xl border bg-white p-3 text-left transition-colors duration-150 hover:bg-slate-50 ${
                                isExpanded
                                    ? "gap-3 border-border"
                                    : "justify-center border-transparent"
                            }`}
                        >
                            <div className="relative shrink-0">
                                <InitialsAvatar name={profileName} />
                                <span
                                    className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
                                        currentAttendant?.is_online
                                            ? "bg-green"
                                            : "bg-red"
                                    }`}
                                />
                            </div>

                            {isExpanded && (
                                <div className="min-w-0 flex-1">
                                    <div
                                        title={profileName}
                                        className="truncate text-sm font-bold text-slate-950"
                                    >
                                        {profileName}
                                    </div>

                                    <div
                                        title={profileSubtitle}
                                        className="mt-0.5 truncate text-xs text-slate-500"
                                    >
                                        {profileSubtitle}
                                    </div>
                                </div>
                            )}
                        </button>
                    </div>
                </div>
            </aside>
        </div>
    );
}

function formatTimeAgo(date: Date, now: Date): string {
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);

    if (diffSeconds < 30) return "agora";
    if (diffMinutes < 1) return "há 1 minuto";
    if (diffMinutes === 1) return "há 1 minuto";
    if (diffMinutes < 60) return `há ${diffMinutes} minutos`;
    if (diffHours === 1) return "há 1 hora";

    return `há ${diffHours} horas`;
}