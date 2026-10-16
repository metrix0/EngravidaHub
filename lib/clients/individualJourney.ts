// lib/clients/individualJourney.ts
import { getClientCallClosureLabel } from "@/lib/clients/callTracking";
import { isFirstEvaluationProcedure } from "@/lib/funnel/clinisysJourney";
import { normalizeScheduleStatus } from "@/lib/schedules/status";

export type JourneyCategory = "origem" | "conversa" | "contato" | "agendamento" | "procedimento" | "financeiro";
export type JourneyEvidence = "registrado" | "inferido";
export type IndividualJourneyEvent = {
    id: string;
    occurredAt: string;
    dateOnly: boolean;
    category: JourneyCategory;
    title: string;
    detail: string | null;
    source: string;
    evidence: JourneyEvidence;
    conversationId?: string;
};
export type IndividualJourney = { events: IndividualJourneyEvent[]; partial: boolean };
export type JourneyRow = Record<string, unknown>;
export type ClientJourneySources = {
    client: JourneyRow | null;
    instagramUsers: JourneyRow[];
    conversations: JourneyRow[];
    analyses: JourneyRow[];
    threads: JourneyRow[];
    adAttributions: JourneyRow[];
    tintim: JourneyRow[];
    adEvents: JourneyRow[];
    calls: JourneyRow[];
    funnelHistory: JourneyRow[];
    appointments: JourneyRow[];
    appointmentHistory: JourneyRow[];
    clinisys: JourneyRow[];
    schedules: JourneyRow[];
    invoices: JourneyRow[];
    partial: boolean;
};

const outcomeLabels: Record<string, string> = {
    information_requested: "Solicitou informações",
    information_answered: "Recebeu informações",
    price_presented: "Recebeu informação de preço",
    handoff_to_human: "Conversa encaminhada a atendente",
    customer_stopped_responding: "Deixou de responder",
    consultation_offered: "Consulta oferecida",
    attendant_followed_up: "Atendente fez acompanhamento",
    appointment_scheduled: "Agendamento mencionado na conversa",
    customer_returned: "Retomou o contato",
    handoff_to_unit: "Encaminhado para a unidade",
    attendance_confirmed: "Comparecimento mencionado na conversa",
    objection_raised: "Apresentou uma objeção",
    appointment_rescheduled: "Reagendamento mencionado na conversa",
};

const value = (item: JourneyRow | null | undefined, key: string) =>
    typeof item?.[key] === "string" && (item[key] as string).trim()
        ? (item[key] as string).trim()
        : null;
const rowObject = (item: unknown): JourneyRow =>
    item && typeof item === "object" && !Array.isArray(item) ? item as JourneyRow : {};
const validDate = (date: string | null) => date && !Number.isNaN(Date.parse(date)) ? date : null;
const label = (value: string | null, fallback: string) => value || fallback;
const short = (value: string | null) => value ? value.slice(0, 220) : null;
const pretty = (value: string | null) => value ? value.replace(/_/g, " ") : null;

export function buildIndividualJourney(input: ClientJourneySources): IndividualJourney {
    const events: IndividualJourneyEvent[] = [];
    const seen = new Set<string>();
    const add = (
        id: string, at: string | null, category: JourneyCategory, title: string,
        detail: string | null, source: string, evidence: JourneyEvidence = "registrado",
        conversationId?: string,
    ) => {
        const time = validDate(at);
        if (!time || seen.has(id)) return;
        seen.add(id);
        events.push({
            id, occurredAt: time, dateOnly: /^\d{4}-\d{2}-\d{2}$/.test(time),
            category, title, detail: short(detail), source, evidence,
            ...(conversationId ? { conversationId } : {}),
        });
    };

    const client = input.client;
    if (client) {
        add("client:first", value(client, "first_seen_at") ?? value(client, "created_at"),
            "contato", "Primeiro registro do cliente", null, "Cadastro");
        const origin = value(client, "last_origin") ?? value(client, "utm_source");
        const campaign = value(client, "utm_campaign");
        if (origin || campaign) {
            const detail = [origin ? "Origem: " + origin : null, campaign ? "Campanha: " + campaign : null].filter(Boolean).join(" · ");
            add("client:origin", value(client, "tracking_updated_at") ?? value(client, "first_seen_at"),
                "origem", "Origem de aquisição registrada", detail + " · Data do registro, não necessariamente do clique.", "Rastreamento");
        }
        add("client:active", value(client, "last_active_message_sent_at"),
            "contato", "Mensagem ativa enviada", "Último envio registrado no perfil.", "Mensagem Ativa");
    }

    for (const social of input.instagramUsers) {
        const id = value(social, "id");
        if (!id) continue;
        add("instagram:" + id, value(social, "first_seen_at"), "contato",
            "Contato pelo Instagram identificado",
            value(social, "username") ? "@" + value(social, "username")!.replace(/^@/, "") : null,
            "Instagram");
    }

    for (const attribution of input.adAttributions) {
        const id = value(attribution, "id");
        const ad = value(attribution, "ad_name") ?? value(attribution, "referral_ad_title");
        const campaign = value(attribution, "campaign_name");
        const adId = value(attribution, "meta_ad_id") ?? value(attribution, "zernio_ad_id");
        if (!id || !(ad || campaign || adId || value(attribution, "referral_source"))) continue;
        const channel = label(value(attribution, "channel"), "Instagram / Messenger");
        add("adref:" + id,
            value(attribution, "referral_received_at") ?? value(attribution, "created_at"),
            "origem", "Contato atribuído a anúncio (" + channel + ")",
            [ad && "Anúncio: " + ad, campaign && "Campanha: " + campaign, !ad && adId && "ID do anúncio: " + adId]
                .filter(Boolean).join(" · ") || "Referência de anúncio recebida.",
            "Referência do anúncio");
    }

    for (const row of input.tintim) {
        const id = value(row, "id");
        if (!id) continue;
        add("tintim:" + id, value(row, "occurred_at"), "origem",
            "Origem do contato rastreada",
            [value(row, "platform"), value(row, "source")].filter(Boolean).join(" · ") || null,
            "Tintim");
    }

    for (const thread of input.threads) {
        const id = value(thread, "id");
        if (!id) continue;
        add("thread:claimed:" + id, value(thread, "claimed_at"), "contato",
            "Atendimento assumido", value(thread, "channel"), "Inbox");
        add("thread:closed:" + id, value(thread, "closed_at"), "conversa",
            "Atendimento arquivado", null, "Inbox");
    }

    for (const conversation of input.conversations) {
        const id = value(conversation, "id");
        if (!id) continue;
        const channel = value(conversation, "channel") ?? value(conversation, "source");
        const attendant = value(conversation, "attendant_chat_name");
        const origin = value(conversation, "origin");
        add("conversation:start:" + id, value(conversation, "started_at"), "conversa",
            "Iniciou conversa" + (channel ? " via " + channel : ""),
            [attendant && "Atendente: " + attendant, origin && "Origem: " + origin].filter(Boolean).join(" · ") || null,
            "Conversas", "registrado", id);
        add("conversation:end:" + id, value(conversation, "ended_at"), "conversa",
            "Conversa finalizada", attendant ? "Atendente: " + attendant : null,
            "Conversas", "registrado", id);
    }

    for (const analysis of input.analyses) {
        const id = value(analysis, "conversation_id");
        const outcomes = Array.isArray(analysis.outcome_events) ? analysis.outcome_events : [];
        outcomes.forEach((raw, index) => {
            const event = rowObject(raw);
            const type = value(event, "type");
            if (!type || !outcomeLabels[type]) return;
            // AI-extracted milestones are not clinical or booking confirmations.
            add("analysis:" + id + ":" + index, value(event, "event_at"),
                "conversa", outcomeLabels[type], "Identificado pela análise de conversa; pode exigir confirmação.",
                "Análise da conversa", "inferido", id ?? undefined);
        });
    }

    for (const call of input.calls) {
        const id = value(call, "id");
        if (!id) continue;
        add("call:" + id, value(call, "called_at"), "contato", "Ligação registrada",
            getClientCallClosureLabel(value(call, "closure_tag")), "Ligações");
    }

    for (const change of input.funnelHistory) {
        const id = value(change, "id");
        if (!id) continue;
        add("funnel:" + id, value(change, "moved_at"), "contato",
            "Etapa do funil alterada", value(change, "note"), "Histórico do funil");
    }

    for (const appointment of input.appointments) {
        const id = value(appointment, "id");
        if (!id) continue;
        const name = value(appointment, "procedure_name");
        const isEvaluation = isFirstEvaluationProcedure(name);
        const entity = isEvaluation ? "consulta" : "procedimento";
        const status = value(appointment, "status");
        const booked = value(appointment, "created_at");
        const scheduled = value(appointment, "starts_at");
        const details = name || null;
        add("appt:booked:" + id, booked, "agendamento",
            "Agendou " + (isEvaluation ? "uma consulta" : "um procedimento"),
            details, "Agenda do Hub");
        add("appt:time:" + id, scheduled, isEvaluation ? "agendamento" : "procedimento",
            status === "completed" ? (isEvaluation ? "Consulta concluída" : "Procedimento concluído")
                : "Horário previsto para " + entity,
            [details, status === "completed" ? "Status atual: concluído. Horário do agendamento, não horário exato de comparecimento." : "Status atual: " + label(status, "não informado")].filter(Boolean).join(" · "),
            "Agenda do Hub");
        if (status === "cancelled" || status === "no_show") {
            add("appt:status:" + id, value(appointment, "updated_at"), "agendamento",
                status === "cancelled" ? "Registro de consulta cancelada" : "Registro de não comparecimento",
                "Data da última atualização do registro, não necessariamente a hora da ocorrência.",
                "Agenda do Hub");
        }
    }

    for (const history of input.appointmentHistory) {
        const id = history.id !== undefined ? String(history.id) : null;
        if (!id || value(history, "operation") !== "UPDATE") continue;
        const before = rowObject(history.before_state);
        const after = rowObject(history.after_state);
        const oldStart = value(before, "starts_at");
        const newStart = value(after, "starts_at");
        const oldStatus = value(before, "status");
        const newStatus = value(after, "status");
        if (oldStart && newStart && oldStart !== newStart) {
            add("appt:reschedule:" + id, value(history, "recorded_at"), "agendamento",
                "Horário do agendamento alterado",
                "De " + oldStart + " para " + newStart, "Histórico da agenda");
        }
        if (oldStatus !== newStatus && newStatus) {
            add("appt:statuschange:" + id, value(history, "recorded_at"), "agendamento",
                "Status do agendamento atualizado",
                "Novo status: " + newStatus, "Histórico da agenda");
        }
    }

    // The two Clinisys feeds may contain the same consultation. Preserve each
    // real appointment only once; don't match patients merely by their names.
    const clinicianSeen = new Set<string>();
    for (const row of [...input.clinisys, ...input.schedules]) {
        const external = value(row, "source_external_id");
        const procedure = value(row, "procedure_name");
        const date = value(row, "scheduled_for");
        const status = value(row, "status");
        const kind = value(row, "event_kind") ?? (isFirstEvaluationProcedure(procedure) ? "evaluation" : "procedure");
        const dedup = external ? "external:" + external : [date, procedure, status, kind].join("|");
        if (clinicianSeen.has(dedup)) continue;
        clinicianSeen.add(dedup);
        const id = value(row, "id");
        if (!id) continue;
        const isEvaluation = kind === "evaluation" || isFirstEvaluationProcedure(procedure);
        const item = isEvaluation ? "consulta" : "procedimento";
        const eventCategory = isEvaluation ? "agendamento" : "procedimento";
        add("clinisys:booked:" + dedup, value(row, "created_in_source_at"), "agendamento",
            "Agendou " + (isEvaluation ? "uma consulta" : "um procedimento"),
            [procedure, "CliniSys informa apenas a data da marcação."].filter(Boolean).join(" · "),
            "CliniSys");
        const group = normalizeScheduleStatus(status);
        let eventTitle = isEvaluation ? "Consulta prevista" : "Procedimento previsto";
        if (group === "attended") eventTitle = isEvaluation ? "Compareceu à consulta" : "Procedimento realizado";
        else if (group === "arrived") eventTitle = "Chegada registrada";
        else if (group === "no_show") eventTitle = "Não compareceu";
        else if (group === "cancelled") eventTitle = item === "consulta" ? "Consulta desmarcada" : "Procedimento desmarcado";
        else if (group === "rescheduled") eventTitle = item === "consulta" ? "Consulta remarcada" : "Procedimento remarcado";
        add("clinisys:scheduled:" + dedup, date, eventCategory,
            eventTitle, [procedure, status ? "Status atual: " + status : null, "Data prevista no CliniSys; não é a hora exata da ocorrência."].filter(Boolean).join(" · "),
            "CliniSys");
    }

    for (const invoice of input.invoices) {
        const id = invoice.source_invoice_id !== undefined ? String(invoice.source_invoice_id) : null;
        if (!id) continue;
        const amount = typeof invoice.amount === "number" || typeof invoice.amount === "string"
            ? Number(invoice.amount) : Number.NaN;
        add("invoice:" + id, value(invoice, "issued_at"), "financeiro",
            "Fatura emitida", [
                value(invoice, "description"), value(invoice, "status") && "Status: " + value(invoice, "status"),
                Number.isFinite(amount) ? "Valor: " + amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null,
            ].filter(Boolean).join(" · ") || null, "Faturamento CliniSys");
    }

    for (const event of input.adEvents) {
        const id = value(event, "id");
        if (!id) continue;
        const kind = value(event, "event_type");
        const platform = value(event, "platform");
        add("conversion:" + id, value(event, "event_date") ?? value(event, "created_at"), "origem",
            "Evento de conversão informado à plataforma",
            [platform, kind, value(event, "status")].filter(Boolean).join(" · ") || null,
            "Integrações de anúncios");
    }

    events.sort((a, b) => {
        const time = (item: IndividualJourneyEvent) => Date.parse(
            item.dateOnly ? item.occurredAt + "T12:00:00Z" : item.occurredAt,
        );
        return time(a) - time(b) || a.id.localeCompare(b.id);
    });
    return { events, partial: input.partial };
}
