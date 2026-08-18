// components/layout/SidePanel.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    BriefcaseBusiness,
    CalendarDays,
    ChevronRight,
    CircleDollarSign,
    Flag,
    Funnel,
    HelpCircle,
    LayoutDashboard,
    LogOut,
    Menu,
    Megaphone,
    MessageCircle,
    MessagesSquare,
    Send,
    Sparkles,
    UserCog,
    Users,
    X,
} from "lucide-react";

import { useCurrentUser } from "@/components/auth/CurrentUserProvider";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { Modal } from "@/components/ui/Modal";
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
import { formatSystemUserName } from "@/lib/users/formatSystemUserName";

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
    affectLayout?: boolean;
    defaultExpanded?: boolean;
    persistent?: boolean;
};

const COLLAPSED_WIDTH = 76;
const EXPANDED_WIDTH = 250;

const defaultItems: SidePanelEntry[] = [
    {
        label: "Dashboard",
        href: "/",
        icon: <LayoutDashboard size={18} />,
        tabId: "dashboard",
    },
    {
        label: "Financeiro",
        href: "/financeiro",
        icon: <CircleDollarSign size={18} />,
        tabId: "financeiro",
    },
    {
        label: "Jornada",
        href: "/jornada",
        icon: <Flag size={18} />,
        tabId: "jornada",
    },
    {
        label: "Eventos",
        href: "/eventos",
        icon: <Megaphone size={18} />,
        tabId: "eventos",
    },
    {
        label: "Assistente IA",
        href: "/assistente",
        icon: <Sparkles size={18} />,
        tabId: "assistente",
    },
    { type: "separator", id: "crm" },
    {
        label: "Inbox",
        href: "/inbox",
        icon: <MessagesSquare size={18} />,
        tabId: "inbox",
    },
    {
        label: "Agendamentos",
        href: "/agendamentos",
        icon: <CalendarDays size={18} />,
        tabId: "agendamentos",
    },
    {
        label: "Clientes",
        href: "/clientes",
        icon: <Users size={18} />,
        tabId: "clientes",
    },
    {
        label: "Conversas",
        href: "/conversas",
        icon: <MessageCircle size={18} />,
        tabId: "conversas",
    },
    {
        label: "Funil",
        href: "/funil",
        icon: <Funnel size={18} />,
        tabId: "funil",
    },
    {
        label: "Mensagem Ativa",
        href: "/mensagem-ativa",
        icon: <Send size={18} />,
        tabId: "mensagem_ativa",
    },
    { type: "separator", id: "usuarios" },

    {
        label: "Internos",
        href: "/internos",
        icon: <BriefcaseBusiness size={18} />,
        tabId: "internos",
    },
    {
        label: "Usuários",
        href: "/usuarios",
        icon: <UserCog size={18} />,
        tabId: "usuarios",
    },
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
        if (
            isSeparator(entry) &&
            (compacted.length === 0 ||
                isSeparator(compacted[compacted.length - 1]))
        ) {
            continue;
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
    const shouldHide =
        pathname === "/login" ||
        pathname === "/registrar" ||
        pathname.startsWith("/registrar/") ||
        pathname.startsWith("/dev");

    if (!props.persistent || shouldHide) return null;
    return <PersistentSidePanel {...props} />;
}

function PersistentSidePanel({
    items = defaultItems,
    affectLayout,
    defaultExpanded,
}: SidePanelProps) {
    const pathname = usePathname();
    const router = useRouter();
    const { currentUser } = useCurrentUser();
    const currentUserId = currentUser?.user?.id ?? null;
    const cachedAttendant = getCachedCurrentAttendant(currentUserId);

    const isCompactPage =
        pathname.startsWith("/inbox") ||
        pathname.startsWith("/agendamentos") ||
        pathname.startsWith("/assistente") ||
        pathname.startsWith("/funil");
    const resolvedAffectLayout = affectLayout ?? !isCompactPage;
    const [isExpanded, setIsExpanded] = useState(
        () => defaultExpanded ?? !isCompactPage,
    );
    const [currentAttendant, setCurrentAttendant] =
        useState<CurrentAttendant | null>(
            () => cachedAttendant?.attendant ?? null,
        );
    const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
    const [isStatusUpdating, setIsStatusUpdating] = useState(false);
    const [helpModalOpen, setHelpModalOpen] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        if (isCompactPage) setIsExpanded(false);
    }, [isCompactPage]);

    useEffect(() => {
        setMobileOpen(false);
        setIsStatusMenuOpen(false);
    }, [pathname]);

    useEffect(() => {
        let mounted = true;

        async function loadCurrentAttendant(force = false) {
            if (!currentUserId) {
                if (mounted) setCurrentAttendant(null);
                return;
            }

            const cached = getCachedCurrentAttendant(currentUserId);
            if (cached && mounted) setCurrentAttendant(cached.attendant);

            try {
                const response = await fetchCurrentAttendant({
                    force,
                    userId: currentUserId,
                });
                if (mounted) setCurrentAttendant(response.attendant);
            } catch (error) {
                console.error(
                    "[SidePanel] failed to load current attendant",
                    error,
                );
            }
        }

        function refreshAttendant() {
            void loadCurrentAttendant(true);
        }

        void loadCurrentAttendant(true);
        window.addEventListener("attendant-status-changed", refreshAttendant);
        window.addEventListener(
            "current-user-permissions-changed",
            refreshAttendant,
        );

        return () => {
            mounted = false;
            window.removeEventListener(
                "attendant-status-changed",
                refreshAttendant,
            );
            window.removeEventListener(
                "current-user-permissions-changed",
                refreshAttendant,
            );
        };
    }, [currentUserId]);

    const permission = currentUser?.permission ?? null;
    const allowedTabs = useMemo(
        () => (permission?.active ? permission.allowed_tabs : []),
        [permission],
    );

    const visibleItems = useMemo(
        () =>
            currentUser?.user
                ? filterEntriesByPermission(items, allowedTabs)
                : [],
        [allowedTabs, currentUser?.user, items],
    );

    const sidebarWidth = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
    const layoutWidth = resolvedAffectLayout ? sidebarWidth : COLLAPSED_WIDTH;
    const profileName = formatSystemUserName(
        currentAttendant?.name ??
            currentUser?.user?.name ??
            currentUser?.user?.email,
    );
    const profileSubtitle = currentAttendant
        ? currentAttendant.is_online
            ? "Online"
            : "Offline"
        : "";
    const homeHref = getFirstAllowedHref(allowedTabs) ?? pathname;

    async function handleLogout() {
        const supabase = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );

        await supabase.auth.signOut();
        window.location.replace("/login");
    }

    async function handleToggleAttendantStatus() {
        if (!currentAttendant || isStatusUpdating) return;

        setIsStatusUpdating(true);
        try {
            const response = currentAttendant.is_online
                ? await setCurrentAttendantOffline()
                : await setCurrentAttendantOnline();

            setCurrentAttendant((current) => {
                if (response.attendant) return response.attendant;
                return current
                    ? { ...current, is_online: !current.is_online }
                    : null;
            });
            setIsStatusMenuOpen(false);
            window.dispatchEvent(new Event("attendant-status-changed"));

            if (pathname.startsWith("/inbox")) {
                window.location.reload();
            } else {
                router.refresh();
            }
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
            className="relative z-50 h-14 w-full shrink-0 transition-[width] duration-300 ease-out max-md:!w-full md:h-screen md:w-auto"
            style={{ width: layoutWidth, willChange: "width" }}
        >
            <div className="fixed inset-x-0 top-0 z-[70] flex h-14 items-center justify-between border-b border-border bg-white px-4 shadow-sm md:hidden">
                <Link href={homeHref} onClick={() => setMobileOpen(false)} className="flex min-w-0 items-center">
                    <img src="/logo.png" className="h-8 w-auto max-w-[190px] object-contain" alt="Engravida" />
                </Link>
                <button
                    type="button"
                    onClick={() => setMobileOpen((value) => !value)}
                    className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100"
                    aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
                    aria-expanded={mobileOpen}
                >
                    {mobileOpen ? <X size={21} /> : <Menu size={21} />}
                </button>
            </div>

            {mobileOpen ? (
                <button
                    type="button"
                    aria-label="Fechar menu"
                    onClick={() => setMobileOpen(false)}
                    className="fixed inset-x-0 bottom-0 top-14 z-40 bg-slate-950/25 md:hidden"
                />
            ) : null}

            <aside
                className={`group fixed left-0 top-14 z-50 h-[calc(100dvh-3.5rem)] max-h-screen w-[320px] max-w-[86vw] overflow-visible border-r border-border bg-card shadow-sm transition-[width,box-shadow,transform] duration-300 ease-out max-md:!w-[320px] md:top-0 md:h-screen md:max-w-none md:translate-x-0 ${
                    mobileOpen ? "translate-x-0" : "-translate-x-full"
                }`}
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
                    className={`absolute top-[46px] z-[60] hidden h-9 w-9 cursor-pointer md:flex items-center justify-center rounded-xl border border-border bg-white text-muted shadow-sm transition-[right,opacity,background-color,color] duration-200 hover:bg-selection hover:text-text ${
                        isExpanded
                            ? "pointer-events-none -right-5 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
                            : "pointer-events-auto right-5 opacity-100"
                    }`}
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
                        className={`fixed bottom-20 left-4 z-[90] w-52 rounded-xl border border-border bg-white p-2 shadow-lg transition-[left] duration-200 md:bottom-7 md:w-44 ${
                            isExpanded ? "md:left-[258px]" : "md:left-[84px]"
                        }`}
                    >
                        <button
                            type="button"
                            onClick={() => void handleToggleAttendantStatus()}
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

                        <div className="my-1 h-px bg-border" />

                        <button
                            type="button"
                            onClick={() => void handleLogout()}
                            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-red transition hover:bg-red-soft"
                        >
                            <LogOut size={17} />
                            <span>Sair</span>
                        </button>
                    </div>
                )}

                <div className="flex h-full max-h-screen flex-col overflow-hidden py-7">
                    <div className="relative mb-6 flex h-10 shrink-0 items-center px-5">
                        <Link
                            href={homeHref}
                            className="flex h-10 w-full min-w-0 cursor-pointer items-center overflow-hidden rounded-xl"
                        >
                            <img
                                src="/logo.png"
                                className={`block max-h-9 w-full shrink-0 object-contain opacity-100 transition-opacity duration-150 ${
                                    isExpanded ? "md:opacity-100" : "md:opacity-0"
                                }`}
                                alt="Engravida"
                            />
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
                                                className="my-3 flex h-px items-center px-3"
                                            >
                                                <div
                                                    className={`h-px w-full bg-border transition-[width] duration-200 ${
                                                        isExpanded
                                                            ? "md:w-full"
                                                            : "md:w-5"
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
                                            onClick={() => setMobileOpen(false)}
                                            className={`flex h-11 w-full cursor-pointer items-center overflow-hidden rounded-xl px-3 py-3 text-sm leading-none transition-colors duration-150 ${
                                                isActive
                                                    ? "bg-brand-soft font-semibold text-brand"
                                                    : "font-medium text-muted hover:bg-selection"
                                            }`}
                                        >
                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                                                {item.icon}
                                            </span>
                                            <span
                                                className={`ml-4 min-w-0 w-[200px] translate-x-0 whitespace-nowrap leading-none opacity-100 transition-[width,margin,opacity,transform] duration-150 ${
                                                    isExpanded
                                                        ? "md:ml-4 md:w-[160px] md:translate-x-0 md:opacity-100"
                                                        : "md:ml-0 md:w-0 md:-translate-x-1 md:opacity-0"
                                                }`}
                                            >
                                                {item.label}
                                            </span>
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
                            onClick={() => setHelpModalOpen(true)}
                            title="Precisa de ajuda?"
                            className={`flex h-12 w-full cursor-pointer items-center overflow-hidden rounded-xl border px-3 text-xs text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-text ${
                                isExpanded ? "md:border-border" : "md:border-transparent"
                            }`}
                        >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center text-brand">
                                <HelpCircle size={22} />
                            </span>
                            <span
                                className={`ml-3 w-[200px] whitespace-nowrap opacity-100 transition-[width,margin,opacity] duration-150 ${
                                    isExpanded
                                        ? "md:ml-3 md:w-[150px] md:opacity-100"
                                        : "md:ml-0 md:w-0 md:opacity-0"
                                }`}
                            >
                                Precisa de ajuda?
                            </span>
                        </button>
                    </div>

                    <div className="shrink-0 px-4 pt-4">
                        <button
                            type="button"
                            onClick={
                                currentAttendant
                                    ? () =>
                                          setIsStatusMenuOpen((value) => !value)
                                    : undefined
                            }
                            title={profileName}
                            className={`flex h-16 w-full min-w-0 items-center overflow-hidden rounded-xl border bg-white text-left transition-[padding,background-color] duration-150 ${
                                isExpanded ? "md:px-2" : "md:px-1"
                            } max-md:px-2 ${
                                currentAttendant
                                    ? "cursor-pointer hover:bg-slate-50"
                                    : "cursor-default"
                            } ${
                                isExpanded ? "md:border-border" : "md:border-transparent"
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
                            <div
                                className={`ml-3 min-w-0 w-[200px] opacity-100 transition-[width,margin,opacity] duration-150 ${
                                    isExpanded
                                        ? "md:ml-3 md:w-[150px] md:opacity-100"
                                        : "md:ml-0 md:w-0 md:opacity-0"
                                }`}
                            >
                                <div className="truncate text-sm font-bold text-slate-950">
                                    {profileName}
                                </div>
                                {profileSubtitle && (
                                    <div className="mt-0.5 truncate text-xs text-slate-500">
                                        {profileSubtitle}
                                    </div>
                                )}
                            </div>
                        </button>
                    </div>
                </div>
            </aside>

            <Modal
                open={helpModalOpen}
                onClose={() => setHelpModalOpen(false)}
                width={480}
                height="auto"
                maxHeight="calc(100vh - 48px)"
                zIndexClassName="z-[100]"
                ariaLabelledBy="sidepanel-help-title"
            >
                <div className="p-7">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                        <HelpCircle size={23} />
                    </div>
                    <h2
                        id="sidepanel-help-title"
                        className="mt-5 text-xl font-bold text-slate-950"
                    >
                        Precisa de ajuda?
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500">
                        Entre em contato com o suporte do Engravida Hub pelo e-mail abaixo.
                    </p>
                    <a
                        href="mailto:joao.almeida@engravida.com.br"
                        className="mt-5 block rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-brand transition hover:bg-brand-soft"
                    >
                        joao.almeida@engravida.com.br
                    </a>
                </div>
            </Modal>
        </div>
    );
}