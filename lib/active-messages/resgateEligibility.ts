import { supabase } from "@/lib/supabase/client";

// Any prior clinical relationship contradicts a "never booked" rescue tag.
// Keep invoice history conservative, including cancelled/denied documents.
export async function loadResgateClinicalHistory(clientIds: string[]) {
    const blocked = new Set<string>();
    for (let offset = 0; offset < clientIds.length; offset += 250) {
        const { data, error } = await supabase.rpc("resgate_clients_with_clinical_history", {
            p_client_ids: clientIds.slice(offset, offset + 250),
        });
        if (error) throw new Error(`Não foi possível verificar o histórico clínico: ${error.message}`);
        for (const row of data ?? []) blocked.add(row.client_id);
    }
    return blocked;
}
