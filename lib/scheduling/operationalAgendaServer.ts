// lib/scheduling/operationalAgendaServer.ts
import { supabase } from "@/lib/supabase/client";
import { agendaDate, agendaMonthStart, agendaWeekStart, buildOperationalAgenda, type OperationalAgenda, type OperationalAppointment } from "./operationalAgenda";
import { sectorBookingTeam, teamForAttendantName, type BookingTeam } from "./bookingOrigin";

async function readAll<T>(query: (cursor: string | null) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
    const rows: T[] = []; let cursor: string | null = null;
    for (;;) {
        const { data, error } = await query(cursor); if (error) throw error;
        if (!data?.length) return rows;
        rows.push(...data as T[]); cursor = String((data.at(-1) as { id: string }).id);
        if (data.length < 500) return rows;
    }
}

export async function enrichBookingTeams<T extends { booking_team?: BookingTeam; source_external_id?: string | null }>(appointments: T[]) {
    const ids = [...new Set(appointments.filter(row => !row.booking_team && row.source_external_id).map(row => row.source_external_id!))];
    if (!ids.length) return appointments;
    const [{ data: attendants, error }, schedules] = await Promise.all([
        supabase.from("attendants").select("id,name,queues!attendants_queue_id_fkey(sector)"),
        Promise.all(Array.from({ length: Math.ceil(ids.length / 150) }, (_, index) => ids.slice(index * 150, (index + 1) * 150)).map(async batch => {
            return readAll<{ id: string; source_external_id: string; attendant_name: string | null }>(cursor => {
                let query = supabase.from("schedules").select("id,source_external_id,attendant_name").in("source_external_id", batch).order("id").limit(500);
                if (cursor) query = query.gt("id", cursor);
                return query;
            });
        })),
    ]);
    if (error) throw error;
    const names = (attendants ?? []).map(row => { const queue = Array.isArray(row.queues) ? row.queues[0] : row.queues; return { id: row.id, name: row.name, team: sectorBookingTeam(queue?.sector) }; });
    const teams = new Map<string, Set<BookingTeam>>();
    schedules.flat().forEach(row => { const team = row.attendant_name ? teamForAttendantName(row.attendant_name, names) : null; teams.set(row.source_external_id, new Set([...(teams.get(row.source_external_id) ?? []), team])); });
    return appointments.map(row => { const found = teams.get(row.source_external_id ?? ""); return { ...row, booking_team: row.booking_team ?? (found?.size === 1 ? [...found][0] : null) }; });
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
        readAll<OperationalAppointment>(cursor => {
            let query = supabase.from("appointments").select("id,unit_id,doctor_id,starts_at,ends_at,status,booking_team,source_external_id")
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
    const report = buildOperationalAgenda({ agendas, appointments: await enrichBookingTeams(appointments), start, end, reportDate, includeHistory });
    const covered = new Set(agendas.map(row => `${row.unit_id}:${row.doctor_id}`));
    return { ...report, missingDoctors: doctorUnits.flatMap(doctor => doctor.doctor_units.filter(row => !covered.has(`${row.unit_id}:${doctor.id}`)).map(row => ({ doctorId: doctor.id, doctorName: doctor.name, unitId: row.unit_id }))) };
}
export const agendaScopeKey = (unitIds: string[], doctorIds: string[]) => `units:${[...new Set(unitIds)].sort().join(",")}|doctors:${[...new Set(doctorIds)].sort().join(",")}`;
