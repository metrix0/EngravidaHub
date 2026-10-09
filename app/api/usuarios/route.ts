// app/api/usuarios/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";
import { invalidateAuthUsersCache, listAuthUsers } from "@/lib/supabase/authAdmin";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { formatSystemUserName } from "@/lib/users/formatSystemUserName";

const NO_PRESET_ID = "__none__";

const VALID_TAB_IDS = new Set([
    "dashboard",
    "gerencial",
    "financeiro",
    "conversas",
    "jornada",
    "eventos",
    "assistente",
    "usuarios",
    "inbox",
    "agendamentos",
    "inteligencia_agenda",
    "mensagem_ativa",
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
            listAuthUsers({ forceRefresh: true }),
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

        const users = authUsersResult.map((user) => {
            const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
            const rawName =
                getMetadataString(metadata, "name") ??
                getMetadataString(metadata, "full_name") ??
                getMetadataString(metadata, "display_name") ??
                getMetadataString(metadata, "user_name") ??
                user.email?.split("@")[0] ??
                "Usuário";

            return {
                id: user.id,
                email: user.email ?? null,
                name: formatSystemUserName(rawName),
                created_at: user.created_at,
                last_sign_in_at: user.last_sign_in_at ?? null,
                invited_at: user.invited_at ?? null,
                email_confirmed_at: user.email_confirmed_at ?? null,
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

export async function POST(request: NextRequest) {
    let authUserId: string | null = null;
    try {
        const access = await getServerTabAccess("usuarios");
        if (access.ok === false) {
            return NextResponse.json({ error: access.error }, { status: access.status });
        }

        const body = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return NextResponse.json({ error: "Informe os dados do usuário" }, { status: 400 });
        }
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 180 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return NextResponse.json({ error: "Informe um nome e email válidos" }, { status: 400 });
        }
        if (!["admin", "gestor", "atendente", "marketing", NO_PRESET_ID].includes(normalizePresetValue(body.preset))) {
            return NextResponse.json({ error: "Preset inválido" }, { status: 400 });
        }

        const validationError = await validateUserPermissionSelection(body);
        if (validationError) return validationError;

        const existingUserId = normalizeNullableId(body.auth_user_id);
        if (existingUserId) {
            const { data, error } = await supabase.auth.admin.getUserById(existingUserId);
            if (error || !data.user) {
                return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
            }
            if (data.user.email_confirmed_at || data.user.last_sign_in_at) {
                return NextResponse.json({ error: "Este usuário já possui acesso. Edite suas permissões na lista." }, { status: 409 });
            }
            if (data.user.email?.toLowerCase() !== email) {
                return NextResponse.json({ error: "O email não corresponde ao usuário" }, { status: 400 });
            }
            authUserId = data.user.id;
        } else {
            // Create the Auth identity without sending email, then save access first.
            const { data, error } = await supabase.auth.admin.createUser({
                email, email_confirm: false, user_metadata: { name },
            });
            if (error || !data.user) {
                const duplicate = error?.code === "email_exists" || error?.code === "user_already_exists";
                return NextResponse.json({
                    error: duplicate
                        ? "Este email já está cadastrado. Abra o usuário na lista."
                        : error?.message ?? "Não foi possível criar o usuário",
                }, { status: duplicate ? 409 : 500 });
            }
            authUserId = data.user.id;
        }

        const permissionResponse = await saveUserPermissions({
            ...body, auth_user_id: authUserId, unit_id: normalizeNullableId(body.unit_id),
        });
        if (!permissionResponse.ok) {
            const failure = await permissionResponse.json();
            return NextResponse.json({ ...failure, auth_user_id: authUserId }, { status: permissionResponse.status });
        }

        const { data: invitation, error: invitationError } = await supabase.auth.admin.inviteUserByEmail(email, {
            redirectTo: new URL("/login", request.url).toString(),
        });
        if (invitationError || invitation.user?.id !== authUserId) {
            return NextResponse.json({
                auth_user_id: authUserId,
                error: `Usuário e permissões salvos. Não foi possível enviar o convite: ${invitationError?.message ?? "resposta inválida do serviço de email"}`,
            }, { status: 500 });
        }

        return NextResponse.json({ ok: true, auth_user_id: authUserId }, { status: 201 });
    } catch (error) {
        console.error("[usuarios] invitation failed", error);
        return NextResponse.json({
            auth_user_id: authUserId,
            error: error instanceof Error ? error.message : "Não foi possível enviar o convite",
        }, { status: 500 });
    } finally {
        if (authUserId) invalidateAuthUsersCache();
    }
}

export async function PATCH(request: NextRequest) {
    try {
        return await saveUserPermissions(await request.json());
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : "Erro inesperado ao salvar permissões",
        }, { status: 500 });
    }
}

async function saveUserPermissions(body: Record<string, unknown>) {
    try {
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

        const validationError = await validateUserPermissionSelection(body);
        if (validationError) return validationError;

        const { data: permission, error: permissionError } = await supabase
            .from("user_permissions")
            .upsert(
                {
                    auth_user_id: authUserId,
                    preset,
                    allowed_tabs:
                        preset === NO_PRESET_ID ? [] : allowedTabs,
                    attendant_id: attendantId,
                    ...(Object.hasOwn(body, "unit_id")
                        ? { unit_id: normalizeNullableId(body.unit_id) }
                        : {}),
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

async function validateUserPermissionSelection(body: Record<string, unknown>) {
    const attendantId = normalizeNullableId(body.attendant_id);
    const queueId = attendantId ? normalizeNullableId(body.queue_id) : null;
    const manualGroupIds = normalizeIdArray(body.manual_group_ids);
    const unitId = normalizeNullableId(body.unit_id);
    if (unitId) {
        const { data: unit, error } = await supabase.from("units")
            .select("id").eq("id", unitId).eq("active", true).maybeSingle();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!unit) return NextResponse.json({ error: "Unidade não encontrada ou inativa" }, { status: 404 });
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

    return null;
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
