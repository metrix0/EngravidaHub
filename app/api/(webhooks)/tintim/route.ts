// app/api/(webhooks)/tintim/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { supabase } from "@/lib";
import {
    buildTintimAttributionEvent,
    extractTintimClientTracking,
    type TintimPayload,
} from "@/lib/tintim/attribution";

export async function POST(request: Request) {
    try {
        const payload = (await request.json()) as TintimPayload;
        void forwardTintimWebhook(payload);

        const normalizedPhone = normalizeBrazilPhone(
            payload.phone_e164 ?? payload.phone ?? null
        );

        if (!normalizedPhone) {
            return NextResponse.json(
                { ok: false, error: "Missing phone" },
                { status: 400 }
            );
        }

        const { data: client, error: findError } = await supabase
            .from("clients")
            .select("*")
            .or(
                [
                    `phone.eq.${normalizedPhone}`,
                    `phone.eq.+${normalizedPhone}`,
                    `phone.eq.${stripBrazilPrefix(normalizedPhone)}`,
                ].join(",")
            )
            .maybeSingle();

        if (findError) {
            return NextResponse.json(
                { ok: false, error: findError.message },
                { status: 500 }
            );
        }

        const tracking = extractTintimClientTracking(payload);

        if (!client) {
            const createdClientId = await createClientFromTintim({
                phone: normalizedPhone,
                name: normalizePersonName(payload.name ?? null),
                tracking,
            });
            const attributionEvent = await saveTintimAttributionEvent({
                payload,
                clientId: createdClientId,
                phone: normalizedPhone,
            });

            return NextResponse.json({
                ok: true,
                matched: false,
                created: true,
                client_id: createdClientId,
                phone: normalizedPhone,
                inserted_tracking_fields: Object.keys(tracking).filter(
                    (key) => tracking[key as keyof typeof tracking]
                ),
                attribution_event_saved: attributionEvent.saved,
                attribution_platform: attributionEvent.platform,
            });
        }

        const updatePayload = buildOnlyEmptyFieldsUpdate(client, tracking);

        if (Object.keys(updatePayload).length === 0) {
            const attributionEvent = await saveTintimAttributionEvent({
                payload,
                clientId: client.id,
                phone: normalizedPhone,
            });

            return NextResponse.json({
                ok: true,
                matched: true,
                client_id: client.id,
                updated_tracking_fields: [],
                attribution_event_saved: attributionEvent.saved,
                attribution_platform: attributionEvent.platform,
            });
        }

        const { error: updateError } = await supabase
            .from("clients")
            .update({
                ...updatePayload,
                tracking_updated_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq("id", client.id);

        if (updateError) {
            return NextResponse.json(
                { ok: false, error: updateError.message },
                { status: 500 }
            );
        }
        const attributionEvent = await saveTintimAttributionEvent({
            payload,
            clientId: client.id,
            phone: normalizedPhone,
        });

        return NextResponse.json({
            ok: true,
            matched: true,
            client_id: client.id,
            updated_tracking_fields: Object.keys(updatePayload),
            attribution_event_saved: attributionEvent.saved,
            attribution_platform: attributionEvent.platform,
        });
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to process Tintim webhook",
            },
            { status: 500 }
        );
    }
}

async function createClientFromTintim({
    phone,
    name,
    tracking,
}: {
    phone: string;
    name: string | null;
    tracking: Record<string, string | null>;
}) {
    const now = new Date().toISOString();

    const insertPayload = removeNullValues({
        id: randomUUID(),

        name,
        phone,

        ...tracking,

        first_seen_at: now,
        last_interaction_at: now,
        tracking_updated_at: now,

        created_at: now,
        updated_at: now,
    });

    const { data, error } = await supabase
        .from("clients")
        .insert(insertPayload)
        .select("id")
        .single();

    if (error) {
        throw error;
    }

    return data.id as string;
}

async function saveTintimAttributionEvent({
    payload,
    clientId,
    phone,
}: {
    payload: TintimPayload;
    clientId: string;
    phone: string;
}) {
    const event = buildTintimAttributionEvent({
        payload,
        clientId,
        phone,
    });
    const { error } = await supabase
        .from("tintim_attribution_events")
        .upsert(event, {
            onConflict: "event_fingerprint",
            ignoreDuplicates: true,
        });

    if (error) {
        console.error("[tintim webhook] Attribution insert failed", {
            code: error.code,
            message: error.message,
        });
        throw new Error(
            `Failed to store TinTim attribution: ${error.message}`,
        );
    }

    return {
        saved: true,
        platform: event.platform,
    };
}

function buildOnlyEmptyFieldsUpdate(
    currentClient: Record<string, unknown>,
    incoming: Record<string, string | null>
) {
    const update: Record<string, string> = {};

    for (const [key, value] of Object.entries(incoming)) {
        if (!value) continue;

        const currentValue = currentClient[key];

        if (
            currentValue === null ||
            currentValue === undefined ||
            currentValue === ""
        ) {
            update[key] = value;
        }
    }

    return update;
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

function removeNullValues<T extends Record<string, unknown>>(object: T) {
    return Object.fromEntries(
        Object.entries(object).filter(([, value]) => {
            if (value === null || value === undefined || value === "") return false;

            return true;
        })
    );
}

async function forwardTintimWebhook(payload: TintimPayload) {
    const forwardUrl = process.env.TINTIM_FORWARD_WEBHOOK_URL;

    if (!forwardUrl) return;

    try {
        const response = await fetch(forwardUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            console.warn("[tintim webhook] Forward failed", {
                status: response.status,
            });
        }
    } catch (error) {
        console.warn("[tintim webhook] Forward error", error);
    }
}
