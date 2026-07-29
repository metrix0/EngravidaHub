// lib/tintim/attribution.ts
import { createHash } from "node:crypto";

import type { PaidMediaPlatform } from "@/lib/ads/paidMediaAttribution";

export type TintimPayload = {
    created?: string | null;
    created_isoformat?: string | null;
    updated?: string | null;
    updated_isoformat?: string | null;
    event_type?: string | null;
    phone?: string | null;
    phone_e164?: string | null;
    name?: string | null;
    source?: string | null;

    fbclid?: string | null;
    fbc?: string | null;
    fbp?: string | null;

    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;

    ctwa_clid?: string | null;

    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_content?: string | null;
    utm_term?: string | null;

    location?: {
        state?: string | null;
        country?: string | null;
    } | null;

    visit?: {
        meta?: {
            remote_addr?: string | null;
            http_user_agent?: {
                raw?: string | null;
            } | null;
        } | null;
        params?: {
            fbclid?: string | null;
            fbc?: string | null;
            fbp?: string | null;

            gclid?: string | null;
            gbraid?: string | null;
            wbraid?: string | null;

            ctwa_clid?: string | null;

            utm_source?: string | null;
            utm_medium?: string | null;
            utm_campaign?: string | null;
            utm_content?: string | null;
            utm_term?: string | null;
        } | null;
    } | null;
};

type TintimClientTracking = ReturnType<typeof extractTintimClientTracking>;

export function extractTintimClientTracking(payload: TintimPayload) {
    const params = payload.visit?.params ?? {};

    return {
        fbclid: firstValue(payload.fbclid, params.fbclid),
        fbc: firstValue(payload.fbc, params.fbc),
        fbp: firstValue(payload.fbp, params.fbp),

        gclid: firstValue(payload.gclid, params.gclid),
        gbraid: firstValue(payload.gbraid, params.gbraid),
        wbraid: firstValue(payload.wbraid, params.wbraid),

        ctwa_clid: firstValue(payload.ctwa_clid, params.ctwa_clid),

        utm_source: firstValue(payload.utm_source, params.utm_source),
        utm_medium: firstValue(payload.utm_medium, params.utm_medium),
        utm_campaign: firstValue(payload.utm_campaign, params.utm_campaign),
        utm_content: firstValue(payload.utm_content, params.utm_content),
        utm_term: firstValue(payload.utm_term, params.utm_term),

        client_ip_address: firstValue(payload.visit?.meta?.remote_addr),
        client_user_agent: firstValue(
            payload.visit?.meta?.http_user_agent?.raw,
        ),

        state: firstValue(payload.location?.state),
        country: firstValue(payload.location?.country),
    };
}

export function buildTintimAttributionEvent({
    payload,
    clientId,
    phone,
    receivedAt = new Date().toISOString(),
}: {
    payload: TintimPayload;
    clientId: string;
    phone: string;
    receivedAt?: string;
}) {
    const tracking = extractTintimClientTracking(payload);
    const eventType = firstValue(payload.event_type);
    const occurredAt = resolveOccurredAt(payload, eventType, receivedAt);
    const source = firstValue(payload.source, tracking.utm_source);
    const platform = resolveTintimPlatform(source, tracking);
    const stableIdentity = [
        phone,
        eventType,
        occurredAt,
        source,
        platform,
        tracking.gclid,
        tracking.gbraid,
        tracking.wbraid,
        tracking.fbclid,
        tracking.fbc,
        tracking.ctwa_clid,
    ];

    return {
        event_fingerprint: createHash("sha256")
            .update(JSON.stringify(stableIdentity))
            .digest("hex"),
        client_id: clientId,
        platform,
        source,
        occurred_at: occurredAt,
    };
}

export function paidMediaPlatformFromTintimSource(
    value: string | null | undefined,
): PaidMediaPlatform | null {
    const source = normalize(value);
    if (!source) return null;

    if (
        /(^| )(google ads|google adwords|adwords|gads)( |$)/.test(source)
    ) {
        return "google_ads";
    }

    if (
        /(^| )(meta ads|facebook ads|instagram ads|fb ads|ig ads)( |$)/.test(
            source,
        )
    ) {
        return "meta_ads";
    }

    return null;
}

export function isTrackedTintimSource(
    value: string | null | undefined,
) {
    const source = normalize(value);
    if (!source) return false;

    return ![
        "nao rastreada",
        "nao rastreado",
        "nao identificada",
        "nao identificado",
        "sem rastreamento",
        "not tracked",
        "untracked",
        "unknown",
    ].includes(source);
}

function resolveTintimPlatform(
    source: string | null,
    tracking: TintimClientTracking,
): PaidMediaPlatform | null {
    const sourcePlatform = paidMediaPlatformFromTintimSource(source);
    if (sourcePlatform) return sourcePlatform;

    const hasGoogleClick = Boolean(
        tracking.gclid || tracking.gbraid || tracking.wbraid,
    );
    const hasMetaClick = Boolean(
        tracking.fbclid || tracking.fbc || tracking.ctwa_clid,
    );
    if (hasGoogleClick !== hasMetaClick) {
        return hasGoogleClick ? "google_ads" : "meta_ads";
    }

    return paidMediaPlatformFromPaidUtm(
        tracking.utm_source,
        tracking.utm_medium,
    );
}

function paidMediaPlatformFromPaidUtm(
    sourceValue: string | null,
    mediumValue: string | null,
): PaidMediaPlatform | null {
    const source = normalize(sourceValue);
    const medium = normalize(mediumValue);
    const paidMedium =
        /(^| )(paid|cpc|ppc|trafego pago|paid social)( |$)/.test(medium);

    if (
        /(^| )(google ads|google adwords|adwords|gads)( |$)/.test(source) ||
        (source === "google" && paidMedium)
    ) {
        return "google_ads";
    }

    if (
        /(^| )(meta ads|facebook ads|instagram ads|fb ads|ig ads)( |$)/.test(
            source,
        ) ||
        (
            ["meta", "facebook", "instagram", "fb", "ig"].includes(source) &&
            paidMedium
        )
    ) {
        return "meta_ads";
    }

    return null;
}

function resolveOccurredAt(
    payload: TintimPayload,
    eventType: string | null,
    receivedAt: string,
) {
    const isUpdate = normalize(eventType).includes("update");
    const candidates = isUpdate
        ? [
              payload.updated_isoformat,
              payload.updated,
              payload.created_isoformat,
              payload.created,
          ]
        : [
              payload.created_isoformat,
              payload.created,
              payload.updated_isoformat,
              payload.updated,
          ];

    return firstValidTimestamp(...candidates) ?? receivedAt;
}

function firstValidTimestamp(...values: unknown[]) {
    for (const value of values) {
        if (typeof value !== "string" || !value.trim()) continue;
        const timestamp = new Date(value).getTime();
        if (Number.isFinite(timestamp)) {
            return new Date(timestamp).toISOString();
        }
    }
    return null;
}

function firstValue(...values: unknown[]) {
    for (const value of values) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
    }
    return null;
}

function normalize(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
