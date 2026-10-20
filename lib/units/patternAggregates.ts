import { supabase } from "@/lib";
import { aggregatePatternSignals, type PatternRow } from "@/lib/analysis/patternSignals";

// Sequential compact reads, with the same unit/channel/period attribution as
// the existing weekly diagnostics. Never reread transcripts to find patterns.
export async function loadUnitPatternAggregates(unitId: string, start: string, end: string) {
    const rows: PatternRow[] = [];
    let pending = 0;
    const dayMs = 86_400_000;
    const from = Date.parse(start + "T00:00:00-03:00");
    const until = Date.parse(end + "T00:00:00-03:00");
    // Read one day at a time using the existing started_at index, avoiding
    // large joined scans that can time out before the first result page.
    for (let day = from; day < until; day += dayMs) {
        const dayStart = new Date(day).toISOString();
        const dayEnd = new Date(Math.min(day + dayMs, until)).toISOString();
        let cursor: { started_at: string; id: string } | null = null;
        for (;;) {
            let query = supabase.from("conversation_analysis")
                .select("id, started_at, conversation_id, pattern_signals, clients!inner(unit_id), conversations!conversation_analysis_conversation_id_fkey!inner(channel), attendants!conversation_analysis_attendant_id_fkey(queues!attendants_queue_id_fkey(sector))")
                .eq("clients.unit_id", unitId).eq("conversations.channel", "WhatsApp")
                .gte("started_at", cursor?.started_at ?? dayStart).lt("started_at", dayEnd)
                .order("started_at").order("id").limit(200);
            if (cursor) query = query.or(
                `started_at.gt.${cursor.started_at},and(started_at.eq.${cursor.started_at},id.gt.${cursor.id})`,
            );
            const { data, error } = await query;
            if (error) throw error;
            if (!data?.length) break;
            for (const row of data) {
                const attendant = Array.isArray(row.attendants) ? row.attendants[0] : row.attendants;
                const queue = Array.isArray(attendant?.queues) ? attendant.queues[0] : attendant?.queues;
                if (row.pattern_signals === null) pending++;
                rows.push({ conversation_id: row.conversation_id, pattern_signals: row.pattern_signals, audience: queue?.sector === "ra" ? "RA" : "Atendimento" });
            }
            if (rows.length > 10000) throw new Error("Período excede 10 mil análises; agregação interrompida sem publicar contagens parciais.");
            const last = data[data.length - 1];
            cursor = { started_at: last.started_at, id: last.id };
            if (data.length < 200) break;
        }
    }
    return { patterns: aggregatePatternSignals(rows), coverage: { analyzed_conversations: rows.length, signals_processed: rows.length - pending, signals_pending: pending } };
}
