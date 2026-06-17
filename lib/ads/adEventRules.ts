// lib/ads/adEventRules.ts
import type { OutcomeEventType } from "../../types";

export type AdPlatformTag = "Meta Ads" | "Google Ads";

export const QUALIFIED_LEAD_OUTCOME_EVENTS: OutcomeEventType[] = [
    "consultation_offered",
    "price_presented",
    "handoff_to_unit",
];

export const SCHEDULE_OUTCOME_EVENTS: OutcomeEventType[] = [
    "appointment_scheduled",
    "appointment_rescheduled",
];

export function getAdTagsForOutcomeEventType(
    eventType: OutcomeEventType | string
): AdPlatformTag[] {
    if (
        QUALIFIED_LEAD_OUTCOME_EVENTS.includes(eventType as OutcomeEventType) ||
        SCHEDULE_OUTCOME_EVENTS.includes(eventType as OutcomeEventType)
    ) {
        return ["Meta Ads", "Google Ads"];
    }

    return [];
}
