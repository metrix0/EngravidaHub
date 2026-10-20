import { createClient } from "npm:@supabase/supabase-js@2.108.0";
import { prepareJourneyPatients } from "./journey-engine.mjs";
const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(async request => {
    const token = request.headers.get("x-journey-token");
    if (!token) return new Response("Unauthorized", { status: 401 });
    const { data: batch, error } = await db.rpc("dashboard_journey_claim_v1", { p_token: token });
    if (error) { console.error("journey claim failed", { code: error.code }); return new Response("Refresh unavailable", { status: 503 }); }
    if (!batch?.authorized) return new Response("Unauthorized", { status: 401 });
    if (!batch.ids?.length) return Response.json({ ok: true, idle: true });
    const work = async () => {
        try {
            const { data, error: sourceError } = await db.rpc("dashboard_journey_source_v1", { p_client_ids: batch.ids });
            if (sourceError) throw sourceError;
            const patients = await prepareJourneyPatients(data);
            const { error: saveError } = await db.rpc("dashboard_journey_save_v1", { p_run_id: batch.run_id, p_batch_id: batch.batch_id, p_patients: patients });
            if (saveError) throw saveError;
        } catch (error) {
            console.error("journey refresh failed", { code: error?.code, message: error?.message });
            await db.rpc("dashboard_journey_fail_v1", { p_batch_id: batch.batch_id, p_error: String(error?.message ?? error).slice(0, 300) });
        }
    };
    // One bounded batch per invocation keeps CPU, payloads and retries bounded.
    EdgeRuntime.waitUntil(work());
    return Response.json({ ok: true, clients: batch.ids.length });
});
