// lib/scheduling/agendaIntelligenceServer.ts
import { supabase } from "@/lib/supabase/client";
import { buildAgendaIntelligence, type IntelligenceAgenda, type IntelligenceAnalysis, type IntelligenceAppointment, type ScheduleHistory } from "./agendaIntelligence";

// Keyset pagination avoids silently relying on Supabase's default result cap.
async function readAll<T>(query: (cursor: string | null) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
    const rows: T[] = [];
    let cursor: string | null = null;
    for (;;) {
        const { data, error } = await query(cursor);
        if (error) throw error;
        if (!data?.length) break;
        rows.push(...data as T[]);
        cursor = String((data[data.length - 1] as { id: string | number }).id);
        if (data.length < 500) break;
    }
    return rows;
}

export async function loadAgendaIntelligence({ days, unitIds, doctorIds, resultsStart, resultsEnd }: { days: number; unitIds: string[]; doctorIds: string[]; resultsStart?: string; resultsEnd?: string }) {
    const now = Date.now();
    const from = resultsStart ?? new Date(now - days * 86_400_000).toISOString();
    const until = new Date(Math.min(now, resultsEnd ? Date.parse(resultsEnd) : now)).toISOString();
    const to = new Date(now + (days + 1) * 86_400_000).toISOString();
    const [agendas, appointments, analyses, history, baseline, doctorResult] = await Promise.all([
        readAll<IntelligenceAgenda>(cursor => {
            let query = supabase.from("clinisys_agendas").select("id, unit_id, unit_name, doctor_id, doctor_name, timezone, slot_duration_minutes, working_hours, exceptions, blocks, procedures")
                .eq("active", true).not("doctor_id", "is", null).not("unit_id", "is", null).order("id").limit(500);
            if (unitIds.length) query = query.in("unit_id", unitIds);
            if (doctorIds.length) query = query.in("doctor_id", doctorIds);
            if (cursor) query = query.gt("id", cursor);
            return query;
        }),
        readAll<IntelligenceAppointment>(cursor => {
            let query = supabase.from("appointments").select("id, unit_id, doctor_id, starts_at, ends_at, status")
                .gt("ends_at", new Date(Math.min(now, Date.parse(from))).toISOString()).lt("starts_at", to).order("id").limit(500);
            if (unitIds.length) query = query.in("unit_id", unitIds);
            if (doctorIds.length) query = query.in("doctor_id", doctorIds);
            if (cursor) query = query.gt("id", cursor);
            return query;
        }),
        readAll<IntelligenceAnalysis>(cursor => {
            let query = supabase.from("conversation_analysis")
                .select("id, conversation_id, pattern_signals, started_at, clients!inner(unit_id, name), conversations!conversation_analysis_conversation_id_fkey!inner(channel)")
                .gte("started_at", from).lt("started_at", until).eq("conversations.channel", "WhatsApp").order("id").limit(500);
            if (unitIds.length) query = query.in("clients.unit_id", unitIds);
            if (cursor) query = query.gt("id", cursor);
            return query;
        }),
        readAll<ScheduleHistory>(cursor => {
            let query = supabase.from("schedule_history").select("id, entity_id, entity_type, operation, recorded_at, before_state, after_state")
                .eq("entity_type", "appointment").neq("operation", "snapshot").gte("recorded_at", from).lt("recorded_at", new Date(now).toISOString()).order("id").limit(500);
            // Scope both sides of moves; the calculator also filters each snapshot below.
            const current = [], previous = [];
            if (unitIds.length) { current.push(`unit_id.in.(${unitIds.join(",")})`); previous.push(`previous_unit_id.in.(${unitIds.join(",")})`); }
            if (doctorIds.length) { current.push(`doctor_id.in.(${doctorIds.join(",")})`); previous.push(`previous_doctor_id.in.(${doctorIds.join(",")})`); }
            if (current.length) query = query.or(`and(${current.join(",")}),and(${previous.join(",")})`);
            if (cursor) query = query.gt("id", cursor);
            return query;
        }),
        supabase.from("schedule_history").select("recorded_at").eq("operation", "snapshot").order("recorded_at").limit(1).maybeSingle(),
        (() => {
            let query = supabase.from("doctor_units").select("unit_id, doctor:doctors!inner(id, name, active)").eq("active", true).eq("doctor.active", true);
            if (unitIds.length) query = query.in("unit_id", unitIds);
            if (doctorIds.length) query = query.in("doctor.id", doctorIds);
            return query;
        })(),
    ]);
    if (baseline.error) throw baseline.error;
    if (doctorResult.error) throw doctorResult.error;
    const doctors = (doctorResult.data ?? []).flatMap(row => {
        const doctor = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
        return doctor ? [{ id: doctor.id, name: doctor.name, unit_id: row.unit_id }] : [];
    });
    const scoped = (item: IntelligenceAppointment | null) => item && (!unitIds.length || unitIds.includes(item.unit_id)) && (!doctorIds.length || doctorIds.includes(item.doctor_id)) ? item : null;
    return buildAgendaIntelligence({ days, now, resultsStart: from, resultsEnd: until, agendas, appointments, analyses, doctors,
        history: history.map(row => ({ ...row, before_state: scoped(row.before_state), after_state: scoped(row.after_state) })),
        historyStartedAt: baseline.data?.recorded_at ?? null });
}
