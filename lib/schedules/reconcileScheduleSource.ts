import { supabase } from "@/lib/supabase/client";
import { getBigqueryScheduleStates, type BigqueryScheduleState } from "./getBigquerySchedules";

type StoredSchedule = {
    id: string; source_external_id: string; source: string; created_at: string; updated_at: string;
    source_visible: boolean; scheduled_for: string; created_in_source_at: string | null;
    procedure_name: string | null; status: string | null;
};

export function scheduleSourcePatch(row: StoredSchedule, state: BigqueryScheduleState | undefined, now: number): Partial<StoredSchedule> | null {
    // Give newly received webhooks time to reach the warehouse.
    if (!state && row.source === "clinisys" && Date.parse(row.created_at) > now - 86_400_000) return null;
    const patch = state ? {
        source_visible: state.visible,
        ...(state.scheduled_for ? { scheduled_for: state.scheduled_for } : {}),
        created_in_source_at: state.created_in_source_at,
        procedure_name: state.procedure_name,
        status: state.status,
    } : { source_visible: false };
    return Object.entries(patch).some(([key, value]) => row[key as keyof StoredSchedule] !== value) ? patch : null;
}

export async function reconcileScheduleSource(daysBack: number) {
    const now = Date.now();
    const from = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now - daysBack * 86_400_000);
    let checked = 0, updated = 0, cursor: string | null = null;
    for (;;) {
        let query = supabase.from("schedules")
            .select("id,source_external_id,source,created_at,updated_at,source_visible,scheduled_for,created_in_source_at,procedure_name,status")
            .ilike("procedure_name", "%1%Avalia%Reprodu%")
            .in("source", ["bigquery", "clinisys"]).not("source_external_id", "is", null)
            .or(`created_in_source_at.gte.${from},scheduled_for.gte.${from}`)
            .order("id").limit(500);
        if (cursor) query = query.gt("id", cursor);
        const { data, error } = await query;
        if (error) throw error;
        const rows = (data ?? []) as StoredSchedule[];
        if (!rows.length) break;
        const states = new Map((await getBigqueryScheduleStates(rows.map(row => row.source_external_id))).map(state => [state.id, state]));
        for (const row of rows) {
            const patch = scheduleSourcePatch(row, states.get(row.source_external_id), now);
            checked++;
            if (!patch) continue;
            // Do not overwrite a webhook that changed this record during the source read.
            const { data: changed, error: writeError } = await supabase.from("schedules")
                .update({ ...patch, updated_at: new Date().toISOString() })
                .eq("id", row.id).eq("source_external_id", row.source_external_id)
                .eq("updated_at", row.updated_at).select("id");
            if (writeError) throw writeError;
            updated += changed?.length ?? 0;
        }
        cursor = rows.at(-1)!.id;
        if (rows.length < 500) break;
    }
    return { checked, updated };
}
