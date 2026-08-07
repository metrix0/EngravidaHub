// lib/clients/callTracking.ts
export type ClientCallClosureTone = "neutral" | "positive" | "negative";
export type ClientCallClosureGroup =
    | "Sem contato"
    | "Não avançou"
    | "Avançou"
    | "Outro";

export const CLIENT_CALL_CLOSURE_OPTIONS = [
    {
        value: "no_answer",
        label: "Não atendeu",
        tone: "neutral",
        group: "Sem contato",
    },
    {
        value: "no_time_to_talk",
        label: "Sem tempo para falar",
        tone: "neutral",
        group: "Sem contato",
    },
    {
        value: "call_back_later",
        label: "Pediu retorno depois",
        tone: "neutral",
        group: "Sem contato",
    },
    {
        value: "invalid_number",
        label: "Número não existe",
        tone: "negative",
        group: "Sem contato",
    },
    {
        value: "price_objection",
        label: "Preço muito caro",
        tone: "negative",
        group: "Não avançou",
    },
    {
        value: "no_availability",
        label: "Sem disponibilidade",
        tone: "negative",
        group: "Não avançou",
    },
    {
        value: "not_interested",
        label: "Sem interesse",
        tone: "negative",
        group: "Não avançou",
    },
    {
        value: "rescheduled",
        label: "Reagendou",
        tone: "positive",
        group: "Avançou",
    },
    {
        value: "scheduled",
        label: "Novo agendamento",
        tone: "positive",
        group: "Avançou",
    },
    {
        value: "other",
        label: "Outro",
        tone: "neutral",
        group: "Outro",
    },
] as const satisfies ReadonlyArray<{
    value: string;
    label: string;
    tone: ClientCallClosureTone;
    group: ClientCallClosureGroup;
}>;

export type ClientCallClosureTag =
    (typeof CLIENT_CALL_CLOSURE_OPTIONS)[number]["value"];

export const DEFAULT_CLIENT_CALL_CLOSURE_TAG: ClientCallClosureTag = "no_answer";

export function isClientCallClosureTag(
    value: unknown,
): value is ClientCallClosureTag {
    return (
        typeof value === "string" &&
        CLIENT_CALL_CLOSURE_OPTIONS.some((option) => option.value === value)
    );
}

export function getClientCallClosureLabel(value: string | null | undefined) {
    if (!value) return "Outro";

    return (
        CLIENT_CALL_CLOSURE_OPTIONS.find((option) => option.value === value)
            ?.label ?? value
    );
}

export function getClientCallClosureTone(
    value: string | null | undefined,
): ClientCallClosureTone | null {
    if (!value) return null;

    return (
        CLIENT_CALL_CLOSURE_OPTIONS.find((option) => option.value === value)
            ?.tone ?? null
    );
}
