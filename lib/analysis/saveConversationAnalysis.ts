// lib/analysis/saveConversationAnalysis.ts
import { supabase } from "@/lib";
import { deriveInboxClosingTag } from "@/lib/analysis/deriveInboxClosingTag";
import type { ConversationAnalysis } from "@/types";

export async function saveConversationAnalysis(analysis: ConversationAnalysis) {
    const { data, error } = await supabase
        .from("conversation_analysis")
        .upsert(
            {
                conversation_id: analysis.conversation_id,
                client_id: analysis.client_id,
                instagram_user_id: analysis.instagram_user_id,
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
                pattern_signals: analysis.pattern_signals ?? null,
                objections: analysis.objections,
                dropoff_happened: analysis.dropoff.happened,
                dropoff_moment: analysis.dropoff.moment,
                dropoff_likely_reason: analysis.dropoff.likely_reason,
                dropoff_confidence: analysis.dropoff.confidence,
                dropoff_evidence_message_ids: analysis.dropoff.evidence_message_ids,
                customer_sentiment: analysis.sentiment.customer_sentiment,
                satisfaction_score: analysis.sentiment.satisfaction_score,
                sentiment_confidence: analysis.sentiment.confidence,
                sentiment_evidence_message_ids: analysis.sentiment.evidence_message_ids,
                clarity_score: analysis.attendant_quality.clarity_score,
                empathy_score: analysis.attendant_quality.empathy_score,
                proactivity_score: analysis.attendant_quality.proactivity_score,
                objection_handling_score: analysis.attendant_quality.objection_handling_score,
                response_speed_score: analysis.attendant_quality.response_speed_score,
                attendant_quality_score: analysis.attendant_quality.overall_score,
                attendant_quality_evidence_message_ids: analysis.attendant_quality.evidence_message_ids,
                first_human_response_time_seconds: analysis.response_timing.first_human_response_time_seconds,
                average_human_response_time_seconds: analysis.response_timing.average_human_response_time_seconds,
                longest_human_delay_seconds: analysis.response_timing.longest_human_delay_seconds,
                resolution_result: analysis.resolution.resolved === true ? "resolved" : analysis.resolution.resolved === false ? "not_resolved" : "partial",
                resolution_score: analysis.resolution.resolution_score,
                resolution_reasoning_category: analysis.resolution.reasoning_category,
                resolution_evidence_message_ids: analysis.resolution.evidence_message_ids,
                short_label: analysis.short_label,
                notable: analysis.notable,
                notable_reason: analysis.notable_reason,
                analysis_provider: analysis.analysis_provider,
                analysis_model: analysis.analysis_model,
                analysis_prompt_version: analysis.analysis_prompt_version,
                analysis_message_count: analysis.analysis_message_count,
                analysis_completed_at: new Date().toISOString(),
            },
            { onConflict: "conversation_id" },
        )
        .select("id")
        .single();

    if (error) throw new Error(`Failed to save conversation analysis: ${error.message}`);

    // Tag only a finalized Inbox thread, using the existing client closing-tag mechanism.
    // Tagging failures must not discard an otherwise successfully saved AI analysis.
    try {
        await syncInboxClosingTag(analysis);
    } catch (tagError) {
        console.error("[saveConversationAnalysis] closing-tag sync failed", {
            conversation_id: analysis.conversation_id,
            error: tagError instanceof Error ? tagError.message : String(tagError),
        });
    }

    return data.id as string;
}

function nullableUuid(value: string | null | undefined) {
    if (!value) return null;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}


async function syncInboxClosingTag(analysis: ConversationAnalysis) {
    const tag = deriveInboxClosingTag(analysis);
    if (!tag || !analysis.client_id || !analysis.ended_at) return;

    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("client_id, thread_id")
        .eq("id", analysis.conversation_id)
        .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation?.thread_id || conversation.client_id !== analysis.client_id) return;

    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select("status")
        .eq("id", conversation.thread_id)
        .maybeSingle();
    if (threadError) throw threadError;
    if (thread?.status !== "closed") return;

    // Verify that the model's evidence IDs belong to this completed conversation.
    if (analysis.closing_tag) {
        const ids = [...new Set(analysis.closing_tag.evidence_message_ids)];
        const { data: evidence, error: evidenceError } = await supabase
            .from("messages")
            .select("id")
            .eq("conversation_id", analysis.conversation_id)
            .in("id", ids)
            .limit(ids.length);
        if (evidenceError) throw evidenceError;
        if (evidence?.length !== ids.length) return;
    }

    // The existing RPC preserves newer closing tags (including human/sheet tags)
    // and makes repeat analysis saves idempotent.
    const { error } = await supabase.rpc("sync_client_last_closing_tags", {
        p_items: [{
            client_id: analysis.client_id,
            closing_tag: tag,
            closing_tag_at: analysis.ended_at,
        }],
    });
    if (error) throw error;
}
