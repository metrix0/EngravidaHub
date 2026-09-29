// One conversation at a time; updates only signals, never requeues analyses/ad events.
// node --env-file=.env.local --import tsx scripts/backfill-pattern-signals.ts --since 2026-09-21 --until 2026-09-29 --limit 100 --apply
import { parseArgs } from "node:util";
import { z } from "zod";
import { supabase } from "../lib/supabase/client";
import { getGroqClient } from "../lib/ai/groq";
import { PATTERN_SIGNALS_PROMPT, PATTERN_SIGNAL_VERSION, patternSignalsSchema, validatePatternSignals } from "../lib/analysis/patternSignals";

const schema = z.object({ pattern_signals: patternSignalsSchema });
const { values } = parseArgs({ options: {
    since: { type: "string" }, until: { type: "string" }, limit: { type: "string", default: "25" },
    unit: { type: "string" }, apply: { type: "boolean", default: false },
} });
const limit = Number(values.limit);
function date(value: string | undefined) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value)
        throw new Error("Use --since e --until como YYYY-MM-DD (until exclusivo).");
    return value;
}
async function main() {
    const since = date(values.since), until = date(values.until);
    if (since >= until || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Intervalo inválido; limit deve ser 1–500.");
    let unitId: string | null = null;
    if (values.unit) {
        const { data, error } = await supabase.from("units").select("id").eq("name", values.unit).single();
        if (error) throw error;
        unitId = data.id;
    }
    let query = supabase.from("conversation_analysis")
        .select("id, conversation_id, clients!inner(unit_id), conversations!conversation_analysis_conversation_id_fkey!inner(channel)")
        .is("pattern_signals", null).eq("conversations.channel", "WhatsApp")
        .gte("started_at", since + "T00:00:00-03:00").lt("started_at", until + "T00:00:00-03:00")
        .order("started_at", { ascending: false }).order("id").limit(limit);
    if (unitId) query = query.eq("clients.unit_id", unitId);
    const { data: rows, error } = await query;
    if (error) throw error;
    console.log(JSON.stringify({ version: PATTERN_SIGNAL_VERSION, selected: rows?.length ?? 0, apply: values.apply, since, until }));
    if (!values.apply) return;
    const model = process.env.GROQ_MODEL_ANALYSIS_PRIMARY ?? "openai/gpt-oss-120b";
    const groq = getGroqClient();
    let processed = 0, signals = 0, inputTokens = 0, outputTokens = 0;
    for (const row of rows ?? []) {
        const messages: Array<{ id: string; sender_type: string; text: string }> = [];
        for (let offset = 0;;) {
            const result = await supabase.from("messages").select("id, sender_type, text, sent_at, sequence_index")
                .eq("conversation_id", row.conversation_id)
                .order("sent_at").order("sequence_index").order("id").range(offset, offset + 199);
            if (result.error) throw result.error;
            if (!result.data?.length) break;
            messages.push(...result.data);
            offset += result.data.length;
            if (messages.length > 2000) throw new Error(`Conversa ${row.conversation_id} excede limite seguro; permaneceu pendente.`);
        }
        if (!messages.length) throw new Error(`Conversa ${row.conversation_id} sem mensagens; permaneceu pendente.`);
        const content = JSON.stringify({ messages });
        if (content.length > 180000) throw new Error(`Conversa ${row.conversation_id} excede limite de contexto; permaneceu pendente.`);
        const result = await groq.chat.completions.create({
            model, temperature: 0, max_completion_tokens: 3600,
            response_format: { type: "json_schema", json_schema: { name: "customer_patterns", strict: true, schema: z.toJSONSchema(schema, { target: "draft-7" }) } },
            messages: [{ role: "system", content: PATTERN_SIGNALS_PROMPT }, { role: "user", content }],
        }, { maxRetries: 0, timeout: 120000 });
        if (result.choices[0]?.finish_reason !== "stop") throw new Error("Extração incompleta; conversa permaneceu pendente.");
        const parsed = schema.parse(JSON.parse(result.choices[0]?.message.content ?? ""));
        const validated = validatePatternSignals(parsed.pattern_signals, messages);
        const saved = await supabase.from("conversation_analysis").update({ pattern_signals: validated })
            .eq("id", row.id).is("pattern_signals", null).select("id");
        if (saved.error) throw saved.error;
        processed += saved.data?.length ?? 0;
        signals += saved.data?.length ? validated.length : 0;
        inputTokens += result.usage?.prompt_tokens ?? 0;
        outputTokens += result.usage?.completion_tokens ?? 0;
        console.log(JSON.stringify({ conversation_id: row.conversation_id, processed, signals, input_tokens: inputTokens, output_tokens: outputTokens }));
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log(JSON.stringify({ complete: true, processed, signals, input_tokens: inputTokens, output_tokens: outputTokens }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
