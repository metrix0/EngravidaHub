// lib/clients/acquisition.ts
import type { JourneyRow } from "@/lib/clients/individualJourney";

export type ClientAcquisition = ReturnType<typeof buildClientAcquisition>;
const text = (row: JourneyRow | null | undefined, key: string) =>
    typeof row?.[key] === "string" && (row[key] as string).trim() ? (row[key] as string).trim() : null;
const fields = [
    ["last_origin", "Origem registrada"], ["last_tunnel", "Túnel"],
    ["utm_source", "UTM source"], ["utm_medium", "UTM medium"],
    ["utm_campaign", "Campanha (UTM)"], ["utm_content", "Conteúdo (UTM)"],
    ["utm_term", "Termo registrado (UTM term)"],
] as const;
const identifiers = ["gclid", "gbraid", "wbraid", "fbclid", "fbc", "fbp", "ctwa_clid"] as const;

export function buildClientAcquisition(input: {
    client: JourneyRow | null;
    instagramUsers: JourneyRow[];
    threads: JourneyRow[];
    adAttributions: JourneyRow[];
    appointments: JourneyRow[];
}) {
    const threads = new Map(input.threads.map(row => [text(row, "id"), row]));
    const ads = input.adAttributions.map(row => ({
        id: text(row, "id")!, threadId: text(row, "thread_id"),
        receivedAt: text(row, "referral_received_at") ?? text(row, "created_at"),
        channel: text(row, "channel"), adId: text(row, "meta_ad_id") ?? text(row, "zernio_ad_id"),
        name: text(row, "ad_name") ?? text(row, "referral_ad_title"),
        campaignId: text(row, "campaign_id"), campaignName: text(row, "campaign_name"),
        adSetId: text(row, "ad_set_id"), adSetName: text(row, "ad_set_name"),
        imageUrl: mediaUrl(text(row, "creative_image_url") ?? text(row, "referral_photo_url")),
        videoUrl: mediaUrl(text(row, "creative_video_url") ?? text(row, "referral_video_url")),
    })).sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
    const appointments = input.appointments.flatMap(row => {
        const threadId = text(row, "thread_id");
        const channel = text(threads.get(threadId), "channel");
        if (!threadId || !["Instagram", "Messenger"].includes(channel ?? "")) return [];
        const createdAt = text(row, "created_at");
        // Only a referral from this conversation, received before the booking,
        // can explain this appointment. A later ad must not replace its origin.
        const ad = createdAt ? ads.find(item => item.threadId === threadId && item.receivedAt &&
            Date.parse(item.receivedAt) <= Date.parse(createdAt)) : null;
        return [{
            id: text(row, "id")!, threadId, channel: channel!,
            startsAt: text(row, "starts_at"), createdAt,
            procedure: text(row, "procedure_name"), status: text(row, "status"),
            adAttributionId: ad?.id ?? null,
        }];
    }).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return {
        fields: fields.map(([key, label]) => ({ key, label, value: text(input.client, key) })),
        identifiers: identifiers.flatMap(key => {
            const value = text(input.client, key);
            return value ? [{ key, label: key, value }] : [];
        }),
        trackingUpdatedAt: text(input.client, "tracking_updated_at"),
        socialProfiles: input.instagramUsers.map(row => ({
            id: text(row, "id")!, username: text(row, "username"), name: text(row, "display_name"),
        })),
        appointments, ads,
    };
}

function mediaUrl(value: string | null) {
    if (!value) return null;
    try { return ["https:", "http:"].includes(new URL(value).protocol) ? value : null; }
    catch { return null; }
}
