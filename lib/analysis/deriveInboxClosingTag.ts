// Exact closing-tag labels already stored in Engravida clients.
import type { ConversationAnalysis } from "@/types";

export const EXISTING_INBOX_CLOSING_TAGS = [
    "-",
    "Agendamento de 1ª avaliação",
    "Agendamento de 1º ultrassom de preparo endometrial",
    "Agendamento de avaliação (após 6 meses)",
    "Agendou - Gostaria de doar",
    "Assistência",
    "Avaliação de ciclo",
    "Beta HCG",
    "Cancelada por falta de confirmação",
    "Cancelamento de 1ª avaliação",
    "Cobrança de pagamento antecipado ou online",
    "Confirmação de 1ª avaliação",
    "Currículo",
    "Doação familiar",
    "Dúvidas",
    "Dúvidas gerais",
    "Encerramento automático de tickets",
    "Exames",
    "Financeiro",
    "FIV - Início de ciclo",
    "Fraude",
    "Gostaria de doar",
    "Gostaria de trazer doadora",
    "Já é paciente",
    "Lembrete de 1ª avaliação",
    "Lembretes",
    "Medicações",
    "Não agendou 1ª Avaliação",
    "Nascidos vivos",
    "Orientações",
    "Outros",
    "Outros setores",
    "Ovorecepção",
    "Pesquisa",
    "Progesterona",
    "Reagendamento",
    "Reagendamento de 1ª avaliação",
    "Reclamações",
    "Reembolso",
    "Resgate de 1ª avaliação",
    "Sem retorno da paciente",
    "TED - Início de ciclo",
    "Telefone não é da pessoa",
    "Termo de descarte",
    "Termos do tratamento",
    "TESTE",
    "Urologia",
    "Útero substituição",
    "Vagas/Currículos"
] as const;
export type ExistingInboxClosingTag = typeof EXISTING_INBOX_CLOSING_TAGS[number];

export const INBOX_CLOSING_TAG_PROMPT = `
TAG DE FECHAMENTO
- Classifique toda a conversa pelo assunto e pelo desfecho, escolhendo UMA closing_tag.value exatamente entre as tags disponíveis abaixo.
- Os objetivos genéricos da análise não limitam as tags: verifique o texto para identificar Financeiro, Assistência, Exames, Medicações, tratamento, doação, reclamações, cancelamento etc.
- É obrigatório preencher closing_tag.evidence_message_ids com IDs reais de mensagens que sustentem a tag. Se não houver evidências, retorne value=null e evidence_message_ids=[].
- Não invente etiquetas nem altere grafia. Quando houver evidência de um assunto específico, prefira sua tag a "Outros".
- Não confunda agendamento realizado com oferta de horários. Identifique claramente primeira avaliação, exames e demais procedimentos.
- "Não agendou 1ª Avaliação" exige tentativa de agendar primeira avaliação sem sucesso.
- "Sem retorno da paciente" exige espera por resposta e não pode ser inferida pelo fim do transcript.
- "Encerramento automático de tickets", "-" e "TESTE" não devem ser usados como fallback por falta de assunto.
- Termos clínicos/específicos exigem menção inequívoca. Sem contexto suficiente, retorne null.
TAGS DISPONÍVEIS:
${EXISTING_INBOX_CLOSING_TAGS.map(tag => "- " + tag).join("\n")}`;

const TAGS = {
    scheduled: "Agendamento de 1ª avaliação",
    rescheduled: "Reagendamento de 1ª avaliação",
    confirmed: "Confirmação de 1ª avaliação",
    noSchedule: "Não agendou 1ª Avaliação",
    noResponse: "Sem retorno da paciente",
    questions: "Dúvidas gerais",
    guidance: "Orientações",
} as const;

type ClosingTagEvidence = Pick<
    ConversationAnalysis,
    "conversation_goal" | "goal_status" | "customer_final_state" |
    "outcome_events" | "dropoff" | "resolution" | "closing_tag"
>;

export function deriveInboxClosingTag(analysis: ClosingTagEvidence): ExistingInboxClosingTag | null {
    // New analyses can use all known tags; older queued analyses keep the legacy fallback below.
    if (analysis.closing_tag !== undefined) {
        const selected = analysis.closing_tag;
        if (!selected?.value || selected.evidence_message_ids.length === 0) return null;
        const tag = selected.value;
        if (!(EXISTING_INBOX_CLOSING_TAGS as readonly string[]).includes(tag)) return null;
        const strongEvent = (type: ConversationAnalysis["outcome_events"][number]["type"]) =>
            analysis.outcome_events.some(e => e.type === type && e.confidence >= 0.8 && e.evidence_message_ids.length > 0);
        if (tag === TAGS.scheduled &&
            (analysis.goal_status !== "achieved" || analysis.customer_final_state !== "scheduled" || !strongEvent("appointment_scheduled"))) return null;
        if (tag === TAGS.rescheduled && !strongEvent("appointment_rescheduled")) return null;
        if (tag === TAGS.confirmed && !strongEvent("attendance_confirmed")) return null;
        if (tag === TAGS.noSchedule &&
            (analysis.goal_status === "achieved" || strongEvent("appointment_scheduled") || strongEvent("appointment_rescheduled"))) return null;
        if (tag === TAGS.noResponse &&
            (!analysis.dropoff.happened || analysis.customer_final_state !== "stopped_responding")) return null;
        return tag;
    }

    const hasEvidence = (type: ConversationAnalysis["outcome_events"][number]["type"]) =>
        analysis.outcome_events.some((event) =>
            event.type === type &&
            event.confidence >= 0.8 &&
            event.evidence_message_ids.length > 0
        );

    if (
        analysis.conversation_goal === "reschedule_consultation" &&
        analysis.goal_status === "achieved" &&
        (analysis.customer_final_state === "rescheduled" ||
            analysis.customer_final_state === "scheduled") &&
        (hasEvidence("appointment_rescheduled") || hasEvidence("appointment_scheduled"))
    ) return TAGS.rescheduled;

    if (
        analysis.conversation_goal === "schedule_consultation" &&
        analysis.goal_status === "achieved" &&
        analysis.customer_final_state === "scheduled" &&
        hasEvidence("appointment_scheduled")
    ) return TAGS.scheduled;

    if (
        analysis.conversation_goal === "confirm_attendance" &&
        analysis.goal_status === "achieved" &&
        analysis.customer_final_state === "confirmed_attendance" &&
        hasEvidence("attendance_confirmed")
    ) return TAGS.confirmed;

    if (
        analysis.customer_final_state === "stopped_responding" &&
        analysis.goal_status !== "achieved" &&
        analysis.dropoff.happened &&
        analysis.dropoff.confidence >= 0.8 &&
        analysis.dropoff.evidence_message_ids.length > 0 &&
        analysis.resolution.reasoning_category === "customer_abandoned"
    ) return TAGS.noResponse;

    if (
        analysis.conversation_goal === "schedule_consultation" &&
        analysis.goal_status === "not_achieved" &&
        ["asked_to_think", "objected_to_price", "received_information", "not_qualified"]
            .includes(analysis.customer_final_state) &&
        !hasEvidence("appointment_scheduled") &&
        analysis.resolution.reasoning_category !== "customer_scheduled"
    ) return TAGS.noSchedule;

    if (
        analysis.conversation_goal === "answer_information" &&
        analysis.goal_status === "achieved" &&
        analysis.customer_final_state === "received_information" &&
        hasEvidence("information_answered")
    ) return TAGS.questions;

    if (
        analysis.conversation_goal === "explain_treatment" &&
        analysis.goal_status === "achieved" &&
        analysis.customer_final_state === "received_information" &&
        hasEvidence("information_answered")
    ) return TAGS.guidance;

    return null;
}
