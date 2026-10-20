// app/api/scheduling/booking-authors/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { normalizeAgendaText } from "@/lib/scheduling/operationalAgenda";
import { normalizeScheduleStatus, type ScheduleStatusGroup } from "@/lib/schedules/status";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    unitIds: z.array(z.uuid()).max(100),
    doctorIds: z.array(z.uuid()).max(100),
});
const PAGE_SIZE = 500;
type ScheduleRow = {
    id: string; source_external_id: string | null; attendant_name: string | null;
    unit_name: string | null; client_id: string | null; created_in_source_at: string | null;
    scheduled_for: string | null; status: string | null;
};
type AppointmentRow = {
    id: string; source_external_id: string | null; created_by_attendant_id: string | null;
    created_by: string | null; unit_id: string; doctor_id: string; client_id: string | null;
    created_at: string; starts_at: string; status: string;
};
type Attendant = { id: string; name: string };
type MutableRow = {
    key: string; name: string; bookings: number; reschedules: number; upcoming: number;
    attended: number; rescheduledClients: Set<string>; cancelled: number; missed: number;
    clients: Set<string>;
};
type MetricRow = {
    key: string; name: string; bookings: number; reschedules: number; rescheduleRate: number;
    unique: number; upcoming: number; attended: number; attendanceRate: number;
    projection: null; rescheduled: number; rescheduledRate: number;
    cancelled: number; cancelledRate: number; missed: number; missedRate: number;
};

async function readMonth<T>(table: "schedules" | "appointments", select: string, field: string, from: string, until: string) {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
        let query = supabase.from(table).select(select).gte(field, from).lt(field, until)
            .order("id").range(offset, offset + PAGE_SIZE - 1);
        if (table === "appointments") query = query.not("created_by", "is", null);
        const { data, error } = await query;
        if (error) throw error;
        const page = (data ?? []) as unknown as T[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
    }
}

function normalizeName(value: string) {
    return normalizeAgendaText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}
function statusForAppointment(status: string): ScheduleStatusGroup {
    if (status === "completed") return "attended";
    if (status === "cancelled") return "cancelled";
    if (status === "no_show") return "no_show";
    return "pending";
}
function percentage(numerator: number, denominator: number) {
    return denominator ? Math.round(numerator / denominator * 1000) / 10 : 0;
}

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const parsed = schema.safeParse({
        month: params.get("month"),
        unitIds: params.getAll("unit_ids"),
        doctorIds: params.getAll("doctor_ids"),
    });
    if (!parsed.success) return NextResponse.json({ error: "Filtros inválidos." }, { status: 400 });
    const access = await getServerTabAccess("inteligencia_agenda");
    if (access.ok === false) return NextResponse.json({ error: access.error }, { status: access.status });
    const { month, doctorIds } = parsed.data;
    const unitIds = access.permission.unit_lock ? [access.permission.unit_lock.id] : parsed.data.unitIds;
    const [year, part] = month.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year, part, 1)).toISOString().slice(0, 10);
    const firstDay = month + "-01";
    try {
        const [schedules, bookedInHub, attendantsResult, aliasResult, unitsResult] = await Promise.all([
            readMonth<ScheduleRow>("schedules",
                "id,source_external_id,attendant_name,unit_name,client_id,created_in_source_at,scheduled_for,status",
                "created_in_source_at", firstDay, nextMonth),
            readMonth<AppointmentRow>("appointments",
                "id,source_external_id,created_by_attendant_id,created_by,unit_id,doctor_id,client_id,created_at,starts_at,status",
                "created_at", firstDay + "T00:00:00-03:00", nextMonth + "T00:00:00-03:00"),
            supabase.from("attendants").select("id,name"),
            supabase.from("attendant_aliases").select("source_name,attendant_id").eq("source", "clinisys"),
            supabase.from("units").select("id,name"),
        ]);
        if (attendantsResult.error) throw attendantsResult.error;
        if (aliasResult.error) throw aliasResult.error;
        if (unitsResult.error) throw unitsResult.error;
        const attendants = (attendantsResult.data ?? []) as Attendant[];
        const attendantsById = new Map(attendants.map(item => [item.id, item]));
        const aliases = new Map((aliasResult.data ?? []).map(row => [row.source_name, row.attendant_id]));
        const exact = new Map<string, string | null>();
        for (const row of attendants) {
            const name = normalizeName(row.name);
            exact.set(name, exact.has(name) ? null : row.id);
        }
        const unitByName = new Map((unitsResult.data ?? []).map(unit => [normalizeName(unit.name), unit.id]));
        const externalIds = [...new Set(schedules.map(row => row.source_external_id).filter((id): id is string => Boolean(id)))];
        const linked = new Map<string, AppointmentRow>();
        for (let start = 0; start < externalIds.length; start += 100) {
            const { data, error } = await supabase.from("appointments")
                .select("id,source_external_id,created_by_attendant_id,created_by,unit_id,doctor_id,client_id,created_at,starts_at,status")
                .in("source_external_id", externalIds.slice(start, start + 100));
            if (error) throw error;
            for (const item of (data ?? []) as AppointmentRow[]) {
                if (item.source_external_id) linked.set(item.source_external_id, item);
            }
        }
        const now = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date());
        const groups = new Map<string, MutableRow>();
        const all = createRow("total", "Total geral");
        function createRow(key: string, name: string): MutableRow {
            return { key, name, bookings: 0, reschedules: 0, upcoming: 0, attended: 0,
                rescheduledClients: new Set(), cancelled: 0, missed: 0, clients: new Set() };
        }
        function record(
            id: string, name: string, client: string, status: ScheduleStatusGroup,
            scheduledDay: string | null,
        ) {
            const row = groups.get(id) ?? createRow(id, name);
            for (const bucket of [row, all]) {
                bucket.bookings += 1;
                bucket.clients.add(client);
                if (status === "rescheduled") {
                    bucket.reschedules += 1;
                    bucket.rescheduledClients.add(client);
                }
                if (status === "attended" || status === "arrived" || status === "in_service") bucket.attended += 1;
                if (status === "cancelled") bucket.cancelled += 1;
                if (status === "no_show") bucket.missed += 1;
                if (status === "pending" && scheduledDay && scheduledDay >= now) bucket.upcoming += 1;
            }
            groups.set(id, row);
        }
        const bookedIds = new Set<string>();
        const seenExternalIds = new Set<string>();
        for (const item of schedules) {
            const external = item.source_external_id;
            if (external && seenExternalIds.has(external)) continue;
            if (external) seenExternalIds.add(external);
            const appointment = external ? linked.get(external) : null;
            if (unitIds.length) {
                const unitId = appointment?.unit_id ?? unitByName.get(normalizeName(item.unit_name ?? ""));
                if (!unitId || !unitIds.includes(unitId)) continue;
            }
            // A Clinisys schedule has no doctor ID. When filtering by doctor, only
            // use entries linked to a Hub appointment with that exact doctor.
            if (doctorIds.length && (!appointment || !doctorIds.includes(appointment.doctor_id))) continue;
            const rawName = item.attendant_name?.trim() || "";
            const attendantId = appointment?.created_by_attendant_id
                ?? aliases.get(rawName) ?? exact.get(normalizeName(rawName)) ?? null;
            const name = attendantId ? attendantsById.get(attendantId)?.name ?? rawName : rawName || "Não identificado";
            const groupKey = attendantId ?? "source:" + normalizeName(name);
            const client = item.client_id ?? appointment?.client_id ?? item.id;
            record(groupKey, name, client, normalizeScheduleStatus(item.status), item.scheduled_for);
            if (appointment?.created_by) bookedIds.add(appointment.id);
        }
        for (const appointment of bookedInHub) {
            if (bookedIds.has(appointment.id)) continue;
            if (unitIds.length && !unitIds.includes(appointment.unit_id)) continue;
            if (doctorIds.length && !doctorIds.includes(appointment.doctor_id)) continue;
            const booker = appointment.created_by_attendant_id ? attendantsById.get(appointment.created_by_attendant_id) : null;
            const name = booker?.name ?? "Não identificado";
            const key = booker?.id ?? "source:nao identificado";
            record(key, name, appointment.client_id ?? appointment.id,
                statusForAppointment(appointment.status), appointment.starts_at.slice(0, 10));
        }
        function output(row: MutableRow): MetricRow {
            const unique = row.clients.size;
            const rescheduled = row.rescheduledClients.size;
            return {
                key: row.key, name: row.name, bookings: row.bookings,
                reschedules: row.reschedules, rescheduleRate: percentage(row.reschedules, row.bookings),
                unique, upcoming: row.upcoming, attended: row.attended,
                attendanceRate: percentage(row.attended, unique),
                projection: null, rescheduled, rescheduledRate: percentage(rescheduled, unique),
                cancelled: row.cancelled, cancelledRate: percentage(row.cancelled, unique),
                missed: row.missed, missedRate: percentage(row.missed, unique),
            };
        }
        const rows = [...groups.values()].sort((a,b) => b.bookings - a.bookings || a.name.localeCompare(b.name,"pt-BR")).map(output);
        return NextResponse.json({ rows, total: output(all), doctorLimited: doctorIds.length > 0 },
            { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        console.error("[agenda-booking-authors] failed", error);
        return NextResponse.json({ error: "Não foi possível carregar os agendamentos por atendente." }, { status: 500 });
    }
}
