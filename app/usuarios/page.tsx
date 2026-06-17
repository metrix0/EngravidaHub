// app/usuarios/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Briefcase, ChevronRight,
    Crown,
    DollarSign,
    Headphones,
    Megaphone,
    ShieldCheck,
    UsersRound,
} from "lucide-react";

import {
    Card,
    SidePanel,
    Skeleton,
    DataTable,
    type DataTableColumn,
} from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";

type TabId =
    | "dashboard"
    | "mensagens"
    | "jornada"
    | "eventos"
    | "usuarios"
    | "inbox"
    | "clientes"
    | "funil";

type PresetId =
    | "admin"
    | "gestor"
    | "atendente"
    | "marketing"
    | "financeiro";

type ColorName = "purple" | "blue" | "green" | "orange" | "red";

type PermissionTab = {
    id: TabId;
    label: string;
    href: string;
    color: ColorName;
    position: number;
};

type PermissionPreset = {
    id: PresetId;
    name: string;
    description: string;
    color: ColorName;
    icon: "crown" | "briefcase" | "headphones" | "megaphone" | "dollar";
    default_tabs: TabId[];
};

type ApiUser = {
    id: string;
    email: string | null;
    name: string;
    created_at: string;
    last_sign_in_at: string | null;
};

type UserPermission = {
    auth_user_id: string;
    preset: PresetId;
    allowed_tabs: TabId[];
    attendant_id: string | null;
    active: boolean;
};

type Attendant = {
    id: string;
    name: string;
    email: string | null;
    active: boolean;
    is_online: boolean;
    auth_user_id: string | null;
    unit_id: string | null;
    unit_name: string;
};

type ApiResponse = {
    users: ApiUser[];
    permissions: UserPermission[];
    attendants: Attendant[];
};

type UserView = {
    id: string;
    email: string | null;
    name: string;
    preset: PermissionPreset | null;
    permission: UserPermission | null;
    allowed_tabs: TabId[];
    tabs: PermissionTab[];
    attendant: Attendant | null;
    attendant_id: string | null;
    unit_name: string;
    active: boolean;
};

const TABS: PermissionTab[] = [
    {
        id: "dashboard",
        label: "Dashboard",
        href: "/",
        color: "purple",
        position: 10,
    },
    {
        id: "mensagens",
        label: "Mensagens",
        href: "/mensagens",
        color: "purple",
        position: 20,
    },
    {
        id: "jornada",
        label: "Jornada",
        href: "/jornada",
        color: "purple",
        position: 30,
    },
    {
        id: "eventos",
        label: "Eventos",
        href: "/eventos",
        color: "orange",
        position: 40,
    },
    {
        id: "usuarios",
        label: "Usuários",
        href: "/usuarios",
        color: "red",
        position: 50,
    },
    {
        id: "inbox",
        label: "Inbox",
        href: "/inbox",
        color: "green",
        position: 60,
    },
    {
        id: "clientes",
        label: "Clientes",
        href: "/clientes",
        color: "green",
        position: 70,
    },
    {
        id: "funil",
        label: "Funil",
        href: "/funil",
        color: "green",
        position: 80,
    },
];

const PRESETS: PermissionPreset[] = [
    {
        id: "admin",
        name: "Admin",
        description: "Acesso completo",
        color: "purple",
        icon: "crown",
        default_tabs: [
            "dashboard",
            "mensagens",
            "jornada",
            "eventos",
            "usuarios",
            "inbox",
            "clientes",
            "funil",
        ],
    },
    {
        id: "gestor",
        name: "Gestor",
        description: "Visão operacional",
        color: "blue",
        icon: "briefcase",
        default_tabs: [
            "dashboard",
            "mensagens",
            "jornada",
            "eventos",
            "inbox",
            "clientes",
            "funil",
        ],
    },
    {
        id: "atendente",
        name: "Atendente",
        description: "Operação diária",
        color: "green",
        icon: "headphones",
        default_tabs: ["inbox", "clientes", "funil"],
    },
    {
        id: "marketing",
        name: "Marketing",
        description: "Métricas e eventos",
        color: "orange",
        icon: "megaphone",
        default_tabs: ["dashboard", "jornada", "eventos"],
    },
    {
        id: "financeiro",
        name: "Financeiro",
        description: "Eventos e relatórios",
        color: "red",
        icon: "dollar",
        default_tabs: ["eventos", "dashboard"],
    },
];

const colorClasses: Record<
    ColorName,
    {
        iconBg: string;
        iconText: string;
        softBg: string;
        text: string;
    }
> = {
    purple: {
        iconBg: "bg-purple-soft",
        iconText: "text-purple",
        softBg: "bg-purple-soft",
        text: "text-purple",
    },
    blue: {
        iconBg: "bg-blue-soft",
        iconText: "text-blue",
        softBg: "bg-blue-soft",
        text: "text-blue",
    },
    green: {
        iconBg: "bg-green-soft",
        iconText: "text-green",
        softBg: "bg-green-soft",
        text: "text-green",
    },
    orange: {
        iconBg: "bg-orange-soft",
        iconText: "text-orange",
        softBg: "bg-orange-soft",
        text: "text-orange",
    },
    red: {
        iconBg: "bg-red-soft",
        iconText: "text-red",
        softBg: "bg-red-soft",
        text: "text-red",
    },
};

const presetIcons = {
    crown: Crown,
    briefcase: Briefcase,
    headphones: Headphones,
    megaphone: Megaphone,
    dollar: DollarSign,
};

const EMPTY_VALUE = "—";

export default function UsuariosPage() {
    const [data, setData] = useState<ApiResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [savingUserId, setSavingUserId] = useState<string | null>(null);

    async function loadUsers() {
        setLoading(true);

        try {
            setError(null);

            const response = await fetch("/api/usuarios", {
                cache: "no-store",
            });

            const json: ApiResponse | { error?: string } = await response.json();

            if (!response.ok) {
                throw new Error(
                    "error" in json && json.error
                        ? json.error
                        : "Erro ao carregar usuários",
                );
            }

            setData(json as ApiResponse);
        } catch (loadError) {
            console.error("[usuarios] failed to load", loadError);
            setError(
                loadError instanceof Error
                    ? loadError.message
                    : "Erro ao carregar usuários",
            );
            setData(null);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadUsers();
    }, []);

    const users = useMemo<UserView[]>(() => {
        if (!data) return [];

        const permissionsByUserId = new Map(
            data.permissions.map((permission) => [
                permission.auth_user_id,
                permission,
            ]),
        );

        const attendantsById = new Map(
            data.attendants.map((attendant) => [attendant.id, attendant]),
        );

        const attendantsByAuthUserId = new Map<string, Attendant>();

        for (const attendant of data.attendants) {
            if (attendant.auth_user_id) {
                attendantsByAuthUserId.set(attendant.auth_user_id, attendant);
            }
        }

        return data.users.map((user) => {
            const permission = permissionsByUserId.get(user.id) ?? null;

            const preset =
                PRESETS.find((item) => item.id === permission?.preset) ?? null;

            const allowedTabs = normalizeAllowedTabs(
                permission?.allowed_tabs,
                permission ? [] : preset?.default_tabs ?? [],
            );

            const attendant = permission?.attendant_id
                ? attendantsById.get(permission.attendant_id) ?? null
                : attendantsByAuthUserId.get(user.id) ?? null;

            return {
                id: user.id,
                email: user.email,
                name: attendant?.name ?? user.name,
                preset,
                permission,
                allowed_tabs: allowedTabs,
                tabs: tabsFromIds(allowedTabs),
                attendant,
                attendant_id: attendant?.id ?? permission?.attendant_id ?? null,
                unit_name: attendant?.unit_name ?? EMPTY_VALUE,
                active: permission?.active ?? true,
            };
        });
    }, [data]);

    async function saveUserPermission(
        user: UserView,
        patch: Partial<{
            preset: PresetId;
            allowed_tabs: TabId[];
            attendant_id: string | null;
            active: boolean;
        }>,
    ) {
        const nextPresetId =
            patch.preset ??
            user.preset?.id ??
            user.permission?.preset ??
            "atendente";

        const nextPreset =
            PRESETS.find((preset) => preset.id === nextPresetId) ??
            PRESETS.find((preset) => preset.id === "atendente")!;

        const nextAllowedTabs =
            patch.allowed_tabs ??
            (patch.preset
                ? nextPreset.default_tabs
                : user.allowed_tabs.length > 0
                    ? user.allowed_tabs
                    : nextPreset.default_tabs);

        const nextAttendantId =
            patch.attendant_id !== undefined
                ? patch.attendant_id
                : user.attendant_id;

        const nextActive =
            patch.active !== undefined ? patch.active : user.active;

        try {
            setSavingUserId(user.id);
            setError(null);

            const response = await fetch("/api/usuarios", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    auth_user_id: user.id,
                    preset: nextPreset.id,
                    allowed_tabs: nextAllowedTabs,
                    attendant_id: nextAttendantId ?? "__none__",
                    active: nextActive,
                }),
            });

            const json = await response.json();

            if (!response.ok) {
                throw new Error(json.error ?? "Erro ao salvar permissões");
            }

            await loadUsers();
        } catch (saveError) {
            console.error("[usuarios] failed to save", saveError);
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : "Erro ao salvar permissões",
            );
        } finally {
            setSavingUserId(null);
        }
    }

    function toggleUserTab(user: UserView, tabId: TabId) {
        const nextTabs = user.allowed_tabs.includes(tabId)
            ? user.allowed_tabs.filter((item) => item !== tabId)
            : [...user.allowed_tabs, tabId];

        void saveUserPermission(user, {
            allowed_tabs: nextTabs,
        });
    }

    const userColumns: DataTableColumn<UserView>[] = [
        {
            id: "user",
            label: "Usuário",
            width: "23%",
            render: (user) => (
                <div className="flex min-w-0 items-center gap-3">
                    <InitialsAvatar name={user.name}/>

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
            id: "unit",
            label: "Unidade",
            width: "12%",
            render: (user) => (
                <div title={user.unit_name} className="truncate text-slate-700">
                    {user.unit_name}
                </div>
            ),
        },
        {
            id: "attendant",
            label: "Atendente",
            width: "17%",
            render: (user) => (
                <div
                    title={user.attendant?.name ?? EMPTY_VALUE}
                    className="truncate text-slate-700"
                >
                    {user.attendant?.name ?? EMPTY_VALUE}
                </div>
            ),
        },
        {
            id: "preset",
            label: "Preset",
            width: "13%",
            render: (user) =>
                user.preset ? (
                    <PermissionBadge
                        label={user.preset.name}
                        color={user.preset.color}
                    />
                ) : (
                    <span className="text-slate-400">{EMPTY_VALUE}</span>
                ),
        },
        {
            id: "tabs",
            label: "Abas permitidas",
            width: "22%",
            render: (user) => {
                const label = user.tabs.map((tab) => tab.label).join(", ") || EMPTY_VALUE;

                return (
                    <div
                        title={label}
                        className="truncate text-slate-700"
                    >
                        {label}
                    </div>
                );
            },
        },
        {
            id: "status",
            label: "Status",
            width: "9%",
            render: (user) => (
                <span
                    className={`inline-flex rounded-xl px-3 py-1.5 text-xs font-bold ${
                        user.active
                            ? "bg-green-soft text-green"
                            : "bg-red-soft text-red"
                    }`}
                >
                    {user.active ? "Ativo" : "Inativo"}
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

    if (loading) {
        return (
            <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
                <SidePanel />

                <section className="min-w-0 flex-1 px-8 py-8">
                    <UsuariosSkeleton />
                </section>
            </main>
        );
    }

    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel />

            <section className="min-w-0 flex-1 px-8 py-8 pb-16">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                        Usuários
                    </h1>

                    <p className="mt-2 text-sm text-slate-500">
                        Gerencie presets de acesso, abas disponíveis e vínculo com atendentes
                    </p>
                </header>

                {error && (
                    <div className="mb-6 rounded-2xl border border-red/20 bg-red-soft px-5 py-4 text-sm font-bold text-red">
                        {error}
                    </div>
                )}

                <section className="mb-6">
                    <Card>
                        <div className="mb-5">
                            <h2 className="text-lg font-bold">
                                Presets de acesso{" "}
                                <span className="text-slate-400">
                                    ({PRESETS.length})
                                </span>
                            </h2>

                            <p className="mt-1 text-sm text-slate-500">
                                Cada preset aplica um conjunto inicial de abas. Depois, as permissões podem ser ajustadas por usuário.
                            </p>
                        </div>

                        <div className="grid grid-cols-5 gap-4">
                            {PRESETS.map((preset) => (
                                <PresetCard
                                    key={preset.id}
                                    preset={preset}
                                    userCount={
                                        data?.permissions.filter(
                                            (permission) =>
                                                permission.preset === preset.id,
                                        ).length ?? 0
                                    }
                                />
                            ))}
                        </div>
                    </Card>
                </section>

                <section>
                    <div className="mb-5 px-6">
                        <h2 className="text-lg font-bold">
                            Usuários atribuídos{" "}
                            <span className="text-slate-500">
                                ({users.length})
                            </span>
                        </h2>

                        <p className="mt-1 text-sm text-slate-500">
                            Defina o preset, as abas permitidas e o perfil de atendente vinculado a cada usuário.
                        </p>
                    </div>

                    <DataTable
                        columns={userColumns}
                        rows={users}
                        getRowKey={(user) => user.id}
                    />
                </section>
            </section>
        </main>
    );
}

function PresetCard({
                        preset,
                        userCount,
                    }: {
    preset: PermissionPreset;
    userCount: number;
}) {
    const colors = getColorClasses(preset.color);
    const Icon = presetIcons[preset.icon] ?? ShieldCheck;
    const tabs = tabsFromIds(preset.default_tabs);
    const visibleTabs = tabs.slice(0, 6);
    const hiddenCount = Math.max(0, tabs.length - visibleTabs.length);

    return (
        <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-start gap-4">
                <div
                    className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${colors.iconBg} ${colors.iconText}`}
                >
                    <Icon size={26} />
                </div>

                <div className="min-w-0">
                    <h3
                        className={`truncate text-base font-bold ${colors.text}`}
                    >
                        {preset.name}
                    </h3>

                    <p className="mt-1 text-sm text-muted">
                        {preset.description}
                    </p>
                </div>
            </div>

            <div className="mb-4 flex items-center gap-2 text-sm text-muted">
                <UsersRound size={15} />
                <span>{userCount} usuários</span>
            </div>

            <div className="flex flex-wrap gap-2">
                {visibleTabs.map((tab) => (
                    <PermissionBadge
                        key={tab.id}
                        label={tab.label}
                        color={tab.color}
                    />
                ))}

                {hiddenCount > 0 && (
                    <span className="rounded-lg bg-purple-soft px-2.5 py-1 text-xs font-bold text-purple">
                        +{hiddenCount}
                    </span>
                )}
            </div>
        </div>
    );
}

function PermissionBadge({
                             label,
                             color,
                         }: {
    label: string;
    color: ColorName;
}) {
    const colors = getColorClasses(color);

    return (
        <span
            className={`inline-flex max-w-full truncate rounded-md px-2.5 py-1 text-xs font-bold ${colors.softBg} ${colors.text}`}
        >
            {label}
        </span>
    );
}

function tabsFromIds(ids: TabId[]) {
    return ids
        .map((id) => TABS.find((tab) => tab.id === id))
        .filter((tab): tab is PermissionTab => Boolean(tab))
        .sort((a, b) => a.position - b.position);
}

function normalizeAllowedTabs(
    value: TabId[] | null | undefined,
    fallback: TabId[],
) {
    const validTabIds = new Set(TABS.map((tab) => tab.id));

    if (!Array.isArray(value)) {
        return fallback;
    }

    return value.filter((tab): tab is TabId => validTabIds.has(tab));
}

function getColorClasses(color: ColorName) {
    return colorClasses[color] ?? colorClasses.blue;
}

function UsuariosSkeleton() {
    return (
        <>
            <div className="mb-8">
                <Skeleton className="h-9 w-[220px]" />
                <Skeleton className="mt-3 h-4 w-[430px]" />
            </div>

            <section className="mb-6">
                <Card>
                    <Skeleton className="mb-5 h-6 w-[220px]" />

                    <div className="grid grid-cols-5 gap-4">
                        {Array.from({ length: 5 }).map((_, index) => (
                            <Skeleton
                                key={index}
                                className="h-[190px] rounded-2xl"
                            />
                        ))}
                    </div>
                </Card>
            </section>

            <section>
                <Card>
                    <Skeleton className="mb-5 h-6 w-[220px]" />

                    <div className="space-y-2">
                        {Array.from({ length: 8 }).map((_, index) => (
                            <Skeleton
                                key={index}
                                className="h-[76px] rounded-xl"
                            />
                        ))}
                    </div>
                </Card>
            </section>
        </>
    );
}