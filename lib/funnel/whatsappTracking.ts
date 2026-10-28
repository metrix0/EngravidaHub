// Shared with Jornada's WhatsApp coverage and Clientes' "WhatsApp rastreado" filter.
import { isTrackedTintimSource } from "@/lib/tintim/attribution";

export type WhatsappTrackingClient = {
    tracking_updated_at?: string | null;
    last_origin?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_content?: string | null;
    utm_term?: string | null;
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
    fbclid?: string | null;
    fbc?: string | null;
    ctwa_clid?: string | null;
};

type TintimTrackingAttribution = {
    source: string | null;
    platform: string | null;
};

export function hasTintimTrackingEvidence(attribution: TintimTrackingAttribution | null) {
    return Boolean(attribution?.platform || isTrackedTintimSource(attribution?.source));
}

export function trackingIsNearConversation(
    trackingUpdatedAt: string | null | undefined,
    conversationStartedAt: string,
) {
    if (!trackingUpdatedAt) return false;
    const trackingTime = new Date(trackingUpdatedAt).getTime();
    const conversationTime = new Date(conversationStartedAt).getTime();
    if (!Number.isFinite(trackingTime) || !Number.isFinite(conversationTime)) {
        return false;
    }
    return Math.abs(trackingTime - conversationTime) <= 7 * 86_400_000;
}

export function hasConversationTrackingEvidence({
    conversationOrigin,
    client,
    trackingIsNear,
}: {
    conversationOrigin: string | null | undefined;
    client: WhatsappTrackingClient | null;
    trackingIsNear: boolean;
}) {
    if (conversationOrigin?.trim()) return true;
    if (!trackingIsNear || !client) return false;
    return Boolean(
        client.last_origin?.trim() ||
        client.utm_source?.trim() ||
        client.utm_medium?.trim() ||
        client.utm_campaign?.trim() ||
        client.utm_content?.trim() ||
        client.utm_term?.trim() ||
        client.gclid || client.gbraid || client.wbraid ||
        client.fbclid || client.fbc || client.ctwa_clid,
    );
}

export function isTrackedWhatsappConversation({
    conversationOrigin,
    conversationStartedAt,
    client,
    tintimAttribution,
}: {
    conversationOrigin: string | null | undefined;
    conversationStartedAt: string;
    client: WhatsappTrackingClient | null;
    tintimAttribution: TintimTrackingAttribution | null;
}) {
    return hasTintimTrackingEvidence(tintimAttribution) ||
        hasConversationTrackingEvidence({
            conversationOrigin,
            client,
            trackingIsNear: trackingIsNearConversation(client?.tracking_updated_at, conversationStartedAt),
        });
}
