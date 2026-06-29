// app/api/usuarios/allowed-tabs/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";

const VALID_TAB_IDS = new Set([
    "dashboard",
    "conversas",
    "jornada",
    "eventos",
    "usuarios",
    "inbox",
    "agendamentos",
    "mensagem_ativa",
    "internos",
    "clientes",
    "funil",
]);

const ACTIVE_MESSAGE_PRESET_IDS = new Set([
    "admin",
    "atendente",
    "marketing",
]);

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const authUserId =
            typeof body.auth_user_id === "string"
                ? body.auth_user_id.trim()
                : "";
        const preset = typeof body.preset === "string" ? body.preset : "__none__";

        if (!authUserId) {
            return NextResponse.json(
                { error: "auth_user_id is required" },
                { status: 400 },
            );
        }

        const allowedTabs = Array.isArray(body.allowed_tabs)
            ? [...new Set(
                  body.allowed_tabs.filter(
                      (value: unknown): value is string =>
                          typeof value === "string" && VALID_TAB_IDS.has(value),
                  ),
              )]
            : [];
        const restrictedTabs = ACTIVE_MESSAGE_PRESET_IDS.has(preset)
            ? allowedTabs
            : allowedTabs.filter((tabId) => tabId !== "mensagem_ativa");

        const { error } = await supabase
            .from("user_permissions")
            .update({
                allowed_tabs: preset === "__none__" ? [] : restrictedTabs,
                updated_at: new Date().toISOString(),
            })
            .eq("auth_user_id", authUserId);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, allowed_tabs: restrictedTabs });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Erro inesperado ao salvar abas",
            },
            { status: 500 },
        );
    }
}
