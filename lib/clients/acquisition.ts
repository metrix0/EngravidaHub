// lib/clients/acquisition.ts
import type { JourneyRow } from "@/lib/clients/individualJourney";
import { matchMediaBudgetCity, normalizeCampaignMatchText } from "@/lib/ads/mediaBudgetByCity";

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
    entryMessages?: JourneyRow[];
    tintim?: JourneyRow[];
    conversations?: JourneyRow[];
}) {
    const threads = new Map(input.threads.map(row => [text(row, "id"), row]));
    const messages = new Map((input.entryMessages ?? []).map(row => [text(row, "id"), row]));
    const ads = input.adAttributions.map(row => {
        const message = messages.get(text(row, "message_id"));
        // Only the customer message carrying this referral can describe entry.
        const entryMessage = message && text(message, "sender_type") === "client" &&
            text(message, "thread_id") === text(row, "thread_id") ? text(message, "text")?.slice(0, 1200) ?? null : null;
        const campaignName = text(row, "campaign_name");
        const adSetName = text(row, "ad_set_name");
        const name = text(row, "ad_name") ?? text(row, "referral_ad_title");
        return {
            id: text(row, "id")!, threadId: text(row, "thread_id"),
            receivedAt: text(row, "referral_received_at") ?? text(row, "created_at"),
            channel: text(row, "channel"), adId: text(row, "meta_ad_id") ?? text(row, "zernio_ad_id"),
            name,
            campaignId: text(row, "campaign_id"), campaignName,
            adSetId: text(row, "ad_set_id"), adSetName,
            campaignTheme: topics([campaignName, adSetName, name].filter(Boolean).join(" ")),
            campaignUnit: matchMediaBudgetCity(adSetName)?.city ?? matchMediaBudgetCity(campaignName)?.city ?? null,
            entryMessage,
            entryInterest: entryMessage && !/\b(nao|nunca)\b/.test(normalizeCampaignMatchText(entryMessage)) ? topics(entryMessage) : null,
            imageUrl: mediaUrl(text(row, "creative_image_url") ?? text(row, "referral_photo_url")),
            videoUrl: mediaUrl(text(row, "creative_video_url") ?? text(row, "referral_video_url")),
        };
    }).sort((a, b) => (Date.parse(b.receivedAt ?? "") || 0) - (Date.parse(a.receivedAt ?? "") || 0));
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
        touchpoints: buildTouchpoints(input, ads),
    };
}

function topics(value: string) {
    const normalized = normalizeCampaignMatchText(value);
    const labels: string[] = [];
    if (/\b(congelamento|criopreservacao|cong)\b/.test(normalized)) {
        labels.push(/\bovulos?\b/.test(normalized) ? "Congelamento de óvulos" : "Congelamento");
    }
    for (const [pattern, label] of [
        [/\b(ovodoacao|ovorecepcao)\b/, "Ovodoação"],
        [/\blaqueadura\b/, "Laqueadura"],
        [/\b(lgbt\w*|homoafetiv\w*)\b/, "LGBT"],
        [/\b(fiv|fertilizacao in vitro)\b/, "FIV"],
        [/\bvasectomia\b/, "Vasectomia"],
    ] as const) if (pattern.test(normalized)) labels.push(label);
    return labels.length ? labels.join(" · ") : null;
}

function buildTouchpoints(input: Parameters<typeof buildClientAcquisition>[0], ads: Array<{
    id: string; receivedAt: string | null; channel: string | null; campaignName: string | null; threadId: string | null;
}>) {
    const points: Array<{ id: string; at: string; label: string; detail: string | null; source: string; threadId: string | null }> = [];
    const add = (point: Omit<typeof points[number], "at"> & { at: string | null }) => {
        if (point.at && Number.isFinite(Date.parse(point.at))) points.push({ ...point, at: point.at });
    };
    for (const ad of ads) add({ id: `ad:${ad.id}`, at: ad.receivedAt,
        label: `Anúncio · ${ad.channel ?? "Meta"}`, detail: ad.campaignName, source: "Referência do anúncio", threadId: ad.threadId });
    for (const row of input.tintim ?? []) add({ id: `tintim:${text(row, "id")}`, at: text(row, "occurred_at"),
        label: text(row, "source") ?? text(row, "platform") ?? "Contato rastreado", detail: text(row, "platform"), source: "Tintim", threadId: null });
    for (const row of input.conversations ?? []) {
        const origin = text(row, "origin");
        if (origin) add({ id: `conversation:${text(row, "id")}`, at: text(row, "started_at"), label: origin,
            detail: text(row, "channel"), source: "Origem registrada na conversa", threadId: text(row, "thread_id") });
    }
    const origin = text(input.client, "last_origin");
    if (origin) add({ id: "client:origin", at: text(input.client, "tracking_updated_at") ?? text(input.client, "first_seen_at"),
        label: origin, detail: "Data do registro da origem no cadastro; pode diferir do contato.", source: "Cadastro", threadId: null });
    return points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}

function mediaUrl(value: string | null) {
    if (!value) return null;
    try { return ["https:", "http:"].includes(new URL(value).protocol) ? value : null; }
    catch { return null; }
}
