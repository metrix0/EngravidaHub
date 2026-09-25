// lib/clinisys/replicatedAvailability.ts
import { supabase } from "@/lib/supabase/client";

const DEFAULT_HORIZON_DAYS = 180;
const DEFAULT_TIMEZONE = "America/Sao_Paulo";

type TimePeriod = {
    startsAt: string;
    endsAt: string;
};

type WorkingHours = TimePeriod & {
    daysOfWeek: number[];
    validFrom: string;
    validUntil: string | null;
};

type AgendaException = {
    date: string;
    available: boolean;
    periods: TimePeriod[];
    recurrence?: string | null;
    daysOfWeek?: number[] | null;
    validFrom?: string | null;
    validUntil?: string | null;
};

type OneTimeBlock = {
    id: string;
    type: "one_time";
    startsAt: string;
    endsAt: string;
};

type RecurringBlock = TimePeriod & {
    id: string;
    type: "recurring";
    daysOfWeek: number[];
    validFrom: string;
    validUntil: string | null;
};

type AgendaRow = {
    doctor_id: string;
    timezone: string;
    slot_duration_minutes: number;
    working_hours: unknown;
    exceptions: unknown;
    blocks: unknown;
    procedures: unknown;
};

type StoredProcedure = {
    id?: string;
    name?: string;
};

type AppointmentRow = {
    doctor_id: string;
    starts_at: string;
    ends_at: string;
};

export type ReplicatedClinisysAvailabilitySlot = {
    doctorId: string;
    data: string;
    inicio: string;
    termino: string;
};

export type ReplicatedClinisysAvailabilityResult = {
    slots: ReplicatedClinisysAvailabilitySlot[];
    coveredDoctorIds: string[];
    missingDoctorIds: string[];
};

export async function listReplicatedClinisysAvailability({
    unitId,
    doctorIds,
    dateFrom,
    dateTo,
    procedureName,
    durationMinutes,
}: {
    unitId: string;
    doctorIds: string[];
    dateFrom?: string | null;
    dateTo?: string | null;
    procedureName?: string | null;
    durationMinutes?: number | null;
}): Promise<ReplicatedClinisysAvailabilityResult> {
    const requestedDoctorIds = [...new Set(doctorIds.filter(Boolean))];
    if (requestedDoctorIds.length === 0) {
        return { slots: [], coveredDoctorIds: [], missingDoctorIds: [] };
    }

    const { data: agendaData, error: agendaError } = await supabase
        .from("clinisys_agendas")
        .select(
            "doctor_id, timezone, slot_duration_minutes, working_hours, exceptions, blocks, procedures",
        )
        .eq("unit_id", unitId)
        .eq("active", true)
        .in("doctor_id", requestedDoctorIds);

    if (agendaError) throw agendaError;

    const replicatedAgendas = (agendaData ?? []) as AgendaRow[];
    const coveredDoctorIds = [
        ...new Set(
            replicatedAgendas.map((agenda) => agenda.doctor_id).filter(Boolean),
        ),
    ];
    const coveredSet = new Set(coveredDoctorIds);
    const missingDoctorIds = requestedDoctorIds.filter(
        (doctorId) => !coveredSet.has(doctorId),
    );

    if (replicatedAgendas.length === 0) {
        return { slots: [], coveredDoctorIds, missingDoctorIds };
    }

    const procedureNeedle = normalizeProcedureName(procedureName ?? "");
    const agendas = procedureNeedle
        ? replicatedAgendas.filter((agenda) =>
              asArray<StoredProcedure>(agenda.procedures).some(
                  (procedure) =>
                      normalizeProcedureName(procedure.name ?? "") ===
                      procedureNeedle,
              ),
          )
        : replicatedAgendas;
    if (agendas.length === 0) {
        return { slots: [], coveredDoctorIds, missingDoctorIds };
    }

    const today = todayInTimeZone(DEFAULT_TIMEZONE);
    const from = dateFrom?.trim() || today;
    const to = dateTo?.trim() || addDays(from, DEFAULT_HORIZON_DAYS);
    validateDateRange(from, to);

    const queryStart = `${addDays(from, -2)}T00:00:00.000Z`;
    const queryEnd = `${addDays(to, 2)}T23:59:59.999Z`;
    const { data: appointmentData, error: appointmentError } = await supabase
        .from("appointments")
        .select("doctor_id, starts_at, ends_at")
        .eq("unit_id", unitId)
        .in("doctor_id", coveredDoctorIds)
        .in("status", ["scheduled", "confirmed"])
        .lt("starts_at", queryEnd)
        .gt("ends_at", queryStart);

    if (appointmentError) throw appointmentError;

    const appointments = (appointmentData ?? []) as AppointmentRow[];
    const appointmentsByDoctor = new Map<string, AppointmentRow[]>();
    for (const appointment of appointments) {
        const current = appointmentsByDoctor.get(appointment.doctor_id) ?? [];
        current.push(appointment);
        appointmentsByDoctor.set(appointment.doctor_id, current);
    }

    const requestedDuration = durationMinutes ?? null;
    if (
        requestedDuration !== null &&
        (!Number.isInteger(requestedDuration) || requestedDuration <= 0)
    ) {
        throw new Error("Duração do agendamento inválida.");
    }

    const now = Date.now();
    const unique = new Map<string, ReplicatedClinisysAvailabilitySlot>();

    for (const agenda of agendas) {
        const timezone = isValidTimezone(agenda.timezone)
            ? agenda.timezone
            : DEFAULT_TIMEZONE;
        const cadence = Number(agenda.slot_duration_minutes);
        if (!Number.isInteger(cadence) || cadence <= 0) continue;
        const duration = requestedDuration ?? cadence;

        const workingHours = asArray<WorkingHours>(agenda.working_hours);
        const exceptions = asArray<AgendaException>(agenda.exceptions);
        const blocks = asArray<OneTimeBlock | RecurringBlock>(agenda.blocks);
        const doctorAppointments =
            appointmentsByDoctor.get(agenda.doctor_id) ?? [];

        for (
            let date = from;
            date <= to;
            date = addDays(date, 1)
        ) {
            const periods = availabilityPeriodsForDate(
                date,
                workingHours,
                exceptions,
            );

            for (const period of periods) {
                const startMinutes = minutesFromTime(period.startsAt);
                const endMinutes = minutesFromTime(period.endsAt);
                if (
                    startMinutes === null ||
                    endMinutes === null ||
                    endMinutes <= startMinutes
                ) {
                    continue;
                }

                for (
                    let minute = startMinutes;
                    minute + duration <= endMinutes;
                    minute += cadence
                ) {
                    const startTime = timeFromMinutes(minute);
                    const endTime = timeFromMinutes(minute + duration);
                    const slotStart = zonedDateTimeToEpoch(
                        date,
                        startTime,
                        timezone,
                    );
                    const slotEnd = zonedDateTimeToEpoch(
                        date,
                        endTime,
                        timezone,
                    );

                    if (
                        !Number.isFinite(slotStart) ||
                        !Number.isFinite(slotEnd) ||
                        slotEnd <= now
                    ) {
                        continue;
                    }

                    if (
                        unavailableByException(
                            date,
                            minute,
                            minute + duration,
                            exceptions,
                        ) ||
                        blockedByAgenda(
                            date,
                            minute,
                            minute + duration,
                            slotStart,
                            slotEnd,
                            blocks,
                        ) ||
                        doctorAppointments.some((appointment) =>
                            overlaps(
                                slotStart,
                                slotEnd,
                                Date.parse(appointment.starts_at),
                                Date.parse(appointment.ends_at),
                            ),
                        )
                    ) {
                        continue;
                    }

                    const key = `${agenda.doctor_id}|${date}|${startTime}`;
                    if (!unique.has(key)) {
                        unique.set(key, {
                            doctorId: agenda.doctor_id,
                            data: formatBrazilDate(date),
                            inicio: startTime,
                            termino: endTime,
                        });
                    }
                }
            }
        }
    }

    return {
        slots: [...unique.values()].sort(
            (left, right) =>
                toIsoDate(left.data).localeCompare(toIsoDate(right.data)) ||
                left.inicio.localeCompare(right.inicio) ||
                left.doctorId.localeCompare(right.doctorId),
        ),
        coveredDoctorIds,
        missingDoctorIds,
    };
}

function availabilityPeriodsForDate(
    date: string,
    workingHours: WorkingHours[],
    exceptions: AgendaException[],
) {
    const weekday = isoWeekday(date);
    let periods = workingHours
        .filter(
            (hours) =>
                hours.daysOfWeek?.includes(weekday) &&
                date >= hours.validFrom &&
                (!hours.validUntil || date <= hours.validUntil),
        )
        .map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));

    const matching = exceptions.filter((exception) =>
        exceptionApplies(exception, date, weekday),
    );
    const exactAvailable = matching.filter(
        (exception) =>
            exception.available &&
            exception.date === date &&
            exception.periods.length > 0,
    );
    const recurringAvailable = matching.filter(
        (exception) =>
            exception.available &&
            exception.date !== date &&
            exception.periods.length > 0,
    );
    const availableOverride =
        exactAvailable.length > 0 ? exactAvailable : recurringAvailable;

    if (availableOverride.length > 0) {
        periods = availableOverride.flatMap((exception) => exception.periods);
    }

    return mergePeriods(periods);
}

function unavailableByException(
    date: string,
    startMinutes: number,
    endMinutes: number,
    exceptions: AgendaException[],
) {
    const weekday = isoWeekday(date);
    return exceptions.some((exception) => {
        if (
            exception.available ||
            !exceptionApplies(exception, date, weekday)
        ) {
            return false;
        }
        if (exception.periods.length === 0) return true;

        return exception.periods.some((period) => {
            const blockedStart = minutesFromTime(period.startsAt);
            const blockedEnd = minutesFromTime(period.endsAt);
            return (
                blockedStart !== null &&
                blockedEnd !== null &&
                intervalsOverlap(
                    startMinutes,
                    endMinutes,
                    blockedStart,
                    blockedEnd,
                )
            );
        });
    });
}

function exceptionApplies(
    exception: AgendaException,
    date: string,
    weekday: number,
) {
    if (exception.date === date) return true;
    if (!exception.recurrence) return false;
    if (exception.validFrom && date < exception.validFrom) return false;
    if (exception.validUntil && date > exception.validUntil) return false;
    if (
        exception.daysOfWeek?.length &&
        !exception.daysOfWeek.includes(weekday)
    ) {
        return false;
    }
    return true;
}

function blockedByAgenda(
    date: string,
    startMinutes: number,
    endMinutes: number,
    slotStart: number,
    slotEnd: number,
    blocks: Array<OneTimeBlock | RecurringBlock>,
) {
    const weekday = isoWeekday(date);

    return blocks.some((block) => {
        if (block.type === "one_time") {
            return overlaps(
                slotStart,
                slotEnd,
                Date.parse(block.startsAt),
                Date.parse(block.endsAt),
            );
        }

        if (
            !block.daysOfWeek?.includes(weekday) ||
            date < block.validFrom ||
            (block.validUntil && date > block.validUntil)
        ) {
            return false;
        }

        const blockedStart = minutesFromTime(block.startsAt);
        const blockedEnd = minutesFromTime(block.endsAt);
        return (
            blockedStart !== null &&
            blockedEnd !== null &&
            intervalsOverlap(
                startMinutes,
                endMinutes,
                blockedStart,
                blockedEnd,
            )
        );
    });
}

function mergePeriods(periods: TimePeriod[]) {
    const normalized = periods
        .map((period) => ({
            start: minutesFromTime(period.startsAt),
            end: minutesFromTime(period.endsAt),
        }))
        .filter(
            (period): period is { start: number; end: number } =>
                period.start !== null &&
                period.end !== null &&
                period.end > period.start,
        )
        .sort((left, right) => left.start - right.start);

    const merged: Array<{ start: number; end: number }> = [];
    for (const period of normalized) {
        const previous = merged[merged.length - 1];
        if (!previous || period.start > previous.end) {
            merged.push({ ...period });
        } else {
            previous.end = Math.max(previous.end, period.end);
        }
    }

    return merged.map((period) => ({
        startsAt: timeFromMinutes(period.start),
        endsAt: timeFromMinutes(period.end),
    }));
}

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeProcedureName(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function validateDateRange(from: string, to: string) {
    if (!isIsoDate(from) || !isIsoDate(to) || to < from) {
        throw new Error("Intervalo de disponibilidade inválido.");
    }
    if (daysBetween(from, to) > 366) {
        throw new Error("Intervalo de disponibilidade muito amplo.");
    }
}

function isIsoDate(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const date = new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    );
    return (
        date.getUTCFullYear() === Number(match[1]) &&
        date.getUTCMonth() === Number(match[2]) - 1 &&
        date.getUTCDate() === Number(match[3])
    );
}

function daysBetween(from: string, to: string) {
    return Math.round(
        (Date.parse(`${to}T12:00:00Z`) -
            Date.parse(`${from}T12:00:00Z`)) /
            86_400_000,
    );
}

function isoWeekday(date: string) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    return day === 0 ? 7 : day;
}

function minutesFromTime(value: string) {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
}

function timeFromMinutes(value: number) {
    const hour = Math.floor(value / 60);
    const minute = value % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function intervalsOverlap(
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number,
) {
    return firstStart < secondEnd && firstEnd > secondStart;
}

function overlaps(
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number,
) {
    return (
        Number.isFinite(secondStart) &&
        Number.isFinite(secondEnd) &&
        intervalsOverlap(firstStart, firstEnd, secondStart, secondEnd)
    );
}

function zonedDateTimeToEpoch(date: string, time: string, timeZone: string) {
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    let offset = timezoneOffsetMs(timeZone, new Date(guess));
    let result = guess - offset;
    const correctedOffset = timezoneOffsetMs(timeZone, new Date(result));
    if (correctedOffset !== offset) {
        offset = correctedOffset;
        result = guess - offset;
    }
    return result;
}

function timezoneOffsetMs(timeZone: string, value: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((item) => item.type === type)?.value ?? 0);

    const asUtc = Date.UTC(
        part("year"),
        part("month") - 1,
        part("day"),
        part("hour"),
        part("minute"),
        part("second"),
    );
    return asUtc - value.getTime();
}

function todayInTimeZone(timeZone: string) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

function addDays(value: string, days: number) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function formatBrazilDate(value: string) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
}

function toIsoDate(value: string) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

function isValidTimezone(value: string) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
    } catch {
        return false;
    }
}
