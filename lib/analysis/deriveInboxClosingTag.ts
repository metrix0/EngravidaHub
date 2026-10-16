// Only existing client closing-tag labels, never free-form AI text.
import type { ConversationAnalysis } from "@/types";

const TAGS = {
    scheduled: "Agendamento de 1ª avaliação",
    rescheduled: "Reagendamento de 1ª avaliação",
    confirmed: "Confirmação de 1ª avaliação",
    noSchedule: "Não agendou 1ª Avaliação",
    noResponse: "Sem retorno da paciente",
    questions: "Dúvidas gerais",
    guidance: "Orientações",
} as const;

type ClosingTagEvidence = Pick<
    ConversationAnalysis,
    "conversation_goal" | "goal_status" | "customer_final_state" |
    "outcome_events" | "dropoff" | "resolution"
>;

export function deriveInboxClosingTag(analysis: ClosingTagEvidence): typeof TAGS[keyof typeof TAGS] | null {
    const hasEvidence = (type: ConversationAnalysis["outcome_events"][number]["type"]) =>
        analysis.outcome_events.some((event) =>
            event.type === type &&
            event.confidence >= 0.8 &&
            event.evidence_message_ids.length > 0
        );

    if (
        analysis.conversation_goal === "reschedule_consultation" &&
        analysis.goal_status === "achieved" &&
        (analysis.customer_final_state === "rescheduled" ||
            analysis.customer_final_state === "scheduled") &&
        (hasEvidence("appointment_rescheduled") || hasEvidence("appointment_scheduled"))
    ) return TAGS.rescheduled;

    if (
        analysis.conversation_goal === "schedule_consultation" &&
        analysis.goal_status === "achieved" &&
        analysis.customer_final_state === "scheduled" &&
        hasEvidence("appointment_scheduled")
    ) return TAGS.scheduled;

    if (
        analysis.conversation_goal === "confirm_attendance" &&
        analysis.goal_status === "achieved" &&
        analysis.customer_final_state === "confirmed_attendance" &&
        hasEvidence("attendance_confirmed")
    ) return TAGS.confirmed;

    if (
        analysis.customer_final_state === "stopped_responding" &&
        analysis.goal_status !== "achieved" &&
        analysis.dropoff.happened &&
        analysis.dropoff.confidence >= 0.8 &&
        analysis.dropoff.evidence_message_ids.length > 0 &&
        analysis.resolution.reasoning_category === "customer_abandoned"
    ) return TAGS.noResponse;

    if (
        analysis.conversation_goal === "schedule_consultation" &&
        analysis.goal_status === "not_achieved" &&
        ["asked_to_think", "objected_to_price", "received_information", "not_qualified"]
            .includes(analysis.customer_final_state) &&
        !hasEvidence("appointment_scheduled") &&
        analysis.resolution.reasoning_category !== "customer_scheduled"
    ) return TAGS.noSchedule;

    if (
        analysis.conversation_goal === "answer_information" &&
        analysis.goal_status === "achieved" &&
        analysis.customer_final_state === "received_information" &&
        hasEvidence("information_answered")
    ) return TAGS.questions;

    if (
        analysis.conversation_goal === "explain_treatment" &&
        analysis.goal_status === "achieved" &&
        analysis.customer_final_state === "received_information" &&
        hasEvidence("information_answered")
    ) return TAGS.guidance;

    return null;
}
