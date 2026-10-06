import { parseArgs } from "node:util";
import { SYNTHETIC_ACTIVE_MESSAGE_SEND_ID } from "../lib/active-messages/history";

// Run with the same server environment as the Hub. Default is read-only.
async function main() {
    const { values } = parseArgs({
        options: { apply: { type: "boolean" }, help: { type: "boolean" } },
    });
    if (values.help) {
        console.log("node --env-file=.env.local --import tsx scripts/remove-synthetic-active-message-send.ts [--apply]");
        return;
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL)
        throw new Error("Configure o ambiente do servidor do Hub antes de executar.");
    const { supabase } = await import("../lib/supabase/client");
    const { data: row, error } = await supabase.from("active_message_sends")
        .select("id, requested_count, sent_count, status, created_at, client_ids, results, filters")
        .eq("id", SYNTHETIC_ACTIVE_MESSAGE_SEND_ID).maybeSingle();
    if (error) throw error;
    if (!row) {
        console.log("O registro sintético já foi removido.");
        return;
    }
    const results = row.results as Array<{ client_id?: string; phone?: string; status?: string }>;
    const cadenceId = "bad72f40-3556-42fe-8753-700f0ef34df5";
    if (row.requested_count !== 200 || row.sent_count !== 200 || row.status !== "completed" ||
        new Date(row.created_at).toISOString() !== "2026-10-01T15:00:00.000Z" ||
        !Array.isArray(row.client_ids) || row.client_ids.length !== 0 ||
        row.filters?.cadence_id !== cadenceId ||
        !Array.isArray(results) || results.length !== 200 ||
        results.some((result) => result.client_id || !result.phone || result.status !== "sent") ||
        new Set(results.map((result) => result.phone?.replace(/\D/g, ""))).size !== 1)
        throw new Error("O registro não corresponde ao teste confirmado. Nenhuma alteração realizada.");
    if (!values.apply) {
        console.log("Teste confirmado: 200 resultados repetidos, sem clientes. Use --apply para remover somente este registro.");
        return;
    }
    const { data: removed, error: removeError } = await supabase.from("active_message_sends")
        .delete().eq("id", row.id).eq("status", "completed")
        .eq("created_at", row.created_at).eq("requested_count", 200).eq("sent_count", 200)
        .eq("client_ids", "{}").contains("filters", { cadence_id: cadenceId }).select("id");
    if (removeError) throw removeError;
    if (removed?.length !== 1) throw new Error("A remoção não foi confirmada; o registro pode ter mudado.");
    const { count, error: verifyError } = await supabase.from("active_message_sends")
        .select("id", { count: "exact", head: true }).eq("id", row.id);
    if (verifyError) throw verifyError;
    if (count !== 0) throw new Error("O registro ainda existe após a remoção.");
    console.log("Registro sintético removido e ausência confirmada. A cadência e os envios reais foram preservados.");
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
