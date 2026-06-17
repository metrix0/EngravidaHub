// lib/clients/createClient.ts
import { randomUUID } from "crypto";

import { supabase } from "@/lib";
import type { Client } from "@/types/client";
import type { ParsedBlipMessage } from "@/lib/importers/blip/parseBlipMessage";
import { resolveClosestUnitIdFromPhone } from "@/lib/units/resolveClosestUnitFromPhone";

type ExistingClient = Client & {
    unit_id?: string | null;
    email?: string | null;
};

export async function createClientFromParsedMessage(
    parsedMessage: ParsedBlipMessage
): Promise<Client> {
    if (!parsedMessage.external_contact_id) {
        throw new Error("Cannot create client without external_contact_id");
    }

    const now = new Date().toISOString();
    const phone = extractPhoneFromExternalContactId(
        parsedMessage.external_contact_id
    );

    const existingClient = await findExistingClient({
        externalContactId: parsedMessage.external_contact_id,
        phone,
    });

    if (existingClient) {
        const updatedClient = await updateExistingClientFromParsedMessage({
            client: existingClient,
            externalContactId: parsedMessage.external_contact_id,
            phone,
            lastInteractionAt: parsedMessage.sent_at,
        });

        return updatedClient;
    }

    const unitId = await resolveClosestUnitIdFromPhone(phone);

    const { data: createdClient, error: createError } = await supabase
        .from("clients")
        .insert({
            id: randomUUID(),

            name: null,
            phone,
            email: null,

            external_contact_id: parsedMessage.external_contact_id,
            unit_id: unitId,

            first_seen_at: parsedMessage.sent_at,
            last_interaction_at: parsedMessage.sent_at,

            created_at: now,
            updated_at: now,
        })
        .select("*")
        .single();

    if (!createError && createdClient) {
        return createdClient;
    }

    if (createError?.code !== "23505" || !phone) {
        throw createError;
    }

    const fallbackClient = await findExistingClient({
        externalContactId: parsedMessage.external_contact_id,
        phone,
    });

    if (!fallbackClient) {
        throw createError;
    }

    return updateExistingClientFromParsedMessage({
        client: fallbackClient,
        externalContactId: parsedMessage.external_contact_id,
        phone,
        lastInteractionAt: parsedMessage.sent_at,
    });
}

async function findExistingClient({
                                      externalContactId,
                                      phone,
                                  }: {
    externalContactId: string;
    phone: string | null;
}): Promise<ExistingClient | null> {
    const { data: byExternalContactId, error: externalError } = await supabase
        .from("clients")
        .select("*")
        .eq("external_contact_id", externalContactId)
        .maybeSingle();

    if (externalError) {
        throw externalError;
    }

    if (byExternalContactId) {
        return byExternalContactId;
    }

    if (!phone) return null;

    const phoneCandidates = Array.from(
        new Set([
            phone,
            `+${phone}`,
            stripBrazilPrefix(phone),
            `+${stripBrazilPrefix(phone)}`,
        ])
    );

    const { data: byPhone, error: phoneError } = await supabase
        .from("clients")
        .select("*")
        .in("phone", phoneCandidates)
        .limit(1)
        .maybeSingle();

    if (phoneError) {
        throw phoneError;
    }

    return byPhone ?? null;
}

async function updateExistingClientFromParsedMessage({
                                                         client,
                                                         externalContactId,
                                                         phone,
                                                         lastInteractionAt,
                                                     }: {
    client: ExistingClient;
    externalContactId: string;
    phone: string | null;
    lastInteractionAt: string;
}): Promise<Client> {
    const unitId = await resolveClosestUnitIdFromPhone(phone ?? client.phone);

    const updateData: Record<string, string | null> = {
        last_interaction_at: lastInteractionAt,
        updated_at: new Date().toISOString(),
    };

    if (!client.external_contact_id) {
        updateData.external_contact_id = externalContactId;
    }

    if (!client.phone && phone) {
        updateData.phone = phone;
    }

    if (!client.unit_id && unitId) {
        updateData.unit_id = unitId;
    }

    const { data: updatedClient, error } = await supabase
        .from("clients")
        .update(updateData)
        .eq("id", client.id)
        .select("*")
        .single();

    if (error) {
        throw error;
    }

    return updatedClient;
}

function extractPhoneFromExternalContactId(
    externalContactId: string
): string | null {
    const beforeAt = externalContactId.split("@")[0];
    const onlyDigits = beforeAt.replace(/\D/g, "");

    if (onlyDigits.length < 10 || onlyDigits.length > 15) {
        return null;
    }

    return normalizeBrazilPhone(onlyDigits);
}

function normalizeBrazilPhone(phone: string | null) {
    if (!phone) return null;

    const digits = phone.replace(/\D/g, "");

    if (!digits) return null;

    if (digits.startsWith("55")) {
        return digits;
    }

    if (digits.length === 10 || digits.length === 11) {
        return `55${digits}`;
    }

    return digits;
}

function stripBrazilPrefix(phone: string) {
    if (phone.startsWith("55")) {
        return phone.slice(2);
    }

    return phone;
}
