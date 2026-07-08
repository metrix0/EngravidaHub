// lib/auth/getServerTabAccess.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabase as adminSupabase } from "@/lib";
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
    active: boolean;
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
    const routeSupabase = await createRouteSupabaseClient();

    const {
        data: { user },
        error: userError,
    } = await routeSupabase.auth.getUser();

    if (userError || !user) {
        return {
            ok: false,
            status: 401,
            error: "Not authenticated",
        };
    }

    const { data, error } = await adminSupabase
        .from("user_permissions")
        .select("auth_user_id, preset, allowed_tabs, attendant_id, active")
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
        },
    };
}

async function createRouteSupabaseClient() {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        cookieStore.set(name, value, options);
                    });
                },
            },
        },
    );
}

function metadataString(
    metadata: Record<string, unknown>,
    key: string,
) {
    const value = metadata[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
