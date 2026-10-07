// lib/scheduling/agendaIntelligenceServer.ts
import { supabase } from "@/lib/supabase/client";
import { patternSignalSchema } from "@/lib/analysis/patternSignals";
import { buildAgendaIntelligence, type IntelligenceAgenda, type IntelligenceAnalysis, type IntelligenceAppointment, type IntelligenceEvidenceMessage, type ScheduleHistory } from "./agendaIntelligence";

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
    const analysisRequest = readAll<IntelligenceAnalysis>(cursor => {
            let query = supabase.from("conversation_analysis")
                .select("id, conversation_id, client_id, pattern_signals, started_at, customer_final_state, outcome_events, clients!inner(id, unit_id, name, phone, phone_identity), conversations!conversation_analysis_conversation_id_fkey!inner(channel)")
                .gte("started_at", from).lt("started_at", until).eq("conversations.channel", "WhatsApp").order("id").limit(500);
            if (unitIds.length) query = query.in("clients.unit_id", unitIds);
            if (cursor) query = query.gt("id", cursor);
            return query;
        });
    const evidenceRequest = analysisRequest.then(loadEvidenceMessages);
    const [agendas, appointments, analyses, history, baseline, doctorResult, evidenceMessages] = await Promise.all([
        readAll<IntelligenceAgenda>(cursor => {
            let query = supabase.from("clinisys_agendas").select("id, unit_id, unit_name, doctor_id, doctor_name, timezone, slot_duration_minutes, working_hours, exceptions, blocks, procedures")
                .eq("active", true).not("doctor_id", "is", null).not("unit_id", "is", null).order("id").limit(500);
            if (unitIds.length) query = query.in("unit_id", unitIds);
            if (doctorIds.length) query = query.in("doctor_id", doctorIds);
            if (cursor) query = query.gt("id", cursor);
            return query;
        }),
        readAll<IntelligenceAppointment>(cursor => {
            // Booking outcomes must include every doctor and appointments beyond the capacity horizon.
            let query = supabase.from("appointments").select("id, client_id, patient_phone, unit_id, doctor_id, starts_at, ends_at, status")
                .gt("ends_at", new Date(Math.min(now, Date.parse(from))).toISOString()).order("id").limit(500);
            if (unitIds.length) query = query.in("unit_id", unitIds);
            if (cursor) query = query.gt("id", cursor);
            return query;
        }),
        analysisRequest,
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
        evidenceRequest,
    ]);
    if (baseline.error) throw baseline.error;
    if (doctorResult.error) throw doctorResult.error;
    const doctors = (doctorResult.data ?? []).flatMap(row => {
        const doctor = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
        return doctor ? [{ id: doctor.id, name: doctor.name, unit_id: row.unit_id }] : [];
    });
    const scoped = (item: IntelligenceAppointment | null) => item && (!unitIds.length || unitIds.includes(item.unit_id)) && (!doctorIds.length || doctorIds.includes(item.doctor_id)) ? item : null;
    return buildAgendaIntelligence({ days, now, resultsStart: from, resultsEnd: until, agendas,
        appointments: appointments.filter(item => !doctorIds.length || doctorIds.includes(item.doctor_id)), demandAppointments: appointments,
        analyses, evidenceMessages, doctors,
        history: history.map(row => ({ ...row, before_state: scoped(row.before_state), after_state: scoped(row.after_state) })),
        historyStartedAt: baseline.data?.recorded_at ?? null });
}

async function loadEvidenceMessages(analyses: IntelligenceAnalysis[]) {
    const evidenceIds = [...new Set(analyses.flatMap(analysis => Array.isArray(analysis.pattern_signals) ? analysis.pattern_signals.flatMap(raw => {
        const signal = patternSignalSchema.safeParse(raw);
        return signal.success && signal.data.category === "consultation_preference" && signal.data.confidence >= 0.85
            ? signal.data.evidence.map(item => item.message_id).filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) : [];
    }) : []))];
    const batches = Array.from({ length: Math.ceil(evidenceIds.length / 200) }, (_, index) => evidenceIds.slice(index * 200, (index + 1) * 200));
    return (await Promise.all(batches.map(async ids => {
        const { data, error } = await supabase.from("messages").select("id, conversation_id, sent_at").in("id", ids);
        if (error) throw error;
        return (data ?? []) as IntelligenceEvidenceMessage[];
    }))).flat();
}
