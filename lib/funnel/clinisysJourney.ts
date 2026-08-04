// lib/funnel/clinisysJourney.ts
import {
    normalizeScheduleStatus,
    scheduleShowedUp,
    type ScheduleStatusGroup,
} from "@/lib/schedules/status";

export const FIV_FUNNEL_ID = "22222222-2222-2222-2222-222222222222";

export const FIV_STAGE_IDS = {
    evaluationScheduled: "21111111-1111-1111-1111-111111111111",
    evaluationCompleted: "22222222-1111-1111-1111-111111111111",
    procedureScheduled: "23333333-1111-1111-1111-111111111111",
    procedureCompleted: "24444444-1111-1111-1111-111111111111",
} as const;

export const FIV_STAGE_ID_SET = new Set<string>(Object.values(FIV_STAGE_IDS));

export type ClinisysJourneyKind = "evaluation" | "procedure";

export type ClinisysJourneyEvent = {
    id: string;
    client_id: string;
    scheduled_for: string;
    procedure_name: string | null;
    status: string | null;
    event_kind: ClinisysJourneyKind;
};

export type FunnelMilestone = {
    stageId: string;
    event: ClinisysJourneyEvent;
    statusGroup: ScheduleStatusGroup;
};

export function classifyClinisysJourneyProcedure(
    procedureName: string | null | undefined,
): ClinisysJourneyKind | null {
    const normalized = normalizeProcedureText(procedureName);
    if (!normalized) return null;

    if (isFirstEvaluationProcedure(procedureName)) return "evaluation";

    // CliniSys already supplies the canonical appointment/procedure name.
    // Do not maintain a keyword allow-list here: it silently discarded valid
    // consultations, returns, exams and newly-created billable procedures.
    return "procedure";
}

export function isFirstEvaluationProcedure(
    procedureName: string | null | undefined,
) {
    const normalized = normalizeProcedureText(procedureName);
    return /\b(?:1|1a|1o|primeira)\s+avaliacao\b/.test(normalized);
}

export function resolveFunnelMilestone(
    events: ClinisysJourneyEvent[],
    today = new Date(),
): FunnelMilestone | null {
    const candidates = [
        {
            stageId: FIV_STAGE_IDS.procedureCompleted,
            events: events.filter(
                (event) =>
                    event.event_kind === "procedure" &&
                    isCompletedMilestone(event.status),
            ),
            completed: true,
        },
        {
            stageId: FIV_STAGE_IDS.procedureScheduled,
            events: events.filter(
                (event) =>
                    event.event_kind === "procedure" &&
                    !isCompletedMilestone(event.status),
            ),
            completed: false,
        },
        {
            stageId: FIV_STAGE_IDS.evaluationCompleted,
            events: events.filter(
                (event) =>
                    event.event_kind === "evaluation" &&
                    isCompletedMilestone(event.status),
            ),
            completed: true,
        },
        {
            stageId: FIV_STAGE_IDS.evaluationScheduled,
            events: events.filter(
                (event) =>
                    event.event_kind === "evaluation" &&
                    !isCompletedMilestone(event.status),
            ),
            completed: false,
        },
    ];

    for (const candidate of candidates) {
        const event = chooseRepresentativeEvent(
            candidate.events,
            today,
            candidate.completed,
        );
        if (!event) continue;

        return {
            stageId: candidate.stageId,
            event,
            statusGroup: normalizeScheduleStatus(event.status),
        };
    }

    return null;
}

export function isFunnelAttentionState(
    stageId: string | null,
    status: string | null | undefined,
) {
    const statusGroup = normalizeScheduleStatus(status);

    return (
        ((stageId === FIV_STAGE_IDS.evaluationScheduled ||
            stageId === FIV_STAGE_IDS.procedureScheduled) &&
            statusGroup === "cancelled") ||
        ((stageId === FIV_STAGE_IDS.evaluationCompleted ||
            stageId === FIV_STAGE_IDS.procedureCompleted) &&
            statusGroup === "no_show")
    );
}

export function getFunnelAttentionLabel(
    stageId: string | null,
    status: string | null | undefined,
) {
    if (!isFunnelAttentionState(stageId, status)) return null;

    return normalizeScheduleStatus(status) === "cancelled"
        ? "Cancelou"
        : "Faltou";
}

function chooseRepresentativeEvent(
    events: ClinisysJourneyEvent[],
    today: Date,
    completed: boolean,
) {
    if (events.length === 0) return null;

    let candidates = events;

    if (!completed) {
        const active = events.filter((event) => {
            const group = normalizeScheduleStatus(event.status);
            return group !== "cancelled" && group !== "rescheduled";
        });

        if (active.length > 0) candidates = active;
    }

    const todayTime = startOfLocalDay(today).getTime();

    return [...candidates].sort((left, right) => {
        const leftTime = dateOnlyToLocalTime(left.scheduled_for);
        const rightTime = dateOnlyToLocalTime(right.scheduled_for);
        const distance = Math.abs(leftTime - todayTime) - Math.abs(rightTime - todayTime);

        if (distance !== 0) return distance;
        return rightTime - leftTime;
    })[0];
}

function isCompletedMilestone(status: string | null | undefined) {
    const statusGroup = normalizeScheduleStatus(status);
    return scheduleShowedUp(statusGroup) || statusGroup === "no_show";
}

function normalizeProcedureText(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[ªº°]/g, " ")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function dateOnlyToLocalTime(value: string) {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return new Date(year, month - 1, day, 12).getTime();
}

function startOfLocalDay(value: Date) {
    return new Date(
        value.getFullYear(),
        value.getMonth(),
        value.getDate(),
        12,
    );
}
