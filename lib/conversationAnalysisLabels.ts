// lib/conversationAnalysisLabels.ts
import type {
    ConversationGoal,
    CustomerFinalState,
    DropoffMoment,
    GoalStatus,
    OutcomeEventType,
} from "@/types/conversation-analysis";

export const CONVERSATION_GOAL_LABELS: Record<ConversationGoal, string> = {
    answer_information: "Informação",
    schedule_consultation: "Agendar consulta",
    reschedule_consultation: "Reagendar consulta",
    confirm_attendance: "Confirmar presença",
    recover_inactive_lead: "Recuperar lead inativo",
    explain_treatment: "Explicar tratamento",
    handle_price_objection: "Tratar objeção de preço",
    collect_documents_or_exams: "Coletar documentos ou exames",
    post_consultation_followup: "Acompanhamento pós-consulta",
    other: "Outro",
};

export const CUSTOMER_START_INTENT_LABELS: Record<string, string> = {
    ...CONVERSATION_GOAL_LABELS,
    asked_to_think: "Pediu tempo para pensar",
};

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
    achieved: "Atingido",
    partially_achieved: "Parcialmente atingido",
    not_achieved: "Não atingido",
    unclear: "Não identificado",
};

export const CUSTOMER_FINAL_STATE_LABELS: Record<CustomerFinalState, string> = {
    scheduled: "Consulta agendada",
    rescheduled: "Consulta reagendada",
    confirmed_attendance: "Presença confirmada",
    received_information: "Recebeu as informações",
    asked_to_think: "Pediu tempo para pensar",
    objected_to_price: "Apresentou objeção ao preço",
    stopped_responding: "Parou de responder",
    redirected: "Foi redirecionado",
    not_qualified: "Não qualificado",
    unclear: "Estado final indefinido",
};

export const OUTCOME_EVENT_LABELS: Record<OutcomeEventType, string> = {
    information_requested: "Informação solicitada",
    information_answered: "Informação respondida",
    consultation_offered: "Consulta oferecida",
    price_presented: "Preço apresentado",
    objection_raised: "Objeção apresentada",
    appointment_scheduled: "Consulta agendada",
    appointment_rescheduled: "Consulta reagendada",
    attendance_confirmed: "Presença confirmada",
    customer_stopped_responding: "Cliente parou de responder",
    attendant_followed_up: "Atendente realizou acompanhamento",
    customer_returned: "Cliente retornou",
    handoff_to_human: "Transferido para atendente",
    handoff_to_unit: "Transferido para unidade",
};

export const DROPOFF_MOMENT_LABELS: Record<Exclude<DropoffMoment, null>, string> = {
    after_price: "Após apresentação do preço",
    after_consultation_online: "Após oferta de consulta online",
    after_unit_presented: "Após apresentação da unidade",
    after_schedule_options: "Após opções de agendamento",
    after_payment_info: "Após informações de pagamento",
    after_medical_question: "Após pergunta médica",
    after_delay: "Após demora no atendimento",
    unknown: "Motivo não identificado",
};

export const DROPOFF_REASON_CODE_LABELS: Record<string, string> = {
    customer_stopped_responding: "Cliente parou de responder",
    stopped_responding: "Cliente parou de responder",
    customer_abandoned: "Cliente abandonou a conversa",
    customer_medical_uncertainty: "Incerteza médica do cliente",
};

export const CONVERSATION_GOAL_OPTIONS = Object.entries(CONVERSATION_GOAL_LABELS).map(
    ([value, label]) => ({ value, label }),
);

export const DROPOFF_MOMENT_OPTIONS = Object.entries(DROPOFF_MOMENT_LABELS).map(
    ([value, label]) => ({ value, label }),
);

export function getConversationGoalLabel(value: string | null | undefined): string {
    if (!value) return "Sem análise";
    return CONVERSATION_GOAL_LABELS[value as ConversationGoal] ?? humanizeAnalysisCode(value);
}

export function getCustomerStartIntentLabel(value: string | null | undefined): string {
    if (!value) return "Não identificada";
    return CUSTOMER_START_INTENT_LABELS[value] ?? humanizeAnalysisCode(value);
}

export function getGoalStatusLabel(value: string | null | undefined): string {
    if (!value) return "Não identificado";
    return GOAL_STATUS_LABELS[value as GoalStatus] ?? humanizeAnalysisCode(value);
}

export function getCustomerFinalStateLabel(value: string | null | undefined): string {
    if (!value) return "Não informado";
    return CUSTOMER_FINAL_STATE_LABELS[value as CustomerFinalState] ?? humanizeAnalysisCode(value);
}

export function getOutcomeEventLabel(value: string | null | undefined): string {
    if (!value) return "Evento não identificado";
    return OUTCOME_EVENT_LABELS[value as OutcomeEventType] ?? humanizeAnalysisCode(value);
}

export function getDropoffMomentLabel(value: string | null | undefined): string {
    if (!value) return "Não identificado";
    return DROPOFF_MOMENT_LABELS[value as Exclude<DropoffMoment, null>] ?? humanizeAnalysisCode(value);
}

export function getDropoffReasonLabel(value: string | null | undefined): string {
    if (!value) return "Não informado";
    return DROPOFF_REASON_CODE_LABELS[value] ?? humanizeAnalysisCode(value);
}

export function humanizeAnalysisCode(value: string): string {
    const normalized = value.trim();
    if (!normalized) return "Não informado";

    // Frases já legíveis permanecem intactas.
    if (/\s/.test(normalized) && !normalized.includes("_")) return normalized;

    const words = normalized
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("pt-BR");

    return words.charAt(0).toLocaleUpperCase("pt-BR") + words.slice(1);
}
