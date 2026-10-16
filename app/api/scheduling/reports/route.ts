// app/api/scheduling/reports/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { supabase } from "@/lib/supabase/client";
import { agendaAddDays, agendaDate, agendaMonthStart, agendaWeekStart } from "@/lib/scheduling/operationalAgenda";
import { agendaScopeKey, loadOperationalAgenda } from "@/lib/scheduling/operationalAgendaServer";

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
        let snapshots: unknown[] = [];
        if (parsed.data.view === "reports") {
            const { data, error } = await supabase.from("agenda_monthly_snapshots").select("month,captured_at,report").eq("scope_key", agendaScopeKey(unitIds, parsed.data.doctorIds)).order("month", { ascending: false }).limit(120);
            if (error) throw error; snapshots = data ?? [];
        }
        return NextResponse.json({ ok: true, report, snapshots }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        console.error("[agenda-reports] failed", error);
        return NextResponse.json({ error: "Não foi possível carregar os indicadores da agenda." }, { status: 500 });
    }
}
export async function POST(request: Request) {
    const access = await getServerTabAccess("inteligencia_agenda");
    if (access.ok === false) return NextResponse.json({ error: access.error }, { status: access.status });
    try {
        const parsed = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), unitIds: z.array(z.uuid()).max(100), doctorIds: z.array(z.uuid()).max(100) }).safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: "Filtros inválidos." }, { status: 400 });
        const unitIds = access.permission.unit_lock ? [access.permission.unit_lock.id] : parsed.data.unitIds;
        const month = `${parsed.data.month}-01`, end = agendaMonthStart(month, 1);
        const report = await loadOperationalAgenda({ start: month, end, reportDate: month, unitIds, doctorIds: parsed.data.doctorIds, includeHistory: false });
        const { error } = await supabase.from("agenda_monthly_snapshots").upsert({ month, scope_key: agendaScopeKey(unitIds, parsed.data.doctorIds), unit_ids: [...new Set(unitIds)].sort(), doctor_ids: [...new Set(parsed.data.doctorIds)].sort(), report: { counts: report.counts, byUnit: report.byUnit }, captured_at: new Date().toISOString(), captured_by: access.user.id }, { onConflict: "month,scope_key" });
        if (error) throw error;
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[agenda-reports] snapshot failed", error);
        return NextResponse.json({ error: "Não foi possível salvar o histórico mensal." }, { status: 500 });
    }
}
