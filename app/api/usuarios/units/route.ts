// app/api/usuarios/units/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import {
    serializeUnitLockCookie,
    UNIT_LOCK_COOKIE_NAME,
} from "@/lib/auth/userAccess";

const NO_VALUE_ID = "__none__";

export async function GET() {
    const { data, error } = await supabase
        .from("units")
        .select("id, name, city")
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ units: data ?? [] });
}

export async function PATCH(request: NextRequest) {
    try {
        const actor = await getCurrentAuthUser();
        const body = await request.json();
        const authUserId =
            typeof body.auth_user_id === "string" ? body.auth_user_id.trim() : "";
        const rawUnitId =
            typeof body.unit_id === "string" ? body.unit_id.trim() : "";
        const unitId = rawUnitId && rawUnitId !== NO_VALUE_ID ? rawUnitId : null;

        if (!authUserId) {
            return NextResponse.json(
                { error: "auth_user_id is required" },
                { status: 400 },
            );
        }

        if (unitId) {
            const { data: unit, error: unitError } = await supabase
                .from("units")
                .select("id")
                .eq("id", unitId)
                .eq("active", true)
                .maybeSingle();

            if (unitError) {
                return NextResponse.json(
                    { error: unitError.message },
                    { status: 500 },
                );
            }

            if (!unit) {
                return NextResponse.json(
                    { error: "Unidade não encontrada ou inativa" },
                    { status: 404 },
                );
            }
        }

        const { data: permission, error } = await supabase
            .from("user_permissions")
            .update({
                unit_id: unitId,
                updated_at: new Date().toISOString(),
            })
            .eq("auth_user_id", authUserId)
            .select("auth_user_id, unit_id")
            .maybeSingle();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (!permission) {
            return NextResponse.json(
                { error: "Permissões do usuário não encontradas" },
                { status: 404 },
            );
        }

        const response = NextResponse.json({
            ok: true,
            unit_id: permission.unit_id,
        });

        if (actor?.id === authUserId) {
            response.cookies.set(
                UNIT_LOCK_COOKIE_NAME,
                serializeUnitLockCookie(actor.id, unitId),
                { path: "/", sameSite: "lax" },
            );
        }

        return response;
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Erro inesperado ao salvar unidade",
            },
            { status: 500 },
        );
    }
}
