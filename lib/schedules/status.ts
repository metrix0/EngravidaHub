// lib/schedules/status.ts
export type ScheduleStatusGroup =
    | "pending"
    | "arrived"
    | "in_service"
    | "attended"
    | "cancelled"
    | "no_show"
    | "rescheduled"
    | "unknown";

const RAW_VALUES_BY_GROUP: Record<ScheduleStatusGroup, string[]> = {
    pending: ["Não"],
    arrived: ["Sim"],
    in_service: ["Em Atendimento"],
    attended: ["Atendido"],
    cancelled: ["Desmarcou"],
    no_show: ["Faltou"],
    rescheduled: ["Remarcou"],
    unknown: [],
};

const LABELS: Record<ScheduleStatusGroup, string> = {
    pending: "Pendente",
    arrived: "Chegou",
    in_service: "Em atendimento",
    attended: "Atendido",
    cancelled: "Cancelado",
    no_show: "Faltou",
    rescheduled: "Remarcado",
    unknown: "Status desconhecido",
};

const FILTER_ALIASES: Record<string, ScheduleStatusGroup[]> = {
    pending: ["pending"],
    pendente: ["pending"],
    pendentes: ["pending"],
    nao: ["pending"],

    confirmed: ["arrived"],
    confirmado: ["arrived"],
    confirmada: ["arrived"],
    arrived: ["arrived"],
    chegou: ["arrived"],
    sim: ["arrived"],

    in_service: ["in_service"],
    em_atendimento: ["in_service"],

    completed: ["attended"],
    concluido: ["attended"],
    concluida: ["attended"],
    attended: ["attended"],
    atendido: ["attended"],
    atendida: ["attended"],

    showed_up: ["arrived", "in_service", "attended"],
    compareceu: ["arrived", "in_service", "attended"],
    compareceram: ["arrived", "in_service", "attended"],
    comparecimento: ["arrived", "in_service", "attended"],

    cancelled: ["cancelled"],
    canceled: ["cancelled"],
    cancelado: ["cancelled"],
    cancelada: ["cancelled"],
    cancelados: ["cancelled"],
    canceladas: ["cancelled"],
    desmarcou: ["cancelled"],

    no_show: ["no_show"],
    faltou: ["no_show"],
    falta: ["no_show"],
    nao_compareceu: ["no_show"],

    rescheduled: ["rescheduled"],
    reagendado: ["rescheduled"],
    reagendada: ["rescheduled"],
    remarcado: ["rescheduled"],
    remarcada: ["rescheduled"],
    remarcou: ["rescheduled"],
};

export function normalizeScheduleStatus(
    value: string | null | undefined,
): ScheduleStatusGroup {
    const normalized = normalizeStatusText(value);

    switch (normalized) {
        case "nao":
            return "pending";
        case "sim":
            return "arrived";
        case "em_atendimento":
            return "in_service";
        case "atendido":
        case "atendida":
            return "attended";
        case "desmarcou":
        case "cancelado":
        case "cancelada":
            return "cancelled";
        case "faltou":
        case "nao_compareceu":
            return "no_show";
        case "remarcou":
        case "remarcado":
        case "remarcada":
        case "reagendado":
        case "reagendada":
            return "rescheduled";
        default:
            return "unknown";
    }
}

export function getScheduleStatusLabel(status: ScheduleStatusGroup) {
    return LABELS[status];
}

export function scheduleShowedUp(status: ScheduleStatusGroup) {
    return ["arrived", "in_service", "attended"].includes(status);
}

export function scheduleIsInactive(status: ScheduleStatusGroup) {
    return status === "cancelled" || status === "rescheduled";
}

export function getScheduleStatusFlags(value: string | null | undefined) {
    const statusGroup = normalizeScheduleStatus(value);

    return {
        status_group: statusGroup,
        status_label: getScheduleStatusLabel(statusGroup),
        cancelled: statusGroup === "cancelled",
        showed_up: scheduleShowedUp(statusGroup),
        completed: statusGroup === "attended",
        no_show: statusGroup === "no_show",
        rescheduled: statusGroup === "rescheduled",
        pending: statusGroup === "pending",
    };
}

export function resolveScheduleStatusFilters(values: string[]) {
    if (values.length === 0) return [];

    const groups = new Set<ScheduleStatusGroup>();
    const rawValues = new Set<string>();

    for (const value of values) {
        const normalized = normalizeStatusText(value);

        if (normalized === "all" || normalized === "todos") return [];

        // "scheduled" means appointment records as a whole. Use "pending"
        // when the desired CliniSys state is specifically agenda_chegou = Não.
        if (normalized === "scheduled" || normalized === "agendado") return [];

        const aliases = FILTER_ALIASES[normalized];
        if (aliases) {
            for (const group of aliases) groups.add(group);
            continue;
        }

        const cleanRawValue = value.trim();
        if (cleanRawValue) rawValues.add(cleanRawValue);
    }

    for (const group of groups) {
        for (const rawValue of RAW_VALUES_BY_GROUP[group]) {
            rawValues.add(rawValue);
        }
    }

    return [...rawValues];
}

function normalizeStatusText(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}
