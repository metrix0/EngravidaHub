import type { AgendaFreeSlot } from "@/lib/scheduling/operationalAgenda";
import type { SchedulingDoctorOption, SchedulingUnitOption } from "@/types/scheduling";

type RaRule = {
    duration: number;
    days: Partial<Record<number, string[]>>;
    quotas?: Partial<Record<number, { morning?: number; afternoon?: number }>>;
};

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const times = (from: string, last: string, step: number) => {
    const values: string[] = [];
    for (let time = minutes(from); time <= minutes(last); time += step) {
        values.push(String(Math.floor(time / 60)).padStart(2, "0") + ":" + String(time % 60).padStart(2, "0"));
    }
    return values;
};
const rule = (duration: number, days: RaRule["days"], quotas?: RaRule["quotas"]): RaRule => ({ duration, days, quotas });
const normalize = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ").replace(/^dr(?:a)?\.?\s+/, "");

// These are permitted consultation START times, not full CliniSYS opening hours.
// Quinzenal and "conforme escala" dates remain governed by actual CliniSYS availability.
const RA_RULES: Record<string, Record<string, RaRule>> = {
    "sao paulo": {
        "barbara tavares": rule(45, { 2: times("14:00", "16:15", 45), 3: [...times("08:00", "11:00", 45), ...times("13:00", "16:00", 45)], 4: times("08:00", "11:00", 45), 6: times("08:00", "11:00", 45) }),
        "carolina yumi": rule(30, { 1: times("08:00", "11:30", 30), 3: times("13:00", "15:00", 30), 4: times("08:00", "11:30", 30), 6: times("08:00", "11:30", 30) }),
        "laura beatriz": rule(45, { 2: [...times("08:00", "11:00", 45), ...times("13:00", "16:00", 45)], 3: times("14:00", "16:15", 45), 4: times("14:00", "16:15", 45), 6: times("08:00", "11:00", 45) }),
        // The source has contradictory Monday period text; use the explicitly listed starts.
        "mariana coelho": rule(45, { 1: times("13:00", "16:00", 45), 4: times("08:00", "11:00", 45), 5: times("08:00", "11:45", 45), 6: times("08:00", "11:00", 45) }),
        "thais manzione": rule(30, { 1: times("13:00", "16:30", 30), 6: times("08:00", "11:30", 30) }),
    },
    "brasilia": {
        "kelma siqueira": rule(45, { 2: [...times("08:00", "11:00", 45), ...times("13:00", "16:00", 45)], 6: times("08:00", "11:00", 45) }),
        "gisele bussinger": rule(45, { 5: times("08:00", "11:00", 45), 6: times("08:00", "11:00", 45) }),
        "larissa miranda": rule(45, { 1: times("08:00", "11:00", 45), 2: times("08:00", "11:00", 45), 3: times("08:00", "11:00", 45), 4: times("08:00", "11:00", 45), 5: times("08:00", "11:00", 45), 6: times("08:00", "11:00", 45) }),
        "mayane siqueira": rule(45, { 1: [...times("08:00", "11:00", 45), ...times("13:00", "16:00", 45)], 6: times("08:00", "11:00", 45) }),
    },
    "rio de janeiro": {
        "daphne usiglio": rule(45, { 1: [...times("09:00", "11:15", 45), "14:00", "14:45"], 2: [...times("09:00", "11:15", 45), "14:00", "14:45"], 3: [...times("09:00", "11:15", 45), "14:00", "14:45"] }),
        "teresa alves": rule(45, { 3: [...times("09:00", "11:15", 45), "14:00"], 4: [...times("09:00", "11:15", 45), ...times("14:00", "15:30", 45)], 5: [...times("09:00", "11:15", 45), ...times("14:00", "15:30", 45)], 6: times("09:00", "11:15", 45) }),
        "marcos paulo": rule(45, { 1: [...times("09:00", "11:15", 45), ...times("14:00", "16:15", 45)], 2: [...times("09:00", "11:15", 45), ...times("14:00", "15:30", 45)], 4: [...times("09:00", "11:15", 45), ...times("14:00", "16:15", 45)], 5: [...times("09:00", "11:15", 45), "14:00", "14:45"], 6: times("09:00", "11:15", 45) }),
    },
    "salvador": {
        "amanda cutalo": rule(45, { 1: times("08:00", "11:00", 45), 3: times("09:00", "11:15", 45), 4: times("09:00", "11:15", 45) }),
        "joventina de oliveira araujo": rule(45, { 1: times("10:00", "11:30", 45), 2: times("09:00", "11:15", 45), 3: [...times("10:00", "11:30", 45), ...times("14:00", "16:15", 45)], 5: [...times("10:00", "11:30", 45), ...times("14:00", "16:15", 45)] }),
        "joy araujo": rule(45, { 1: times("10:00", "11:30", 45), 2: times("09:00", "11:15", 45), 3: [...times("10:00", "11:30", 45), ...times("14:00", "16:15", 45)], 5: [...times("10:00", "11:30", 45), ...times("14:00", "16:15", 45)] }),
        "vanessa maia": rule(45, { 1: times("13:30", "16:30", 45), 4: times("08:00", "11:00", 45), 5: times("08:00", "11:00", 45), 6: times("08:00", "11:00", 45) }),
    },
    "campinas": {
        "fabio padilla": rule(30, { 1: times("14:30", "17:30", 30), 3: [...times("10:00", "11:30", 30), ...times("14:00", "16:30", 30)], 4: times("15:00", "16:30", 30), 5: times("15:00", "16:30", 30) }, { 1: { afternoon: 1 }, 3: { morning: 2, afternoon: 2 }, 4: { afternoon: 1 }, 5: { afternoon: 1 } }),
    },
    "manaus": {
        "mariana coelho": rule(45, { 1: times("13:00", "16:00", 45) }),
        "pamela duarte": rule(45, { 1: times("09:00", "10:30", 45), 2: ["15:30"], 4: ["15:30"], 5: times("09:00", "10:30", 45), 6: times("09:00", "10:30", 45) }),
        "paula nunes": rule(45, { 2: [...times("08:00", "10:15", 45), "13:00"] }),
    },
    "juiz de fora": {
        "leila lamas": rule(45, { 1: times("09:00", "11:15", 45), 3: [...times("09:00", "11:15", 45), ...times("14:00", "16:15", 45)], 4: times("09:00", "11:15", 45) }),
        "rafaela matos": rule(45, { 1: times("13:30", "15:45", 45), 2: ["08:30"], 5: times("08:45", "12:30", 45) }),
    },
    "bauru": {
        "paula nunes": rule(45, { 1: [...times("08:00", "11:00", 45), ...times("12:45", "14:15", 45)], 2: [...times("08:00", "11:00", 45), ...times("12:45", "14:15", 45)], 3: [...times("08:00", "11:00", 45), ...times("12:45", "14:15", 45)], 4: [...times("08:00", "11:00", 45), ...times("12:45", "14:15", 45)], 5: [...times("08:00", "11:00", 45), ...times("12:45", "14:15", 45)] }),
    },
    "vitoria": {
        "brenda battestin": rule(45, { 2: times("09:30", "11:00", 45), 4: times("14:15", "15:45", 45), 5: times("09:30", "11:00", 45) }),
        "bruna mendes": rule(45, { 1: times("09:45", "11:15", 45), 3: times("10:00", "10:45", 45), 4: times("10:00", "10:45", 45) }),
    },
    "belo horizonte": {
        "thiago souza capatti": rule(45, { 1: times("08:30", "11:30", 45), 2: times("08:30", "11:30", 45) }),
        "laudislena colodetti": rule(45, { 1: times("08:30", "11:30", 45), 2: times("08:30", "11:30", 45), 3: times("08:30", "11:30", 45), 4: [...times("08:30", "11:30", 45), ...times("14:00", "15:30", 45)], 5: times("08:30", "11:30", 45) }),
    },
};

export function raQuotaKey(doctorId: string, date: string, startMinutes: number) {
    return doctorId + "|" + date + "|" + (startMinutes < 720 ? "morning" : "afternoon");
}

export function filterRaFreeSlots(
    slots: AgendaFreeSlot[],
    units: Pick<SchedulingUnitOption, "id" | "name">[],
    doctors: Pick<SchedulingDoctorOption, "id" | "unit_id" | "name">[],
    firstEvaluations: Record<string, number> = {},
    limitQuotas = false,
    isAvailable?: (slot: AgendaFreeSlot) => boolean,
    datedPeriods: Record<string, Array<{ startsAt: string; endsAt: string }>> = {},
): AgendaFreeSlot[] {
    const unitsById = new Map(units.map(unit => [unit.id, unit]));
    const doctorsById = new Map(doctors.map(doctor => [doctor.unit_id + ":" + doctor.id, doctor]));
    const grouped = new Map<string, AgendaFreeSlot[]>();
    for (const slot of slots) {
        const key = slot.unitId + ":" + slot.doctorId + ":" + slot.date;
        grouped.set(key, [...(grouped.get(key) ?? []), slot]);
    }

    const eligible: AgendaFreeSlot[] = [];
    const selectedByQuota = new Map<string, number>();
    for (const group of grouped.values()) {
        const first = group[0];
        const unit = unitsById.get(first.unitId);
        const doctor = doctorsById.get(first.unitId + ":" + first.doctorId);
        if (!unit || !doctor) continue;
        const raRule = RA_RULES[normalize(unit.name)]?.[normalize(doctor.name)];
        if (!raRule) continue;
        const day = new Date(first.date + "T12:00:00Z").getUTCDay();
        const special = datedPeriods[first.unitId + ":" + first.doctorId + ":" + first.date];
        const allowedStarts = raRule.days[day] ?? (special ?? []).flatMap(period =>
            times(period.startsAt, period.endsAt, raRule.duration).filter(clock => minutes(clock) + raRule.duration <= minutes(period.endsAt)));
        if (!allowedStarts.length) continue;

        // CliniSYS may publish 15-minute capacity for a 45-minute evaluation.
        // Only expose starts backed by an uninterrupted interval of the full duration.
        const intervals = group.map(slot => ({ start: Date.parse(slot.startsAt), end: Date.parse(slot.endsAt) }))
            .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end))
            .sort((a, b) => a.start - b.start);
        const contiguous: Array<{ start: number; end: number }> = [];
        for (const interval of intervals) {
            const last = contiguous.at(-1);
            if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
            else contiguous.push({ ...interval });
        }
        if (!contiguous.length) continue;

        const zone = normalize(unit.name) === "manaus" ? "America/Manaus" : "America/Sao_Paulo";
        const anchor = new Date(first.startsAt);
        const anchorClock = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(anchor);
        const anchorMinutes = minutes(anchorClock);
        const anchorEpoch = anchor.getTime();
        for (const clock of allowedStarts) {
            const startMinutes = minutes(clock);
            const quota = raRule.quotas?.[day]?.[startMinutes < 720 ? "morning" : "afternoon"];
            const quotaKey = raQuotaKey(first.doctorId, first.date, startMinutes);
            if (quota !== undefined && (firstEvaluations[quotaKey] ?? 0) + (limitQuotas ? selectedByQuota.get(quotaKey) ?? 0 : 0) >= quota) continue;
            const startsAt = anchorEpoch + (startMinutes - anchorMinutes) * 60_000;
            const endsAt = startsAt + raRule.duration * 60_000;
            if (!contiguous.some(interval => interval.start <= startsAt && interval.end >= endsAt)) continue;
            const candidate = { ...first, id: first.unitId + ":" + first.doctorId + ":" + startsAt, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), durationMinutes: raRule.duration };
            if (isAvailable && !isAvailable(candidate)) continue;
            if (limitQuotas && quota !== undefined) selectedByQuota.set(quotaKey, (selectedByQuota.get(quotaKey) ?? 0) + 1);
            eligible.push(candidate);
        }
    }
    return eligible.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.doctorName.localeCompare(b.doctorName));
}
