// lib/scheduling/operationalAgendaServer.ts
import { supabase } from "@/lib/supabase/client";
import { agendaDate, agendaMonthStart, agendaWeekStart, buildOperationalAgenda, type OperationalAgenda, type OperationalAppointment } from "./operationalAgenda";
import { raQuotaKey } from "./raAvailability";

const brazilClock = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

async function readAll<T>(query: (cursor: string | null) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
    const rows: T[] = []; let cursor: string | null = null;
    for (;;) {
        const { data, error } = await query(cursor); if (error) throw error;
        if (!data?.length) return rows;
        rows.push(...data as T[]); cursor = String((data.at(-1) as { id: string }).id);
        if (data.length < 500) return rows;
    }
}

export async function loadOperationalAgenda({ start, end, unitIds, doctorIds, reportDate, includeHistory = true }: { start: string; end: string; unitIds: string[]; doctorIds: string[]; reportDate?: string; includeHistory?: boolean }) {
    const from = [agendaMonthStart(start, includeHistory ? -6 : 0), agendaWeekStart(reportDate ?? agendaDate())].sort()[0];
    const horizonEnd = agendaMonthStart(reportDate ?? agendaDate(), 2);
    const until = [end, horizonEnd].sort().at(-1)!;
    const [agendas, appointments, doctorUnits] = await Promise.all([
        readAll<OperationalAgenda>(cursor => {
            let query = supabase.from("clinisys_agendas").select("id,unit_id,unit_name,doctor_id,doctor_name,timezone,slot_duration_minutes,working_hours,exceptions,blocks,availability_snapshot")
                .eq("active", true).not("unit_id", "is", null).not("doctor_id", "is", null).order("id").limit(500);
            if (unitIds.length) query = query.in("unit_id", unitIds);
            if (doctorIds.length) query = query.in("doctor_id", doctorIds);
            if (cursor) query = query.gt("id", cursor); return query;
        }),
        readAll<OperationalAppointment & { procedure_name: string | null }>(cursor => {
            let query = supabase.from("appointments").select("id,unit_id,doctor_id,starts_at,ends_at,status,booking_team,source_external_id,procedure_name")
                .gt("ends_at", `${from}T00:00:00-03:00`).lt("starts_at", `${until}T00:00:00-03:00`).in("status", ["scheduled", "confirmed", "completed", "no_show"]).order("id").limit(500);
            if (unitIds.length) query = query.in("unit_id", unitIds);
            if (doctorIds.length) query = query.in("doctor_id", doctorIds);
            if (cursor) query = query.gt("id", cursor); return query;
        }),
        readAll<{ id: string; name: string; doctor_units: Array<{ unit_id: string; active: boolean }> }>(cursor => {
            let query = supabase.from("doctors").select("id,name,doctor_units!inner(unit_id,active)").eq("active", true).eq("doctor_units.active", true).order("id").limit(500);
            if (unitIds.length) query = query.in("doctor_units.unit_id", unitIds);
            if (doctorIds.length) query = query.in("id", doctorIds);
            if (cursor) query = query.gt("id", cursor); return query;
        }),
    ]);
    const raFirstEvaluationCounts: Record<string, number> = {};
    for (const appointment of appointments) {
        const procedure = (appointment.procedure_name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (appointment.booking_team !== "ra" || !/^1\s*[ªaºo]?\s*avaliac/.test(procedure)) continue;
        const [hour, minute] = brazilClock.format(new Date(appointment.starts_at)).split(":").map(Number);
        const key = raQuotaKey(appointment.doctor_id, agendaDate(appointment.starts_at), hour * 60 + minute);
        raFirstEvaluationCounts[key] = (raFirstEvaluationCounts[key] ?? 0) + 1;
    }
    const report = buildOperationalAgenda({ agendas: includeHistory ? agendas : agendas.map(agenda => ({ ...agenda, doctor_name: doctorUnits.find(doctor => doctor.id === agenda.doctor_id)?.name ?? agenda.doctor_name })), appointments, start, end, reportDate, includeHistory, reportAvailability: !includeHistory, raFirstEvaluationCounts });
    const covered = new Set(agendas.map(row => `${row.unit_id}:${row.doctor_id}`));
    return { ...report, raFirstEvaluationCounts, missingDoctors: doctorUnits.flatMap(doctor => doctor.doctor_units.filter(row => !covered.has(`${row.unit_id}:${doctor.id}`)).map(row => ({ doctorId: doctor.id, doctorName: doctor.name, unitId: row.unit_id }))) };
}
