// lib/active-messages/templates.ts

export type ActiveMessageTemplate = {
    id: string;
    name: string;
    description: string;
    preview: string;
    blip_template_name: string;
    language_code: string;
    namespace: string | null;
    parameter_keys: Array<"client_first_name">;
};

/**
 * Temporary local catalogue.
 * Replace blip_template_name/namespace with the approved WhatsApp templates
 * returned by Blip once template synchronisation is connected.
 */
export const ACTIVE_MESSAGE_TEMPLATES: ActiveMessageTemplate[] = [
    {
        id: "retomada_atendimento",
        name: "Retomada de atendimento",
        description: "Reabre o contato com uma mensagem curta e acolhedora.",
        preview:
            "Olá, {{nome}}! Tudo bem? Podemos continuar seu atendimento por aqui?",
        blip_template_name: "engravida_retomada_atendimento",
        language_code: "pt_BR",
        namespace: null,
        parameter_keys: ["client_first_name"],
    },
    {
        id: "lembrete_agendamento",
        name: "Lembrete de agendamento",
        description: "Convida o cliente a retomar ou concluir o agendamento.",
        preview:
            "Olá, {{nome}}! Passando para lembrar que seguimos à disposição para ajudar com seu agendamento.",
        blip_template_name: "engravida_lembrete_agendamento",
        language_code: "pt_BR",
        namespace: null,
        parameter_keys: ["client_first_name"],
    },
    {
        id: "acompanhamento_tratamento",
        name: "Acompanhamento de tratamento",
        description: "Contato de acompanhamento para o próximo passo do tratamento.",
        preview:
            "Olá, {{nome}}! Queremos saber como podemos ajudar você a dar o próximo passo no seu tratamento.",
        blip_template_name: "engravida_acompanhamento_tratamento",
        language_code: "pt_BR",
        namespace: null,
        parameter_keys: ["client_first_name"],
    },
];

export function getActiveMessageTemplate(templateId: string) {
    return (
        ACTIVE_MESSAGE_TEMPLATES.find((template) => template.id === templateId) ??
        null
    );
}

export function getClientFirstName(name: string | null | undefined) {
    const normalized = name?.trim();
    if (!normalized) return "cliente";
    return normalized.split(/\s+/)[0] ?? normalized;
}

export function renderActiveMessageText({
    template,
    clientName,
}: {
    template: ActiveMessageTemplate;
    clientName: string | null | undefined;
}) {
    return template.preview.replaceAll(
        "{{nome}}",
        getClientFirstName(clientName),
    );
}

export function getActiveMessageTemplateParameters({
    template,
    clientName,
}: {
    template: ActiveMessageTemplate;
    clientName: string | null | undefined;
}) {
    return template.parameter_keys.map((key) => {
        if (key === "client_first_name") {
            return getClientFirstName(clientName);
        }

        return "";
    });
}
