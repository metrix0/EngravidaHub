// app/api/usuarios/allowed-tabs/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";

const VALID_TAB_IDS = new Set([
    "dashboard",
    "financeiro",
    "conversas",
    "jornada",
    "eventos",
    "assistente",
    "usuarios",
    "inbox",
    "agendamentos",
    "mensagem_ativa",
    "internos",
    "clientes",
    "funil",
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

        const savedAllowedTabs =
            preset === "__none__" ? [] : allowedTabs;

        const { error } = await supabase
            .from("user_permissions")
            .update({
                allowed_tabs: savedAllowedTabs,
                updated_at: new Date().toISOString(),
            })
            .eq("auth_user_id", authUserId);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, allowed_tabs: savedAllowedTabs });
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
