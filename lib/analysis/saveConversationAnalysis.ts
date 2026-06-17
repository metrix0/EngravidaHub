// lib/analysis/saveConversationAnalysis.ts
import { supabase } from "@/lib";
import type { ConversationAnalysis } from "@/types";

export async function saveConversationAnalysis(analysis: ConversationAnalysis) {
    const { data, error } = await supabase
        .from("conversation_analysis")
        .upsert(
            {
                conversation_id: analysis.conversation_id,
                client_id: analysis.client_id,

                started_at: analysis.started_at,
                ended_at: analysis.ended_at,

                attendant_id: nullableUuid(analysis.attendant_id),
                unit_id: nullableUuid(analysis.unit_id),
                service_id: nullableUuid(analysis.service_id),

                customer_start_intent: analysis.customer_start_intent,
                conversation_goal: analysis.conversation_goal,
                goal_status: analysis.goal_status,
                customer_final_state: analysis.customer_final_state,

                outcome_events: analysis.outcome_events,
                objections: analysis.objections,

                dropoff_happened: analysis.dropoff.happened,
                dropoff_moment: analysis.dropoff.moment,
                dropoff_likely_reason: analysis.dropoff.likely_reason,
                dropoff_confidence: analysis.dropoff.confidence,

                customer_sentiment: analysis.sentiment.customer_sentiment,
                satisfaction_score: analysis.sentiment.satisfaction_score,
                sentiment_confidence: analysis.sentiment.confidence,

                clarity_score: analysis.attendant_quality.clarity_score,
                empathy_score: analysis.attendant_quality.empathy_score,
                proactivity_score: analysis.attendant_quality.proactivity_score,
                objection_handling_score: analysis.attendant_quality.objection_handling_score,
                response_speed_score: analysis.attendant_quality.response_speed_score,
                attendant_quality_score: analysis.attendant_quality.overall_score,

                first_human_response_time_seconds:
                analysis.response_timing.first_human_response_time_seconds,
                average_human_response_time_seconds:
                analysis.response_timing.average_human_response_time_seconds,
                longest_human_delay_seconds:
                analysis.response_timing.longest_human_delay_seconds,

                resolution_result:
                    analysis.resolution.resolved === true
                        ? "resolved"
                        : analysis.resolution.resolved === false
                            ? "not_resolved"
                            : "partial",

                resolution_score: analysis.resolution.resolution_score,
                resolution_reasoning_category: analysis.resolution.reasoning_category,

                short_label: analysis.short_label,
                notable: analysis.notable,
                notable_reason: analysis.notable_reason,
            },
            {
                onConflict: "conversation_id",
            }
        )
        .select("id")
        .single();

    if (error) {
        throw new Error(`Failed to save conversation analysis: ${error.message}`);
    }

    return data.id as string;
}

function nullableUuid(value: string | null | undefined) {
        if (!value) return null;

        const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                value
            );

        return isUuid ? value : null;
}
