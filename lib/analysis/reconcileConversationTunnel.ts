// lib/analysis/reconcileConversationTunnel.ts
import {
    inferTunnelFromAnalysis,
    inferTunnelFromReferrals,
    inferTunnelFromTracking,
    isMissingTunnel,
    type TunnelReferral,
} from "@/lib/analysis/tunnelAttribution";
import { supabase } from "@/lib/supabase/client";

type AnalysisEvidence = { tunnel_attribution?: unknown; pattern_signals?: unknown };

export async function reconcileConversationTunnel(conversationId: string, analysis?: AnalysisEvidence) {
    const { data: conversation, error } = await supabase.from("conversations")
        .select("tunnel,client_id,instagram_user_id,started_at,ended_at,last_message_at")
        .eq("id", conversationId).maybeSingle();
    if (error) throw error;
    if (!conversation) return;

    const { client_id, instagram_user_id } = conversation;
    if (!isMissingTunnel(conversation.tunnel)) {
        // The conversation's own tunnel can also fill an empty linked profile.
        if (client_id || instagram_user_id) await saveTunnel(conversationId, conversation.tunnel);
        return;
    }

    const { data: referrals, error: referralError } = await supabase.from("conversation_ad_attributions")
        .select("campaign_name,ad_set_name,ad_name,referral_ad_title,messages!inner(text)")
        .eq("messages.conversation_id", conversationId)
        .eq("messages.sender_type", "client")
        .order("referral_received_at", { ascending: false })
        .order("id", { ascending: false })
        .returns<TunnelReferral[]>();
    if (referralError) throw referralError;

    const tracked = inferTunnelFromReferrals(referrals ?? []);
    if (tracked) {
        await saveTunnel(conversationId, tracked);
        return;
    }

    const utmTunnel = client_id ? await loadUtmTunnel(client_id,
        conversation.last_message_at ?? conversation.ended_at ?? conversation.started_at) : null;
    if (utmTunnel) {
        await saveTunnel(conversationId, utmTunnel);
        return;
    }

    if (!analysis) {
        const { data, error: analysisError } = await supabase.from("conversation_analysis")
            .select("tunnel_attribution,pattern_signals").eq("conversation_id", conversationId).maybeSingle();
        if (analysisError) throw analysisError;
        analysis = data ?? undefined;
    }
    const inferred = analysis && inferTunnelFromAnalysis(analysis);
    if (inferred) await saveTunnel(conversationId, inferred.tunnel);
}

async function loadUtmTunnel(clientId: string, cutoff: string) {
    const { data, error } = await supabase.from("clients")
        .select("utm_campaign,utm_content,utm_term,tracking_updated_at").eq("id", clientId).maybeSingle();
    if (error) throw error;
    if (!data?.tracking_updated_at || Date.parse(data.tracking_updated_at) > Date.parse(cutoff)) return null;

    const campaign = data.utm_campaign;
    if (/^\d+$/.test(campaign ?? "")) {
        const { data: metrics, error: metricsError } = await supabase.from("ad_daily_metrics")
            .select("campaign_name").eq("campaign_id", campaign!)
            .order("metric_date", { ascending: false }).limit(1).maybeSingle();
        if (metricsError) throw metricsError;
        return inferTunnelFromTracking(metrics?.campaign_name, data.utm_content, data.utm_term);
    }
    return inferTunnelFromTracking(campaign, data.utm_content, data.utm_term);
}

async function saveTunnel(conversationId: string, tunnel: string | null) {
    const { error } = await supabase.rpc("reconcile_conversation_tunnels", {
        p_items: [{ conversation_id: conversationId, tunnel }],
    });
    if (error) throw error;
}
