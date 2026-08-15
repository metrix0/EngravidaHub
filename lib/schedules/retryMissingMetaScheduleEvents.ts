// lib/schedules/retryMissingMetaScheduleEvents.ts
import { supabase } from "@/lib";
import type { DerivedAdEvent } from "@/lib/ads/deriveAdEventsFromAnalysis";
import { sendMetaEvents } from "@/lib/ads/meta/sendMetaEvents";
import {
    normalizeScheduleStatus,
    scheduleIsInactive,
} from "@/lib/schedules/status";

const CLINISYS_SCHEDULE_SOURCES = ["bigquery", "clinisys"];
const META_RETRY_WINDOW_DAYS = 6;
const SUPABASE_IN_FILTER_BATCH_SIZE = 100;

type RetrySchedule = {
    id: string;
    client_id: string | null;
    created_in_source_at: string | null;
    phone: string | null;
    status: string | null;
};

type RetryClient = {
    id: string;
    phone: string | null;
    email: string | null;
};

export async function retryMissingMetaScheduleEvents() {
    const retrySince = getSaoPauloDateDaysAgo(META_RETRY_WINDOW_DAYS);

    const { data: scheduleRows, error: schedulesError } = await supabase
        .from("schedules")
        .select("id, client_id, created_in_source_at, phone, status")
        .in("source", CLINISYS_SCHEDULE_SOURCES)
        .gte("created_in_source_at", retrySince)
        .limit(5_000);

    if (schedulesError) throw schedulesError;

    const eligibleSchedules = (scheduleRows ?? [])
        .map((row) => row as RetrySchedule)
        .filter(
            (schedule) =>
                !scheduleIsInactive(normalizeScheduleStatus(schedule.status)),
        );

    if (eligibleSchedules.length === 0) {
        console.log("[retryMissingMetaScheduleEvents] no eligible schedules", {
            retry_since: retrySince,
        });
        return;
    }

    const sentScheduleIds = new Set<string>();

    for (const scheduleIds of chunk(
        eligibleSchedules.map((schedule) => schedule.id),
        SUPABASE_IN_FILTER_BATCH_SIZE,
    )) {
        const { data, error } = await supabase
            .from("ad_events")
            .select("schedule_id")
            .eq("event_type", "schedule")
            .eq("platform", "Meta Ads")
            .eq("status", "sent")
            .in("schedule_id", scheduleIds);

        if (error) throw error;

        for (const row of data ?? []) {
            if (row.schedule_id) sentScheduleIds.add(row.schedule_id);
        }
    }

    const retrySchedules = eligibleSchedules.filter(
        (schedule) => !sentScheduleIds.has(schedule.id),
    );

    if (retrySchedules.length === 0) {
        console.log("[retryMissingMetaScheduleEvents] coverage complete", {
            retry_since: retrySince,
            eligible: eligibleSchedules.length,
            confirmed_sent: sentScheduleIds.size,
        });
        return;
    }

    const clientsById = new Map<string, RetryClient>();
    const clientIds = [
        ...new Set(
            retrySchedules
                .map((schedule) => schedule.client_id)
                .filter((value): value is string => Boolean(value)),
        ),
    ];

    for (const ids of chunk(clientIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
        const { data, error } = await supabase
            .from("clients")
            .select("id, phone, email")
            .in("id", ids);

        if (error) throw error;

        for (const row of data ?? []) {
            clientsById.set(row.id, row as RetryClient);
        }
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const schedule of retrySchedules) {
        if (!schedule.client_id) {
            skipped += 1;
            continue;
        }

        const client = clientsById.get(schedule.client_id);
        if (!client) {
            skipped += 1;
            continue;
        }

        const event: DerivedAdEvent = {
            type: "schedule",
            meta_event_name: "Schedule",
            google_conversion_name: "book_appointment",
            occurred_at: getScheduleEventTime(schedule.created_in_source_at),
            confidence: 0.95,
        };

        const result = await sendMetaEvents({
            events: [event],
            phone: client.phone ?? schedule.phone,
            email: client.email,
            schedule_id: schedule.id,
            client_id: client.id,
        });

        if (isSuccessfulDelivery(result)) {
            sent += 1;
        } else if (isSkippedDelivery(result)) {
            skipped += 1;
        } else {
            failed += 1;
        }
    }

    console.log("[retryMissingMetaScheduleEvents] completed", {
        retry_since: retrySince,
        eligible: eligibleSchedules.length,
        already_sent: sentScheduleIds.size,
        retry_candidates: retrySchedules.length,
        sent,
        failed,
        skipped,
    });
}

function getScheduleEventTime(date: string | null) {
    const today = getSaoPauloDateDaysAgo(0);
    if (!date || date === today) return new Date().toISOString();
    return new Date(`${date}T12:00:00-03:00`).toISOString();
}

function getSaoPauloDateDaysAgo(daysAgo: number) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());

    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    const date = new Date(Date.UTC(year, month - 1, day - daysAgo));

    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0"),
    ].join("-");
}

function isSuccessfulDelivery(value: unknown) {
    if (!value || typeof value !== "object") return false;
    const result = value as { ok?: unknown; skipped?: unknown };
    return result.ok === true && result.skipped !== true;
}

function isSkippedDelivery(value: unknown) {
    if (!value || typeof value !== "object") return false;
    const result = value as { skipped?: unknown };
    return result.skipped === true;
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}
