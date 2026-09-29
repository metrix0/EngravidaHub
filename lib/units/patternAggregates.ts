import { supabase } from "@/lib";
import { aggregatePatternSignals, type PatternRow } from "@/lib/analysis/patternSignals";

// Sequential compact reads, with the same unit/channel/period attribution as
// the existing weekly diagnostics. Never reread transcripts to find patterns.
export async function loadUnitPatternAggregates(unitId: string, start: string, end: string) {
    const rows: PatternRow[] = [];
    let cursor: string | null = null;
    let pending = 0;
    for (;;) {
        let query = supabase.from("conversation_analysis")
            .select("id, conversation_id, pattern_signals, clients!inner(unit_id), conversations!conversation_analysis_conversation_id_fkey!inner(channel), attendants!conversation_analysis_attendant_id_fkey(queues!attendants_queue_id_fkey(sector))")
            .eq("clients.unit_id", unitId).eq("conversations.channel", "WhatsApp")
            .gte("started_at", start + "T00:00:00-03:00").lt("started_at", end + "T00:00:00-03:00")
            .order("id").limit(200);
        if (cursor) query = query.gt("id", cursor);
        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) break;
        for (const row of data) {
            const attendant = Array.isArray(row.attendants) ? row.attendants[0] : row.attendants;
            const queue = Array.isArray(attendant?.queues) ? attendant.queues[0] : attendant?.queues;
            if (row.pattern_signals === null) pending++;
            rows.push({ conversation_id: row.conversation_id, pattern_signals: row.pattern_signals, audience: queue?.sector === "ra" ? "RA" : "Atendimento" });
        }
        cursor = data[data.length - 1].id;
        if (rows.length > 10000) throw new Error("Período excede 10 mil análises; agregação interrompida sem publicar contagens parciais.");
    }
    return { patterns: aggregatePatternSignals(rows), coverage: { analyzed_conversations: rows.length, signals_processed: rows.length - pending, signals_pending: pending } };
}
