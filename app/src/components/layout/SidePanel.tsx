// apps/insights/src/components/layout/SidePanel.tsx
"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    HelpCircle,
    LayoutDashboard,
    MessageCircle,
    RefreshCcw,
    Megaphone,
    Flag,
} from "lucide-react";

type SidePanelItem = {
    label: string;
    href: string;
    icon: ReactNode;
};

type SidePanelProps = {
    items?: SidePanelItem[];
};

const defaultItems: SidePanelItem[] = [
    { label: "Dashboard", href: "/", icon: <LayoutDashboard size={18} /> },
    { label: "Mensagens", href: "/mensagens", icon: <MessageCircle size={18} /> },
    { label: "Jornada", href: "/jornada", icon: <Flag size={18} /> },
    { label: "Eventos", href: "/eventos", icon: <Megaphone size={18} /> },
    // { label: "Atendentes", href: "/atendentes", icon: <Users size={18} /> },
    // { label: "Relatórios", href: "/relatorios", icon: <FileText size={18} /> },
    // { label: "Configurações", href: "/configuracoes", icon: <Settings size={18} /> },
];

export default function SidePanel({ items = defaultItems }: SidePanelProps) {
    const router = useRouter();
    const pathname = usePathname();

    const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>(new Date());
    const [now, setNow] = useState<Date>(new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        const interval = window.setInterval(() => {
            setNow(new Date());
        }, 30_000);

        return () => window.clearInterval(interval);
    }, []);

    const updatedLabel = useMemo(() => {
        return formatTimeAgo(lastUpdatedAt, now)
    }, [lastUpdatedAt, now]);

    function handleRefresh() {
        setIsRefreshing(true);
        setLastUpdatedAt(new Date());
        setNow(new Date());

        router.refresh();

        window.setTimeout(() => {
            setIsRefreshing(false);
        }, 500);
    }

    return (
        <aside className="sticky left-0 top-0 z-40 flex h-screen max-h-screen w-[250px] flex-col overflow-y-auto border-r border-border bg-card px-6 py-7">
            <Link
                href="/apps/insights/public"
                className="mb-10 flex cursor-pointer items-center gap-2 rounded-xl transition hover:bg-slate-50"
            >
                <img src="/logo.png" className="w-full" alt="Engravida" />
            </Link>

            <nav className="space-y-2">
                {items.map((item) => {
                    const isActive =
                        item.href === "/"
                            ? pathname === "/"
                            : pathname.startsWith(item.href);

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex cursor-pointer items-center gap-4 rounded-xl px-4 py-3 text-sm transition-colors duration-150 ${
                                isActive
                                    ? "bg-brand-soft font-semibold text-brand"
                                    : "font-medium text-muted hover:bg-selection"
                            }`}
                        >
                            {item.icon}
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            <div className="mt-auto space-y-4">
                <button
                    type="button"
                    onClick={handleRefresh}
                    className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-border p-4 text-left text-sm text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-text"
                >
                    <div>Atualizado {updatedLabel}</div>

                    <RefreshCcw
                        size={18}
                        className={`min-w-[18px] ml-1 ${isRefreshing ? "animate-spin" : ""}`}
                    />
                </button>

                <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-xs text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-text"
                >
                    <HelpCircle className="text-brand" size={22} />
                    <div>Precisa de ajuda?</div>
                </button>
            </div>
        </aside>
    );
}

function formatTimeAgo(date: Date, now: Date): string {
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);

    if (diffSeconds < 30) return "agora";
    if (diffMinutes < 1) return "há menos de 1 minuto";
    if (diffMinutes === 1) return "há 1 minuto";
    if (diffMinutes < 60) return `há  ${diffMinutes} minutos`;
    if (diffHours === 1) return "há 1 hora";

    return `há ${diffHours} horas`;
}