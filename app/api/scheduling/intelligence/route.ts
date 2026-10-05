// app/api/scheduling/intelligence/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { loadAgendaIntelligence } from "@/lib/scheduling/agendaIntelligenceServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
    const access = await getServerTabAccess("inteligencia_agenda");
    if (access.ok === false) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    const params = new URL(request.url).searchParams;
    const parsed = z.object({ days: z.enum(["7", "30"]), unitIds: z.array(z.uuid()), doctorIds: z.array(z.uuid()) }).safeParse({
        days: params.get("days") ?? "30", unitIds: params.getAll("unit_ids"), doctorIds: params.getAll("doctor_ids"),
    });
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Filtros inválidos." }, { status: 400 });
    try {
        const report = await loadAgendaIntelligence({ days: Number(parsed.data.days),
            unitIds: access.permission.unit_lock ? [access.permission.unit_lock.id] : parsed.data.unitIds,
            doctorIds: parsed.data.doctorIds });
        if (!access.permission.allowed_tabs.includes("conversas")) report.preferences.forEach(item => { item.examples = []; });
        return NextResponse.json({ ok: true, report }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        console.error("[agenda-intelligence] read failed", error);
        return NextResponse.json({ ok: false, error: "Não foi possível carregar a inteligência de agenda." }, { status: 500 });
    }
}
