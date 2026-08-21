import { randomUUID } from "crypto";

import type { ParsedZernioMessage } from "@/lib/importers/zernio/parseZernioWebhook";
import { supabase } from "@/lib/supabase/client";
import { getZernioAd, ZernioApiError } from "@/lib/zernio/client";

type PersistConversationAdAttributionInput = {
    message: ParsedZernioMessage;
    messageId: string;
    threadId: string;
    instagramUserId: string;
    requestId: string;
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
        const ad = await getZernioAd(referral.ad_id);
        const enrichedAt = new Date().toISOString();
        const { error: updateError } = await supabase
            .from("conversation_ad_attributions")
            .update({
                zernio_ad_id: ad.id,
                platform: ad.platform,
                campaign_id: ad.campaign_id,
                campaign_name: ad.campaign_name,
                ad_set_id: ad.ad_set_id,
                ad_set_name: ad.ad_set_name,
                ad_name: ad.name,
                creative_image_url: ad.image_url,
                creative_video_url: ad.video_url,
                enrichment_status: "resolved",
                enrichment_error: null,
                enriched_at: enrichedAt,
                updated_at: enrichedAt,
            })
            .eq("id", rowId);

        if (updateError) throw updateError;

        await updateInstagramUserLatestAttribution({
            instagramUserId,
            receivedAt: message.sent_at,
            values: {
                last_meta_ad_id: referral.ad_id,
                last_ad_campaign_id: ad.campaign_id,
                last_ad_campaign_name: ad.campaign_name,
                last_ad_set_id: ad.ad_set_id,
                last_ad_set_name: ad.ad_set_name,
                last_ad_name: ad.name ?? referral.ad_title,
            },
            requestId,
        });
    } catch (error) {
        const status =
            error instanceof ZernioApiError && error.status === 403
                ? "unavailable"
                : "failed";
        const errorMessage =
            error instanceof Error ? error.message.slice(0, 1_000) : "Unknown error";

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
            `[zernio-webhook:${requestId}] Zernio ad enrichment ${status}`,
            {
                meta_ad_id: referral.ad_id,
                error: errorMessage,
            },
        );
    }
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
    requestId,
}: {
    instagramUserId: string;
    receivedAt: string;
    values: Record<string, string | null>;
    requestId: string;
}) {
    const { data: current, error: readError } = await supabase
        .from("instagram_users")
        .select("last_paid_attribution_at")
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

    const { error } = await supabase
        .from("instagram_users")
        .update({
            ...values,
            last_paid_attribution_at: receivedAt,
            updated_at: new Date().toISOString(),
        })
        .eq("id", instagramUserId);

    if (error) {
        console.error(
            `[zernio-webhook:${requestId}] Instagram attribution profile update failed`,
            error,
        );
    }
}
