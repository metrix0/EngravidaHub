// lib/attendants/createAttendant.ts
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

    const { data: attendantId, error: resolveError } = await supabase.rpc(
        "resolve_attendant_identity",
        {
            p_source: "blip",
            p_name: name,
            p_external_id: parsedMessage.external_attendant_id,
            p_email: email,
        },
    );
    if (resolveError) throw resolveError;
    if (!attendantId) return null;

    const { data: attendant, error: findError } = await supabase
        .from("attendants")
        .select("*")
        .eq("id", attendantId)
        .single();
    if (findError) throw findError;
    return attendant;
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
