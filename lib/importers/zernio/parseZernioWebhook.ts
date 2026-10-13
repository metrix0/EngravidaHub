// lib/importers/zernio/parseZernioWebhook.ts
import type { SenderType } from "@/types/message";

import {
    zernioExternalMessageId,
    type ZernioInboxPlatform,
} from "@/lib/zernio/client";

export type ParsedZernioAttachment = {
    type: "image" | "video" | "audio" | "file";
    url: string;
    name: string | null;
};

export type ParsedZernioReferral = {
    ad_id: string;
    ref: string | null;
    source: string | null;
    type: string | null;
    ad_title: string | null;
    photo_url: string | null;
    video_url: string | null;
    post_id: string | null;
    campaign_id: string | null;
    campaign_name: string | null;
    ad_set_id: string | null;
    ad_set_name: string | null;
    ad_name: string | null;
};

export type ParsedZernioMessage = {
    platform: ZernioInboxPlatform;
    channel: "Instagram" | "Facebook";
    event_id: string | null;
    sender_type: SenderType;
    sender_name: string | null;
    sender_id: string | null;
    text: string;
    attachment: ParsedZernioAttachment | null;
    referral: ParsedZernioReferral | null;
    social_metadata: Record<string, unknown> | null;
    sent_at: string;
    external_id: string;
    external_thread_id: string;
    external_account_id: string;
    participant_id: string;
    participant_username: string | null;
    participant_name: string | null;
    participant_picture_url: string | null;
};

export function parseZernioMessageWebhook(
    payload: unknown,
): ParsedZernioMessage | null {
    const root = asRecord(payload);
    const event = stringValue(root?.event);

    if (event !== "message.received" && event !== "message.sent") {
        return null;
    }

    const message = asRecord(root?.message);
    const conversation = asRecord(root?.conversation);
    const account = asRecord(root?.account);
    const sender = asRecord(message?.sender);
    const platform = normalizePlatform(
        stringValue(message?.platform) ??
            stringValue(conversation?.platform) ??
            stringValue(account?.platform),
    );

    if (!platform) return null;

    const channel = platform === "facebook" ? "Facebook" : "Instagram";
    const socialProfile =
        asRecord(conversation?.instagramProfile) ??
        asRecord(conversation?.facebookProfile) ??
        asRecord(conversation?.profile);

    const direction =
        stringValue(message?.direction)?.toLowerCase() ??
        (event === "message.received" ? "incoming" : "outgoing");
    const accountId =
        stringValue(account?.id) ??
        stringValue(account?._id) ??
        stringValue(account?.accountId) ??
        stringValue(message?.accountId);
    const conversationId =
        stringValue(conversation?.platformConversationId) ??
        stringValue(conversation?.id) ??
        stringValue(conversation?._id) ??
        stringValue(message?.conversationId);
    const participantId =
        stringValue(conversation?.participantId) ??
        (direction === "incoming" ? stringValue(sender?.id) : null);
    const platformMessageId = stringValue(message?.platformMessageId);
    const messageId =
        direction === "outgoing"
            ? platformMessageId ??
              stringValue(message?.id) ??
              stringValue(message?._id) ??
              stringValue(root?.id)
            : stringValue(message?.id) ??
              stringValue(message?._id) ??
              platformMessageId ??
              stringValue(root?.id);

    if (!accountId || !conversationId || !participantId || !messageId) {
        return null;
    }

    const participantUsername =
        stringValue(conversation?.participantUsername) ??
        stringValue(socialProfile?.username) ??
        (direction === "incoming" ? stringValue(sender?.username) : null);
    const participantName =
        stringValue(conversation?.participantName) ??
        (direction === "incoming"
            ? stringValue(sender?.name) ??
              stringValue(sender?.displayName)
            : null) ??
        (participantUsername ? `@${stripAt(participantUsername)}` : null);
    const accountName =
        stringValue(account?.displayName) ??
        stringValue(account?.username) ??
        channel;
    const attachment = firstAttachment(message?.attachments);
    const rawText =
        stringValue(message?.text) ?? stringValue(message?.message) ?? "";
    const referral =
        event === "message.received" && direction === "incoming"
            ? parseReferral(message, root)
            : null;

    return {
        platform,
        channel,
        event_id: stringValue(root?.id),
        sender_type: direction === "incoming" ? "client" : "attendant",
        sender_name:
            direction === "incoming" ? participantName : stripAt(accountName),
        sender_id: stringValue(sender?.id),
        text: rawText || attachmentLabel(attachment, channel),
        attachment,
        referral,
        social_metadata: event === "message.received" && direction === "incoming"
            ? parseSocialMetadata(message, root) : null,
        sent_at: normalizeDate(message?.sentAt ?? root?.timestamp),
        external_id: zernioExternalMessageId(
            platform === "facebook" ? `facebook:${messageId}` : messageId,
        ),
        external_thread_id: conversationId,
        external_account_id: accountId,
        participant_id: participantId,
        participant_username: participantUsername
            ? stripAt(participantUsername)
            : null,
        participant_name: participantName,
        participant_picture_url:
            stringValue(conversation?.participantPicture) ??
            stringValue(conversation?.participantPictureUrl) ??
            stringValue(socialProfile?.profilePictureUrl) ??
            (direction === "incoming"
                ? stringValue(sender?.profilePictureUrl) ??
                  stringValue(sender?.picture)
                : null),
    };
}

function parseReferral(
    message: Record<string, unknown> | null,
    root: Record<string, unknown> | null,
): ParsedZernioReferral | null {
    const metadata = asRecord(message?.metadata) ?? asRecord(root?.metadata);
    const referral = asRecord(metadata?.referral) ??
        asRecord(message?.referral) ?? asRecord(root?.referral);
    const adId = stringValue(referral?.ad_id) ?? stringValue(referral?.adId);
    if (!adId) return null;

    const adsContext = asRecord(referral?.adscontextdata);
    return {
        ad_id: adId,
        ref: stringValue(referral?.ref),
        source: stringValue(referral?.source),
        type: stringValue(referral?.type),
        ad_title: stringValue(adsContext?.adtitle),
        photo_url: stringValue(adsContext?.photo_url),
        video_url: stringValue(adsContext?.videourl),
        post_id: stringValue(adsContext?.post_id),
        campaign_id: stringValue(referral?.campaign_id) ?? stringValue(referral?.campaignId),
        campaign_name: stringValue(referral?.campaign_name) ?? stringValue(referral?.campaignName),
        ad_set_id: stringValue(referral?.adset_id) ?? stringValue(referral?.ad_set_id),
        ad_set_name: stringValue(referral?.adset_name) ?? stringValue(referral?.ad_set_name),
        ad_name: stringValue(referral?.ad_name) ?? stringValue(adsContext?.adtitle),
    };
}

// Retain advertising context without persisting unfiltered provider/patient metadata.
const SOCIAL_META_KEYS = new Set([
    "referral", "adscontextdata", "ad_id", "adId", "adtitle", "ad_name",
    "campaign_id", "campaignId", "campaign_name", "campaignName",
    "adset_id", "adset_name", "ad_set_id", "ad_set_name",
    "source", "ref", "type", "post_id", "photo_url", "videourl",
    "source_url", "fbclid", "fbc", "fbp", "ctwa_clid", "click_id",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
]);

function parseSocialMetadata(
    message: Record<string, unknown> | null,
    root: Record<string, unknown> | null,
): Record<string, unknown> | null {
    const metadata = asRecord(message?.metadata) ?? asRecord(root?.metadata);
    const result = pickSocialMetadata(metadata, 0);
    const directReferral = asRecord(message?.referral) ?? asRecord(root?.referral);
    if (directReferral && !result.referral) {
        const referral = pickSocialMetadata(directReferral, 1);
        if (Object.keys(referral).length) result.referral = referral;
    }
    return Object.keys(result).length ? result : null;
}

function pickSocialMetadata(
    source: Record<string, unknown> | null,
    depth: number,
): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    if (!source || depth > 2) return picked;
    for (const [key, value] of Object.entries(source)) {
        if (!SOCIAL_META_KEYS.has(key)) continue;
        if (typeof value === "string" && value.trim()) {
            picked[key] = value.trim().slice(0, 2048);
        } else if (typeof value === "number" && Number.isFinite(value)) {
            picked[key] = value;
        } else if ((key === "referral" || key === "adscontextdata") && depth < 2) {
            const nested = pickSocialMetadata(asRecord(value), depth + 1);
            if (Object.keys(nested).length) picked[key] = nested;
        }
    }
    return picked;
}

function firstAttachment(value: unknown): ParsedZernioAttachment | null {
    if (!Array.isArray(value)) return null;

    for (const candidate of value) {
        const attachment = asRecord(candidate);
        const url =
            stringValue(attachment?.url) ??
            stringValue(attachment?.attachmentUrl) ??
            stringValue(attachment?.mediaUrl) ??
            stringValue(attachment?.previewUrl);

        if (!url) continue;

        return {
            type: normalizeAttachmentType(
                attachment?.type ?? attachment?.mimeType,
            ),
            url,
            name:
                stringValue(attachment?.filename) ??
                stringValue(attachment?.name),
        };
    }

    return null;
}

function normalizeAttachmentType(
    value: unknown,
): ParsedZernioAttachment["type"] {
    const normalized = String(value ?? "")
        .trim()
        .toLowerCase();

    if (normalized === "image" || normalized.startsWith("image/")) {
        return "image";
    }
    if (normalized === "video" || normalized.startsWith("video/")) {
        return "video";
    }
    if (normalized === "audio" || normalized.startsWith("audio/")) {
        return "audio";
    }

    return "file";
}

function attachmentLabel(
    attachment: ParsedZernioAttachment | null,
    channel: "Instagram" | "Facebook",
) {
    if (!attachment) return `[Mensagem do ${channel}]`;

    if (attachment.type === "image") return "[Imagem enviada]";
    if (attachment.type === "video") return "[Vídeo enviado]";
    if (attachment.type === "audio") return "[Áudio enviado]";
    return "[Arquivo enviado]";
}

function normalizePlatform(value: string | null): ZernioInboxPlatform | null {
    const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");

    if (normalized === "instagram") return "instagram";
    if (
        normalized === "facebook" ||
        normalized === "messenger" ||
        normalized === "facebook_messenger"
    ) {
        return "facebook";
    }

    return null;
}

function normalizeDate(value: unknown) {
    const parsed = new Date(typeof value === "string" ? value : Date.now());
    return Number.isNaN(parsed.getTime())
        ? new Date().toISOString()
        : parsed.toISOString();
}

function stripAt(value: string) {
    return value.replace(/^@+/, "").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
