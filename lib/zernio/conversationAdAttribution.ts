// lib/zernio/conversationAdAttribution.ts
import { randomUUID } from "crypto";

import { matchMediaBudgetCity } from "@/lib/ads/mediaBudgetByCity";
import type { ParsedZernioMessage } from "@/lib/importers/zernio/parseZernioWebhook";
import { supabase } from "@/lib/supabase/client";
import { getZernioAd, ZernioApiError } from "@/lib/zernio/client";

const META_GRAPH_REQUEST_TIMEOUT_MS = 20_000;
const BACKFILL_PAGE_SIZE = 1_000;
const BACKFILL_UPDATE_BATCH_SIZE = 100;
const META_LOOKUP_CONCURRENCY = 8;

type PersistConversationAdAttributionInput = {
    message: ParsedZernioMessage;
    messageId: string;
    threadId: string;
    instagramUserId: string;
    requestId: string;
};

type ConversationAdDetails = {
    zernioAdId: string | null;
    platform: string | null;
    campaignId: string | null;
    campaignName: string | null;
    adSetId: string | null;
    adSetName: string | null;
    name: string | null;
    imageUrl: string | null;
    videoUrl: string | null;
};

type MetaGraphAdResponse = {
    id?: string;
    name?: string;
    campaign?: {
        id?: string;
        name?: string;
    };
    adset?: {
        id?: string;
        name?: string;
    };
    error?: {
        message?: string;
    };
};

type UnresolvedAttributionRow = {
    instagram_user_id: string;
    meta_ad_id: string;
    referral_received_at: string;
};

export async function persistConversationAdAttribution({
    message,
    messageId,
    threadId,
    instagramUserId,
    requestId,
}: PersistConversationAdAttributionInput) {
    const referral = message.referral;
    if (!referral?.ad_id || message.sender_type !== "client") return;

    const attributionId = randomUUID();
    const now = new Date().toISOString();
    const baseRow = {
        id: attributionId,
        instagram_user_id: instagramUserId,
        thread_id: threadId,
        message_id: messageId,
        channel: message.channel,
        zernio_conversation_id: message.external_thread_id,
        zernio_account_id: message.external_account_id,
        meta_ad_id: referral.ad_id,
        referral_ref: referral.ref,
        referral_source: referral.source,
        referral_type: referral.type,
        referral_ad_title: referral.ad_title,
        referral_photo_url: referral.photo_url,
        referral_video_url: referral.video_url,
        referral_post_id: referral.post_id,
        referral_received_at: message.sent_at,
        enrichment_status: "pending",
        created_at: now,
        updated_at: now,
    };

    const { data: attribution, error: insertError } = await supabase
        .from("conversation_ad_attributions")
        .upsert(baseRow, {
            onConflict: "message_id",
            ignoreDuplicates: true,
        })
        .select("id")
        .maybeSingle();

    if (insertError) {
        console.error(
            `[zernio-webhook:${requestId}] Ad attribution persistence failed`,
            insertError,
        );
        return;
    }

    const rowId = attribution?.id ?? (await findAttributionId(messageId));
    if (!rowId) return;

    await updateInstagramUserLatestAttribution({
        instagramUserId,
        receivedAt: message.sent_at,
        values: {
            last_meta_ad_id: referral.ad_id,
            last_ad_name: referral.ad_title,
        },
        requestId,
    });

    try {
        const ad = await resolveConversationAd(referral.ad_id);
        const enrichedAt = new Date().toISOString();
        const { error: updateError } = await supabase
            .from("conversation_ad_attributions")
            .update(attributionUpdateValues(ad, enrichedAt))
            .eq("id", rowId);

        if (updateError) throw updateError;

        await updateInstagramUserLatestAttribution({
            instagramUserId,
            receivedAt: message.sent_at,
            values: {
                last_meta_ad_id: referral.ad_id,
                last_ad_campaign_id: ad.campaignId,
                last_ad_campaign_name: ad.campaignName,
                last_ad_set_id: ad.adSetId,
                last_ad_set_name: ad.adSetName,
                last_ad_name: ad.name ?? referral.ad_title,
            },
            unitName: resolveAdCity(ad),
            requestId,
        });
    } catch (error) {
        const zernioError =
            error instanceof ConversationAdResolutionError
                ? error.zernioError
                : error;
        const status =
            zernioError instanceof ZernioApiError && zernioError.status === 403
                ? "unavailable"
                : "failed";
        const errorMessage = toErrorMessage(error).slice(0, 1_000);

        const { error: updateError } = await supabase
            .from("conversation_ad_attributions")
            .update({
                enrichment_status: status,
                enrichment_error: errorMessage,
                updated_at: new Date().toISOString(),
            })
            .eq("id", rowId);

        if (updateError) {
            console.error(
                `[zernio-webhook:${requestId}] Ad attribution status update failed`,
                updateError,
            );
        }

        console.warn(
            `[zernio-webhook:${requestId}] Ad enrichment ${status}`,
            {
                meta_ad_id: referral.ad_id,
                error: errorMessage,
            },
        );
    }
}

export async function backfillConversationAdAttributions() {
    const rows = await loadUnresolvedAttributionRows();
    const adIds = [...new Set(rows.map((row) => row.meta_ad_id))];

    if (adIds.length === 0) {
        return {
            attempted_ads: 0,
            resolved_ads: 0,
            failed_ads: 0,
            resolved_attributions: 0,
            locations_updated: 0,
            first_error: null,
        };
    }

    const rowsPerAd = new Map<string, number>();
    for (const row of rows) {
        rowsPerAd.set(row.meta_ad_id, (rowsPerAd.get(row.meta_ad_id) ?? 0) + 1);
    }

    const resolvedAds = new Map<string, ConversationAdDetails>();
    let resolvedAttributions = 0;
    let firstError: string | null = null;

    await runWithConcurrency(adIds, META_LOOKUP_CONCURRENCY, async (adId) => {
        try {
            const ad = await getMetaGraphAd(adId);
            const enrichedAt = new Date().toISOString();
            const { error } = await supabase
                .from("conversation_ad_attributions")
                .update(attributionUpdateValues(ad, enrichedAt))
                .eq("meta_ad_id", adId)
                .in("enrichment_status", ["pending", "failed", "unavailable"]);

            if (error) throw error;

            resolvedAds.set(adId, ad);
            resolvedAttributions += rowsPerAd.get(adId) ?? 0;
        } catch (error) {
            firstError ??= toErrorMessage(error).slice(0, 1_000);
        }
    });

    const locationsUpdated = await backfillInstagramLocations(rows, resolvedAds);
    const result = {
        attempted_ads: adIds.length,
        resolved_ads: resolvedAds.size,
        failed_ads: adIds.length - resolvedAds.size,
        resolved_attributions: resolvedAttributions,
        locations_updated: locationsUpdated,
        first_error: firstError,
    };

    console.info("[conversation-ad-attribution] Backfill completed", result);
    return result;
}

async function resolveConversationAd(metaAdId: string) {
    let zernioError: unknown = null;

    try {
        const ad = await getZernioAd(metaAdId);
        if (
            ad.campaign_id ||
            ad.campaign_name ||
            ad.ad_set_id ||
            ad.ad_set_name
        ) {
            return {
                zernioAdId: ad.id,
                platform: ad.platform,
                campaignId: ad.campaign_id,
                campaignName: ad.campaign_name,
                adSetId: ad.ad_set_id,
                adSetName: ad.ad_set_name,
                name: ad.name,
                imageUrl: ad.image_url,
                videoUrl: ad.video_url,
            } satisfies ConversationAdDetails;
        }

        zernioError = new Error(
            "Zernio ad response did not include campaign or ad set details",
        );
    } catch (error) {
        zernioError = error;
    }

    try {
        return await getMetaGraphAd(metaAdId);
    } catch (metaError) {
        throw new ConversationAdResolutionError(zernioError, metaError);
    }
}

async function getMetaGraphAd(metaAdId: string): Promise<ConversationAdDetails> {
    const accessTokens = [...new Set(
        [
            process.env.META_ADS_ACCESS_TOKEN?.trim(),
            process.env.META_ACCESS_TOKEN?.trim(),
        ].filter((value): value is string => Boolean(value)),
    )];
    if (accessTokens.length === 0) {
        throw new Error("Meta Ads access token is not configured");
    }

    let firstError: unknown = null;
    for (const accessToken of accessTokens) {
        try {
            return await requestMetaGraphAd(metaAdId, accessToken);
        } catch (error) {
            firstError ??= error;
        }
    }

    throw firstError ?? new Error("Meta ad lookup failed");
}

async function requestMetaGraphAd(
    metaAdId: string,
    accessToken: string,
): Promise<ConversationAdDetails> {
    const apiVersion = (
        process.env.META_GRAPH_API_VERSION?.trim() || "v25.0"
    ).replace(/^\/+|\/+$/g, "");
    const url = new URL(
        `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(metaAdId)}`,
    );
    url.searchParams.set(
        "fields",
        "id,name,campaign{id,name},adset{id,name}",
    );

    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(META_GRAPH_REQUEST_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => ({}))) as MetaGraphAdResponse;

    if (!response.ok || payload.error) {
        throw new Error(
            payload.error?.message ??
                `Meta Graph API returned HTTP ${response.status}`,
        );
    }

    if (!payload.campaign && !payload.adset) {
        throw new Error("Meta ad response did not include campaign or ad set details");
    }

    return {
        zernioAdId: null,
        platform: "meta",
        campaignId: payload.campaign?.id ?? null,
        campaignName: payload.campaign?.name ?? null,
        adSetId: payload.adset?.id ?? null,
        adSetName: payload.adset?.name ?? null,
        name: payload.name ?? null,
        imageUrl: null,
        videoUrl: null,
    };
}

function attributionUpdateValues(ad: ConversationAdDetails, enrichedAt: string) {
    return {
        zernio_ad_id: ad.zernioAdId,
        platform: ad.platform,
        campaign_id: ad.campaignId,
        campaign_name: ad.campaignName,
        ad_set_id: ad.adSetId,
        ad_set_name: ad.adSetName,
        ad_name: ad.name,
        creative_image_url: ad.imageUrl,
        creative_video_url: ad.videoUrl,
        enrichment_status: "resolved",
        enrichment_error: null,
        enriched_at: enrichedAt,
        updated_at: enrichedAt,
    };
}

function resolveAdCity(ad: ConversationAdDetails) {
    return (
        matchMediaBudgetCity(ad.adSetName) ??
        matchMediaBudgetCity(ad.campaignName)
    )?.city ?? null;
}

async function loadUnresolvedAttributionRows() {
    const rows: UnresolvedAttributionRow[] = [];

    for (let from = 0; ; from += BACKFILL_PAGE_SIZE) {
        const { data, error } = await supabase
            .from("conversation_ad_attributions")
            .select("instagram_user_id, meta_ad_id, referral_received_at")
            .in("enrichment_status", ["pending", "failed", "unavailable"])
            .order("referral_received_at", { ascending: false })
            .range(from, from + BACKFILL_PAGE_SIZE - 1);

        if (error) throw error;

        const page = (data ?? []) as UnresolvedAttributionRow[];
        rows.push(...page);
        if (page.length < BACKFILL_PAGE_SIZE) break;
    }

    return rows;
}

async function backfillInstagramLocations(
    rows: UnresolvedAttributionRow[],
    resolvedAds: Map<string, ConversationAdDetails>,
) {
    const latestLocationByUser = new Map<string, string>();

    for (const row of rows) {
        if (latestLocationByUser.has(row.instagram_user_id)) continue;
        const ad = resolvedAds.get(row.meta_ad_id);
        if (!ad) continue;
        const city = resolveAdCity(ad);
        if (city) latestLocationByUser.set(row.instagram_user_id, city);
    }

    const userIdsByCity = new Map<string, string[]>();
    for (const [userId, city] of latestLocationByUser) {
        const userIds = userIdsByCity.get(city) ?? [];
        userIds.push(userId);
        userIdsByCity.set(city, userIds);
    }

    let locationsUpdated = 0;
    for (const [city, userIds] of userIdsByCity) {
        for (const ids of chunk(userIds, BACKFILL_UPDATE_BATCH_SIZE)) {
            const { data, error } = await supabase
                .from("instagram_users")
                .update({
                    location: city,
                    updated_at: new Date().toISOString(),
                })
                .in("id", ids)
                .is("location", null)
                .select("id");

            if (error) throw error;
            locationsUpdated += data?.length ?? 0;
        }
    }

    return locationsUpdated;
}

async function findAttributionId(messageId: string) {
    const { data, error } = await supabase
        .from("conversation_ad_attributions")
        .select("id")
        .eq("message_id", messageId)
        .maybeSingle();

    if (error) return null;
    return data?.id ?? null;
}

async function updateInstagramUserLatestAttribution({
    instagramUserId,
    receivedAt,
    values,
    unitName,
    requestId,
}: {
    instagramUserId: string;
    receivedAt: string;
    values: Record<string, string | null>;
    unitName?: string | null;
    requestId: string;
}) {
    const { data: current, error: readError } = await supabase
        .from("instagram_users")
        .select("last_paid_attribution_at, location")
        .eq("id", instagramUserId)
        .maybeSingle();

    if (readError) {
        console.error(
            `[zernio-webhook:${requestId}] Instagram attribution profile read failed`,
            readError,
        );
        return;
    }

    const currentAt = current?.last_paid_attribution_at
        ? new Date(current.last_paid_attribution_at).getTime()
        : Number.NEGATIVE_INFINITY;
    const nextAt = new Date(receivedAt).getTime();
    if (Number.isFinite(nextAt) && nextAt < currentAt) return;

    const updates: Record<string, string | null> = {
        ...values,
        last_paid_attribution_at: receivedAt,
        updated_at: new Date().toISOString(),
    };
    if (unitName && !current?.location?.trim()) {
        updates.location = unitName;
    }

    const { error } = await supabase
        .from("instagram_users")
        .update(updates)
        .eq("id", instagramUserId);

    if (error) {
        console.error(
            `[zernio-webhook:${requestId}] Instagram attribution profile update failed`,
            error,
        );
    }
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
) {
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (nextIndex < items.length) {
                const item = items[nextIndex];
                nextIndex += 1;
                await worker(item);
            }
        }),
    );
}

function chunk<T>(items: T[], size: number) {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        result.push(items.slice(index, index + size));
    }
    return result;
}

function toErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

class ConversationAdResolutionError extends Error {
    readonly zernioError: unknown;

    constructor(zernioError: unknown, metaError: unknown) {
        super(
            `Zernio: ${toErrorMessage(zernioError)}; Meta: ${toErrorMessage(metaError)}`,
        );
        this.name = "ConversationAdResolutionError";
        this.zernioError = zernioError;
    }
}
