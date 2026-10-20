import type { AgendaFreeSlot } from "@/lib/scheduling/operationalAgenda";

export type AppointmentState = {
    id?: string;
    unit_id?: string;
    doctor_id?: string;
    starts_at?: string;
    ends_at?: string;
    procedure_name?: string;
    status?: string;
};

export type VacancyHistory = {
    id: number;
    entity_id: string;
    operation: string;
    recorded_at: string;
    before_state: AppointmentState | null;
    after_state: AppointmentState | null;
};

export type RecoveryVacancy = {
    id: number;
    unitId: string;
    doctorId: string;
    startsAt: string;
    endsAt: string;
    procedureName: string;
    openedAt: string;
    reason: "cancelled" | "rescheduled";
    filled: boolean;
    filledByClientId: string | null;
    contacted: number;
    responded: number;
};

const ACTIVE = new Set(["scheduled", "confirmed"]);

export function vacancyFromHistory(row: VacancyHistory): Omit<RecoveryVacancy, "filled" | "filledByClientId" | "contacted" | "responded"> | null {
    const before = row.before_state;
    const after = row.after_state;
    if (!before || !ACTIVE.has(before.status ?? "")) return null;
    if (!before.unit_id || !before.doctor_id || !before.starts_at || !before.ends_at) return null;
    const becameCancelled = row.operation === "DELETE" || after?.status === "cancelled";
    const rescheduled = Boolean(after && ACTIVE.has(after.status ?? "") &&
        (after.starts_at !== before.starts_at || after.ends_at !== before.ends_at ||
            after.doctor_id !== before.doctor_id || after.unit_id !== before.unit_id));
    if (!becameCancelled && !rescheduled) return null;
    const start = Date.parse(before.starts_at), end = Date.parse(before.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return {
        id: row.id, unitId: before.unit_id, doctorId: before.doctor_id,
        startsAt: before.starts_at, endsAt: before.ends_at,
        procedureName: before.procedure_name ?? "",
        openedAt: row.recorded_at, reason: becameCancelled ? "cancelled" : "rescheduled",
    };
}

export function matchesRecoveredSlot(slot: AgendaFreeSlot, vacancy: Pick<RecoveryVacancy, "unitId" | "doctorId" | "startsAt" | "endsAt">) {
    return slot.unitId === vacancy.unitId && slot.doctorId === vacancy.doctorId &&
        Date.parse(slot.startsAt) >= Date.parse(vacancy.startsAt) &&
        Date.parse(slot.endsAt) <= Date.parse(vacancy.endsAt);
}

export function normalizeProcedure(value: string) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function compatibleProcedure(a: string, b: string) {
    const first = normalizeProcedure(a), second = normalizeProcedure(b);
    if (!first || !second) return false;
    if (first === second) return true;
    if ((first.includes("1 avaliacao") || first.includes("primeira avaliacao")) &&
        (second.includes("1 avaliacao") || second.includes("primeira avaliacao"))) return true;
    return first.includes("reavaliacao") && second.includes("reavaliacao");
}
