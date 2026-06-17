// apps/insights/src/lib/ads/deriveAdEventsFromAnalysis.ts
import type { ConversationAnalysis, OutcomeEventType } from "@engravida/types";
import {
    QUALIFIED_LEAD_OUTCOME_EVENTS,
    SCHEDULE_OUTCOME_EVENTS,
} from "@engravida/lib/ads/adEventRules";

export type DerivedAdEvent = {
    type: "lead" | "schedule";
    meta_event_name: "CompleteRegistration" | "Schedule";
    google_conversion_name: "qualified_lead" | "book_appointment";
    occurred_at: string;
    confidence: number;
};

export function deriveAdEventsFromAnalysis(
    analysis: ConversationAnalysis
): DerivedAdEvent[] {
    if (isBadLead(analysis)) {
        return [];
    }

    const events: DerivedAdEvent[] = [];

    if (isQualifiedLead(analysis)) {
        events.push({
            type: "lead",
            meta_event_name: "CompleteRegistration",
            google_conversion_name: "qualified_lead",
            occurred_at:
                getEventTime(analysis, QUALIFIED_LEAD_OUTCOME_EVENTS) ??
                analysis.started_at,
            confidence:
                getEventConfidence(analysis, QUALIFIED_LEAD_OUTCOME_EVENTS) ??
                0.9,
        });
    }

    if (isScheduled(analysis)) {
        events.push({
            type: "schedule",
            meta_event_name: "Schedule",
            google_conversion_name: "book_appointment",
            occurred_at:
                getEventTime(analysis, SCHEDULE_OUTCOME_EVENTS) ??
                analysis.ended_at,
            confidence:
                getEventConfidence(analysis, SCHEDULE_OUTCOME_EVENTS) ??
                0.95,
        });
    }

    return events;
}

function isBadLead(analysis: ConversationAnalysis): boolean {
    return (
        analysis.customer_final_state === "not_qualified" ||
        analysis.resolution.reasoning_category === "customer_not_qualified"
    );
}

function isQualifiedLead(analysis: ConversationAnalysis): boolean {
    if (analysis.dropoff.happened) {
        return false;
    }

    if (analysis.resolution.reasoning_category === "customer_abandoned") {
        return false;
    }

    return hasAnyEvent(analysis, QUALIFIED_LEAD_OUTCOME_EVENTS);
}

function isScheduled(analysis: ConversationAnalysis): boolean {
    return (
        analysis.customer_final_state === "scheduled" ||
        analysis.customer_final_state === "rescheduled" ||
        analysis.resolution.reasoning_category === "customer_scheduled" ||
        hasAnyEvent(analysis, SCHEDULE_OUTCOME_EVENTS)
    );
}

function hasAnyEvent(
    analysis: ConversationAnalysis,
    eventTypes: OutcomeEventType[]
): boolean {
    return analysis.outcome_events.some((event) =>
        eventTypes.includes(event.type)
    );
}

function getEventTime(
    analysis: ConversationAnalysis,
    eventTypes: OutcomeEventType[]
): string | null {
    return (
        analysis.outcome_events.find((event) =>
            eventTypes.includes(event.type)
        )?.occurred_at ?? null
    );
}

function getEventConfidence(
    analysis: ConversationAnalysis,
    eventTypes: OutcomeEventType[]
): number | null {
    return (
        analysis.outcome_events.find((event) =>
            eventTypes.includes(event.type)
        )?.confidence ?? null
    );
}