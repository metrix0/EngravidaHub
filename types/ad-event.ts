// types/ad-event.ts

export const AD_PLATFORMS = [
    "Meta Ads",
    "Google Ads",
] as const;

export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const AD_EVENT_TYPES = [
    "lead",
    "schedule",
] as const;

export type AdEventType = (typeof AD_EVENT_TYPES)[number];

export const AD_EVENT_STATUSES = [
    "sent",
    "failed",
] as const;

export type AdEventStatus = (typeof AD_EVENT_STATUSES)[number];

export type AdEvent = {
    id: string;
    conversation_id: string | null;

    event_type: AdEventType;
    platform: AdPlatform;
    status: AdEventStatus;
    event_date: string;

    created_at: string;
    updated_at: string;
};

export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = {
    "Meta Ads": "Meta Ads",
    "Google Ads": "Google Ads",
};

export const AD_EVENT_TYPE_LABELS: Record<AdEventType, string> = {
    lead: "Qualified Lead",
    schedule: "Schedule",
};

export const AD_EVENT_STATUS_LABELS: Record<AdEventStatus, string> = {
    sent: "Enviado",
    failed: "Falhou",
};
