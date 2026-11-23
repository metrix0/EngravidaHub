// lib/scheduling/firstEvaluationBlocks.ts
import { isFirstEvaluationProcedure } from "@/lib/funnel/clinisysJourney";
import { supabase } from "@/lib/supabase/client";

const calendarDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const calendarClock = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const FIRST_EVALUATION_BLOCKED = "A 1ª avaliação está bloqueada nesta agenda para este horário.";

export type FirstEvaluationBlockRange = { start: number; end: number };
export type FirstEvaluationBlocks = ReadonlyMap<string, readonly FirstEvaluationBlockRange[]>;

export function firstEvaluationBlockKey(unitId: string, doctorId: string, date: string) {
    return `${unitId}:${doctorId}:${date}`;
}

function clockMinutes(value: string) {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
}

export function hasFirstEvaluationBlockOverlap(
    blocks: FirstEvaluationBlocks,
    unitId: string,
    doctorId: string,
    date: string,
    start: number,
    end: number,
) {
    return (blocks.get(firstEvaluationBlockKey(unitId, doctorId, date)) ?? [])
        .some(range => start < range.end && end > range.start);
}

export function overlapsFirstEvaluationBlock(
    blocks: FirstEvaluationBlocks,
    unitId: string,
    doctorId: string,
    startsAt: Date,
    endsAt: Date,
) {
    if (endsAt <= startsAt) return false;
    const from = calendarDate.format(startsAt);
    const last = calendarDate.format(new Date(endsAt.getTime() - 1));
    const endDate = calendarDate.format(endsAt);
    for (let date = from; date <= last; date = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
        const start = date === from ? clockMinutes(calendarClock.format(startsAt)) : 0;
        const end = date === endDate ? clockMinutes(calendarClock.format(endsAt)) : 1440;
        if (hasFirstEvaluationBlockOverlap(blocks, unitId, doctorId, date, start, end)) return true;
    }
    return false;
}

export async function loadFirstEvaluationBlocks(
    from: string,
    to: string,
    unitIds: string[],
    doctorIds: string[],
): Promise<FirstEvaluationBlocks> {
    let query = supabase.from("appointment_day_notes")
        .select("unit_id, doctor_id, note_date, block_start_time, block_end_time")
        .eq("blocks_first_evaluation", true)
        .gte("note_date", from)
        .lte("note_date", to);
    if (unitIds.length) query = query.in("unit_id", unitIds);
    if (doctorIds.length) query = query.in("doctor_id", doctorIds);
    const { data, error } = await query;
    if (error) throw error;
    const ranges = new Map<string, FirstEvaluationBlockRange[]>();
    for (const note of data ?? []) {
        const key = firstEvaluationBlockKey(note.unit_id, note.doctor_id, note.note_date);
        ranges.set(key, [...(ranges.get(key) ?? []), {
            start: note.block_start_time ? clockMinutes(note.block_start_time) : 0,
            end: note.block_end_time ? clockMinutes(note.block_end_time) : 1440,
        }]);
    }
    return ranges;
}

export async function isFirstEvaluationBlocked(
    unitId: string,
    doctorId: string,
    procedureName: string,
    startsAt: Date,
    endsAt: Date,
) {
    if (!isFirstEvaluationProcedure(procedureName) || endsAt <= startsAt) return false;
    const from = calendarDate.format(startsAt);
    const to = calendarDate.format(new Date(endsAt.getTime() - 1));
    const blocks = await loadFirstEvaluationBlocks(from, to, [unitId], [doctorId]);
    return overlapsFirstEvaluationBlock(blocks, unitId, doctorId, startsAt, endsAt);
}
