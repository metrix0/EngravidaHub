// apps/insights/src/app/api/dashboard/eventos/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@engravida/lib";
import {
    AD_EVENT_STATUS_LABELS,
    AD_EVENT_STATUSES,
    AD_EVENT_TYPE_LABELS,
    AD_EVENT_TYPES,
    AD_PLATFORMS,
    type AdEventStatus,
    type AdEventType,
    type AdPlatform,
} from "@/types/ad-event";

type DateRange = {
    start: string;
    end: string;
};

type GetEventsInput = {
    dateRange: DateRange;
    unitIds: string[];
    serviceIds: string[];
    platforms: AdPlatform[];
    eventTypes: AdEventType[];
    statuses: AdEventStatus[];
    tunnelValues: string[];
    originValues: string[];
};

type SupabaseRelation<T> = T | T[] | null;

type ClientRow = {
    id: string;
    name: string | null;
    phone: string | null;
};

type ConversationRow = {
    id: string;
    unit_id: string | null;
    service_id: string | null;
    tunnel: string | null;
    origin: string | null;
    clients: SupabaseRelation<ClientRow>;
};

type AdEventRow = {
    id: string;
    conversation_id: string | null;
    schedule_id: string | null;
    event_type: AdEventType;
    platform: AdPlatform;
    status: AdEventStatus;
    event_date: string;
    parameters: string[] | null;
    conversations: SupabaseRelation<ConversationRow>;
};

type ScheduleRow = {
    id: string;
    client_id: string | null;
    patient_name: string | null;
    phone: string | null;
};

type EnrichedAdEventRow = AdEventRow & {
    schedule_patient_name: string | null;
    schedule_phone: string | null;
    schedule_client_name: string | null;
    schedule_client_phone: string | null;
};

type GroupedRecentEvent = {
    id: string;
    conversation_id: string | null;
    schedule_id: string | null;
    event_type: AdEventType;
    status: AdEventStatus;
    event_date: string;
    platform: string;
    platforms: AdPlatform[];
    parameters: string[];
    client_name: string;
    phone: string;
};

const NULL_FILTER_VALUE = "__NULL__";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    const days = Number(searchParams.get("days") ?? 7);

    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");

    const unitIds = splitParam(searchParams.get("unit_ids"));
    const serviceIds = splitParam(searchParams.get("service_ids"));
    const tunnelValues = splitParam(searchParams.get("tunnels"));
    const originValues = splitParam(searchParams.get("origins"));

    const platforms = splitParam(searchParams.get("platforms")) as AdPlatform[];
    const eventTypes = splitParam(searchParams.get("event_types")) as AdEventType[];
    const statuses = splitParam(searchParams.get("statuses")) as AdEventStatus[];

    const page = Number(searchParams.get("page") ?? 1);
    const pageSize = Number(searchParams.get("page_size") ?? 50);

    const currentRange = getDateRange({
        days,
        startDate,
        endDate,
    });

    const previousRange = getPreviousDateRange(currentRange);

    const currentEvents = await getEvents({
        dateRange: currentRange,
        unitIds,
        serviceIds,
        platforms,
        eventTypes,
        statuses,
        tunnelValues,
        originValues,
    });

    const previousEvents = await getEvents({
        dateRange: previousRange,
        unitIds,
        serviceIds,
        platforms,
        eventTypes,
        statuses,
        tunnelValues,
        originValues,
    });

    const groupedRecentEvents = groupRecentEvents(currentEvents);

    const recentStart = (page - 1) * pageSize;
    const recentEnd = recentStart + pageSize;
    const recentEvents = groupedRecentEvents.slice(recentStart, recentEnd);

    return NextResponse.json({
        kpis: buildKpis(currentEvents),
        previous_kpis: buildKpis(previousEvents),

        by_platform: buildByPlatform(currentEvents),
        previous_by_platform: buildByPlatform(previousEvents),

        by_type: buildByType(currentEvents),
        previous_by_type: buildByType(previousEvents),

        by_status: buildByStatus(currentEvents),

        daily: buildDailyEvents(currentEvents, currentRange.start, currentRange.end),

        recent: recentEvents.map((event) => ({
            id: event.id,
            conversation_id: event.conversation_id,
            schedule_id: event.schedule_id,
            date: event.event_date,
            client_name: event.client_name,
            phone: event.phone,
            event_type: event.event_type,
            platform: event.platform,
            platforms: event.platforms,
            status: event.status,
            parameters: event.parameters,
        })),

        recent_total: groupedRecentEvents.length,
        page,
        page_size: pageSize,
    });
}

async function getEvents({
                             dateRange,
                             unitIds,
                             serviceIds,
                             platforms,
                             eventTypes,
                             statuses,
                             tunnelValues,
                             originValues,
                         }: GetEventsInput) {
    let query = supabase
        .from("ad_events")
        .select(
            `
            id,
            conversation_id,
            schedule_id,
            event_type,
            platform,
            status,
            event_date,
            parameters,
            conversations (
                id,
                unit_id,
                service_id,
                tunnel,
                origin,
                clients (
                    id,
                    name,
                    phone
                )
            )
        `
        )
        .gte("event_date", dateRange.start)
        .lte("event_date", dateRange.end)
        .order("event_date", { ascending: false });

    if (platforms.length > 0) {
        query = query.in("platform", platforms);
    }

    if (eventTypes.length > 0) {
        query = query.in("event_type", eventTypes);
    }

    if (statuses.length > 0) {
        query = query.in("status", statuses);
    }

    if (unitIds.length > 0) {
        query = query.in("conversations.unit_id", unitIds);
    }

    if (serviceIds.length > 0) {
        query = query.in("conversations.service_id", serviceIds);
    }

    const { data, error } = await query;

    if (error) {
        throw new Error(error.message);
    }

    const events = (data ?? []) as AdEventRow[];

    const enrichedEvents = await enrichEventsWithScheduleClients(events);

    return filterByTunnelAndOrigin(enrichedEvents, {
        tunnelValues,
        originValues,
    });
}

function filterByTunnelAndOrigin<T extends { conversations: SupabaseRelation<ConversationRow> }>(
    events: T[],
    {
        tunnelValues,
        originValues,
    }: {
        tunnelValues: string[];
        originValues: string[];
    }
) {
    return events.filter((event) => {
        const conversation = toOne(event.conversations);

        const tunnel = emptyToNull(conversation?.tunnel);
        const origin = emptyToNull(conversation?.origin);

        const matchesTunnel =
            tunnelValues.length === 0 ||
            tunnelValues.includes(tunnel ?? NULL_FILTER_VALUE);

        const matchesOrigin =
            originValues.length === 0 ||
            originValues.includes(origin ?? NULL_FILTER_VALUE);

        return matchesTunnel && matchesOrigin;
    });
}

function groupRecentEvents(events: EnrichedAdEventRow[]) {
    const grouped = new Map<string, GroupedRecentEvent>();

    for (const event of events) {
        const key = event.conversation_id
            ? [
                event.conversation_id,
                event.event_type,
                event.status,
                event.event_date,
            ].join("|")
            : event.id;

        const eventParameters = Array.isArray(event.parameters)
            ? event.parameters
            : [];

        const existing = grouped.get(key);

        if (!existing) {
            grouped.set(key, {
                id: event.id,
                conversation_id: event.conversation_id,
                schedule_id: event.schedule_id,
                event_type: event.event_type,
                status: event.status,
                event_date: event.event_date,
                platform: event.platform,
                platforms: [event.platform],
                parameters: eventParameters,
                client_name: resolveClientName(event),
                phone: resolveClientPhone(event),
            });

            continue;
        }

        if (!existing.platforms.includes(event.platform)) {
            existing.platforms.push(event.platform);
        }

        existing.platform = existing.platforms.join(" + ");
        existing.parameters = uniqueStrings([
            ...existing.parameters,
            ...eventParameters,
        ]);
    }

    return Array.from(grouped.values()).sort(
        (a, b) =>
            new Date(b.event_date).getTime() -
            new Date(a.event_date).getTime()
    );
}

async function enrichEventsWithScheduleClients(events: AdEventRow[]) {
    const scheduleIds = uniqueStrings(
        events
            .map((event) => event.schedule_id)
            .filter((value): value is string => Boolean(value))
    );

    if (scheduleIds.length === 0) {
        return events.map((event) => ({
            ...event,
            schedule_patient_name: null,
            schedule_phone: null,
            schedule_client_name: null,
            schedule_client_phone: null,
        }));
    }

    const { data: schedulesData, error: schedulesError } = await supabase
        .from("schedules")
        .select("id, client_id, patient_name, phone")
        .in("id", scheduleIds);

    if (schedulesError) {
        throw new Error(schedulesError.message);
    }

    const schedules = (schedulesData ?? []) as ScheduleRow[];

    const clientIds = uniqueStrings(
        schedules
            .map((schedule) => schedule.client_id)
            .filter((value): value is string => Boolean(value))
    );

    const { data: clientsData, error: clientsError } =
        clientIds.length > 0
            ? await supabase
                .from("clients")
                .select("id, name, phone")
                .in("id", clientIds)
            : { data: [] as ClientRow[], error: null };

    if (clientsError) {
        throw new Error(clientsError.message);
    }

    const clients = (clientsData ?? []) as ClientRow[];

    const schedulesById = new Map(
        schedules.map((schedule) => [schedule.id, schedule])
    );

    const clientsById = new Map(
        clients.map((client) => [client.id, client])
    );

    return events.map((event) => {
        const schedule = event.schedule_id
            ? schedulesById.get(event.schedule_id)
            : null;

        const client = schedule?.client_id
            ? clientsById.get(schedule.client_id)
            : null;

        return {
            ...event,
            schedule_patient_name: cleanDisplayText(schedule?.patient_name),
            schedule_phone: cleanDisplayText(schedule?.phone),
            schedule_client_name: cleanDisplayText(client?.name),
            schedule_client_phone: cleanDisplayText(client?.phone),
        };
    });
}

function resolveClientName(event: EnrichedAdEventRow) {
    const conversation = toOne(event.conversations);
    const conversationClient = toOne(conversation?.clients);

    return (
        cleanDisplayText(conversationClient?.name) ??
        event.schedule_client_name ??
        event.schedule_patient_name ??
        "Nome não encontrado"
    );
}

function resolveClientPhone(event: EnrichedAdEventRow) {
    const conversation = toOne(event.conversations);
    const conversationClient = toOne(conversation?.clients);

    return (
        cleanDisplayText(conversationClient?.phone) ??
        event.schedule_client_phone ??
        event.schedule_phone ??
        ""
    );
}

function buildKpis(events: EnrichedAdEventRow[]) {
    const totalEvents = events.length;
    const sentEvents = events.filter((event) => event.status === "sent").length;
    const failedEvents = events.filter((event) => event.status === "failed").length;

    const metaEvents = events.filter((event) => event.platform === "Meta Ads");
    const googleEvents = events.filter((event) => event.platform === "Google Ads");

    const fbclidEvents = metaEvents.filter((event) =>
        hasParameter(event, "client_ip_address")
    ).length;

    const gclidEvents = googleEvents.filter((event) =>
        hasParameter(event, "gclid")
    ).length;

    return {
        total_events: totalEvents,
        sent_events: sentEvents,
        failed_events: failedEvents,

        fbclid_events: fbclidEvents,
        gclid_events: gclidEvents,

        fbclid_rate: percentage(fbclidEvents, metaEvents.length),
        gclid_rate: percentage(gclidEvents, googleEvents.length),
    };
}

function buildByPlatform(events: EnrichedAdEventRow[]) {
    const totalEvents = events.length;

    return AD_PLATFORMS.map((platform) => {
        const count = events.filter((event) => event.platform === platform).length;

        return {
            platform,
            count,
            percentage: percentage(count, totalEvents),
        };
    });
}

function buildByType(events: EnrichedAdEventRow[]) {
    const totalEvents = events.length;

    return AD_EVENT_TYPES.map((eventType) => {
        const count = events.filter(
            (event) => event.event_type === eventType
        ).length;

        return {
            event_type: eventType,
            label: AD_EVENT_TYPE_LABELS[eventType],
            count,
            percentage: percentage(count, totalEvents),
        };
    });
}

function buildByStatus(events: EnrichedAdEventRow[]) {
    const totalEvents = events.length;

    return AD_EVENT_STATUSES.map((status) => {
        const count = events.filter((event) => event.status === status).length;

        return {
            status,
            label: AD_EVENT_STATUS_LABELS[status],
            count,
            percentage: percentage(count, totalEvents),
        };
    });
}

function buildDailyEvents(
    events: EnrichedAdEventRow[],
    startValue: string,
    endValue: string
) {
    const start = new Date(startValue);
    const end = new Date(endValue);

    const days: Record<string, string | number>[] = [];

    const cursor = new Date(start);

    while (cursor <= end) {
        const dateKey = cursor.toISOString().slice(0, 10);

        const item: Record<string, string | number> = {
            date: formatShortDate(cursor),
        };

        for (const platform of AD_PLATFORMS) {
            for (const eventType of AD_EVENT_TYPES) {
                const key = getDailyKey(platform, eventType);

                item[key] = events.filter((event) => {
                    const eventDate = new Date(event.event_date)
                        .toISOString()
                        .slice(0, 10);

                    return (
                        eventDate === dateKey &&
                        event.platform === platform &&
                        event.event_type === eventType
                    );
                }).length;
            }
        }

        days.push(item);

        cursor.setDate(cursor.getDate() + 1);
    }

    return days;
}

function hasParameter(event: EnrichedAdEventRow, parameter: string) {
    if (!Array.isArray(event.parameters)) return false;

    return event.parameters.includes(parameter);
}

function uniqueStrings(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
}

function splitParam(value: string | null) {
    if (!value) return [];

    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function getDateRange({
                          days,
                          startDate,
                          endDate,
                      }: {
    days: number;
    startDate: string | null;
    endDate: string | null;
}): DateRange {
    if (startDate) {
        return {
            start: new Date(`${startDate}T00:00:00.000Z`).toISOString(),
            end: new Date(`${endDate ?? startDate}T23:59:59.999Z`).toISOString(),
        };
    }

    const end = new Date();

    const start = new Date();
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);

    return {
        start: start.toISOString(),
        end: end.toISOString(),
    };
}

function getPreviousDateRange(currentRange: DateRange): DateRange {
    const currentStart = new Date(currentRange.start);
    const currentEnd = new Date(currentRange.end);

    const durationMs = currentEnd.getTime() - currentStart.getTime();

    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - durationMs);

    return {
        start: previousStart.toISOString(),
        end: previousEnd.toISOString(),
    };
}

function percentage(value: number, total: number) {
    if (total === 0) return 0;

    return Math.round((value / total) * 1000) / 10;
}

function emptyToNull(value: unknown) {
    if (value === null || value === undefined) return null;

    const trimmed = String(value).trim();

    return trimmed ? trimmed : null;
}

function cleanDisplayText(value: unknown) {
    if (value === null || value === undefined) return null;

    const cleaned = String(value).trim().replace(/\s+/g, " ");

    return cleaned || null;
}

function toOne<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }

    return value ?? null;
}

function getDailyKey(platform: string, eventType: string) {
    return `${slug(platform)}_${eventType}`;
}

function slug(value: string) {
    return value
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
}

function formatShortDate(date: Date) {
    return date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
    });
}