// types/conversation-analysis.ts
export type ConversationGoal =
    | "answer_information"
    | "schedule_consultation"
    | "reschedule_consultation"
    | "confirm_attendance"
    | "recover_inactive_lead"
    | "explain_treatment"
    | "handle_price_objection"
    | "collect_documents_or_exams"
    | "post_consultation_followup"
    | "other";

export type CustomerStartIntent =
    | "answer_information"
    | "schedule_consultation"
    | "reschedule_consultation"
    | "confirm_attendance"
    | "recover_inactive_lead"
    | "explain_treatment"
    | "handle_price_objection"
    | "collect_documents_or_exams"
    | "post_consultation_followup"
    | "asked_to_think"
    | "other";

export type GoalStatus =
    | "achieved"
    | "partially_achieved"
    | "not_achieved"
    | "unclear";

export type CustomerFinalState =
    | "scheduled"
    | "rescheduled"
    | "confirmed_attendance"
    | "received_information"
    | "asked_to_think"
    | "objected_to_price"
    | "stopped_responding"
    | "redirected"
    | "not_qualified"
    | "unclear";

export type OutcomeEventType =
    | "information_requested"
    | "information_answered"
    | "consultation_offered"
    | "price_presented"
    | "objection_raised"
    | "appointment_scheduled"
    | "appointment_rescheduled"
    | "attendance_confirmed"
    | "customer_stopped_responding"
    | "attendant_followed_up"
    | "customer_returned"
    | "handoff_to_human"
    | "handoff_to_unit";

export type OutcomeEvent = {
    type: OutcomeEventType;
    occurred_at: string | null;
    confidence: number;
};

export type DropoffMoment =
    | "after_price"
    | "after_consultation_online"
    | "after_unit_presented"
    | "after_schedule_options"
    | "after_payment_info"
    | "after_medical_question"
    | "after_delay"
    | "unknown"
    | null;

export type ObjectionType =
    | "price"
    | "distance"
    | "online_consultation"
    | "time_availability"
    | "trust"
    | "medical_uncertainty"
    | "partner_or_family"
    | "already_treating_elsewhere"
    | "other";

export type ObjectionSeverity = "low" | "medium" | "high";

export type CustomerSentiment =
    | "positive"
    | "neutral"
    | "negative"
    | "anxious"
    | "confused"
    | "frustrated";

export type ResolutionReasoningCategory =
    | "customer_got_answer"
    | "customer_scheduled"
    | "customer_confirmed"
    | "customer_not_qualified"
    | "customer_abandoned"
    | "attendant_failed_to_answer"
    | "unclear";


export type ConversationAnalysis = {
    conversation_id: string;
    client_id: string;

    started_at: string;
    ended_at: string;

    attendant_id: string | null;
    unit_id: string | null;
    service_id: string | null;

    customer_start_intent: CustomerStartIntent;

    conversation_goal: ConversationGoal;
    goal_status: GoalStatus;
    customer_final_state: CustomerFinalState;

    outcome_events: OutcomeEvent[];

    dropoff: {
        happened: boolean;
        moment: DropoffMoment;
        likely_reason: string | null;
        confidence: number;
    };

    objections: {
        type: ObjectionType;
        severity: ObjectionSeverity;
        resolved: boolean;
        confidence: number;
    }[];

    sentiment: {
        customer_sentiment: CustomerSentiment;
        satisfaction_score: number;
        confidence: number;
    };

    attendant_quality: {
        clarity_score: number;
        empathy_score: number;
        proactivity_score: number;
        objection_handling_score: number;
        response_speed_score: number;
        overall_score: number;
    };

    response_timing: {
        first_human_response_time_seconds: number | null;
        average_human_response_time_seconds: number | null;
        longest_human_delay_seconds: number | null;
    };

    resolution: {
        resolved: true | false | "partial";
        resolution_score: number;
        reasoning_category: ResolutionReasoningCategory;
    };

    short_label: string;
    notable: boolean;
    notable_reason: string | null;
};

