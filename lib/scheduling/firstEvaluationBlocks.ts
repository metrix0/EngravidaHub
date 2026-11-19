// lib/scheduling/firstEvaluationBlocks.ts
import { isFirstEvaluationProcedure } from "@/lib/funnel/clinisysJourney";
import { supabase } from "@/lib/supabase/client";

const calendarDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

export const FIRST_EVALUATION_BLOCKED = "A 1ª avaliação está bloqueada nesta agenda para este dia.";

export function firstEvaluationBlockKey(unitId: string, doctorId: string, date: string) {
    return `${unitId}:${doctorId}:${date}`;
}

export async function loadFirstEvaluationBlocks(
    from: string,
    to: string,
    unitIds: string[],
    doctorIds: string[],
) {
    let query = supabase.from("appointment_day_notes")
        .select("unit_id, doctor_id, note_date")
        .eq("blocks_first_evaluation", true)
        .gte("note_date", from)
        .lte("note_date", to);
    if (unitIds.length) query = query.in("unit_id", unitIds);
    if (doctorIds.length) query = query.in("doctor_id", doctorIds);
    const { data, error } = await query;
    if (error) throw error;
    return new Set((data ?? []).map(note => firstEvaluationBlockKey(note.unit_id, note.doctor_id, note.note_date)));
}

export async function isFirstEvaluationBlocked(
    unitId: string,
    doctorId: string,
    procedureName: string,
    startsAt: Date,
    endsAt: Date,
) {
    if (!isFirstEvaluationProcedure(procedureName)) return false;
    const from = calendarDate.format(startsAt);
    const to = calendarDate.format(new Date(endsAt.getTime() - 1));
    return (await loadFirstEvaluationBlocks(from, to, [unitId], [doctorId])).size > 0;
}
