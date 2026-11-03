// app/api/saude/route.ts
import { NextRequest, NextResponse } from "next/server";

import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { acknowledgeHealthAlert, readHealthAlerts } from "@/lib/saude/alerts";
import { getHealthSnapshot } from "@/lib/saude/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
    const access = await getServerTabAccess("saude");
    if (access.ok === false) return { allowed: false as const, status: access.status, error: access.error };
    if (access.permission.preset !== "admin") {
        return { allowed: false as const, status: 403, error: "Acesso restrito a administradores" };
    }
    return { allowed: true as const };
}

export async function GET() {
    const permission = await requireAdmin();
    if (permission.allowed === false) return NextResponse.json({ error: permission.error }, { status: permission.status });
    try {
        const [snapshot, alerts] = await Promise.all([getHealthSnapshot(), readHealthAlerts()]);
        return NextResponse.json({ snapshot, alerts }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        console.error("[saude] dashboard failed", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar Saúde" }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const permission = await requireAdmin();
    if (permission.allowed === false) return NextResponse.json({ error: permission.error }, { status: permission.status });
    const data = await request.json().catch(() => null);
    const id = typeof data?.id === "string" ? data.id : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Alerta inválido" }, { status: 400 });
    try {
        const updated = await acknowledgeHealthAlert(id);
        return NextResponse.json({ ok: updated }, { status: updated ? 200 : 404 });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao atualizar alerta" }, { status: 500 });
    }
}
