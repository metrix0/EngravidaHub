// lib/ads/meta/sendMetaEvents.ts
import crypto from "crypto";

import { supabase } from "@/lib";
import type { DerivedAdEvent } from "@/lib/ads/deriveAdEventsFromAnalysis";

type SendMetaEventsInput = {
    events: DerivedAdEvent[];
    phone: string | null;
    email?: string | null;

    conversation_id?: string | null;
    conversation_ended_at?: string | null;

    schedule_id?: string | null;
    client_id?: string | null;
};

type ClientTracking = {
    id: string;
    name: string | null;
    external_contact_id: string | null;
    created_at: string | null;

    fbclid: string | null;
    fbc: string | null;
    fbp: string | null;
    ctwa_clid: string | null;

    gclid: string | null;
    gbraid: string | null;
    wbraid: string | null;

    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;

    client_ip_address: string | null;
    client_user_agent: string | null;
    state: string | null;
    country: string | null;

    tracking_updated_at: string | null;
};

const metaPixelId = process.env.META_PIXEL_ID;
const metaAccessToken = process.env.META_ACCESS_TOKEN;
const metaTestEventCode = process.env.META_TEST_EVENT_CODE;

export async function sendMetaEvents({
                                         events,
                                         phone,
                                         email,
                                         conversation_id,
                                         conversation_ended_at,
                                         schedule_id,
                                         client_id,
                                     }: SendMetaEventsInput) {
    if (events.length === 0) {
        return {
            ok: true,
            skipped: true,
            reason: "No ad events",
        };
    }

    const sourceId = conversation_id ?? schedule_id;

    if (!sourceId) {
        throw new Error("sendMetaEvents requires conversation_id or schedule_id");
    }

    if (schedule_id && !client_id) {
        throw new Error("sendMetaEvents with schedule_id requires client_id");
    }

    const sentAt = new Date().toISOString();

    let adEventIds: string[] = [];

    try {
        if (!phone && !email) {
            return {
                ok: false,
                skipped: true,
                reason: "Client has no phone or email",
            };
        }

        if (!metaPixelId) {
            return {
                ok: false,
                skipped: false,
                reason: "Missing META_PIXEL_ID",
            };
        }

        if (!metaAccessToken) {
            return {
                ok: false,
                skipped: false,
                reason: "Missing META_ACCESS_TOKEN",
            };
        }

        const normalizedPhone = phone ? normalizeBrazilPhone(phone) : null;

        const hashedPhone = normalizedPhone ? hash(normalizedPhone) : null;
        const hashedEmail = email ? hashEmail(email) : null;

        const tracking = await getClientTracking({
            conversationId: conversation_id ?? null,
            clientId: client_id ?? null,
            normalizedPhone,
        });

        const userData = buildUserData({
            hashedPhone,
            hashedEmail,
            tracking,
        });

        if (Object.keys(userData).length === 0) {
            return {
                ok: false,
                skipped: true,
                reason: "No valid user_data",
            };
        }

        const trackingCustomData = buildTrackingCustomData(tracking);

        const sentParameters = buildMetaSentParameters({
            hashedPhone,
            hashedEmail,
            tracking,
        });

        const payload = {
            data: events.map((event) => ({
                event_name: event.meta_event_name,
                event_time: toUnixSeconds(
                    event.occurred_at ?? conversation_ended_at ?? sentAt
                ),
                event_id: `${sourceId}:${event.type}`,

                action_source: "chat",

                user_data: userData,

                custom_data: {
                    internal_event: event.type,
                    conversation_id: conversation_id ?? undefined,
                    schedule_id: schedule_id ?? undefined,
                    confidence: event.confidence,

                    ...trackingCustomData,
                },
            })),

            ...(metaTestEventCode
                ? {
                    test_event_code: metaTestEventCode,
                }
                : {}),
        };

        console.log("[sendMetaEvents] payload", {
            conversation_id,
            schedule_id,
            pixel_id: metaPixelId,
            events: payload.data.map((event) => ({
                event_name: event.event_name,
                event_time: event.event_time,
                event_id: event.event_id,
                action_source: event.action_source,
                user_data_keys: Object.keys(event.user_data ?? {}),
                custom_data: event.custom_data,
            })),
            has_test_event_code: Boolean(metaTestEventCode),
        });

        const response = await fetch(
            `https://graph.facebook.com/v20.0/${metaPixelId}/events?access_token=${metaAccessToken}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            }
        );

        const json = await response.json();

        if (!response.ok) {
            console.error("[sendMetaEvents] Meta CAPI error", {
                status: response.status,
                response: json,
            });

            return {
                ok: false,
                skipped: false,
                reason: "Meta CAPI error",
                status: response.status,
                error: json,
            };
        }

        adEventIds = await createPendingMetaAdEvents({
            events,
            conversation_id: conversation_id ?? null,
            schedule_id: schedule_id ?? null,
            sentAt,
        });

        console.log("[sendMetaEvents] sent ad_events created", {
            conversation_id,
            schedule_id,
            ad_event_ids: adEventIds,
        });

        await updateAdEventsParameters(adEventIds, sentParameters);

        await updateAdEventsStatus(adEventIds, "sent");

        return {
            ok: true,
            skipped: false,
            payload,
            response: json,
        };
    } catch (error) {
        console.error("[sendMetaEvents] failed", error);

        return {
            ok: false,
            skipped: false,
            reason: "Meta send failed",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function getClientTracking({
                                     conversationId,
                                     clientId,
                                     normalizedPhone,
                                 }: {
    conversationId: string | null;
    clientId: string | null;
    normalizedPhone: string | null;
}): Promise<ClientTracking | null> {
    if (clientId) {
        const { data } = await supabase
            .from("clients")
            .select(
                `
                id,
                name,
                external_contact_id,
                created_at,
                fbclid,
                fbc,
                fbp,
                ctwa_clid,
                gclid,
                gbraid,
                wbraid,
                utm_source,
                utm_medium,
                utm_campaign,
                utm_content,
                utm_term,
                client_ip_address,
                client_user_agent,
                state,
                country,
                tracking_updated_at
            `
            )
            .eq("id", clientId)
            .maybeSingle();

        return (data ?? null) as ClientTracking | null;
    }

    if (conversationId) {
        const { data: conversation } = await supabase
            .from("conversations")
            .select("client_id")
            .eq("id", conversationId)
            .maybeSingle();

        if (conversation?.client_id) {
            const { data } = await supabase
                .from("clients")
                .select(
                    `
                    id,
                    name,
                    external_contact_id,
                    created_at,
                    fbclid,
                    fbc,
                    fbp,
                    ctwa_clid,
                    gclid,
                    gbraid,
                    wbraid,
                    utm_source,
                    utm_medium,
                    utm_campaign,
                    utm_content,
                    utm_term,
                    client_ip_address,
                    client_user_agent,
                    state,
                    country,
                    tracking_updated_at
                `
                )
                .eq("id", conversation.client_id)
                .maybeSingle();

            return (data ?? null) as ClientTracking | null;
        }
    }

    if (!normalizedPhone) return null;

    const { data } = await supabase
        .from("clients")
        .select(
            `
            id,
            name,
            external_contact_id,
            created_at,
            fbclid,
            fbc,
            fbp,
            ctwa_clid,
            gclid,
            gbraid,
            wbraid,
            utm_source,
            utm_medium,
            utm_campaign,
            utm_content,
            utm_term,
            client_ip_address,
            client_user_agent,
            state,
            country,
            tracking_updated_at
        `
        )
        .or(
            [
                `phone.eq.${normalizedPhone}`,
                `phone.eq.+${normalizedPhone}`,
                `phone.eq.${stripBrazilPrefix(normalizedPhone)}`,
            ].join(",")
        )
        .maybeSingle();

    return (data ?? null) as ClientTracking | null;
}

function buildUserData({
                           hashedPhone,
                           hashedEmail,
                           tracking,
                       }: {
    hashedPhone: string | null;
    hashedEmail: string | null;
    tracking: ClientTracking | null;
}) {
    const externalId = tracking?.external_contact_id ?? null;

    const fbc =
        tracking?.fbc ??
        buildFbcFromFbclid(
            tracking?.fbclid ?? null,
            tracking?.tracking_updated_at ?? tracking?.created_at ?? null
        );

    const parsedName = parseFullName(tracking?.name ?? null);

    const normalizedState = normalizeBrazilState(tracking?.state ?? null);
    const normalizedCountry = normalizeCountry(tracking?.country ?? null);

    return removeNullValues({
        ...(hashedPhone ? { ph: [hashedPhone] } : {}),
        ...(hashedEmail ? { em: [hashedEmail] } : {}),

        ...(externalId ? { external_id: [externalId] } : {}),

        ...(parsedName.firstName
            ? { fn: [hash(normalizeMetaText(parsedName.firstName))] }
            : {}),
        ...(parsedName.lastName
            ? { ln: [hash(normalizeMetaText(parsedName.lastName))] }
            : {}),

        ...(tracking?.client_ip_address
            ? { client_ip_address: tracking.client_ip_address }
            : {}),
        ...(tracking?.client_user_agent
            ? { client_user_agent: tracking.client_user_agent }
            : {}),

        ...(normalizedState ? { st: [hash(normalizedState)] } : {}),
        ...(normalizedCountry ? { country: [hash(normalizedCountry)] } : {}),

        ...(fbc ? { fbc } : {}),
        ...(tracking?.fbp ? { fbp: tracking.fbp } : {}),
        ...(tracking?.ctwa_clid ? { ctwa_clid: tracking.ctwa_clid } : {}),
    });
}

function buildTrackingCustomData(tracking: ClientTracking | null) {
    if (!tracking) return {};

    return removeNullValues({
        fbclid: tracking.fbclid,
        utm_source: tracking.utm_source,
        utm_medium: tracking.utm_medium,
        utm_campaign: tracking.utm_campaign,
        utm_content: tracking.utm_content,
        utm_term: tracking.utm_term,
    });
}

async function createPendingMetaAdEvents({
                                             events,
                                             conversation_id,
                                             schedule_id,
                                             sentAt,
                                         }: {
    events: DerivedAdEvent[];
    conversation_id: string | null;
    schedule_id: string | null;
    sentAt: string;
}) {
    const { data, error } = await supabase
        .from("ad_events")
        .insert(
            events.map((event) => ({
                conversation_id,
                schedule_id,
                event_type: event.type,
                platform: "Meta Ads",
                status: "pending",
                event_date: sentAt,
            }))
        )
        .select("id");

    if (error) {
        throw error;
    }

    return (data ?? []).map((item) => item.id as string);
}

async function updateAdEventsStatus(
    adEventIds: string[],
    status: "pending" | "sent" | "failed"
) {
    if (adEventIds.length === 0) return;

    const { error } = await supabase
        .from("ad_events")
        .update({
            status,
            updated_at: new Date().toISOString(),
        })
        .in("id", adEventIds);

    if (error) {
        throw error;
    }
}

function hashEmail(email: string) {
    const normalized = email.trim().toLowerCase();

    if (!normalized || !normalized.includes("@")) return null;

    return hash(normalized);
}

function hash(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeBrazilPhone(phone: string) {
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

function buildFbcFromFbclid(fbclid: string | null, dateValue: string | null) {
    if (!fbclid) return null;

    const timestamp = dateValue
        ? Math.floor(new Date(dateValue).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

    return `fb.1.${timestamp}.${fbclid}`;
}

function removeNullValues<T extends Record<string, unknown>>(object: T) {
    return Object.fromEntries(
        Object.entries(object).filter(([, value]) => {
            if (value === null || value === undefined || value === "") return false;

            if (Array.isArray(value)) {
                return value.length > 0;
            }

            return true;
        })
    );
}

function toUnixSeconds(date: string) {
    return Math.floor(new Date(date).getTime() / 1000);
}

function parseFullName(name: string | null) {
    if (!name) {
        return {
            firstName: null,
            lastName: null,
        };
    }

    const parts = name.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
        return {
            firstName: null,
            lastName: null,
        };
    }

    if (parts.length === 1) {
        return {
            firstName: parts[0],
            lastName: null,
        };
    }

    return {
        firstName: parts[0],
        lastName: parts.slice(1).join(" "),
    };
}

function normalizeMetaText(value: string) {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function normalizeCountry(value: string | null) {
    if (!value) return null;

    const normalized = normalizeMetaText(value);

    if (normalized === "brazil" || normalized === "brasil" || normalized === "br") {
        return "br";
    }

    if (normalized.length === 2) {
        return normalized;
    }

    return null;
}

function normalizeBrazilState(value: string | null) {
    if (!value) return null;

    const normalized = normalizeMetaText(value);

    const states: Record<string, string> = {
        acre: "ac",
        alagoas: "al",
        amapa: "ap",
        amazonas: "am",
        bahia: "ba",
        ceara: "ce",
        "distrito federal": "df",
        "espirito santo": "es",
        goias: "go",
        maranhao: "ma",
        "mato grosso": "mt",
        "mato grosso do sul": "ms",
        "minas gerais": "mg",
        para: "pa",
        paraiba: "pb",
        parana: "pr",
        pernambuco: "pe",
        piaui: "pi",
        "rio de janeiro": "rj",
        "rio grande do norte": "rn",
        "rio grande do sul": "rs",
        rondonia: "ro",
        roraima: "rr",
        "santa catarina": "sc",
        "sao paulo": "sp",
        sergipe: "se",
        tocantins: "to",
    };

    if (states[normalized]) {
        return states[normalized];
    }

    if (normalized.length === 2) {
        return normalized;
    }

    return null;
}

async function updateAdEventsParameters(
    adEventIds: string[],
    parameters: string[]
) {
    if (adEventIds.length === 0) return;

    const { error } = await supabase
        .from("ad_events")
        .update({
            parameters,
            updated_at: new Date().toISOString(),
        })
        .in("id", adEventIds);

    if (error) {
        throw error;
    }
}

function buildMetaSentParameters({
                                     hashedPhone,
                                     hashedEmail,
                                     tracking,
                                 }: {
    hashedPhone: string | null;
    hashedEmail: string | null;
    tracking: ClientTracking | null;
}) {
    const fbc =
        tracking?.fbc ??
        buildFbcFromFbclid(
            tracking?.fbclid ?? null,
            tracking?.tracking_updated_at ?? tracking?.created_at ?? null
        );

    const parsedName = parseFullName(tracking?.name ?? null);
    const normalizedState = normalizeBrazilState(tracking?.state ?? null);
    const normalizedCountry = normalizeCountry(tracking?.country ?? null);

    return uniqueStrings([
        hashedPhone ? "ph" : null,
        hashedEmail ? "em" : null,

        tracking?.external_contact_id ? "external_id" : null,

        parsedName.firstName ? "fn" : null,
        parsedName.lastName ? "ln" : null,

        tracking?.client_ip_address ? "client_ip_address" : null,
        tracking?.client_user_agent ? "client_user_agent" : null,

        normalizedState ? "st" : null,
        normalizedCountry ? "country" : null,

        fbc ? "fbc" : null,
        tracking?.fbp ? "fbp" : null,
        tracking?.ctwa_clid ? "ctwa_clid" : null,

        tracking?.fbclid ? "fbclid" : null,

        tracking?.utm_source ? "utm_source" : null,
        tracking?.utm_medium ? "utm_medium" : null,
        tracking?.utm_campaign ? "utm_campaign" : null,
        tracking?.utm_content ? "utm_content" : null,
        tracking?.utm_term ? "utm_term" : null,
    ]);
}

function uniqueStrings(values: Array<string | null | undefined>) {
    return Array.from(
        new Set(values.filter((value): value is string => Boolean(value)))
    );
}
