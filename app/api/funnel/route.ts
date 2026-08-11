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
    last_called_at: string | null;
    last_call_closure_tag: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    updated_at: string;
};

type FunnelJourneyEvent = ClinisysJourneyEvent & {
    created_in_source_at: string | null;
};

const DEFAULT_DAYS = 30;
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
    const clientIds = new Set(clients.map((client) => client.id));
    const kpiClientIds = unitClientIdsResult.clientIds
        ? new Set(unitClientIdsResult.clientIds)
        : null;

    try {
        const [allEvents, allAppointments] = await Promise.all([
            getAllJourneyEvents(),
            getAllAppointments(),
        ]);
        const cardEvents = allEvents.filter((event) =>
            clientIds.has(event.client_id),
        );
        const appointments = allAppointments.filter(
            (appointment) =>
                appointment.client_id &&
                clientIds.has(appointment.client_id),
        );
        const periodEvents = kpiClientIds
            ? allEvents.filter((event) => kpiClientIds.has(event.client_id))
            : allEvents;

        const eventsByClient = groupEventsByClient(cardEvents);
        const appointmentsByClient = groupAppointmentsByClient(appointments);

        return NextResponse.json(
            {
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
                                    created_at:
                                        (milestone.event as FunnelJourneyEvent)
                                            .created_in_source_at,
                                    scheduled_for:
                                        milestone.event.scheduled_for,
                                    procedure_name:
                                        milestone.event.procedure_name,
                                    status: milestone.event.status,
                                    status_group: milestone.statusGroup,
                                    event_kind:
                                        milestone.event.event_kind,
                                    attention: isFunnelAttentionState(
                                        client.funnel_stage_id,
                                        milestone.event.status,
                                    ),
                                    attention_label:
                                        getFunnelAttentionLabel(
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
            },
            {
                headers: {
                    "Cache-Control": "private, no-store",
                    "Server-Timing": `funnel-events;desc="${allEvents.length}", funnel-clients;desc="${clients.length}"`,
                },
            },
        );
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
    const first = await loadFunnelClientPage({
        unitIds,
        from: 0,
        withCount: true,
    });
    if (first.error) return { clients: [], error: first.error };

    const total = first.count ?? first.clients.length;
    const remainingOffsets = Array.from(
        {
            length: Math.max(
                0,
                Math.ceil((total - PAGE_SIZE) / PAGE_SIZE),
            ),
        },
        (_, index) => (index + 1) * PAGE_SIZE,
    );
    const remaining = await Promise.all(
        remainingOffsets.map((from) =>
            loadFunnelClientPage({
                unitIds,
                from,
                withCount: false,
            }),
        ),
    );
    const failed = remaining.find((page) => page.error);

    return {
        clients: [
            ...first.clients,
            ...remaining.flatMap((page) => page.clients),
        ],
        error: failed?.error ?? null,
    };
}

async function loadFunnelClientPage({
    unitIds,
    from,
    withCount,
}: {
    unitIds: string[];
    from: number;
    withCount: boolean;
}) {
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
            last_called_at,
            last_call_closure_tag,
            utm_source,
            utm_medium,
            utm_campaign,
            updated_at
            `,
            withCount ? { count: "exact" } : undefined,
        )
        .not("funnel_stage_id", "is", null)
        .order("last_interaction_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

    if (unitIds.length > 0) query = query.in("unit_id", unitIds);
    const { data, error, count } = await query;

    return {
        clients: (data ?? []) as FunnelClient[],
        error,
        count,
    };
}

async function getClientIdsForUnitFilter(unitIds: string[]) {
    if (unitIds.length === 0) {
        return { clientIds: null as string[] | null, error: null };
    }

    const first = await loadUnitClientIdPage(unitIds, 0, true);
    if (first.error) return { clientIds: [] as string[], error: first.error };

    const total = first.count ?? first.clientIds.length;
    const offsets = Array.from(
        {
            length: Math.max(
                0,
                Math.ceil((total - PAGE_SIZE) / PAGE_SIZE),
            ),
        },
        (_, index) => (index + 1) * PAGE_SIZE,
    );
    const remaining = await Promise.all(
        offsets.map((from) =>
            loadUnitClientIdPage(unitIds, from, false),
        ),
    );
    const failed = remaining.find((page) => page.error);

    return {
        clientIds: [
            ...first.clientIds,
            ...remaining.flatMap((page) => page.clientIds),
        ],
        error: failed?.error ?? null,
    };
}

async function loadUnitClientIdPage(
    unitIds: string[],
    from: number,
    withCount: boolean,
) {
    const { data, error, count } = await supabase
        .from("clients")
        .select("id", withCount ? { count: "exact" } : undefined)
        .in("unit_id", unitIds)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

    return {
        clientIds: (data ?? []).map((client) => client.id),
        error,
        count,
    };
}

async function getAllJourneyEvents() {
    const first = await loadJourneyEventPage(0, true);
    if (first.error) throw first.error;

    const total = first.count ?? first.events.length;
    const offsets = Array.from(
        {
            length: Math.max(
                0,
                Math.ceil((total - PAGE_SIZE) / PAGE_SIZE),
            ),
        },
        (_, index) => (index + 1) * PAGE_SIZE,
    );
    const remaining = await Promise.all(
        offsets.map((from) => loadJourneyEventPage(from, false)),
    );
    const failed = remaining.find((page) => page.error);
    if (failed?.error) throw failed.error;

    return [
        ...first.events,
        ...remaining.flatMap((page) => page.events),
    ];
}

async function loadJourneyEventPage(from: number, withCount: boolean) {
    const { data, error, count } = await supabase
        .from("funnel_clinisys_events")
        .select(
            "id, client_id, scheduled_for, created_in_source_at, procedure_name, status, event_kind",
            withCount ? { count: "exact" } : undefined,
        )
        .order("scheduled_for", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

    return {
        events: (data ?? []) as FunnelJourneyEvent[],
        error,
        count,
    };
}

async function getAllAppointments() {
    const first = await loadAppointmentPage(0, true);
    if (first.error) throw first.error;

    const total = first.count ?? first.appointments.length;
    const offsets = Array.from(
        {
            length: Math.max(
                0,
                Math.ceil((total - PAGE_SIZE) / PAGE_SIZE),
            ),
        },
        (_, index) => (index + 1) * PAGE_SIZE,
    );
    const remaining = await Promise.all(
        offsets.map((from) => loadAppointmentPage(from, false)),
    );
    const failed = remaining.find((page) => page.error);
    if (failed?.error) throw failed.error;

    return [
        ...first.appointments,
        ...remaining.flatMap((page) => page.appointments),
    ];
}

async function loadAppointmentPage(from: number, withCount: boolean) {
    const { data, error, count } = await supabase
        .from("appointments")
        .select(
            APPOINTMENT_SELECT,
            withCount ? { count: "exact" } : undefined,
        )
        .order("starts_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

    return {
        appointments: (data ?? []).map(mapAppointment),
        error,
        count,
    };
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
        created_at: appointment.created_at,
        scheduled_for: appointment.starts_at.slice(0, 10),
        procedure_name: appointment.procedure_name,
        status,
        status_group: normalizeScheduleStatus(status),
        event_kind: null,
        attention: isFunnelAttentionState(stageId, status),
        attention_label: getFunnelAttentionLabel(stageId, status),
    };
}

function groupEventsByClient(events: FunnelJourneyEvent[]) {
    const grouped = new Map<string, FunnelJourneyEvent[]>();
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
