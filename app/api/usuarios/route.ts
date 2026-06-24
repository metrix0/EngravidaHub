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

export async function GET() {
    try {
        const [authUsersResult, permissionsResult, attendantsResult, queuesResult] =
            await Promise.all([
                supabase.auth.admin.listUsers({
                    page: 1,
                    perPage: 1000,
                }),

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
            ]);

        if (authUsersResult.error) {
            return NextResponse.json(
                { error: authUsersResult.error.message },
                { status: 500 },
            );
        }

        if (permissionsResult.error) {
            return NextResponse.json(
                { error: permissionsResult.error.message },
                { status: 500 },
            );
        }

        if (attendantsResult.error) {
            return NextResponse.json(
                { error: attendantsResult.error.message },
                { status: 500 },
            );
        }

        if (queuesResult.error) {
            return NextResponse.json(
                { error: queuesResult.error.message },
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
                {
                    onConflict: "auth_user_id",
                },
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

        return NextResponse.json({
            ok: true,
            permission,
            attendant_id: attendantId,
            queue_id: queueId,
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
