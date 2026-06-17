// lib/ai/conversationAnalysisSchema.ts
import { z } from "zod";

export const conversationAnalysisSchema = z.object({
    conversation_id: z.string(),
    client_id: z.string(),

    started_at: z.string(),
    ended_at: z.string(),

    attendant_id: z.string().nullable(),
    unit_id: z.string().nullable(),
    service_id: z.string().nullable(),

    customer_start_intent: z.enum([
        "answer_information",
        "schedule_consultation",
        "reschedule_consultation",
        "confirm_attendance",
        "recover_inactive_lead",
        "explain_treatment",
        "handle_price_objection",
        "collect_documents_or_exams",
        "post_consultation_followup",
        "asked_to_think",
        "other",
    ]),

    conversation_goal: z.enum([
        "answer_information",
        "schedule_consultation",
        "reschedule_consultation",
        "confirm_attendance",
        "recover_inactive_lead",
        "explain_treatment",
        "handle_price_objection",
        "collect_documents_or_exams",
        "post_consultation_followup",
        "other",
    ]),

    goal_status: z.enum([
        "achieved",
        "partially_achieved",
        "not_achieved",
        "unclear",
    ]),

    customer_final_state: z.enum([
        "scheduled",
        "rescheduled",
        "confirmed_attendance",
        "received_information",
        "asked_to_think",
        "objected_to_price",
        "stopped_responding",
        "redirected",
        "not_qualified",
        "unclear",
    ]),

    outcome_events: z.array(
        z.object({
            type: z.enum([
                "information_requested",
                "information_answered",
                "consultation_offered",
                "price_presented",
                "objection_raised",
                "appointment_scheduled",
                "appointment_rescheduled",
                "attendance_confirmed",
                "customer_stopped_responding",
                "attendant_followed_up",
                "customer_returned",
                "handoff_to_human",
                "handoff_to_unit",
            ]),
            occurred_at: z.string().nullable(),
            confidence: z.number().min(0).max(1),
        })
    ),

    dropoff: z.object({
        happened: z.boolean(),
        moment: z
            .enum([
                "after_price",
                "after_consultation_online",
                "after_unit_presented",
                "after_schedule_options",
                "after_payment_info",
                "after_medical_question",
                "after_delay",
                "unknown",
            ])
            .nullable(),
        likely_reason: z.string().nullable(),
        confidence: z.number().min(0).max(1),
    }),

    objections: z.array(
        z.object({
            type: z.enum([
                "price",
                "distance",
                "online_consultation",
                "time_availability",
                "trust",
                "medical_uncertainty",
                "partner_or_family",
                "already_treating_elsewhere",
                "other",
            ]),
            severity: z.enum(["low", "medium", "high"]),
            resolved: z.boolean(),
            confidence: z.number().min(0).max(1),
        })
    ),

    sentiment: z.object({
        customer_sentiment: z.enum([
            "positive",
            "neutral",
            "negative",
            "anxious",
            "confused",
            "frustrated",
        ]),
        satisfaction_score: z.number().int().min(0).max(100),
        confidence: z.number().min(0).max(1),
    }),

    attendant_quality: z.object({
        clarity_score: z.number().int().min(0).max(100),
        empathy_score: z.number().int().min(0).max(100),
        proactivity_score: z.number().int().min(0).max(100),
        objection_handling_score: z.number().int().min(0).max(100),
        response_speed_score: z.number().int().min(0).max(100),
        overall_score: z.number().int().min(0).max(100),
    }),

    response_timing: z.object({
        first_human_response_time_seconds: z.number().int().nullable(),
        average_human_response_time_seconds: z.number().int().nullable(),
        longest_human_delay_seconds: z.number().int().nullable(),
    }),

    resolution: z.object({
        resolved: z.enum(["true", "false", "partial"]),
        resolution_score: z.number().int().min(0).max(100),
        reasoning_category: z.enum([
            "customer_got_answer",
            "customer_scheduled",
            "customer_confirmed",
            "customer_not_qualified",
            "customer_abandoned",
            "attendant_failed_to_answer",
            "unclear",
        ]),
    }),

    short_label: z.string(),
    notable: z.boolean(),
    notable_reason: z.string().nullable(),
});

