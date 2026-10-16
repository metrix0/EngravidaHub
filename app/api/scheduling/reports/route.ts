// app/api/scheduling/reports/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { agendaAddDays, agendaDate, agendaWeekStart } from "@/lib/scheduling/operationalAgenda";
import { loadOperationalAgenda } from "@/lib/scheduling/operationalAgendaServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const filters = z.object({ view: z.enum(["calendar", "reports"]), start: z.iso.date(), end: z.iso.date(), reportDate: z.iso.date(), unitIds: z.array(z.uuid()).max(100), doctorIds: z.array(z.uuid()).max(100) }).refine(value => value.end > value.start && Date.parse(value.end) - Date.parse(value.start) <= 62 * 86_400_000, { message: "Selecione até 62 dias." });
export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const today = agendaDate(), start = params.get("start") || agendaWeekStart(today);
    const parsed = filters.safeParse({ view: params.get("view") || "calendar", start, end: params.get("end") || agendaAddDays(start, 7), reportDate: params.get("report_date") || today, unitIds: params.getAll("unit_ids"), doctorIds: params.getAll("doctor_ids") });
    if (!parsed.success) return NextResponse.json({ error: "Filtros inválidos." }, { status: 400 });
    const access = await getServerTabAccess(parsed.data.view === "calendar" ? "agendamentos" : "inteligencia_agenda");
    if (access.ok === false) return NextResponse.json({ error: access.error }, { status: access.status });
    const unitIds = access.permission.unit_lock ? [access.permission.unit_lock.id] : parsed.data.unitIds;
    try {
        const report = await loadOperationalAgenda({ ...parsed.data, unitIds, includeHistory: parsed.data.view === "calendar" });
        return NextResponse.json({ ok: true, report }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        console.error("[agenda-reports] failed", error);
        return NextResponse.json({ error: "Não foi possível carregar os indicadores da agenda." }, { status: 500 });
    }
}
