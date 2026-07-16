// lib/clients/createClient.ts
import { randomUUID } from "crypto";

import { supabase } from "@/lib";
import {
    extractPhoneIdentityFromExternalContactId,
    normalizePhoneIdentity,
} from "@/lib/clients/phoneIdentity";
import type { ParsedBlipMessage } from "@/lib/importers/blip/parseBlipMessage";
import { resolveClosestUnitIdFromPhone } from "@/lib/units/resolveClosestUnitFromPhone";
import type { Client } from "@/types/client";

type ClientReference = Pick<Client, "id">;

type ExistingClient = Pick<
    Client,
    | "id"
    | "phone"
    | "external_contact_id"
    | "first_seen_at"
    | "last_interaction_at"
> & {
    unit_id: string | null;
    phone_identity: string | null;
};

const EXISTING_CLIENT_COLUMNS = [
    "id",
    "phone",
    "external_contact_id",
    "phone_identity",
    "unit_id",
    "first_seen_at",
    "last_interaction_at",
].join(", ");

export async function createClientFromParsedMessage(
    parsedMessage: ParsedBlipMessage,
): Promise<ClientReference> {
    const externalContactId = parsedMessage.external_contact_id;

    if (!externalContactId) {
        throw new Error("Cannot create client without external_contact_id");
    }

    const phoneIdentity =
        extractPhoneIdentityFromExternalContactId(externalContactId);
    const existing = await findExistingClient(
        externalContactId,
        phoneIdentity,
    );

    if (existing) {
        return updateExistingClient(
            existing,
            externalContactId,
            phoneIdentity,
            parsedMessage.sent_at,
        );
    }

    const now = new Date().toISOString();
    const unitId = await resolveClosestUnitIdFromPhone(phoneIdentity);
    const clientId = randomUUID();

    const { error } = await supabase.from("clients").insert({
        id: clientId,
        name: null,
        phone: phoneIdentity,
        email: null,
        external_contact_id: externalContactId,
        unit_id: unitId,
        first_seen_at: parsedMessage.sent_at,
        last_interaction_at: parsedMessage.sent_at,
        created_at: now,
        updated_at: now,
    });

    if (!error) {
        return { id: clientId };
    }

    if (error.code !== "23505") {
        throw error;
    }

    const winner = await findExistingClient(
        externalContactId,
        phoneIdentity,
    );

    if (!winner) {
        throw error;
    }

    return updateExistingClient(
        winner,
        externalContactId,
        phoneIdentity,
        parsedMessage.sent_at,
    );
}

async function findExistingClient(
    externalContactId: string,
    phoneIdentity: string | null,
): Promise<ExistingClient | null> {
    const external = await supabase
        .from("clients")
        .select(EXISTING_CLIENT_COLUMNS)
        .eq("external_contact_id", externalContactId)
        .maybeSingle();

    if (external.error) {
        throw external.error;
    }

    if (external.data) {
        return external.data as ExistingClient;
    }

    if (!phoneIdentity) {
        return null;
    }

    const canonical = await supabase
        .from("clients")
        .select(EXISTING_CLIENT_COLUMNS)
        .eq("phone_identity", phoneIdentity)
        .limit(1)
        .maybeSingle();

    if (canonical.error) {
        throw canonical.error;
    }

    if (canonical.data) {
        return canonical.data as ExistingClient;
    }

    const local = phoneIdentity.startsWith("55")
        ? phoneIdentity.slice(2)
        : phoneIdentity;

    const legacy = await supabase
        .from("clients")
        .select(EXISTING_CLIENT_COLUMNS)
        .in("phone", [
            phoneIdentity,
            `+${phoneIdentity}`,
            local,
            `+${local}`,
        ])
        .limit(20);

    if (legacy.error) {
        throw legacy.error;
    }

    return (
        ((legacy.data ?? []) as ExistingClient[]).find(
            (row) => normalizePhoneIdentity(row.phone) === phoneIdentity,
        ) ?? null
    );
}

async function updateExistingClient(
    client: ExistingClient,
    externalContactId: string,
    phoneIdentity: string | null,
    interactionAt: string,
): Promise<ClientReference> {
    const incoming = new Date(interactionAt).getTime();
    const first = new Date(client.first_seen_at).getTime();
    const last = new Date(client.last_interaction_at).getTime();

    // Preserve an existing unit assignment. The geographical DDD lookup is
    // only needed while the client still has no unit.
    const unitId = client.unit_id
        ? null
        : await resolveClosestUnitIdFromPhone(
              phoneIdentity ?? client.phone,
          );

    const updates: Record<string, string | null> = {
        first_seen_at:
            Number.isFinite(incoming) && incoming < first
                ? interactionAt
                : client.first_seen_at,
        last_interaction_at:
            Number.isFinite(incoming) && incoming > last
                ? interactionAt
                : client.last_interaction_at,
        updated_at: new Date().toISOString(),
    };

    if (!client.external_contact_id) {
        updates.external_contact_id = externalContactId;
    }

    if (phoneIdentity && client.phone !== phoneIdentity) {
        updates.phone = phoneIdentity;
    }

    if (!client.unit_id && unitId) {
        updates.unit_id = unitId;
    }

    const result = await supabase
        .from("clients")
        .update(updates)
        .eq("id", client.id)
        .select("id")
        .single();

    if (result.error) {
        throw result.error;
    }

    return result.data;
}
