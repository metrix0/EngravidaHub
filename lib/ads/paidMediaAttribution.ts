// lib/ads/paidMediaAttribution.ts
export type PaidMediaPlatform = "google_ads" | "meta_ads";

export type PaidMediaAttributionEvidence =
    | "origin"
    | "utm_source"
    | "click_id";

export type PaidMediaAttributionInput = {
    last_origin?: string | null;
    utm_source?: string | null;
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
    fbclid?: string | null;
    fbc?: string | null;
    ctwa_clid?: string | null;
};

export type PaidMediaAttribution = {
    platform: PaidMediaPlatform;
    evidence: PaidMediaAttributionEvidence;
};

const GOOGLE_PAID_ORIGIN_FAMILIES = [
    "google conta 1",
    "google conta 2",
] as const;

const META_PAID_ORIGIN_FAMILIES = [
    "meta que passa pela lp",
    "meta clique para whatsapp",
    "direct meta para whatsapp",
] as const;

export function paidMediaPlatformFromOrigin(
    value: string | null | undefined,
): PaidMediaPlatform | null {
    const origin = normalizeAttributionText(value);
    if (!origin) return null;

    if (
        GOOGLE_PAID_ORIGIN_FAMILIES.some((family) =>
            belongsToOriginFamily(origin, family),
        )
    ) {
        return "google_ads";
    }

    if (
        META_PAID_ORIGIN_FAMILIES.some((family) =>
            belongsToOriginFamily(origin, family),
        )
    ) {
        return "meta_ads";
    }

    return null;
}

export function paidMediaPlatformFromTrackingSource(
    value: string | null | undefined,
): PaidMediaPlatform | null {
    const source = normalizeAttributionText(value);
    if (!source) return null;

    if (/(^| )(google|adwords|gads|youtube)( |$)/.test(source)) {
        return "google_ads";
    }

    if (/(^| )(meta|facebook|instagram|fb|ig)( |$)/.test(source)) {
        return "meta_ads";
    }

    return null;
}

/**
 * Resolves the strongest paid-acquisition evidence that is still present on a
 * client. A later organic `last_origin` must not erase an earlier paid UTM or
 * click identifier.
 */
export function resolvePaidMediaAttribution(
    client: PaidMediaAttributionInput | null | undefined,
): PaidMediaAttribution | null {
    if (!client) return null;

    const originPlatform = paidMediaPlatformFromOrigin(client.last_origin);
    if (originPlatform) {
        return { platform: originPlatform, evidence: "origin" };
    }

    const sourcePlatform = paidMediaPlatformFromTrackingSource(
        client.utm_source,
    );
    if (sourcePlatform) {
        return { platform: sourcePlatform, evidence: "utm_source" };
    }

    const hasGoogleClick = Boolean(
        client.gclid || client.gbraid || client.wbraid,
    );
    const hasMetaClick = Boolean(
        client.fbclid || client.fbc || client.ctwa_clid,
    );

    if (hasGoogleClick && !hasMetaClick) {
        return { platform: "google_ads", evidence: "click_id" };
    }
    if (hasMetaClick && !hasGoogleClick) {
        return { platform: "meta_ads", evidence: "click_id" };
    }

    return null;
}

export function resolvePaidMediaPlatform(
    client: PaidMediaAttributionInput | null | undefined,
): PaidMediaPlatform | null {
    return resolvePaidMediaAttribution(client)?.platform ?? null;
}

function belongsToOriginFamily(origin: string, family: string) {
    return origin === family || origin.startsWith(`${family} `);
}

function normalizeAttributionText(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
