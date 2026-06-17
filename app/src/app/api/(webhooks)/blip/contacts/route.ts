// app/src/app/api/(webhooks)/blip/contacts/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { supabase } from "@engravida/lib";
import {resolveClosestUnitIdFromPhone} from "@/lib/units/resolveClosestUnitFromPhone";

type BlipContactPayload = {
    identity?: string;
    messageId?: string;

    name?: string;
    email?: string;
    phoneNumber?: string;
    source?: string;
    lastMessageDate?: string;

    contact?: {
        Identity?: string;
        Name?: string;
        PhoneNumber?: string;
        Email?: string;
    };

    extras?: Record<string, any>;

    storageDate?: string;
};

type ParsedBlipContact = {
    external_contact_id: string | null;
    message_external_id: string | null;

    name: string | null;
    phone: string | null;
    email: string | null;

    received_at: string;
};

export async function POST(request: Request) {
    try {
        const body: BlipContactPayload = await request.json();

        const parsedContact = parseBlipContact(body);

        console.log(body);

        if (!parsedContact.external_contact_id && !parsedContact.message_external_id) {
            return NextResponse.json({
                ok: true,
                received: true,
                skipped: true,
                reason: "missing_external_contact_id_and_message_id",
            });
        }

        const clientId = await findClientIdForContact(parsedContact);

        if (clientId) {
            await updateClient(clientId, parsedContact);

            return NextResponse.json({
                ok: true,
                received: true,
                updated: true,
            });
        }

        if (!parsedContact.external_contact_id) {
            return NextResponse.json({
                ok: true,
                received: true,
                skipped: true,
                reason: "no_client_found_and_missing_external_contact_id",
            });
        }

        await createClient(parsedContact);

        return NextResponse.json({
            ok: true,
            received: true,
            created: true,
        });
    } catch (error) {
        console.error("[/api/blip/contatos] Failed to receive payload", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to receive Blip contact",
            },
            { status: 500 }
        );
    }
}

function parseBlipContact(payload: BlipContactPayload): ParsedBlipContact {
    const externalContactId = normalizeExternalContactId(
        payload.identity ??
        payload.contact?.Identity ??
        payload.extras?.Identificador ??
        payload.extras?.identity ??
        null
    );

    const name = normalizePersonName(
        emptyToNull(
            payload.name ??
            payload.extras?.name ??
            payload.extras?.Nome ??
            payload.contact?.Name ??
            null
        )
    );

    const phone = normalizeBrazilPhone(
        emptyToNull(
            payload.phoneNumber ??
            payload.extras?.phoneNumber ??
            payload.extras?.Telefone ??
            payload.contact?.PhoneNumber ??
            extractPhoneFromExternalContactId(externalContactId)
        )
    );

    const email = emptyToNull(
        payload.email ??
        payload.extras?.email ??
        payload.extras?.Email ??
        payload.contact?.Email ??
        null
    );

    return {
        external_contact_id: externalContactId,
        message_external_id: payload.messageId ?? null,

        name,
        phone,
        email,

        received_at:
            payload.lastMessageDate ??
            payload.storageDate ??
            new Date().toISOString(),
    };
}

async function findClientIdForContact(parsedContact: ParsedBlipContact) {
    if (parsedContact.external_contact_id) {
        const { data, error } = await supabase
            .from("clients")
            .select("id")
            .eq("external_contact_id", parsedContact.external_contact_id)
            .maybeSingle();

        if (error) throw error;
        if (data?.id) return data.id;
    }

    if (parsedContact.phone) {
        const { data, error } = await supabase
            .from("clients")
            .select("id")
            .or(
                [
                    `phone.eq.${parsedContact.phone}`,
                    `phone.eq.+${parsedContact.phone}`,
                    `phone.eq.${stripBrazilPrefix(parsedContact.phone)}`,
                ].join(",")
            )
            .maybeSingle();

        if (error) throw error;
        if (data?.id) return data.id;
    }

    if (parsedContact.message_external_id) {
        const { data, error } = await supabase
            .from("messages")
            .select("client_id")
            .eq("external_id", parsedContact.message_external_id)
            .maybeSingle();

        if (error) throw error;
        if (data?.client_id) return data.client_id;
    }

    return null;
}

async function updateClient(clientId: string, parsedContact: ParsedBlipContact) {
    const unitId = await resolveClosestUnitIdFromPhone(parsedContact.phone);

    const updateData: Record<string, string | null> = {
        updated_at: new Date().toISOString(),
    };

    if (parsedContact.external_contact_id) {
        updateData.external_contact_id = parsedContact.external_contact_id;
    }

    if (parsedContact.name) {
        updateData.name = parsedContact.name;
    }

    if (parsedContact.phone) {
        updateData.phone = parsedContact.phone;
    }

    if (parsedContact.email) {
        updateData.email = parsedContact.email;
    }

    if (unitId) {
        updateData.unit_id = unitId;
    }

    const { error } = await supabase
        .from("clients")
        .update(updateData)
        .eq("id", clientId);

    if (error) throw error;
}

async function createClient(parsedContact: ParsedBlipContact) {
    const now = new Date().toISOString();

    const unitId = await resolveClosestUnitIdFromPhone(parsedContact.phone);

    const { error } = await supabase
        .from("clients")
        .insert({
            id: randomUUID(),

            name: parsedContact.name,
            phone: parsedContact.phone,
            email: parsedContact.email,

            external_contact_id: parsedContact.external_contact_id,
            unit_id: unitId,

            first_seen_at: parsedContact.received_at,
            last_interaction_at: parsedContact.received_at,

            created_at: now,
            updated_at: now,
        });

    if (!error) return;

    if (error.code !== "23505" || !parsedContact.phone) {
        throw error;
    }

    const { data: existingClient, error: findError } = await supabase
        .from("clients")
        .select("id")
        .eq("phone", parsedContact.phone)
        .maybeSingle();

    if (findError) throw findError;
    if (!existingClient?.id) throw error;

    await updateClient(existingClient.id, parsedContact);
}
function normalizeExternalContactId(value: string | null): string | null {
    if (!value) return null;

    return value.split("/")[0] ?? value;
}

function emptyToNull(value: string | null | undefined): string | null {
    if (!value) return null;

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
}

function extractPhoneFromExternalContactId(
    externalContactId: string | null
): string | null {
    if (!externalContactId) return null;

    const beforeAt = externalContactId.split("@")[0];
    const onlyDigits = beforeAt.replace(/\D/g, "");

    if (onlyDigits.length < 10 || onlyDigits.length > 15) {
        return null;
    }

    return onlyDigits;
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

function normalizePersonName(value: string | null): string | null {
    if (!value) return null;

    const trimmed = value.trim().replace(/\s+/g, " ");

    if (!trimmed) return null;

    return trimmed
        .toLowerCase()
        .split(" ")
        .map((part) => {
            if (part.length <= 2) return part;

            return part[0].toUpperCase() + part.slice(1);
        })
        .join(" ");
}