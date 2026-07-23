// app/api/funnel/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import {
    getFunnelAttentionLabel,
    isFunnelAttentionState,
    resolveFunnelMilestone,
    type ClinisysJourneyEvent,
} from "@/lib/funnel/clinisysJourney";
import {
    APPOINTMENT_SELECT,
    mapAppointment,
} from "@/lib/scheduling/appointmentServer";
import {
    normalizeScheduleStatus,
    scheduleShowedUp,
} from "@/lib/schedules/status";
import type { CalendarAppointment } from "@/types/scheduling";

type DateRange = {
    start: string;
    end: string;
};

type FunnelClient = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    funnel_stage_id: string | null;
    unit_id: string | null;
    last_interaction_at: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    updated_at: string;
};

const DEFAULT_DAYS = 30;
const IN_FILTER_BATCH_SIZE = 100;
const PAGE_SIZE = 1_000;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const unitIds = parseIds(searchParams.get("unit_ids"));
    const currentRange = getDateRange({
        days: Number(searchParams.get("days") ?? DEFAULT_DAYS),
        startDate: searchParams.get("start_date"),
        endDate: searchParams.get("end_date"),
    });
    const previousRange = getPreviousDateRange(currentRange);

    const [
        { data: funnels, error: funnelsError },
        { data: stages, error: stagesError },
        { data: units, error: unitsError },
        clientsResult,
        unitClientIdsResult,
    ] = await Promise.all([
        supabase
            .from("funnels")
            .select("id, name, active, created_at, updated_at")
            .eq("active", true)
            .order("created_at", { ascending: true }),
        supabase
            .from("funnel_stages")
            .select("id, funnel_id, name, position, color, created_at, updated_at")
            .order("position", { ascending: true }),
        supabase
            .from("units")
            .select("id, name, active")
            .eq("active", true)
            .order("name"),
        getFunnelClients({ unitIds }),
        getClientIdsForUnitFilter(unitIds),
    ]);

    if (
        funnelsError ||
        stagesError ||
        unitsError ||
        clientsResult.error ||
        unitClientIdsResult.error
    ) {
        return NextResponse.json(
            {
                error: "Failed to load funnel data",
                details: {
                    funnelsError,
                    stagesError,
                    unitsError,
                    clientsError: clientsResult.error,
                    unitClientIdsError: unitClientIdsResult.error,
                },
            },
            { status: 500 },
        );
    }

    const clients = clientsResult.clients as FunnelClient[];
    const clientIds = clients.map((client) => client.id);
    const kpiClientIds = unitClientIdsResult.clientIds;

    try {
        const [cardEvents, appointments, periodEvents] = await Promise.all([
            getJourneyEvents({ clientIds }),
            getAppointments(clientIds),
            getJourneyEvents({
                clientIds: kpiClientIds,
                dateRange: {
                    start: previousRange.start,
                    end: currentRange.end,
                },
            }),
        ]);

        const eventsByClient = groupEventsByClient(cardEvents);
        const appointmentsByClient = groupAppointmentsByClient(appointments);

        return NextResponse.json({
            funnels: funnels ?? [],
            stages: stages ?? [],
            units: units ?? [],
            clients: clients.map((client) => {
                const milestone = resolveFunnelMilestone(
                    eventsByClient.get(client.id) ?? [],
                );
                const appointment = chooseNearestAppointment(
                    appointmentsByClient.get(client.id) ?? [],
                );

                return {
                    ...client,
                    schedule_summary: appointment
                        ? appointmentToSummary(
                              appointment,
                              client.funnel_stage_id,
                          )
                        : milestone
                          ? {
                              id: milestone.event.id,
                              scheduled_for: milestone.event.scheduled_for,
                              procedure_name: milestone.event.procedure_name,
                              status: milestone.event.status,
                              status_group: milestone.statusGroup,
                              event_kind: milestone.event.event_kind,
                              attention: isFunnelAttentionState(
                                  client.funnel_stage_id,
                                  milestone.event.status,
                              ),
                              attention_label: getFunnelAttentionLabel(
                                  client.funnel_stage_id,
                                  milestone.event.status,
                              ),
                          }
                          : null,
                    appointment,
                };
            }),
            kpis: buildFunnelKpis(
                filterEventsByRange(periodEvents, currentRange),
            ),
            previous_kpis: buildFunnelKpis(
                filterEventsByRange(periodEvents, previousRange),
            ),
        });
    } catch (error) {
        return NextResponse.json(
            {
                error: "Failed to load CliniSys funnel milestones",
                details:
                    error instanceof Error ? error.message : String(error),
                hint: "Run supabase-funnel-clinisys-automation.sql before opening /funil.",
            },
            { status: 500 },
        );
    }
}

async function getFunnelClients({ unitIds }: { unitIds: string[] }) {
    let query = supabase
        .from("clients")
        .select(
            `
            id,
            name,
            phone,
            email,
            funnel_stage_id,
            unit_id,
            last_interaction_at,
            utm_source,
            utm_medium,
            utm_campaign,
            updated_at
            `,
        )
        .not("funnel_stage_id", "is", null)
        .order("last_interaction_at", { ascending: false });

    if (unitIds.length > 0) query = query.in("unit_id", unitIds);
    const { data, error } = await query;

    return { clients: data ?? [], error };
}

async function getClientIdsForUnitFilter(unitIds: string[]) {
    if (unitIds.length === 0) {
        return { clientIds: null, error: null };
    }

    const { data, error } = await supabase
        .from("clients")
        .select("id")
        .in("unit_id", unitIds);

    return {
        clientIds: data?.map((client) => client.id) ?? [],
        error,
    };
}

async function getJourneyEvents({
    clientIds,
    dateRange,
}: {
    clientIds: string[] | null;
    dateRange?: DateRange;
}) {
    if (clientIds && clientIds.length === 0) {
        return [] as ClinisysJourneyEvent[];
    }

    const events: ClinisysJourneyEvent[] = [];
    const batches = clientIds
        ? chunk(clientIds, IN_FILTER_BATCH_SIZE)
        : [null];

    for (const clientBatch of batches) {
        let page = 0;

        while (true) {
            let query = supabase
                .from("funnel_clinisys_events")
                .select(
                    "id, client_id, scheduled_for, procedure_name, status, event_kind",
                )
                .order("scheduled_for", { ascending: true })
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            if (clientBatch) query = query.in("client_id", clientBatch);
            if (dateRange) {
                query = query
                    .gte("scheduled_for", toDateKey(dateRange.start))
                    .lte("scheduled_for", toDateKey(dateRange.end));
            }

            const { data, error } = await query;
            if (error) throw error;

            const rows = (data ?? []) as ClinisysJourneyEvent[];
            events.push(...rows);
            if (rows.length < PAGE_SIZE) break;
            page += 1;
        }
    }

    return events;
}

async function getAppointments(clientIds: string[]) {
    if (clientIds.length === 0) return [] as CalendarAppointment[];

    const appointments: CalendarAppointment[] = [];

    for (const clientBatch of chunk(clientIds, IN_FILTER_BATCH_SIZE)) {
        const { data, error } = await supabase
            .from("appointments")
            .select(APPOINTMENT_SELECT)
            .in("client_id", clientBatch)
            .order("starts_at", { ascending: true });

        if (error) throw error;
        appointments.push(...(data ?? []).map(mapAppointment));
    }

    return appointments;
}

function buildFunnelKpis(events: ClinisysJourneyEvent[]) {
    const evaluations = events.filter(
        (event) => event.event_kind === "evaluation",
    );
    const procedures = events.filter(
        (event) => event.event_kind === "procedure",
    );

    return {
        evaluations_scheduled: countUniqueClients(evaluations),
        evaluation_show_rate: buildShowRate(evaluations),
        procedures_scheduled: countUniqueClients(procedures),
        procedure_show_rate: buildShowRate(procedures),
    };
}

function buildShowRate(events: ClinisysJourneyEvent[]) {
    const outcomeByClient = new Map<string, "showed_up" | "no_show">();

    for (const event of events) {
        const status = normalizeScheduleStatus(event.status);
        if (scheduleShowedUp(status)) {
            outcomeByClient.set(event.client_id, "showed_up");
        } else if (
            status === "no_show" &&
            outcomeByClient.get(event.client_id) !== "showed_up"
        ) {
            outcomeByClient.set(event.client_id, "no_show");
        }
    }

    const showedUp = [...outcomeByClient.values()].filter(
        (outcome) => outcome === "showed_up",
    ).length;

    return percentage(showedUp, outcomeByClient.size);
}

function appointmentToSummary(
    appointment: CalendarAppointment,
    stageId: string | null,
) {
    const status =
        appointment.status === "cancelled"
            ? "Desmarcou"
            : appointment.status === "no_show"
              ? "Faltou"
              : appointment.status === "completed"
                ? "Atendido"
                : "Não";

    return {
        id: appointment.id,
        scheduled_for: appointment.starts_at.slice(0, 10),
        procedure_name: appointment.procedure_name,
        status,
        status_group: normalizeScheduleStatus(status),
        event_kind: null,
        attention: isFunnelAttentionState(stageId, status),
        attention_label: getFunnelAttentionLabel(stageId, status),
    };
}

function groupEventsByClient(events: ClinisysJourneyEvent[]) {
    const grouped = new Map<string, ClinisysJourneyEvent[]>();
    for (const event of events) {
        const current = grouped.get(event.client_id) ?? [];
        current.push(event);
        grouped.set(event.client_id, current);
    }
    return grouped;
}

function groupAppointmentsByClient(appointments: CalendarAppointment[]) {
    const grouped = new Map<string, CalendarAppointment[]>();
    for (const appointment of appointments) {
        if (!appointment.client_id) continue;
        const current = grouped.get(appointment.client_id) ?? [];
        current.push(appointment);
        grouped.set(appointment.client_id, current);
    }
    return grouped;
}

function chooseNearestAppointment(appointments: CalendarAppointment[]) {
    const now = Date.now();
    return [...appointments].sort((left, right) => {
        const leftDistance = Math.abs(new Date(left.starts_at).getTime() - now);
        const rightDistance = Math.abs(new Date(right.starts_at).getTime() - now);
        return leftDistance - rightDistance;
    })[0] ?? null;
}

function filterEventsByRange(
    events: ClinisysJourneyEvent[],
    range: DateRange,
) {
    const start = toDateKey(range.start);
    const end = toDateKey(range.end);
    return events.filter(
        (event) =>
            event.scheduled_for >= start && event.scheduled_for <= end,
    );
}

function countUniqueClients(events: ClinisysJourneyEvent[]) {
    return new Set(events.map((event) => event.client_id)).size;
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
            start: new Date(`${startDate}T00:00:00-03:00`).toISOString(),
            end: new Date(
                `${endDate ?? startDate}T23:59:59.999-03:00`,
            ).toISOString(),
        };
    }

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Math.max(1, days) + 1);
    start.setHours(0, 0, 0, 0);

    return { start: start.toISOString(), end: end.toISOString() };
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
    return Math.round((value / total) * 1_000) / 10;
}

function toDateKey(value: string) {
    return value.slice(0, 10);
}

function parseIds(value: string | null) {
    return value
        ? value.split(",").map((item) => item.trim()).filter(Boolean)
        : [];
}

function chunk<T>(items: T[], size: number) {
    return Array.from(
        { length: Math.ceil(items.length / size) },
        (_, index) => items.slice(index * size, (index + 1) * size),
    );
}
