// app/api/usuarios/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib";

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

type AttendantRow = {
    id: string;
    name: string;
    email: string | null;
    active: boolean;
    is_online: boolean;
    auth_user_id: string | null;
    units?: UnitRow | UnitRow[] | null;
};

export async function GET() {
    try {
        const [authUsersResult, permissionsResult, attendantsResult] =
            await Promise.all([
                supabase.auth.admin.listUsers({
                    page: 1,
                    perPage: 1000,
                }),

                supabase
                    .from("user_permissions")
                    .select("*"),

                supabase
                    .from("attendants")
                    .select(`
                        id,
                        name,
                        email,
                        active,
                        is_online,
                        auth_user_id,
                        units (
                            id,
                            name
                        )
                    `)
                    .order("name", { ascending: true }),
            ]);

        if (authUsersResult.error) {
            return NextResponse.json(
                { error: authUsersResult.error.message },
                { status: 500 }
            );
        }

        if (permissionsResult.error) {
            return NextResponse.json(
                { error: permissionsResult.error.message },
                { status: 500 }
            );
        }

        if (attendantsResult.error) {
            return NextResponse.json(
                { error: attendantsResult.error.message },
                { status: 500 }
            );
        }

        const permissions = (permissionsResult.data ?? []) as UserPermissionRow[];

        const attendants = ((attendantsResult.data ?? []) as AttendantRow[]).map(
            (attendant) => {
                const unit = normalizeNestedUnit(attendant.units);

                return {
                    id: attendant.id,
                    name: attendant.name,
                    email: attendant.email,
                    active: attendant.active,
                    is_online: attendant.is_online,
                    auth_user_id: attendant.auth_user_id,
                    unit_id: unit?.id ?? null,
                    unit_name: unit?.name ?? "Sem unidade",
                };
            }
        );

        const users = authUsersResult.data.users.map((user) => {
            const metadata = (user.user_metadata ?? {}) as Record<string, any>;

            return {
                id: user.id,
                email: user.email ?? null,
                name:
                    metadata.name ??
                    metadata.full_name ??
                    metadata.display_name ??
                    metadata.user_name ??
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
            { status: 500 }
        );
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();

        const authUserId =
            typeof body.auth_user_id === "string" ? body.auth_user_id : "";

        const preset =
            typeof body.preset === "string" ? body.preset : "";

        const allowedTabs = Array.isArray(body.allowed_tabs)
            ? body.allowed_tabs.filter((item: unknown): item is string => {
                return typeof item === "string";
            })
            : [];

        const attendantId =
            typeof body.attendant_id === "string" &&
            body.attendant_id !== "__none__"
                ? body.attendant_id
                : null;

        const active =
            typeof body.active === "boolean" ? body.active : true;

        if (!authUserId) {
            return NextResponse.json(
                { error: "auth_user_id is required" },
                { status: 400 }
            );
        }

        if (!preset) {
            return NextResponse.json(
                { error: "preset is required" },
                { status: 400 }
            );
        }

        const { data, error } = await supabase
            .from("user_permissions")
            .upsert(
                {
                    auth_user_id: authUserId,
                    preset,
                    allowed_tabs: allowedTabs,
                    attendant_id: attendantId,
                    active,
                    updated_at: new Date().toISOString(),
                },
                {
                    onConflict: "auth_user_id",
                }
            )
            .select()
            .single();

        if (error) {
            return NextResponse.json(
                { error: error.message },
                { status: 500 }
            );
        }

        return NextResponse.json({
            ok: true,
            permission: data,
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
            { status: 500 }
        );
    }
}

function normalizeNestedUnit(value: UnitRow | UnitRow[] | null | undefined) {
    if (!value) return null;

    if (Array.isArray(value)) {
        return value[0] ?? null;
    }

    return value;
}