import { supabase } from "@/lib";

type SchedulePlatform = "Meta Ads" | "Google Ads";
type DeliveryResult = { ok?: boolean; skipped?: boolean };

const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

// Claim an appointment/platform before the external API call. The database primary key
// serializes webhook, BigQuery, and Meta-retry workers across different instances.
export async function sendScheduleConversionOnce<T extends DeliveryResult>({
    scheduleId,
    platform,
    send,
}: {
    scheduleId: string;
    platform: SchedulePlatform;
    send: () => Promise<T>;
}): Promise<T | { ok: true; skipped: true; reason: string }> {
    const wasSent = await hasSentScheduleEvent(scheduleId, platform);
    if (wasSent) return { ok: true, skipped: true, reason: "already_sent_for_appointment" };

    const now = new Date().toISOString();
    const { data: newClaim, error: claimError } = await supabase
        .from("schedule_conversion_claims")
        .upsert({
            schedule_id: scheduleId,
            platform,
            status: "processing",
            claimed_at: now,
        }, { onConflict: "schedule_id,platform", ignoreDuplicates: true })
        .select("claimed_at")
        .maybeSingle();
    if (claimError) throw claimError;

    let ownedAt = newClaim?.claimed_at ?? null;
    if (!ownedAt) {
        const { data: current, error } = await supabase
            .from("schedule_conversion_claims")
            .select("status,claimed_at")
            .eq("schedule_id", scheduleId)
            .eq("platform", platform)
            .single();
        if (error) throw error;
        if (current.status === "sent") {
            return { ok: true, skipped: true, reason: "already_sent_for_appointment" };
        }
        // Recover a crashed worker only after its claim is older than any normal send.
        if (new Date(current.claimed_at).getTime() > Date.now() - CLAIM_TIMEOUT_MS) {
            return { ok: true, skipped: true, reason: "conversion_in_progress" };
        }
        const { data: recovered, error: recoverError } = await supabase
            .from("schedule_conversion_claims")
            .update({ claimed_at: now })
            .eq("schedule_id", scheduleId)
            .eq("platform", platform)
            .eq("status", "processing")
            .eq("claimed_at", current.claimed_at)
            .select("claimed_at")
            .maybeSingle();
        if (recoverError) throw recoverError;
        if (!recovered) return { ok: true, skipped: true, reason: "conversion_in_progress" };
        ownedAt = recovered.claimed_at;
    }

    let delivered = false;
    try {
        // Covers conversions recorded by an older worker before claims were introduced.
        if (await hasSentScheduleEvent(scheduleId, platform)) {
            delivered = true;
        } else {
            const result = await send();
            delivered = result.ok === true && result.skipped !== true;
            if (!delivered) {
                await releaseClaim(scheduleId, platform, ownedAt);
                return result;
            }
            const { error } = await supabase
                .from("schedule_conversion_claims")
                .update({ status: "sent" })
                .eq("schedule_id", scheduleId)
                .eq("platform", platform)
                .eq("claimed_at", ownedAt);
            if (error) throw error;
            return result;
        }
        const { error } = await supabase
            .from("schedule_conversion_claims")
            .update({ status: "sent" })
            .eq("schedule_id", scheduleId)
            .eq("platform", platform)
            .eq("claimed_at", ownedAt);
        if (error) throw error;
        return { ok: true, skipped: true, reason: "already_sent_for_appointment" };
    } catch (error) {
        // Never release a claim after the provider accepted a conversion.
        if (!delivered) await releaseClaim(scheduleId, platform, ownedAt);
        throw error;
    }
}

async function hasSentScheduleEvent(scheduleId: string, platform: SchedulePlatform) {
    const { data, error } = await supabase.from("ad_events")
        .select("id")
        .eq("schedule_id", scheduleId)
        .eq("platform", platform)
        .eq("event_type", "schedule")
        .eq("status", "sent")
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return Boolean(data);
}

async function releaseClaim(scheduleId: string, platform: SchedulePlatform, claimedAt: string) {
    const { error } = await supabase.from("schedule_conversion_claims")
        .delete()
        .eq("schedule_id", scheduleId)
        .eq("platform", platform)
        .eq("status", "processing")
        .eq("claimed_at", claimedAt);
    if (error) throw error;
}
