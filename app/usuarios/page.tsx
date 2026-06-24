// app/usuarios/page.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    Briefcase,
    Check,
    ChevronRight,
    Crown,
    Headphones,
    Megaphone,
    ShieldCheck,
} from "lucide-react";

import {
    SidePanel,
    Skeleton,
    AdvancedFilterButton,
    DataTable,
    TableHeaderPreset,
    HoverBadgeList,
    DetailsSidePanel,
    DropdownSelect,
    type HoverBadgeListItem,
    type DataTableColumn,
    type DropdownSelectOption,
} from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";

type TabId =
    | "dashboard"
    | "conversas"
    | "jornada"
    | "eventos"
    | "usuarios"
    | "inbox"
    | "internos"
    | "clientes"
    | "funil";

type PresetId = "admin" | "gestor" | "atendente" | "marketing";

const NO_PRESET_ID = "__none__" as const;
const NO_VALUE_ID = "__none__" as const;
type AccessPresetId = PresetId | typeof NO_PRESET_ID;

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
    color: ColorName;
    icon: "crown" | "briefcase" | "headphones" | "megaphone";
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
    preset: AccessPresetId;
    allowed_tabs: TabId[];
    attendant_id: string | null;
    active: boolean;
};

type Queue = {
    id: string;
    name: string;
    sector: string;
    unit_id: string | null;
    unit_name: string | null;
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
    queue_id: string | null;
    queue_name: string | null;
};

type ApiResponse = {
    users: ApiUser[];
    permissions: UserPermission[];
    attendants: Attendant[];
    queues: Queue[];
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
    queue_id: string | null;
    queue_name: string;
    active: boolean;
};

const TABS: PermissionTab[] = [
    { id: "dashboard", label: "Dashboard", href: "/", color: "blue", position: 10 },
    { id: "conversas", label: "Conversas", href: "/conversas", color: "green", position: 20 },
    { id: "jornada", label: "Jornada", href: "/jornada", color: "blue", position: 30 },
    { id: "eventos", label: "Eventos", href: "/eventos", color: "orange", position: 40 },
    { id: "usuarios", label: "Usuários", href: "/usuarios", color: "red", position: 50 },
    { id: "inbox", label: "Inbox", href: "/inbox", color: "green", position: 60 },
    { id: "internos", label: "Internos", href: "/internos", color: "purple", position: 70 },
    { id: "clientes", label: "Clientes", href: "/clientes", color: "green", position: 80 },
    { id: "funil", label: "Funil", href: "/funil", color: "green", position: 90 },
];

const PRESETS: PermissionPreset[] = [
    {
        id: "admin",
        name: "Admin",
        color: "red",
        icon: "crown",
        default_tabs: [
            "dashboard",
            "conversas",
            "jornada",
            "eventos",
            "usuarios",
            "inbox",
            "internos",
            "clientes",
            "funil",
        ],
    },
    {
        id: "gestor",
        name: "Gestor",
        color: "blue",
        icon: "briefcase",
        default_tabs: [
            "dashboard",
            "conversas",
            "jornada",
            "eventos",
            "inbox",
            "internos",
            "clientes",
            "funil",
        ],
    },
    {
        id: "atendente",
        name: "Atendente",
        color: "green",
        icon: "headphones",
        default_tabs: ["inbox", "internos", "clientes", "funil"],
    },
    {
        id: "marketing",
        name: "Marketing",
        color: "orange",
        icon: "megaphone",
        default_tabs: ["dashboard", "jornada", "eventos", "internos"],
    },
];

const colorClasses: Record<
    ColorName,
    { iconBg: string; iconText: string; softBg: string; text: string }
> = {
    purple: { iconBg: "bg-purple-soft", iconText: "text-purple", softBg: "bg-purple-soft", text: "text-purple" },
    blue: { iconBg: "bg-blue-soft", iconText: "text-blue", softBg: "bg-blue-soft", text: "text-blue" },
    green: { iconBg: "bg-green-soft", iconText: "text-green", softBg: "bg-green-soft", text: "text-green" },
    orange: { iconBg: "bg-orange-soft", iconText: "text-orange", softBg: "bg-orange-soft", text: "text-orange" },
    red: { iconBg: "bg-red-soft", iconText: "text-red", softBg: "bg-red-soft", text: "text-red" },
};

const presetIcons = {
    crown: Crown,
    briefcase: Briefcase,
    headphones: Headphones,
    megaphone: Megaphone,
};

const EMPTY_VALUE = "—";

const TAB_COLOR_ORDER: Record<ColorName, number> = {
    blue: 10,
    green: 20,
    orange: 30,
    red: 40,
    purple: 50,
};

export default function UsuariosPage() {
    const [data, setData] = useState<ApiResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [savingUserId, setSavingUserId] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [presetValues, setPresetValues] = useState<string[]>([]);
    const [statusValues, setStatusValues] = useState<string[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

    async function loadUsers() {
        setLoading(true);

        try {
            setError(null);

            const response = await fetch("/api/usuarios", { cache: "no-store" });
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
                permission?.preset === NO_PRESET_ID
                    ? null
                    : PRESETS.find((item) => item.id === permission?.preset) ?? null;
            const allowedTabs = normalizeAllowedTabs(
                permission?.allowed_tabs,
                permission ? [] : preset?.default_tabs ?? [],
            );
            const attendant = permission
                ? permission.attendant_id
                    ? attendantsById.get(permission.attendant_id) ?? null
                    : null
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
                attendant_id: permission
                    ? permission.attendant_id
                    : attendant?.id ?? null,
                unit_name: attendant?.unit_name ?? "Todas",
                queue_id: attendant?.queue_id ?? null,
                queue_name: attendant?.queue_name ?? "Nenhum",
                active: permission?.active ?? true,
            };
        });
    }, [data]);

    const filteredUsers = useMemo(() => {
        const term = search.trim().toLowerCase();

        return users.filter((user) => {
            if (presetValues.length > 0) {
                const userPresetValue = user.preset?.id ?? NO_PRESET_ID;
                if (!presetValues.includes(userPresetValue)) return false;
            }

            if (statusValues.length > 0) {
                const statusValue = user.active ? "active" : "inactive";
                if (!statusValues.includes(statusValue)) return false;
            }

            if (!term) return true;

            const tabsLabel = user.tabs.map((tab) => tab.label).join(" ");

            return [
                user.name,
                user.email,
                user.unit_name,
                user.attendant?.name,
                user.preset?.name,
                user.queue_name,
                tabsLabel,
                user.active ? "ativo" : "inativo",
            ]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(term));
        });
    }, [users, search, presetValues, statusValues]);

    const selectedUser = useMemo(() => {
        if (!selectedUserId) return null;
        return users.find((user) => user.id === selectedUserId) ?? null;
    }, [users, selectedUserId]);

    async function saveUserPermission(
        user: UserView,
        patch: Partial<{
            preset: AccessPresetId;
            allowed_tabs: TabId[];
            attendant_id: string | null;
            queue_id: string | null;
            active: boolean;
        }>,
    ) {
        if (!data) return;

        const patchHasPreset = patch.preset !== undefined;
        const nextPresetId = patchHasPreset
            ? patch.preset!
            : user.preset?.id ?? user.permission?.preset ?? NO_PRESET_ID;
        const noPresetSelected = nextPresetId === NO_PRESET_ID;
        const nextPreset = noPresetSelected
            ? null
            : PRESETS.find((preset) => preset.id === nextPresetId) ?? null;
        const nextAllowedTabs =
            patch.allowed_tabs ??
            (patchHasPreset
                ? nextPreset?.default_tabs ?? []
                : user.allowed_tabs);
        const nextAttendantId =
            patch.attendant_id !== undefined
                ? patch.attendant_id
                : user.attendant_id;
        const selectedAttendant = nextAttendantId
            ? data.attendants.find((attendant) => attendant.id === nextAttendantId) ?? null
            : null;
        const nextQueueId = !nextAttendantId
            ? null
            : patch.queue_id !== undefined
                ? patch.queue_id
                : patch.attendant_id !== undefined
                    ? selectedAttendant?.queue_id ?? null
                    : user.queue_id;
        const nextActive =
            patch.active !== undefined ? patch.active : user.active;
        const nextPermission: UserPermission = {
            auth_user_id: user.id,
            preset: nextPreset?.id ?? NO_PRESET_ID,
            allowed_tabs: nextAllowedTabs,
            attendant_id: nextAttendantId,
            active: nextActive,
        };

        const previousData = data;

        setData((current) => {
            if (!current) return current;

            return applyPermissionUpdate({
                current,
                userId: user.id,
                nextPermission,
                nextQueueId,
            });
        });
        setSavingUserId(user.id);
        setError(null);

        try {
            const response = await fetch("/api/usuarios", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    auth_user_id: user.id,
                    preset: nextPermission.preset,
                    allowed_tabs: nextPermission.allowed_tabs,
                    attendant_id: nextAttendantId ?? NO_VALUE_ID,
                    queue_id: nextQueueId ?? NO_VALUE_ID,
                    active: nextPermission.active,
                }),
            });
            const json = await response.json();

            if (!response.ok) {
                throw new Error(json.error ?? "Erro ao salvar permissões");
            }
        } catch (saveError) {
            console.error("[usuarios] failed to save", saveError);
            setData(previousData);
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

        void saveUserPermission(user, { allowed_tabs: nextTabs });
    }

    const userColumns: DataTableColumn<UserView>[] = [
        {
            id: "user",
            label: "Usuário",
            width: "21%",
            render: (user) => (
                <div className="flex min-w-0 items-center gap-3">
                    <InitialsAvatar name={user.name}/>
                    <div className="min-w-0">
                        <div className="truncate font-medium text-slate-700">{user.name}</div>
                        <div className="mt-1 truncate text-xs text-muted">{user.email ?? "Sem e-mail"}</div>
                    </div>
                </div>
            ),
        },
        {
            id: "unit",
            label: "Unidade",
            width: "11%",
            render: (user) => (
                <div title={user.unit_name} className="ml-1 truncate text-slate-700">
                    {user.unit_name}
                </div>
            ),
        },
        {
            id: "attendant",
            label: "Atendente",
            width: "15%",
            render: (user) => (
                <div title={user.attendant?.name ?? EMPTY_VALUE} className="truncate text-slate-700">
                    {user.attendant?.name ?? EMPTY_VALUE}
                </div>
            ),
        },
        {
            id: "queue",
            label: "Fila",
            width: "17%",
            render: (user) => (
                <div
                    title={user.attendant ? user.queue_name : "Nenhum"}
                    className={`truncate ${user.attendant ? "text-slate-700" : "text-slate-400"}`}
                >
                    {user.attendant ? user.queue_name : "Nenhum"}
                </div>
            ),
        },
        {
            id: "preset",
            label: "Preset",
            width: "11%",
            render: (user) =>
                user.preset ? (
                    <PermissionBadge label={user.preset.name} color={user.preset.color}/>
                ) : (
                    <span className="text-slate-400">{EMPTY_VALUE}</span>
                ),
        },
        {
            id: "tabs",
            label: "Abas permitidas",
            width: "16%",
            render: (user) => {
                const items: HoverBadgeListItem[] = user.tabs.map((tab) => {
                    const colors = getColorClasses(tab.color);
                    return {
                        key: tab.id,
                        label: tab.label,
                        className: `${colors.softBg} ${colors.text}`,
                    };
                });

                return (
                    <HoverBadgeList
                        items={items}
                        emptyLabel={EMPTY_VALUE}
                        badgeClassName="rounded-md px-2.5 py-1 text-xs font-bold"
                        maxBadgeWidthClassName="max-w-[120px]"
                    />
                );
            },
        },
        {
            id: "status",
            label: "Status",
            width: "7%",
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
            width: "2%",
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
                        Gerencie presets de acesso, abas, atendentes e filas
                    </p>
                </header>

                {error && (
                    <div className="mb-6 rounded-2xl border border-red/20 bg-red-soft px-5 py-4 text-sm font-bold text-red">
                        {error}
                    </div>
                )}

                <section className="mb-6">
                    <div className="grid grid-cols-4 gap-4">
                        {PRESETS.map((preset) => (
                            <PresetCard
                                key={preset.id}
                                preset={preset}
                                userCount={
                                    data?.permissions.filter(
                                        (permission) => permission.preset === preset.id,
                                    ).length ?? 0
                                }
                            />
                        ))}
                    </div>
                </section>

                <section>
                    <TableHeaderPreset
                        title="Usuários atribuídos"
                        count={filteredUsers.length}
                        searchValue={search}
                        onSearchChange={setSearch}
                        searchPlaceholder="Buscar usuário, atendente ou fila..."
                    >
                        <AdvancedFilterButton
                            sections={[
                                {
                                    id: "preset",
                                    title: "Preset",
                                    values: presetValues,
                                    onChange: setPresetValues,
                                    options: [
                                        { label: "Nenhum", value: NO_PRESET_ID },
                                        ...PRESETS.map((preset) => ({
                                            label: preset.name,
                                            value: preset.id,
                                        })),
                                    ],
                                },
                                {
                                    id: "status",
                                    title: "Status",
                                    values: statusValues,
                                    onChange: setStatusValues,
                                    options: [
                                        { label: "Ativo", value: "active" },
                                        { label: "Inativo", value: "inactive" },
                                    ],
                                },
                            ]}
                        />
                    </TableHeaderPreset>

                    <DataTable
                        columns={userColumns}
                        rows={filteredUsers}
                        getRowKey={(user) => user.id}
                        onRowClick={(user) => setSelectedUserId(user.id)}
                    />
                </section>
            </section>

            <UserDetailsPanel
                open={Boolean(selectedUser)}
                user={selectedUser}
                attendants={data?.attendants ?? []}
                queues={data?.queues ?? []}
                saving={selectedUser ? savingUserId === selectedUser.id : false}
                onClose={() => setSelectedUserId(null)}
                onSave={saveUserPermission}
                onToggleTab={toggleUserTab}
            />
        </main>
    );
}

function applyPermissionUpdate({
    current,
    userId,
    nextPermission,
    nextQueueId,
}: {
    current: ApiResponse;
    userId: string;
    nextPermission: UserPermission;
    nextQueueId: string | null;
}): ApiResponse {
    const existingPermission = current.permissions.some(
        (permission) => permission.auth_user_id === userId,
    );

    const permissions = existingPermission
        ? current.permissions.map((permission) => {
            if (permission.auth_user_id === userId) return nextPermission;

            if (
                nextPermission.attendant_id &&
                permission.attendant_id === nextPermission.attendant_id
            ) {
                return { ...permission, attendant_id: null };
            }

            return permission;
        })
        : [
            ...current.permissions.map((permission) =>
                nextPermission.attendant_id &&
                permission.attendant_id === nextPermission.attendant_id
                    ? { ...permission, attendant_id: null }
                    : permission,
            ),
            nextPermission,
        ];

    const selectedQueue = nextQueueId
        ? current.queues.find((queue) => queue.id === nextQueueId) ?? null
        : null;

    const attendants = current.attendants.map((attendant) => {
        if (attendant.id === nextPermission.attendant_id) {
            return {
                ...attendant,
                auth_user_id: userId,
                queue_id: nextQueueId,
                queue_name: selectedQueue?.name ?? null,
            };
        }

        if (
            !nextPermission.attendant_id &&
            attendant.auth_user_id === userId
        ) {
            return {
                ...attendant,
                auth_user_id: null,
                queue_id: null,
                queue_name: null,
            };
        }

        if (attendant.auth_user_id === userId) {
            return { ...attendant, auth_user_id: null };
        }

        return attendant;
    });

    return { ...current, permissions, attendants };
}

function UserDetailsPanel({
    open,
    user,
    attendants,
    queues,
    saving,
    onClose,
    onSave,
    onToggleTab,
}: {
    open: boolean;
    user: UserView | null;
    attendants: Attendant[];
    queues: Queue[];
    saving: boolean;
    onClose: () => void;
    onSave: (
        user: UserView,
        patch: Partial<{
            preset: AccessPresetId;
            allowed_tabs: TabId[];
            attendant_id: string | null;
            queue_id: string | null;
            active: boolean;
        }>,
    ) => Promise<void>;
    onToggleTab: (user: UserView, tabId: TabId) => void;
}) {
    if (!user) return null;

    const allTabs = tabsFromIds(TABS.map((tab) => tab.id));
    const accessInfo = getAccessInfo(user);
    const accessColors = accessInfo.preset
        ? getColorClasses(accessInfo.preset.color)
        : null;

    const presetOptions: DropdownSelectOption[] = [
        { label: "Nenhum", value: NO_PRESET_ID },
        ...PRESETS.map((preset) => ({ label: preset.name, value: preset.id })),
    ];
    const statusOptions: DropdownSelectOption[] = [
        { label: "Ativo", value: "active" },
        { label: "Inativo", value: "inactive" },
    ];
    const attendantOptions: DropdownSelectOption[] = [
        { label: "(Não é atendente)", value: NO_VALUE_ID },
        ...attendants.map((attendant) => ({
            label: attendant.name,
            value: attendant.id,
        })),
    ];
    const queueOptions: DropdownSelectOption[] = [
        { label: "Nenhum", value: NO_VALUE_ID },
        ...queues.map((queue) => ({ label: queue.name, value: queue.id })),
    ];
    const hasAttendant = Boolean(user.attendant_id);

    return (
        <DetailsSidePanel
            open={open}
            title="Detalhes do usuário"
            onClose={onClose}
            headerContent={(
                <div className="flex min-w-0 items-center gap-4">
                    <InitialsAvatar name={user.name} />
                    <div className="min-w-0">
                        <div title={user.name} className="truncate text-base font-bold text-slate-950">
                            {user.name}
                        </div>
                        <div title={user.email ?? EMPTY_VALUE} className="mt-1 truncate text-sm text-slate-500">
                            {user.email ?? EMPTY_VALUE}
                        </div>
                    </div>
                </div>
            )}
        >
            <div className="space-y-5">
                <PanelSection>
                    <div className="space-y-4">
                        <PanelControlRow label="Acesso">
                            <DropdownSelect
                                value={user.preset?.id ?? NO_PRESET_ID}
                                disabled={saving}
                                onChange={(value) =>
                                    void onSave(user, {
                                        preset: value as AccessPresetId,
                                    })
                                }
                                options={presetOptions}
                                widthClassName="w-[230px]"
                            />
                        </PanelControlRow>

                        <PanelControlRow label="Status">
                            <DropdownSelect
                                value={user.active ? "active" : "inactive"}
                                disabled={saving}
                                onChange={(value) =>
                                    void onSave(user, { active: value === "active" })
                                }
                                options={statusOptions}
                                widthClassName="w-[230px]"
                            />
                        </PanelControlRow>

                        <PanelControlRow label="Atendente">
                            <DropdownSelect
                                value={user.attendant_id ?? NO_VALUE_ID}
                                disabled={saving}
                                onChange={(value) => {
                                    const attendantId = value === NO_VALUE_ID ? null : value;
                                    const attendant = attendantId
                                        ? attendants.find((item) => item.id === attendantId) ?? null
                                        : null;

                                    void onSave(user, {
                                        attendant_id: attendantId,
                                        queue_id: attendant?.queue_id ?? null,
                                    });
                                }}
                                options={attendantOptions}
                                widthClassName="w-[230px]"
                            />
                        </PanelControlRow>

                        <PanelControlRow label="Fila">
                            <DropdownSelect
                                value={hasAttendant ? user.queue_id ?? NO_VALUE_ID : NO_VALUE_ID}
                                disabled={saving || !hasAttendant}
                                onChange={(value) =>
                                    void onSave(user, {
                                        queue_id: value === NO_VALUE_ID ? null : value,
                                    })
                                }
                                options={queueOptions}
                                widthClassName="w-[230px]"
                            />
                        </PanelControlRow>
                    </div>
                </PanelSection>

                <PanelSection
                    title="Abas permitidas"
                    action={(
                        <span
                            className={`inline-flex max-w-[190px] truncate rounded-md px-2.5 py-1 text-xs font-bold ${
                                accessColors
                                    ? `${accessColors.softBg} ${accessColors.text}`
                                    : "bg-slate-100 text-slate-500"
                            }`}
                            title={accessInfo.label}
                        >
                            {accessInfo.label}
                        </span>
                    )}
                >
                    <div className="grid grid-cols-2 gap-2">
                        {allTabs.map((tab) => {
                            const selected = user.allowed_tabs.includes(tab.id);

                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    disabled={saving}
                                    onClick={() => onToggleTab(user, tab.id)}
                                    className={`flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                        selected
                                            ? "bg-soft-brand text-slate-700 hover:bg-selection"
                                            : "bg-white text-slate-600 hover:bg-selection"
                                    }`}
                                >
                                    <span
                                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                                            selected
                                                ? "border-brand bg-brand"
                                                : "border-slate-300 bg-white"
                                        }`}
                                    >
                                        {selected && <Check size={12} className="text-white" />}
                                    </span>
                                    <span className="truncate">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </PanelSection>
            </div>
        </DetailsSidePanel>
    );
}

function PanelSection({
    title,
    action,
    children,
}: {
    title?: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            {(title || action) && (
                <div className="mb-4 flex items-center justify-between gap-4">
                    {title ? (
                        <h3 className="text-sm font-bold text-slate-950">{title}</h3>
                    ) : (
                        <span />
                    )}
                    {action}
                </div>
            )}
            {children}
        </section>
    );
}

function PanelControlRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-bold text-slate-700">{label}</span>
            {children}
        </div>
    );
}

function PresetCard({ preset, userCount }: { preset: PermissionPreset; userCount: number }) {
    const colors = getColorClasses(preset.color);
    const Icon = presetIcons[preset.icon] ?? ShieldCheck;
    const tabs = tabsFromIds(preset.default_tabs);

    return (
        <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-start gap-4">
                <div
                    className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${colors.iconBg} ${colors.iconText}`}
                >
                    <Icon size={26} />
                </div>
                <div className="min-w-0">
                    <h3 className={`truncate text-base font-bold ${colors.text}`}>{preset.name}</h3>
                    <p className="mt-1 text-sm text-muted">{formatUserCount(userCount)}</p>
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                {tabs.map((tab) => (
                    <PermissionBadge key={tab.id} label={tab.label} color={tab.color} />
                ))}
            </div>
        </div>
    );
}

function PermissionBadge({ label, color }: { label: string; color: ColorName }) {
    const colors = getColorClasses(color);

    return (
        <span
            className={`inline-flex max-w-full truncate rounded-md px-2.5 py-1 text-xs font-bold ${colors.softBg} ${colors.text}`}
        >
            {label}
        </span>
    );
}

function getAccessInfo(user: UserView) {
    if (!user.preset) return { label: "Nenhum", preset: null };

    const customized = !sameTabSet(user.allowed_tabs, user.preset.default_tabs);
    return {
        label: `${user.preset.name}${customized ? " (Customizado)" : ""}`,
        preset: user.preset,
    };
}

function sameTabSet(first: TabId[], second: TabId[]) {
    if (first.length !== second.length) return false;
    const firstSet = new Set(first);
    return second.every((tab) => firstSet.has(tab));
}

function tabsFromIds(ids: TabId[]) {
    return ids
        .map((id) => TABS.find((tab) => tab.id === id))
        .filter((tab): tab is PermissionTab => Boolean(tab))
        .sort((a, b) => {
            const colorDiff = TAB_COLOR_ORDER[a.color] - TAB_COLOR_ORDER[b.color];
            return colorDiff !== 0 ? colorDiff : a.position - b.position;
        });
}

function normalizeAllowedTabs(
    value: TabId[] | null | undefined,
    fallback: TabId[],
) {
    const validTabIds = new Set(TABS.map((tab) => tab.id));
    if (!Array.isArray(value)) return fallback;
    return value.filter((tab): tab is TabId => validTabIds.has(tab));
}

function getColorClasses(color: ColorName) {
    return colorClasses[color] ?? colorClasses.blue;
}

function formatUserCount(count: number) {
    return `${count} usuário${count === 1 ? "" : "s"}`;
}

function UsuariosSkeleton() {
    return (
        <>
            <div className="mb-8">
                <Skeleton className="h-9 w-[220px]" />
                <Skeleton className="mt-3 h-4 w-[430px]" />
            </div>
            <section className="mb-6">
                <div className="grid grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                        <Skeleton key={index} className="h-[190px] rounded-2xl" />
                    ))}
                </div>
            </section>
            <section>
                <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, index) => (
                        <Skeleton key={index} className="h-[76px] rounded-xl" />
                    ))}
                </div>
            </section>
        </>
    );
}
