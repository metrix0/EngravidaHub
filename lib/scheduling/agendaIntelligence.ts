// lib/scheduling/agendaIntelligence.ts
import { patternSignalSchema } from "@/lib/analysis/patternSignals";
import { hasFreshClinisysAvailabilitySnapshot, replicatedAgendaCapacity, type AgendaRow } from "@/lib/clinisys/replicatedAvailability";
import { normalizePhoneIdentity } from "@/lib/clients/phoneIdentity";

type Interval = { start: number; end: number };
export type IntelligenceAgenda = AgendaRow & { unit_id: string; unit_name: string; doctor_name: string };
export type IntelligenceAppointment = {
    id: string; unit_id: string; doctor_id: string; starts_at: string; ends_at: string; status: string;
    client_id?: string | null; patient_phone?: string | null;
};
type IntelligenceClient = { id?: string; unit_id: string | null; name?: string | null; phone?: string | null; phone_identity?: string | null };
export type IntelligenceAnalysis = {
    conversation_id: string; client_id?: string | null; pattern_signals: unknown; started_at?: string;
    customer_final_state?: string | null; outcome_events?: unknown;
    clients: IntelligenceClient | IntelligenceClient[];
};
export type IntelligenceEvidenceMessage = { id: string; conversation_id: string; sent_at: string };
type BookingResult = "bookedMatching" | "bookedOther" | "bookingUnverified" | "withoutBooking";
export type ScheduleHistory = {
    entity_id: string; entity_type: string; recorded_at: string; operation: string;
    before_state: IntelligenceAppointment | null; after_state: IntelligenceAppointment | null;
};
export type AgendaIntelligenceReport = ReturnType<typeof buildAgendaIntelligence>;
const DAY = 86_400_000;
const MINUTE = 60_000;
const BUSY = new Set(["scheduled", "confirmed", "completed", "no_show"]);
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const localFormatters = new Map<string, Intl.DateTimeFormat>();

export function mergeIntervals(intervals: Interval[]): Interval[] {
    const result: Interval[] = [];
    for (const interval of intervals.filter(item => item.end > item.start).sort((a, b) => a.start - b.start)) {
        const previous = result[result.length - 1];
        if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
        else result.push({ ...interval });
    }
    return result;
}

function subtractIntervals(capacity: Interval[], occupied: Interval[]) {
    const result: Interval[] = [];
    for (const interval of capacity) {
        let start = interval.start;
        for (const busy of occupied) {
            if (busy.end <= start || busy.start >= interval.end) continue;
            if (busy.start > start) result.push({ start, end: busy.start });
            start = Math.max(start, busy.end);
            if (start >= interval.end) break;
        }
        if (start < interval.end) result.push({ start, end: interval.end });
    }
    return result;
}

function minutes(intervals: Interval[]) {
    return intervals.reduce((total, interval) => total + (interval.end - interval.start) / MINUTE, 0);
}

function localParts(epoch: number, timezone: string) {
    let formatter = localFormatters.get(timezone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        });
        localFormatters.set(timezone, formatter);
    }
    const parts = formatter.formatToParts(new Date(epoch));
    const value = (key: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === key)!.value;
    return { date: `${value("year")}-${value("month")}-${value("day")}`, minute: Number(value("hour")) * 60 + Number(value("minute")) };
}

export function matchesSchedulingPreference(value: string, date: string, minute: number) {
    const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    if (value === "from_17") return minute >= 17 * 60;
    const period = (name: string) => name === "morning" ? minute >= 6 * 60 && minute < 12 * 60
        : name === "afternoon" ? minute >= 12 * 60 && minute < 18 * 60
        : name === "evening" ? minute >= 18 * 60 : false;
    if (["morning", "afternoon", "evening"].includes(value)) return period(value);
    if (WEEKDAYS.includes(value)) return weekday === value;
    const compound = /^(\w+)_(morning|afternoon|evening)$/.exec(value);
    if (compound) return weekday === compound[1] && period(compound[2]);
    const time = /^(after|before|at)_([01]\d|2[0-3])_([0-5]\d)$/.exec(value);
    if (!time) return false;
    const target = Number(time[2]) * 60 + Number(time[3]);
    return time[1] === "after" ? minute > target : time[1] === "before" ? minute < target : minute === target;
}

export function buildAgendaIntelligence(input: {
    agendas: IntelligenceAgenda[]; appointments: IntelligenceAppointment[]; analyses: IntelligenceAnalysis[];
    demandAppointments?: IntelligenceAppointment[]; evidenceMessages?: IntelligenceEvidenceMessage[];
    history: ScheduleHistory[]; historyStartedAt: string | null; days: number; now?: number;
    resultsStart?: string; resultsEnd?: string;
    coverage?: { analyzedConversations: number; signalsProcessed: number };
    doctors: Array<{ id: string; unit_id: string; name: string }>;
}) {
    const now = input.now ?? Date.now();
    const resultsStart = input.resultsStart ?? new Date(now - input.days * DAY).toISOString();
    const resultsEnd = input.resultsEnd ?? new Date(now).toISOString();
    const start = localParts(now, "America/Sao_Paulo").date;
    const end = new Date(Date.parse(`${start}T12:00:00Z`) + input.days * DAY).toISOString().slice(0, 10);
    const groups = new Map<string, IntelligenceAgenda[]>();
    for (const agenda of input.agendas) {
        const key = `${agenda.unit_id}:${agenda.doctor_id}`;
        groups.set(key, [...(groups.get(key) ?? []), agenda]);
    }
    const heatmap = new Map<string, { weekday: number; hour: number; capacityMinutes: number; occupiedMinutes: number }>();
    const freeWindows: Array<Interval & { unitId: string; doctorName: string; timezone: string; duration: number }> = [];
    const doctors = [];
    for (const [key, agendas] of groups) {
        const agenda = agendas[0];
        const cadence = Math.min(...agendas.map(item => item.slot_duration_minutes).filter(item => item > 0));
        if (!Number.isFinite(cadence)) continue;
        const busy = mergeIntervals(input.appointments.filter(item => `${item.unit_id}:${item.doctor_id}` === key && BUSY.has(item.status))
            .map(item => ({ start: Date.parse(item.starts_at), end: Date.parse(item.ends_at) })));
        let capacityMinutes = 0, occupiedMinutes = 0, freeSlots = 0;
        let firstAvailable: number | null = null;
        for (let date = start; date < end; date = new Date(Date.parse(`${date}T12:00:00Z`) + DAY).toISOString().slice(0, 10)) {
            const hasLive = agendas.some(item => hasFreshClinisysAvailabilitySnapshot(item, date, now));
            const dayStart = Date.parse(`${date}T00:00:00-03:00`);
            const dayEnd = dayStart + DAY;
            // Live CliniSYS slots exclude appointments; count confirmed busy periods as
            // occupied capacity, not as additional free windows.
            const busyCapacity = hasLive ? busy.filter(item => item.start < dayEnd && item.end > dayStart) : [];
            const capacity = mergeIntervals([
                ...agendas.flatMap(item => replicatedAgendaCapacity(item, date, now)),
                ...busyCapacity,
            ].map(interval => ({ start: Math.max(now, interval.start), end: interval.end }))
                .filter(interval => interval.end > interval.start));
            const free = subtractIntervals(capacity, busy);
            capacityMinutes += minutes(capacity);
            occupiedMinutes += minutes(capacity) - minutes(free);
            for (const interval of capacity) {
                for (let cursor = interval.start; cursor < interval.end;) {
                    const local = localParts(cursor, agenda.timezone);
                    const nextHour = Math.min(interval.end, cursor + (60 - local.minute % 60) * MINUTE);
                    const weekday = new Date(`${local.date}T12:00:00Z`).getUTCDay();
                    const hour = Math.floor(local.minute / 60), heatKey = `${weekday}:${hour}`;
                    const cell = heatmap.get(heatKey) ?? { weekday, hour, capacityMinutes: 0, occupiedMinutes: 0 };
                    const length = (nextHour - cursor) / MINUTE;
                    const available = minutes(free.map(item => ({ start: Math.max(cursor, item.start), end: Math.min(nextHour, item.end) })).filter(item => item.end > item.start));
                    cell.capacityMinutes += length;
                    cell.occupiedMinutes += length - available;
                    heatmap.set(heatKey, cell);
                    cursor = nextHour;
                }
            }
            for (const interval of free) {
                // Real non-overlapping consultation capacity; alternative 15-minute starts are not extra slots.
                const local = localParts(interval.start, agenda.timezone);
                const padding = (15 - local.minute % 15) % 15;
                const first = Math.floor(interval.start / MINUTE) * MINUTE + padding * MINUTE + (interval.start % MINUTE && !padding ? 15 * MINUTE : 0);
                if (first + cadence * MINUTE <= interval.end) firstAvailable = Math.min(firstAvailable ?? first, first);
                for (let cursor = first; cursor + cadence * MINUTE <= interval.end; cursor += cadence * MINUTE) {
                    freeSlots++;
                }
                freeWindows.push({ ...interval, start: first, unitId: agenda.unit_id, doctorName: agenda.doctor_name, timezone: agenda.timezone, duration: cadence * MINUTE });
            }
        }
        doctors.push({ unitId: agenda.unit_id, unitName: agenda.unit_name, doctorId: agenda.doctor_id, doctorName: agenda.doctor_name,
            durationMinutes: cadence, capacityMinutes, occupiedMinutes, freeSlots, firstAvailable: firstAvailable === null ? null : new Date(firstAvailable).toISOString(),
            waitDays: firstAvailable === null ? null : (firstAvailable - now) / DAY,
            occupancy: capacityMinutes ? occupiedMinutes / capacityMinutes * 100 : null });
    }
    const covered = new Set(groups.keys());
    const missingDoctors = input.doctors.filter(doctor => !covered.has(`${doctor.unit_id}:${doctor.id}`));
    const demand = new Map<string, { unitId: string; value: string; label: string; cases: Map<string, { result: BookingResult; clientId: string | null; reviewable: boolean }> }>();
    const allConversations = new Set<string>(), processed = new Set<string>();
    const evidenceDetails: Record<string, { name: string; startedAt: string | null }> = {};
    const messages = new Map((input.evidenceMessages ?? []).map(message => [message.id, message]));
    const appointmentsByClient = new Map<string, IntelligenceAppointment[]>(), appointmentsByPhone = new Map<string, IntelligenceAppointment[]>();
    const clientsByPhone = new Map<string, Set<string>>();
    for (const analysis of input.analyses) {
        const client = Array.isArray(analysis.clients) ? analysis.clients[0] : analysis.clients;
        const clientId = analysis.client_id ?? client?.id;
        const phone = normalizePhoneIdentity(client?.phone_identity ?? client?.phone);
        if (phone && clientId) clientsByPhone.set(phone, new Set([...(clientsByPhone.get(phone) ?? []), clientId]));
    }
    for (const appointment of input.demandAppointments ?? input.appointments) {
        if (appointment.client_id) appointmentsByClient.set(appointment.client_id, [...(appointmentsByClient.get(appointment.client_id) ?? []), appointment]);
        else {
            const phone = normalizePhoneIdentity(appointment.patient_phone);
            if (phone) appointmentsByPhone.set(phone, [...(appointmentsByPhone.get(phone) ?? []), appointment]);
        }
    }
    for (const analysis of input.analyses) {
        if (analysis.started_at && (Date.parse(analysis.started_at) < Date.parse(resultsStart) || Date.parse(analysis.started_at) >= Math.min(now, Date.parse(resultsEnd)))) continue;
        allConversations.add(analysis.conversation_id);
        if (!Array.isArray(analysis.pattern_signals)) continue;
        processed.add(analysis.conversation_id);
        const client = Array.isArray(analysis.clients) ? analysis.clients[0] : analysis.clients;
        const unitId = client?.unit_id;
        if (!unitId) continue;
        for (const raw of analysis.pattern_signals) {
            const parsed = patternSignalSchema.safeParse(raw);
            if (!parsed.success || parsed.data.category !== "consultation_preference" || parsed.data.confidence < 0.85) continue;
            const signal = parsed.data, key = `${unitId}:${signal.value}`;
            const group = demand.get(key) ?? { unitId, value: signal.value, label: signal.label, cases: new Map() };
            const clientId = analysis.client_id ?? client?.id ?? null;
            const phone = normalizePhoneIdentity(client?.phone_identity ?? client?.phone);
            const evidenceTimes = signal.evidence.flatMap(item => {
                const message = messages.get(item.message_id);
                return message?.conversation_id === analysis.conversation_id && Number.isFinite(Date.parse(message.sent_at)) ? [Date.parse(message.sent_at)] : [];
            });
            const requestedAt = evidenceTimes.length ? Math.max(...evidenceTimes)
                : input.evidenceMessages ? NaN : Date.parse(analysis.started_at ?? "");
            const candidates = [...(clientId ? appointmentsByClient.get(clientId) ?? [] : []),
                ...(phone && clientsByPhone.get(phone)?.size === 1 ? appointmentsByPhone.get(phone) ?? [] : [])]
                .filter(item => item.unit_id === unitId && Date.parse(item.starts_at) >= requestedAt && ["scheduled", "confirmed", "completed"].includes(item.status));
            const matching = candidates.some(item => {
                const timezone = input.agendas.find(agenda => agenda.unit_id === item.unit_id && agenda.doctor_id === item.doctor_id)?.timezone
                    ?? input.agendas.find(agenda => agenda.unit_id === item.unit_id)?.timezone ?? "America/Sao_Paulo";
                const local = localParts(Date.parse(item.starts_at), timezone);
                return matchesSchedulingPreference(signal.value, local.date, local.minute);
            });
            const bookingReported = ["scheduled", "rescheduled", "confirmed_attendance"].includes(analysis.customer_final_state ?? "") ||
                Array.isArray(analysis.outcome_events) && analysis.outcome_events.some(event => event &&
                    ["appointment_scheduled", "appointment_rescheduled", "attendance_confirmed"].includes(event.type) && event.confidence >= 0.85 &&
                    (!event.occurred_at || Date.parse(event.occurred_at) >= requestedAt));
            const result: BookingResult = matching ? "bookedMatching" : candidates.length ? "bookedOther"
                : !clientId || !Number.isFinite(requestedAt) || phone && (clientsByPhone.get(phone)?.size ?? 0) > 1 || bookingReported ? "bookingUnverified" : "withoutBooking";
            group.cases.set(analysis.conversation_id, { result, clientId, reviewable: analysis.customer_final_state !== "not_qualified" });
            evidenceDetails[analysis.conversation_id] = { name: client?.name?.trim() || "Ver conversa", startedAt: analysis.started_at ?? null };
            demand.set(key, group);
        }
    }
    const reviewContacts = new Map<string, string[]>();
    const preferences = [...demand.values()].map(group => {
        const cases = [...group.cases.values()];
        const reviewCases = [...group.cases].filter(([, item]) => item.result === "withoutBooking" && item.reviewable);
        const contactConversations = new Map<string, string>();
        for (const [id, item] of reviewCases) {
            if (!item.clientId) continue;
            const previous = contactConversations.get(item.clientId);
            if (!previous || Date.parse(evidenceDetails[id].startedAt ?? "") > Date.parse(evidenceDetails[previous].startedAt ?? "")) contactConversations.set(item.clientId, id);
        }
        reviewContacts.set(`${group.unitId}:${group.value}`, [...contactConversations.values()]);
        return { unitId: group.unitId,
        unitName: input.agendas.find(agenda => agenda.unit_id === group.unitId)?.unit_name ?? "Unidade sem agenda",
        value: group.value, label: group.label, conversations: group.cases.size,
        bookedMatching: cases.filter(item => item.result === "bookedMatching").length,
        bookedOther: cases.filter(item => item.result === "bookedOther").length,
        bookingUnverified: cases.filter(item => item.result === "bookingUnverified").length,
        withoutBooking: cases.filter(item => item.result === "withoutBooking").length,
        casesToReview: contactConversations.size,
        examples: [...reviewCases.map(([id]) => id), ...[...group.cases.keys()].filter(id => !reviewCases.some(([reviewId]) => reviewId === id))].slice(0, 3),
        ...compatibleSlots(freeWindows.filter(window => window.unitId === group.unitId), group.value),
        coverageComplete: input.agendas.some(agenda => agenda.unit_id === group.unitId),
    }; }).sort((a, b) => b.conversations - a.conversations || a.label.localeCompare(b.label));
    const actionable = preferences.filter(item => item.conversations >= 3 && item.casesToReview > 0 && (item.coverageComplete || item.availableSlots >= item.casesToReview));
    const opportunities = actionable.map(item => ({
        unitId: item.unitId, unitName: item.unitName, value: item.value, label: item.label,
        conversations: item.casesToReview, totalConversations: item.conversations, availableSlots: item.availableSlots, coverageComplete: item.coverageComplete,
        firstCompatibleSlot: item.firstCompatibleSlot,
        contacts: reviewContacts.get(`${item.unitId}:${item.value}`) ?? [],
        action: item.availableSlots >= item.casesToReview ? "fill" as const : "expand" as const,
        gap: Math.max(0, item.casesToReview - item.availableSlots),
    })).sort((a, b) => {
        const order = { expand: 0, fill: 1 };
        return order[a.action] - order[b.action] || (a.action === "expand" ? b.gap - a.gap : 0) || b.conversations - a.conversations || a.label.localeCompare(b.label);
    }).slice(0, 3);
    const displayedEvidence = new Set([...preferences.flatMap(item => item.examples), ...opportunities.flatMap(item => item.contacts)]);
    for (const id of Object.keys(evidenceDetails)) if (!displayedEvidence.has(id)) delete evidenceDetails[id];
    const past = input.appointments.filter(item => Date.parse(item.starts_at) < Math.min(now, Date.parse(resultsEnd)) && Date.parse(item.starts_at) >= Date.parse(resultsStart));
    const noShows = past.filter(item => item.status === "no_show").length;
    const resolved = past.filter(item => ["completed", "no_show"].includes(item.status)).length;
    const cancellations = past.filter(item => item.status === "cancelled").length;
    const historyMetrics = releasedSlotMetrics(input.history, now, { start: Date.parse(resultsStart), end: Math.min(now, Date.parse(resultsEnd)) });
    const observedFrom = input.historyStartedAt ? new Date(Math.max(Date.parse(resultsStart), Date.parse(input.historyStartedAt))).toISOString() : null;
    const historyAvailable = observedFrom !== null && Date.parse(observedFrom) < Math.min(now, Date.parse(resultsEnd));
    const capacityMinutes = doctors.reduce((total, doctor) => total + doctor.capacityMinutes, 0);
    const occupiedMinutes = doctors.reduce((total, doctor) => total + doctor.occupiedMinutes, 0);
    const waits = doctors.flatMap(doctor => doctor.waitDays === null ? [] : [doctor.waitDays]).sort((a, b) => a - b);
    const mid = Math.floor(waits.length / 2);
    const medianWaitDays = !waits.length ? null : waits.length % 2 ? waits[mid] : (waits[mid - 1] + waits[mid]) / 2;
    const analyzedConversations = input.coverage?.analyzedConversations ?? allConversations.size;
    const signalsProcessed = input.coverage?.signalsProcessed ?? processed.size;
    return { days: input.days, start, end, resultsStart, resultsEnd, evidenceDetails, generatedAt: new Date(now).toISOString(), capacityMinutes, occupiedMinutes,
        occupancy: capacityMinutes ? occupiedMinutes / capacityMinutes * 100 : null,
        freeSlots: doctors.reduce((total, doctor) => total + doctor.freeSlots, 0), medianWaitDays,
        doctors: doctors.sort((a, b) => b.freeSlots - a.freeSlots), missingDoctors,
        heatmap: [...heatmap.values()].sort((a, b) => a.weekday - b.weekday || a.hour - b.hour),
        preferences, opportunities, noShows, noShowRate: resolved ? noShows / resolved * 100 : null, cancellations,
        history: { startedAt: input.historyStartedAt, observedFrom: historyAvailable ? observedFrom : null, ...historyMetrics },
        coverage: { analyzedConversations, signalsProcessed, signalsPending: analyzedConversations - signalsProcessed } };
}

function compatibleSlots(windows: Array<Interval & { doctorName: string; timezone: string; duration: number }>, preference: string) {
    let count = 0;
    let firstSlot: { startsAt: string; doctorName: string } | null = null;
    for (const window of windows) {
        for (let cursor = window.start; cursor + window.duration <= window.end;) {
            const local = localParts(cursor, window.timezone);
            if (matchesSchedulingPreference(preference, local.date, local.minute)) {
                count++;
                if (!firstSlot || cursor < Date.parse(firstSlot.startsAt)) firstSlot = { startsAt: new Date(cursor).toISOString(), doctorName: window.doctorName };
                cursor += window.duration;
            } else cursor += 15 * MINUTE;
        }
    }
    return { availableSlots: count, firstCompatibleSlot: firstSlot };
}

export function releasedSlotMetrics(history: ScheduleHistory[], now: number, period?: Interval) {
    const releases = new Map<string, { row: ScheduleHistory; before: IntelligenceAppointment }>();
    let reschedules = 0;
    for (const row of history) {
        if (period && (Date.parse(row.recorded_at) < period.start || Date.parse(row.recorded_at) >= period.end)) continue;
        const before = row.before_state, after = row.after_state;
        if (row.entity_type !== "appointment" || !before || !["scheduled", "confirmed"].includes(before.status)) continue;
        const moved = after && (before.starts_at !== after.starts_at || before.ends_at !== after.ends_at || before.doctor_id !== after.doctor_id || before.unit_id !== after.unit_id);
        if (moved) reschedules++;
        if (!after || after.status === "cancelled" || moved) {
            if (Date.parse(before.starts_at) <= Date.parse(row.recorded_at)) continue;
            releases.set(`${before.id}:${before.starts_at}:${before.ends_at}`, { row, before });
        }
    }
    let lateReleases = 0, recovered = 0, settled = 0;
    for (const { row, before } of releases.values()) {
        const start = Date.parse(before.starts_at), end = Date.parse(before.ends_at), releasedAt = Date.parse(row.recorded_at);
        if (start - releasedAt < DAY) lateReleases++;
        if (end > now) continue; // Future slots can still be recovered.
        settled++;
        const states = new Map<string, IntelligenceAppointment | null>();
        for (const candidate of history) {
            if (candidate.entity_type !== "appointment" || Date.parse(candidate.recorded_at) <= releasedAt || Date.parse(candidate.recorded_at) > end) continue;
            states.set(candidate.entity_id, candidate.after_state);
        }
        const replacement = mergeIntervals([...states.values()].filter((item): item is IntelligenceAppointment => !!item && item.id !== before.id
            && item.unit_id === before.unit_id && item.doctor_id === before.doctor_id && BUSY.has(item.status))
            .map(item => ({ start: Math.max(start, Date.parse(item.starts_at)), end: Math.min(end, Date.parse(item.ends_at)) })));
        if (minutes(replacement) >= (end - start) / MINUTE) recovered++;
    }
    return { released: releases.size, lateReleases, settled, recovered, reschedules };
}
