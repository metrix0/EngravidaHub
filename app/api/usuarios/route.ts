// app/api/usuarios/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";

const NO_PRESET_ID = "__none__";

const VALID_TAB_IDS = new Set([
    "dashboard",
    "conversas",
    "jornada",
    "eventos",
    "usuarios",
    "inbox",
    "internos",
    "clientes",
    "funil",
]);

const QUEUE_SECTOR_ORDER: Record<string, number> = {
    assistance: 10,
    finance: 20,
    reception: 30,
    management: 40,
    ra: 999,
};

type UserPermissionRow = {
    auth_user_id: string;
    preset: string;
    allowed_tabs: string[];
    attendant_id: string | null;
    active: boolean;
    created_at: string;
    updated_at: string;
};

type UnitRow = {
    id: string;
    name: string;
};

type QueueRow = {
    id: string;
    name: string;
    sector: string;
    unit_id: string | null;
    active: boolean;
    units?: UnitRow | UnitRow[] | null;
};

type AttendantRow = {
    id: string;
    name: string;
    email: string | null;
    active: boolean;
    is_online: boolean;
    auth_user_id: string | null;
    unit_id: string | null;
    queue_id: string | null;
    units?: UnitRow | UnitRow[] | null;
    queues?: QueueRow | QueueRow[] | null;
};

type InternalGroupRow = {
    id: string;
    queue_id: string | null;
    name: string;
    active: boolean;
};

type InternalGroupMemberRow = {
    group_id: string;
    auth_user_id: string;
    automatic: boolean;
    manual: boolean;
};

export async function GET() {
    try {
        const [
            authUsersResult,
            permissionsResult,
            attendantsResult,
            queuesResult,
            groupsResult,
            groupMembersResult,
        ] = await Promise.all([
            supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
            supabase.from("user_permissions").select("*"),
            supabase
                .from("attendants")
                .select(`
                    id,
                    name,
                    email,
                    active,
                    is_online,
                    auth_user_id,
                    unit_id,
                    queue_id,
                    units (
                        id,
                        name
                    ),
                    queues (
                        id,
                        name,
                        sector,
                        unit_id,
                        active
                    )
                `)
                .order("name", { ascending: true }),
            supabase
                .from("queues")
                .select(`
                    id,
                    name,
                    sector,
                    unit_id,
                    active,
                    units (
                        id,
                        name
                    )
                `)
                .eq("active", true),
            supabase
                .from("internal_groups")
                .select("id, queue_id, name, active")
                .eq("active", true)
                .order("name", { ascending: true }),
            supabase
                .from("internal_group_members")
                .select("group_id, auth_user_id, automatic, manual")
                .or("automatic.eq.true,manual.eq.true"),
        ]);

        const errors = [
            authUsersResult.error,
            permissionsResult.error,
            attendantsResult.error,
            queuesResult.error,
            groupsResult.error,
            groupMembersResult.error,
        ].filter(Boolean);

        if (errors.length > 0) {
            return NextResponse.json(
                { error: errors[0]!.message },
                { status: 500 },
            );
        }

        const permissions = (permissionsResult.data ?? []) as UserPermissionRow[];

        const attendants = ((attendantsResult.data ?? []) as AttendantRow[]).map(
            (attendant) => {
                const unit = normalizeNested(attendant.units);
                const queue = normalizeNested(attendant.queues);

                return {
                    id: attendant.id,
                    name: attendant.name,
                    email: attendant.email,
                    active: attendant.active,
                    is_online: attendant.is_online,
                    auth_user_id: attendant.auth_user_id,
                    unit_id: attendant.unit_id ?? unit?.id ?? null,
                    unit_name: unit?.name ?? "Sem unidade",
                    queue_id: attendant.queue_id ?? queue?.id ?? null,
                    queue_name: queue?.name ?? null,
                };
            },
        );

        const queues = ((queuesResult.data ?? []) as QueueRow[])
            .map((queue) => {
                const unit = normalizeNested(queue.units);

                return {
                    id: queue.id,
                    name: queue.name,
                    sector: queue.sector,
                    unit_id: queue.unit_id,
                    unit_name: unit?.name ?? null,
                    active: queue.active,
                };
            })
            .sort((first, second) => {
                if (first.sector === "ra") return 1;
                if (second.sector === "ra") return -1;

                const unitComparison = (first.unit_name ?? "").localeCompare(
                    second.unit_name ?? "",
                    "pt-BR",
                );
                if (unitComparison !== 0) return unitComparison;

                return (
                    (QUEUE_SECTOR_ORDER[first.sector] ?? 500) -
                    (QUEUE_SECTOR_ORDER[second.sector] ?? 500)
                );
            });

        const groups = ((groupsResult.data ?? []) as InternalGroupRow[]).sort(
            (first, second) => first.name.localeCompare(second.name, "pt-BR"),
        );
        const group_memberships =
            (groupMembersResult.data ?? []) as InternalGroupMemberRow[];

        const users = authUsersResult.data.users.map((user) => {
            const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;

            return {
                id: user.id,
                email: user.email ?? null,
                name:
                    getMetadataString(metadata, "name") ??
                    getMetadataString(metadata, "full_name") ??
                    getMetadataString(metadata, "display_name") ??
                    getMetadataString(metadata, "user_name") ??
                    user.email?.split("@")[0] ??
                    "Usuário",
                created_at: user.created_at,
                last_sign_in_at: user.last_sign_in_at ?? null,
            };
        });

        return NextResponse.json({
            users,
            permissions,
            attendants,
            queues,
            groups,
            group_memberships,
        });
    } catch (error) {
        console.error("[usuarios] GET failed", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Erro inesperado ao carregar usuários",
            },
            { status: 500 },
        );
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();

        const authUserId =
            typeof body.auth_user_id === "string" ? body.auth_user_id.trim() : "";
        const preset = normalizePresetValue(body.preset);
        const allowedTabs = normalizeAllowedTabs(body.allowed_tabs);
        const attendantId = normalizeNullableId(body.attendant_id);
        const requestedQueueId = normalizeNullableId(body.queue_id);
        const queueId = attendantId ? requestedQueueId : null;
        const manualGroupIds = normalizeIdArray(body.manual_group_ids);
        const active = typeof body.active === "boolean" ? body.active : true;

        if (!authUserId) {
            return NextResponse.json(
                { error: "auth_user_id is required" },
                { status: 400 },
            );
        }

        if (attendantId) {
            const { data: selectedAttendant, error: selectedAttendantError } =
                await supabase
                    .from("attendants")
                    .select("id")
                    .eq("id", attendantId)
                    .maybeSingle();

            if (selectedAttendantError) {
                return NextResponse.json(
                    { error: selectedAttendantError.message },
                    { status: 500 },
                );
            }

            if (!selectedAttendant) {
                return NextResponse.json(
                    { error: "Atendente não encontrado" },
                    { status: 404 },
                );
            }
        }

        if (queueId) {
            const { data: selectedQueue, error: selectedQueueError } = await supabase
                .from("queues")
                .select("id")
                .eq("id", queueId)
                .eq("active", true)
                .maybeSingle();

            if (selectedQueueError) {
                return NextResponse.json(
                    { error: selectedQueueError.message },
                    { status: 500 },
                );
            }

            if (!selectedQueue) {
                return NextResponse.json(
                    { error: "Fila não encontrada ou inativa" },
                    { status: 404 },
                );
            }
        }

        if (manualGroupIds.length > 0) {
            const { data: selectedGroups, error: selectedGroupsError } =
                await supabase
                    .from("internal_groups")
                    .select("id")
                    .in("id", manualGroupIds)
                    .eq("active", true);

            if (selectedGroupsError) {
                return NextResponse.json(
                    { error: selectedGroupsError.message },
                    { status: 500 },
                );
            }

            if ((selectedGroups ?? []).length !== manualGroupIds.length) {
                return NextResponse.json(
                    { error: "Um ou mais grupos não existem ou estão inativos" },
                    { status: 400 },
                );
            }
        }

        const { data: permission, error: permissionError } = await supabase
            .from("user_permissions")
            .upsert(
                {
                    auth_user_id: authUserId,
                    preset,
                    allowed_tabs: preset === NO_PRESET_ID ? [] : allowedTabs,
                    attendant_id: attendantId,
                    active,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "auth_user_id" },
            )
            .select()
            .single();

        if (permissionError) {
            return NextResponse.json(
                { error: permissionError.message },
                { status: 500 },
            );
        }

        const attendantSyncError = await syncAttendantLink({
            authUserId,
            attendantId,
            queueId,
        });

        if (attendantSyncError) {
            return NextResponse.json(
                { error: attendantSyncError },
                { status: 500 },
            );
        }

        const groupSyncError = await syncManualGroupMemberships({
            authUserId,
            manualGroupIds,
        });

        if (groupSyncError) {
            return NextResponse.json(
                { error: groupSyncError },
                { status: 500 },
            );
        }

        return NextResponse.json({
            ok: true,
            permission,
            attendant_id: attendantId,
            queue_id: queueId,
            manual_group_ids: manualGroupIds,
        });
    } catch (error) {
        console.error("[usuarios] PATCH failed", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Erro inesperado ao salvar permissões",
            },
            { status: 500 },
        );
    }
}

async function syncAttendantLink({
    authUserId,
    attendantId,
    queueId,
}: {
    authUserId: string;
    attendantId: string | null;
    queueId: string | null;
}) {
    if (!attendantId) {
        const { error } = await supabase
            .from("attendants")
            .update({ auth_user_id: null, queue_id: null })
            .eq("auth_user_id", authUserId);

        return error?.message ?? null;
    }

    const { error: clearCurrentUserLinksError } = await supabase
        .from("attendants")
        .update({ auth_user_id: null })
        .eq("auth_user_id", authUserId)
        .neq("id", attendantId);

    if (clearCurrentUserLinksError) {
        return clearCurrentUserLinksError.message;
    }

    const { error: clearOtherPermissionsError } = await supabase
        .from("user_permissions")
        .update({
            attendant_id: null,
            updated_at: new Date().toISOString(),
        })
        .eq("attendant_id", attendantId)
        .neq("auth_user_id", authUserId);

    if (clearOtherPermissionsError) {
        return clearOtherPermissionsError.message;
    }

    const { error: linkAttendantError } = await supabase
        .from("attendants")
        .update({
            auth_user_id: authUserId,
            queue_id: queueId,
            updated_at: new Date().toISOString(),
        })
        .eq("id", attendantId);

    return linkAttendantError?.message ?? null;
}

async function syncManualGroupMemberships({
    authUserId,
    manualGroupIds,
}: {
    authUserId: string;
    manualGroupIds: string[];
}) {
    const { data: existingData, error: existingError } = await supabase
        .from("internal_group_members")
        .select("group_id, automatic, manual")
        .eq("auth_user_id", authUserId);

    if (existingError) return existingError.message;

    const existing = existingData ?? [];
    const existingByGroup = new Map(
        existing.map((membership) => [membership.group_id, membership]),
    );
    const selected = new Set(manualGroupIds);
    const now = new Date().toISOString();

    const selectedExistingIds = manualGroupIds.filter((id) =>
        existingByGroup.has(id),
    );
    const selectedNewIds = manualGroupIds.filter(
        (id) => !existingByGroup.has(id),
    );
    const deselectedAutomaticIds = existing
        .filter(
            (membership) =>
                membership.manual &&
                membership.automatic &&
                !selected.has(membership.group_id),
        )
        .map((membership) => membership.group_id);
    const deselectedManualOnlyIds = existing
        .filter(
            (membership) =>
                membership.manual &&
                !membership.automatic &&
                !selected.has(membership.group_id),
        )
        .map((membership) => membership.group_id);

    if (selectedExistingIds.length > 0) {
        const { error } = await supabase
            .from("internal_group_members")
            .update({ manual: true, updated_at: now })
            .eq("auth_user_id", authUserId)
            .in("group_id", selectedExistingIds);
        if (error) return error.message;
    }

    if (selectedNewIds.length > 0) {
        const { error } = await supabase
            .from("internal_group_members")
            .insert(
                selectedNewIds.map((groupId) => ({
                    group_id: groupId,
                    auth_user_id: authUserId,
                    automatic: false,
                    manual: true,
                    updated_at: now,
                })),
            );
        if (error) return error.message;
    }

    if (deselectedAutomaticIds.length > 0) {
        const { error } = await supabase
            .from("internal_group_members")
            .update({ manual: false, updated_at: now })
            .eq("auth_user_id", authUserId)
            .in("group_id", deselectedAutomaticIds);
        if (error) return error.message;
    }

    if (deselectedManualOnlyIds.length > 0) {
        const { error } = await supabase
            .from("internal_group_members")
            .delete()
            .eq("auth_user_id", authUserId)
            .in("group_id", deselectedManualOnlyIds);
        if (error) return error.message;
    }

    return null;
}

function normalizePresetValue(value: unknown) {
    if (value === null || value === undefined || value === "") {
        return NO_PRESET_ID;
    }

    return typeof value === "string" ? value : NO_PRESET_ID;
}

function normalizeAllowedTabs(value: unknown) {
    if (!Array.isArray(value)) return [];

    return [
        ...new Set(
            value.filter(
                (item: unknown): item is string =>
                    typeof item === "string" && VALID_TAB_IDS.has(item),
            ),
        ),
    ];
}

function normalizeIdArray(value: unknown) {
    if (!Array.isArray(value)) return [];

    return [
        ...new Set(
            value
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    ];
}

function normalizeNullableId(value: unknown) {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value === "__none__"
    ) {
        return null;
    }

    return value.trim();
}

function getMetadataString(
    metadata: Record<string, unknown>,
    key: string,
) {
    const value = metadata[key];

    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNested<T>(value: T | T[] | null | undefined) {
    if (!value) return null;
    return Array.isArray(value) ? value[0] ?? null : value;
}
