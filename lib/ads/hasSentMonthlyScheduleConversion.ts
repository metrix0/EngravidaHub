// lib/ads/hasSentMonthlyScheduleConversion.ts
import { supabase } from "@/lib";

export type ScheduleConversionPlatform = "Meta Ads" | "Google Ads";

export async function hasSentMonthlyScheduleConversion({
    clientId,
    platform,
}: {
    clientId: string;
    platform: ScheduleConversionPlatform;
}) {
    const { start, end } = currentSaoPauloMonthBounds();
    const { data, error } = await supabase
        .from("ad_events")
        .select("id, schedules!inner(client_id)")
        .eq("event_type", "schedule")
        .eq("platform", platform)
        .eq("status", "sent")
        .gte("event_date", start)
        .lt("event_date", end)
        .eq("schedules.client_id", clientId)
        .limit(1);

    if (error) throw error;
    return (data?.length ?? 0) > 0;
}

function currentSaoPauloMonthBounds() {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const nextMonth = new Date(Date.UTC(year, month, 1));

    return {
        start: `${year}-${String(month).padStart(2, "0")}-01T00:00:00-03:00`,
        end: `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00-03:00`,
    };
}
