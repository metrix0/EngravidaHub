// lib/inbox/schedulingClient.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneIdentity } from "@/lib/clients/phoneIdentity";
import { parseBrazilDate } from "@/lib/scheduling/appointmentServer";
import type { SchedulingThread } from "@/lib/inbox/schedulingData";
import type { SchedulingAddressFields, SchedulingPersonFields } from "@/types/scheduling";

// Blank optional fields must not erase data already stored on the profile.
export function schedulingClientValues(
    primary: SchedulingPersonFields,
    address: SchedulingAddressFields,
    unitId: string,
) {
    const phone = normalizePhoneIdentity(primary.phone);
    const values: Record<string, string> = {
        name: primary.fullName.trim(), unit_id: unitId,
        updated_at: new Date().toISOString(),
    };
    if (phone) values.phone = phone;
    if (primary.email.trim()) values.email = primary.email.trim().toLowerCase();
    if (primary.cpf.trim()) values.cpf = primary.cpf.replace(/\D/g, "");
    const birthDate = parseBrazilDate(primary.birthDate);
    if (birthDate) values.birth_date = birthDate;
    for (const [key, value] of Object.entries(address)) {
        if (value.trim()) values[key] = key === "cep" ? value.replace(/\D/g, "") : value.trim();
    }
    return values;
}

export async function resolveSchedulingClient(
    supabase: SupabaseClient,
    thread: SchedulingThread,
    selectedClientId: string | null,
    primary: SchedulingPersonFields,
    address: SchedulingAddressFields,
    unitId: string,
): Promise<string | null> {
    // An explicit replacement changes the appointment patient, not the conversation link.
    if (selectedClientId) {
        const { data, error } = await supabase.from("clients").select("id").eq("id", selectedClientId).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("Cliente selecionado não encontrado.");
        if (thread.client_id || !thread.instagram_user_id) return selectedClientId;
    }
    if (thread.client_id) return thread.client_id;
    if (!thread.instagram_user_id) return null;

    let clientId = selectedClientId;
    const phone = normalizePhoneIdentity(primary.phone);
    const findByPhone = async () => {
        if (!phone) return null;
        const { data, error } = await supabase.from("clients")
            .select("id").eq("phone_identity", phone).maybeSingle();
        if (error) throw error;
        return data?.id ?? null;
    };

    if (!clientId) {
        clientId = await findByPhone();
        if (!clientId) {
            const now = new Date().toISOString();
            const { data, error } = await supabase.from("clients").insert({
                ...schedulingClientValues(primary, address, unitId),
                first_seen_at: now, last_interaction_at: now,
            }).select("id").single();
            if (error) {
                // A webhook may have created the same phone during preparation.
                if (error.code !== "23505") throw error;
                clientId = await findByPhone();
                if (!clientId) throw error;
            } else {
                clientId = data.id;
            }
        }
    }

    // Preserve social thread identity and never replace a concurrent CRM link.
    const { data: linked, error: linkError } = await supabase.from("instagram_users")
        .update({ client_id: clientId, updated_at: new Date().toISOString() })
        .eq("id", thread.instagram_user_id).is("client_id", null)
        .select("client_id").maybeSingle();
    if (linkError) throw linkError;
    if (linked?.client_id) return linked.client_id;
    const { data: current, error: currentError } = await supabase.from("instagram_users")
        .select("client_id").eq("id", thread.instagram_user_id).maybeSingle();
    if (currentError) throw currentError;
    if (!current?.client_id) throw new Error("Não foi possível vincular o cadastro ao contato da conversa.");
    return current.client_id;
}
