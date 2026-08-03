// app/api/current-user/route.ts
import { NextResponse } from "next/server";

import { supabase as adminSupabase } from "@/lib";
import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import { normalizeAllowedTabs } from "@/lib/auth/userAccess";

type UserPermissionRow = {
    auth_user_id: string;
    preset: string;
    allowed_tabs: unknown;
    attendant_id: string | null;
    active: boolean;
};

export async function GET() {
    const user = await getCurrentAuthUser();

    // Having no session is an expected application state, not an API failure.
    // Returning 200 prevents noisy 401 errors in the browser; the client guard
    // is responsible for redirecting unauthenticated users to /login.
    if (!user) {
        return NextResponse.json({
            ok: true,
            user: null,
            permission: null,
        });
    }

    const { data: permissionData, error: permissionError } = await adminSupabase
        .from("user_permissions")
        .select("auth_user_id, preset, allowed_tabs, attendant_id, active")
        .eq("auth_user_id", user.id)
        .maybeSingle();

    if (permissionError) {
        return NextResponse.json(
            {
                ok: false,
                error: permissionError.message,
            },
            { status: 500 },
        );
    }

    const permissionRow = permissionData as UserPermissionRow | null;
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;

    return NextResponse.json({
        ok: true,
        user: {
            id: user.id,
            email: user.email ?? null,
            name:
                getMetadataString(metadata, "name") ??
                getMetadataString(metadata, "full_name") ??
                getMetadataString(metadata, "display_name") ??
                getMetadataString(metadata, "user_name") ??
                user.email?.split("@")[0] ??
                "Usuário",
        },
        permission: permissionRow
            ? {
                auth_user_id: permissionRow.auth_user_id,
                preset: permissionRow.preset,
                allowed_tabs: normalizeAllowedTabs(permissionRow.allowed_tabs),
                attendant_id: permissionRow.attendant_id,
                active: permissionRow.active,
            }
            : null,
    });
}

function getMetadataString(
    metadata: Record<string, unknown>,
    key: string,
) {
    const value = metadata[key];

    return typeof value === "string" && value.trim() ? value.trim() : null;
}
