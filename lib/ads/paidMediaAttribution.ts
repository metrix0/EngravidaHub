// lib/ads/paidMediaAttribution.ts
export type PaidMediaPlatform = "google_ads" | "meta_ads";

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
