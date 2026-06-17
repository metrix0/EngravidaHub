// lib/attendants/createAttendant.ts
import { randomUUID } from "crypto";

import { supabase } from "@/lib";
import type { Attendant } from "@/types/attendant";
import type { ParsedBlipMessage } from "@/lib/importers/blip/parseBlipMessage";

export async function createAttendantFromParsedMessage(
    parsedMessage: ParsedBlipMessage
): Promise<Attendant | null> {
    if (parsedMessage.sender_type !== "attendant") {
        return null;
    }

    if (!parsedMessage.external_attendant_id) {
        return null;
    }

    const name =
        extractNameFromExternalAttendantId(parsedMessage.external_attendant_id) ??
        parsedMessage.sender_name

    const email = extractEmailFromExternalAttendantId(
        parsedMessage.external_attendant_id
    );

    const { data: existingAttendant, error: findError } = await supabase
        .from("attendants")
        .select("*")
        .eq("external_attendant_id", parsedMessage.external_attendant_id)
        .maybeSingle();

    if (findError) {
        throw findError;
    }

    if (existingAttendant) {
        const { data: updatedAttendant, error: updateError } = await supabase
            .from("attendants")
            .update({
                name,
                email,
                updated_at: new Date().toISOString(),
            })
            .eq("id", existingAttendant.id)
            .select("*")
            .single();

        if (updateError) {
            throw updateError;
        }

        return updatedAttendant;
    }

    const now = new Date().toISOString();

    const { data: createdAttendant, error: createError } = await supabase
        .from("attendants")
        .insert({
            id: randomUUID(),

            name,
            email,

            unit_id: null,

            external_attendant_id: parsedMessage.external_attendant_id,

            active: true,

            created_at: now,
            updated_at: now,
        })
        .select("*")
        .single();

    if (createError) {
        throw createError;
    }

    return createdAttendant;
}

function extractEmailFromExternalAttendantId(
    externalAttendantId: string
): string | null {
    const beforeBlip = externalAttendantId.split("@blip.ai")[0];

    if (!beforeBlip) return null;

    const decoded = decodeURIComponent(beforeBlip);

    if (!decoded.includes("@")) return null;

    return decoded;
}

function extractNameFromExternalAttendantId(externalAttendantId: string): string {
    const email = extractEmailFromExternalAttendantId(externalAttendantId);

    if (!email) return "Atendente";

    return email
        .split("@")[0]
        .split(".")
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" ");
}
