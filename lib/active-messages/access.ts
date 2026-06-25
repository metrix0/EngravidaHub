// lib/active-messages/access.ts

import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import { supabase } from "@/lib/supabase/client";

export type ActiveMessageActor = {
    id: string;
    name: string;
    email: string | null;
};

export type ActiveMessageAccessResult =
    | { ok: true; actor: ActiveMessageActor }
    | { ok: false; status: 401 | 403; error: string };

export async function requireActiveMessageAccess(): Promise<ActiveMessageAccessResult> {
    const user = await getCurrentAuthUser();

    if (!user) {
        return {
            ok: false,
            status: 401,
            error: "Não autenticado",
        };
    }

    const { data: permission, error } = await supabase
        .from("user_permissions")
        .select("active, allowed_tabs")
        .eq("auth_user_id", user.id)
        .maybeSingle();

    if (error) {
        console.error("[mensagem-ativa] failed to load permission", error);
        return {
            ok: false,
            status: 403,
            error: "Não foi possível validar o acesso à Mensagem Ativa",
        };
    }

    const allowedTabs = Array.isArray(permission?.allowed_tabs)
        ? permission.allowed_tabs
        : [];

    if (!permission?.active || !allowedTabs.includes("mensagem_ativa")) {
        return {
            ok: false,
            status: 403,
            error: "Você não tem acesso à Mensagem Ativa",
        };
    }

    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const name =
        readMetadataString(metadata, "name") ??
        readMetadataString(metadata, "full_name") ??
        readMetadataString(metadata, "display_name") ??
        user.email?.split("@")[0] ??
        "Usuário";

    return {
        ok: true,
        actor: {
            id: user.id,
            name,
            email: user.email ?? null,
        },
    };
}

function readMetadataString(
    metadata: Record<string, unknown>,
    key: string,
) {
    const value = metadata[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
