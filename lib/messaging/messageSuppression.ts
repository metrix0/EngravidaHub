// lib/messaging/messageSuppression.ts
import { normalizePhoneIdentity } from "@/lib/clients/phoneIdentity";
import { supabase } from "@/lib/supabase/client";

export class HubMessageSuppressedError extends Error {
    constructor() {
        super("Envio bloqueado para este contato.");
        this.name = "HubMessageSuppressedError";
    }
}

export async function assertHubMessageAllowed(recipient: string) {
    const phoneIdentity = normalizePhoneIdentity(recipient);
    if (!phoneIdentity) return;

    const { data, error } = await supabase
        .from("message_suppressions")
        .select("phone_identity")
        .eq("phone_identity", phoneIdentity)
        .maybeSingle();

    if (error) {
        throw new Error("Não foi possível verificar o bloqueio de mensagens.");
    }

    if (data) throw new HubMessageSuppressedError();
}
