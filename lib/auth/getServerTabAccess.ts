// lib/auth/getServerTabAccess.ts
import { supabase as adminSupabase } from "@/lib";
import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import {
    normalizeAllowedTabs,
    type AppTabId,
    type CurrentUserPermission,
} from "@/lib/auth/userAccess";

type ServerUser = {
    id: string;
    email: string | null;
    name: string;
};

type UserPermissionRow = {
    auth_user_id: string;
    preset: string;
    allowed_tabs: unknown;
    attendant_id: string | null;
    unit_id: string | null;
    active: boolean;
};

type UnitRow = {
    id: string;
    name: string;
    city: string;
};

export type ServerTabAccess =
    | {
          ok: true;
          user: ServerUser;
          permission: CurrentUserPermission;
      }
    | {
          ok: false;
          status: 401 | 403 | 500;
          error: string;
      };

export async function getServerTabAccess(
    tabId: AppTabId,
): Promise<ServerTabAccess> {
    const user = await getCurrentAuthUser();

    if (!user) {
        return {
            ok: false,
            status: 401,
            error: "Not authenticated",
        };
    }

    const { data, error } = await adminSupabase
        .from("user_permissions")
        .select("auth_user_id, preset, allowed_tabs, attendant_id, unit_id, active")
        .eq("auth_user_id", user.id)
        .maybeSingle();

    if (error) {
        return {
            ok: false,
            status: 500,
            error: error.message,
        };
    }

    const permissionRow = data as UserPermissionRow | null;

    if (!permissionRow || !permissionRow.active) {
        return {
            ok: false,
            status: 403,
            error: "Access disabled",
        };
    }

    const allowedTabs = normalizeAllowedTabs(permissionRow.allowed_tabs);

    if (!allowedTabs.includes(tabId)) {
        return {
            ok: false,
            status: 403,
            error: "Tab not allowed",
        };
    }

    let unitLock: UnitRow | null = null;

    if (permissionRow.unit_id) {
        const { data: unitData, error: unitError } = await adminSupabase
            .from("units")
            .select("id, name, city")
            .eq("id", permissionRow.unit_id)
            .eq("active", true)
            .maybeSingle();

        if (unitError) {
            return {
                ok: false,
                status: 500,
                error: unitError.message,
            };
        }

        if (!unitData) {
            return {
                ok: false,
                status: 403,
                error: "Unit access unavailable",
            };
        }

        unitLock = unitData as UnitRow;
    }

    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;

    return {
        ok: true,
        user: {
            id: user.id,
            email: user.email ?? null,
            name:
                metadataString(metadata, "name") ??
                metadataString(metadata, "full_name") ??
                metadataString(metadata, "display_name") ??
                user.email?.split("@")[0] ??
                "Usuário",
        },
        permission: {
            auth_user_id: permissionRow.auth_user_id,
            preset: permissionRow.preset,
            allowed_tabs: allowedTabs,
            attendant_id: permissionRow.attendant_id,
            active: permissionRow.active,
            unit_lock: unitLock,
        },
    };
}

function metadataString(
    metadata: Record<string, unknown>,
    key: string,
) {
    const value = metadata[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
