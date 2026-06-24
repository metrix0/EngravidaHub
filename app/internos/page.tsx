// app/internos/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import {
    AdvancedFilterButton,
    DataTable,
    SidePanel,
    Skeleton,
    TableHeaderPreset,
    type DataTableColumn,
} from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { openInternalChat } from "@/components/conversations/FloatingConversationPanel";
import { fetchInternalUsers } from "@/lib/internal-chat/internalChatApi";
import type { InternalChatUser } from "@/types/internalChat";

const REFRESH_INTERVAL_MS = 15_000;

export default function InternosPage() {
    const [users, setUsers] = useState<InternalChatUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [statusValues, setStatusValues] = useState<string[]>([]);

    const loadUsers = useCallback(async ({ silent = false } = {}) => {
        if (!silent) setLoading(true);

        try {
            setError(null);
            const response = await fetchInternalUsers();
            setUsers(response);
        } catch (loadError) {
            console.error("[internos] failed to load users", loadError);
            setError(
                loadError instanceof Error
                    ? loadError.message
                    : "Não foi possível carregar os usuários internos",
            );
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadUsers();

        const interval = window.setInterval(
            () => void loadUsers({ silent: true }),
            REFRESH_INTERVAL_MS,
        );

        function handleVisibilityChange() {
            if (document.visibilityState === "visible") {
                void loadUsers({ silent: true });
            }
        }

        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            window.clearInterval(interval);
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );
        };
    }, [loadUsers]);

    const filteredUsers = useMemo(() => {
        const term = search.trim().toLowerCase();

        return users.filter((user) => {
            if (statusValues.length > 0) {
                const value = user.online ? "online" : "offline";
                if (!statusValues.includes(value)) return false;
            }

            if (!term) return true;

            return [
                user.name,
                user.email,
                user.preset,
                user.attendant_name,
                user.online ? "online" : "offline",
            ]
                .filter(Boolean)
                .some((value) =>
                    String(value).toLowerCase().includes(term),
                );
        });
    }, [search, statusValues, users]);

    const columns: DataTableColumn<InternalChatUser>[] = [
        {
            id: "user",
            label: "Usuário",
            width: "38%",
            render: (user) => (
                <div className="flex min-w-0 items-center gap-3">
                    <InitialsAvatar name={user.name} />

                    <div className="min-w-0">
                        <div className="truncate font-medium text-slate-700">
                            {user.name}
                        </div>
                        <div className="mt-1 truncate text-xs text-muted">
                            {user.email ?? "Sem e-mail"}
                        </div>
                    </div>
                </div>
            ),
        },
        {
            id: "profile",
            label: "Perfil",
            width: "20%",
            render: (user) => (
                <span className="truncate text-slate-700">
                    {formatPreset(user.preset)}
                </span>
            ),
        },
        {
            id: "attendant",
            label: "Atendente",
            width: "22%",
            render: (user) => (
                <span className="truncate text-slate-700">
                    {user.attendant_name ?? "—"}
                </span>
            ),
        },
        {
            id: "status",
            label: "Status",
            width: "16%",
            render: (user) => (
                <span
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-bold ${
                        user.online
                            ? "bg-green-soft text-green"
                            : "bg-slate-100 text-slate-500"
                    }`}
                >
                    <span
                        className={`h-2 w-2 rounded-full ${
                            user.online ? "bg-green" : "bg-slate-400"
                        }`}
                    />
                    {user.online ? "Online" : "Offline"}
                </span>
            ),
        },
        {
            id: "action",
            label: "",
            width: "4%",
            align: "right",
            render: () => (
                <ChevronRight
                    size={16}
                    className="text-slate-400 transition-colors group-hover:text-slate-700"
                />
            ),
        },
    ];

    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel />

            <section className="min-w-0 flex-1 px-8 py-8 pb-16">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                        Internos
                    </h1>
                    <p className="mt-2 text-sm text-slate-500">
                        Converse diretamente com outros usuários do sistema
                    </p>
                </header>

                {error ? (
                    <div className="mb-6 rounded-2xl border border-red/20 bg-red-soft px-5 py-4 text-sm font-bold text-red">
                        {error}
                    </div>
                ) : null}

                <section>
                    <TableHeaderPreset
                        title="Usuários"
                        count={filteredUsers.length}
                        searchValue={search}
                        onSearchChange={setSearch}
                        searchPlaceholder="Buscar usuário..."
                    >
                        <AdvancedFilterButton
                            sections={[
                                {
                                    id: "status",
                                    title: "Status",
                                    values: statusValues,
                                    onChange: setStatusValues,
                                    options: [
                                        { label: "Online", value: "online" },
                                        { label: "Offline", value: "offline" },
                                    ],
                                },
                            ]}
                        />
                    </TableHeaderPreset>

                    {loading ? (
                        <InternosTableSkeleton />
                    ) : (
                        <DataTable
                            columns={columns}
                            rows={filteredUsers}
                            getRowKey={(user) => user.id}
                            onRowClick={(user) => openInternalChat(user.id)}
                            emptyMessage="Nenhum usuário encontrado."
                        />
                    )}
                </section>
            </section>
        </main>
    );
}

function formatPreset(value: string | null) {
    if (!value || value === "__none__") return "Sem preset";

    return value.charAt(0).toUpperCase() + value.slice(1);
}

function InternosTableSkeleton() {
    return (
        <div className="space-y-2 px-6 py-5">
            {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton
                    key={index}
                    className="h-[68px] rounded-xl"
                />
            ))}
        </div>
    );
}
