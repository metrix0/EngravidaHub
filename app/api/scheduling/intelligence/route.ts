// app/api/scheduling/intelligence/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { resolveDashboardDateRange } from "@/lib/dashboard/metrics";
import { loadAgendaIntelligence } from "@/lib/scheduling/agendaIntelligenceServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
    const access = await getServerTabAccess("inteligencia_agenda");
    if (access.ok === false) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    const params = new URL(request.url).searchParams;
    const parsed = z.object({ days: z.enum(["7", "30"]), start: z.iso.date().nullable(), end: z.iso.date().nullable(), unitIds: z.array(z.uuid()), doctorIds: z.array(z.uuid()) }).safeParse({
        days: params.get("days") ?? "30", start: params.get("start_date"), end: params.get("end_date"),
        unitIds: params.getAll("unit_ids").flatMap(value => value.split(",")), doctorIds: params.getAll("doctor_ids").flatMap(value => value.split(",")),
    });
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Filtros inválidos." }, { status: 400 });
    try {
        if (!params.has("days")) params.set("days", "30");
        const range = resolveDashboardDateRange(params);
        const days = range.startDate ? Math.round((Date.parse(range.endAt) - Date.parse(range.startAt)) / 86_400_000) : Number(parsed.data.days);
        const report = await loadAgendaIntelligence({ days, resultsStart: range.startAt, resultsEnd: range.endAt,
            unitIds: access.permission.unit_lock ? [access.permission.unit_lock.id] : parsed.data.unitIds,
            doctorIds: parsed.data.doctorIds });
        if (!access.permission.allowed_tabs.includes("conversas")) {
            report.preferences.forEach(item => { item.examples = []; });
            report.opportunities.forEach(item => { item.contacts = []; });
            report.evidenceDetails = {};
        }
        return NextResponse.json({ ok: true, report }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        console.error("[agenda-intelligence] read failed", error);
        return NextResponse.json({ ok: false, error: "Não foi possível carregar a inteligência de agenda." }, { status: 500 });
    }
}
