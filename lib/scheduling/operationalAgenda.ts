// lib/scheduling/operationalAgenda.ts
import { hasFreshClinisysAvailabilitySnapshot, replicatedAgendaCapacity, replicatedAgendaRestrictions, type AgendaRow } from "@/lib/clinisys/replicatedAvailability";
import { mergeIntervals } from "@/lib/scheduling/agendaIntelligence";

import type { BookingTeam } from "@/lib/scheduling/bookingOrigin";
export type OperationalAgenda = AgendaRow & { id?: string; unit_id: string; unit_name: string; doctor_name: string };
export type OperationalAppointment = { id: string; unit_id: string; doctor_id: string; starts_at: string; ends_at: string; status: string; booking_team?: BookingTeam; source_external_id?: string | null };
export type AgendaCounts = { total: number; available: number; open: number; ra: number; unit: number; unknown: number; blocked: number; occupancy: number | null; raOccupancy: number | null; unitOccupancy: number | null };
export type AgendaFreeSlot = { id: string; unitId: string; unitName: string; doctorId: string; doctorName: string; date: string; startsAt: string; endsAt: string; durationMinutes: number };
export type AgendaBlock = { id: string; unitId: string; doctorId: string; doctorName: string; date: string; startsAt: string; endsAt: string; reason: string };
type Interval = { start: number; end: number };
// CliniSYS labels may contain UTF-8 bytes decoded as DOS CP850.
const AGENDA_TEXT_REPAIRS: Record<string, string> = {"├ü": "Á", "├Ç": "À", "├é": "Â", "├â": "Ã", "├ä": "Ä", "├ë": "É", "├ê": "È", "├è": "Ê", "├ï": "Ë", "├ì": "Í", "├î": "Ì", "├Ä": "Î", "├Å": "Ï", "├ô": "Ó", "├Æ": "Ò", "├ö": "Ô", "├ò": "Õ", "├û": "Ö", "├Ü": "Ú", "├Ö": "Ù", "├ø": "Û", "├£": "Ü", "├ç": "Ç", "├í": "á", "├á": "à", "├ó": "â", "├ú": "ã", "├ñ": "ä", "├®": "é", "├¿": "è", "├¬": "ê", "├½": "ë", "├¡": "í", "├¼": "ì", "├«": "î", "├»": "ï", "├│": "ó", "├▓": "ò", "├┤": "ô", "├Á": "õ", "├Â": "ö", "├║": "ú", "├╣": "ù", "├╗": "û", "├╝": "ü", "├º": "ç"};
export const normalizeAgendaText = (value: string) => value.replace(/├[\s\S]/g, pair => AGENDA_TEXT_REPAIRS[pair] ?? pair);
const DAY = 86_400_000, MINUTE = 60_000;
const BUSY = new Set(["scheduled", "confirmed", "completed", "no_show"]);
export const agendaDate = (value: number | string = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export const agendaAddDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export const agendaMonthStart = (date: string, offset = 0) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + offset, 1, 12)).toISOString().slice(0, 10);
export const agendaWeekStart = (date: string) => agendaAddDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
const epoch = (date: string) => Date.parse(`${date}T00:00:00-03:00`);
const intersects = (a: Interval, b: Interval) => a.start < b.end && a.end > b.start;
function subtract(capacity: Interval[], occupied: Interval[]) {
    return capacity.flatMap(interval => {
        let start = interval.start; const result: Interval[] = [];
        for (const busy of occupied) {
            if (!intersects({ start, end: interval.end }, busy)) continue;
            if (busy.start > start) result.push({ start, end: busy.start });
            start = Math.max(start, busy.end);
        }
        if (start < interval.end) result.push({ start, end: interval.end });
        return result;
    });
}
export function agendaCounts(): AgendaCounts { return { total: 0, available: 0, open: 0, ra: 0, unit: 0, unknown: 0, blocked: 0, occupancy: null, raOccupancy: null, unitOccupancy: null }; }
function sum(rows: AgendaCounts[]) {
    const result = agendaCounts();
    for (const row of rows) for (const key of ["total", "available", "open", "ra", "unit", "unknown", "blocked"] as const) result[key] += row[key];
    // The reference uses all slots, including blocked slots, as the occupancy base.
    const useful = result.total;
    if (useful) { result.occupancy = (result.ra + result.unit + result.unknown) / useful * 100; result.raOccupancy = result.ra / useful * 100; result.unitOccupancy = result.unit / useful * 100; }
    return result;
}

export function buildOperationalAgenda(input: { agendas: OperationalAgenda[]; appointments: OperationalAppointment[]; start: string; end: string; reportDate?: string; now?: number }) {
    const now = input.now ?? Date.now(), reportDate = input.reportDate ?? agendaDate(now);
    const reportNow = reportDate === agendaDate(now) ? now : epoch(reportDate);
    const historyStart = agendaMonthStart(input.start, -6);
    const horizonEnd = agendaMonthStart(reportDate, 2);
    const last = [input.end, horizonEnd, agendaMonthStart(input.start, 1)].sort().at(-1)!;
    const groups = new Map<string, OperationalAgenda[]>();
    input.agendas.forEach(source => { const agenda = { ...source, unit_name: normalizeAgendaText(source.unit_name), doctor_name: normalizeAgendaText(source.doctor_name) }; const key = `${agenda.unit_id}:${agenda.doctor_id}`; groups.set(key, [...(groups.get(key) ?? []), agenda]); });
    const daily: Array<AgendaCounts & { date: string; unitId: string; unitName: string; doctorId: string; doctorName: string }> = [];
    const freeSlots: AgendaFreeSlot[] = [], blocks: AgendaBlock[] = [];
    const appointmentsByDoctor = new Map<string, OperationalAppointment[]>();
    input.appointments.filter(item => BUSY.has(item.status)).forEach(item => {
        const key = `${item.unit_id}:${item.doctor_id}`;
        appointmentsByDoctor.set(key, [...(appointmentsByDoctor.get(key) ?? []), item]);
    });
    for (const [key, agendas] of groups) {
        const agenda = agendas[0], duration = Math.min(...agendas.map(row => row.slot_duration_minutes).filter(value => value > 0));
        if (!Number.isFinite(duration)) continue;
        const appointments = appointmentsByDoctor.get(key) ?? [];
        for (let date = historyStart; date < last; date = agendaAddDays(date, 1)) {
            const dayStart = epoch(date), dayEnd = epoch(agendaAddDays(date, 1));
            const dayAppointments = appointments.filter(item => Date.parse(item.starts_at) < dayEnd && Date.parse(item.ends_at) > dayStart);
            const busy = mergeIntervals(dayAppointments.map(item => ({ start: Math.max(dayStart, Date.parse(item.starts_at)), end: Math.min(dayEnd, Date.parse(item.ends_at)) })));
            const nominal = mergeIntervals(agendas.flatMap(row => replicatedAgendaCapacity({ ...row, availability_snapshot: null, blocks: [], exceptions: Array.isArray(row.exceptions) ? row.exceptions.filter(item => item.available) : [] }, date, now)));
            const usable = mergeIntervals([...agendas.flatMap(row => replicatedAgendaCapacity(row, date, now)), ...busy]);
            // Fresh live snapshots contain free time only; missing time is not evidence of a block.
            const knownCapacity = mergeIntervals(agendas.flatMap(row => replicatedAgendaCapacity({ ...row, availability_snapshot: null }, date, now)));
            const remainingBlocks = subtract(nominal, mergeIntervals([...knownCapacity, ...busy]));
            let blocked = 0;
            for (const interval of nominal) for (let cursor = interval.start; cursor + duration * MINUTE <= interval.end; cursor += duration * MINUTE) {
                if (remainingBlocks.some(block => intersects({ start: cursor, end: cursor + duration * MINUTE }, block))) blocked++;
            }
            const counts = agendaCounts(); counts.blocked = blocked;
            const free = subtract(usable, busy);
            for (const interval of free) {
                // Non-overlapping consultations, rather than all overlapping 15-minute alternatives.
                let cursor = Math.ceil(interval.start / (15 * MINUTE)) * 15 * MINUTE;
                for (; cursor + duration * MINUTE <= interval.end; cursor += duration * MINUTE) {
                    if (cursor < reportNow) counts.open++; else counts.available++;
                    if (cursor >= reportNow && date >= reportDate) freeSlots.push({ id: `${key}:${cursor}`, unitId: agenda.unit_id, unitName: agenda.unit_name, doctorId: agenda.doctor_id, doctorName: agenda.doctor_name, date, startsAt: new Date(cursor).toISOString(), endsAt: new Date(cursor + duration * MINUTE).toISOString(), durationMinutes: duration });
                }
            }
            for (const interval of busy) {
                for (let cursor = interval.start; cursor < interval.end; cursor += duration * MINUTE) {
                    const teams = new Set(dayAppointments.filter(item => intersects({ start: cursor, end: Math.min(cursor + duration * MINUTE, interval.end) }, { start: Date.parse(item.starts_at), end: Date.parse(item.ends_at) })).map(item => item.booking_team ?? null));
                    const team = teams.size === 1 ? [...teams][0] : null;
                    counts[team === "ra" ? "ra" : team === "unit" ? "unit" : "unknown"]++;
                }
            }
            counts.total = counts.available + counts.open + counts.ra + counts.unit + counts.unknown + counts.blocked;
            daily.push({ ...sum([counts]), date, unitId: agenda.unit_id, unitName: agenda.unit_name, doctorId: agenda.doctor_id, doctorName: agenda.doctor_name });
            if (date >= input.start && date < input.end) {
                const unique = new Map<string, AgendaBlock>();
                agendas.forEach(row => replicatedAgendaRestrictions(row, date).forEach(block => {
                    const id = `${key}:${block.start}:${block.end}:${block.reason}`;
                    unique.set(id, { id, unitId: row.unit_id, doctorId: row.doctor_id, doctorName: row.doctor_name, date, startsAt: new Date(block.start).toISOString(), endsAt: new Date(block.end).toISOString(), reason: normalizeAgendaText(block.reason) });
                }));
                blocks.push(...unique.values());
            }
        }
    }
    freeSlots.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.doctorName.localeCompare(b.doctorName));
    const period = daily.filter(row => row.date >= input.start && row.date < input.end);
    const unitIds = [...new Set(input.agendas.map(row => row.unit_id))];
    const byUnit = unitIds.map(unitId => ({ unitId, unitName: normalizeAgendaText(input.agendas.find(row => row.unit_id === unitId)!.unit_name), ...sum(period.filter(row => row.unitId === unitId)) })).sort((a, b) => a.unitName.localeCompare(b.unitName));
    const byDoctor = [...groups.values()].map(([row]) => ({ unitId: row.unit_id, unitName: row.unit_name, doctorId: row.doctor_id, doctorName: row.doctor_name, ...sum(period.filter(item => item.unitId === row.unit_id && item.doctorId === row.doctor_id)) })).sort((a, b) => (a.occupancy ?? 101) - (b.occupancy ?? 101) || b.available - a.available || a.doctorName.localeCompare(b.doctorName));
    const monthStart = agendaMonthStart(input.start), monthEnd = agendaMonthStart(input.start, 1);
    const previousMonths = Array.from({ length: 6 }, (_, index) => {
        const start = agendaMonthStart(monthStart, -index - 1), end = agendaMonthStart(start, 1);
        return { month: start.slice(0, 7), ...sum(daily.filter(row => row.date >= start && row.date < end)) };
    });
    const previous = sum(previousMonths), month = sum(daily.filter(row => row.date >= monthStart && row.date < monthEnd));
    const denominator = previous.total - previous.blocked, monthlyBase = month.total - month.blocked;
    // Unknown booking origins must not produce a deceptively precise team projection.
    const projection = { month: monthStart.slice(0, 7), base: monthlyBase, ra: denominator && !previous.unknown ? Math.round(monthlyBase * previous.ra / denominator) : null, unit: denominator && !previous.unknown ? Math.round(monthlyBase * previous.unit / denominator) : null, historicalMonths: previousMonths.filter(row => row.total > 0).length, unknown: previous.unknown };
    const weekStart = agendaWeekStart(reportDate);
    const availability = byUnit.map(unit => {
        const slots = freeSlots.filter(slot => slot.unitId === unit.unitId);
        const dates = [...new Set(slots.map(slot => slot.date))];
        const threeDate = dates.find(date => slots.filter(slot => slot.date === date).length >= 3) ?? null;
        const wait = (date: string | null) => date ? Math.round((epoch(date) - epoch(reportDate)) / DAY) : null;
        const saturdayDates = dates.filter(date => new Date(`${date}T12:00:00Z`).getUTCDay() === 6);
        const servesSaturday = daily.some(row => row.unitId === unit.unitId && row.date >= reportDate && new Date(`${row.date}T12:00:00Z`).getUTCDay() === 6 && row.total > 0);
        return { ...unit, firstDate: dates[0] ?? null, firstWaitDays: wait(dates[0] ?? null), threeDate, threeWaitDays: wait(threeDate), nextDates: dates.slice(0, 3), weeks: Array.from({ length: 4 }, (_, index) => slots.filter(slot => slot.date >= agendaAddDays(weekStart, index * 7) && slot.date < agendaAddDays(weekStart, (index + 1) * 7)).length), saturdays: saturdayDates.slice(0, 2).map(date => ({ date, threeOrMore: slots.filter(slot => slot.date === date).length >= 3 })), servesSaturday };
    });
    return { generatedAt: new Date(now).toISOString(), start: input.start, end: input.end, reportDate, horizonEnd: last, counts: sum(period), byUnit, byDoctor, blocks, slots: freeSlots.filter(slot => slot.date >= input.start && slot.date < input.end), availability, daily: Array.from(new Set(period.map(row => row.date))).sort().map(date => ({ date, ...sum(period.filter(row => row.date === date)) })), previousMonths, averagePreviousMonths: previousMonths.some(row => row.total) ? Math.round(previous.total / previousMonths.filter(row => row.total).length) : null, projection, hasLiveAvailability: input.agendas.some(row => hasFreshClinisysAvailabilitySnapshot(row, reportDate, now)) };
}
export type OperationalAgendaReport = ReturnType<typeof buildOperationalAgenda>;
