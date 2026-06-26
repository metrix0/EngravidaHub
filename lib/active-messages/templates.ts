// lib/active-messages/templates.ts
export type ActiveMessageDatabaseField = "client_first_name";

export type ActiveMessageTemplateParameter = {
    key: string;
    source:
        | { type: "static"; value: string }
        | { type: "database"; field: ActiveMessageDatabaseField }
        | {
              type: "dynamic";
              field_id: string;
              label: string;
              placeholder?: string;
              default_value?: string;
              required?: boolean;
          };
};

export type ActiveMessageTemplate = {
    id: string;
    name: string;
    preview: string;
    blip_template_name: string;
    active_campaign: {
        flow_id: string;
        state_id: string;
        masterstate: string;
    };
    parameters: ActiveMessageTemplateParameter[];
};

export const ACTIVE_MESSAGE_TEMPLATES: ActiveMessageTemplate[] = [
    {
        id: "contato_pesquisa_satisfacao_1a_avaliacao",
        name: "Pesquisa de satisfação — 1ª avaliação",
        preview: [
            "Olá, {{1}}. Tudo bem?",
            "",
            "Me chamo Mariana, sou gerente da clínica Engravida em Brasília. O motivo do meu contato é referente ao preenchimento da nossa pesquisa de satisfação no dia {{2}}. Você atribuiu a nota {{3}} ao atendimento {{4}}, e antes de tudo quero agradecer por ter dedicado um tempo para nos avaliar.",
            "",
            "Como não houve comentários adicionais na pesquisa, tomei a liberdade de entrar em contato para saber se existe algum ponto que gostaria de nos sinalizar ou alguma consideração que considere importante compartilhar. Sua percepção é fundamental para que possamos aprimorar continuamente nosso atendimento e nossos processos.",
            "",
            "Agradeço novamente pelo retorno e fico à disposição para ouvir você, da forma que for mais confortável. Seguimos à disposição para o que precisar.",
        ].join("\n"),
        blip_template_name: "contato_pesquisadesatisfacao_1aavaliacao",
        active_campaign: {
            flow_id: "",
            state_id: "",
            masterstate: "fluxocampanhaativa@msging.net",
        },
        parameters: [
            {
                key: "1",
                source: {
                    type: "database",
                    field: "client_first_name",
                },
            },
            {
                key: "2",
                source: {
                    type: "dynamic",
                    field_id: "survey_date",
                    label: "Data da pesquisa",
                    placeholder: "Ex.: 25/06/2026",
                    required: true,
                },
            },
            {
                key: "3",
                source: {
                    type: "dynamic",
                    field_id: "survey_score",
                    label: "Nota atribuída",
                    placeholder: "Ex.: 8",
                    required: true,
                },
            },
            {
                key: "4",
                source: {
                    type: "dynamic",
                    field_id: "evaluated_service",
                    label: "Atendimento avaliado",
                    placeholder: "Ex.: Recepção",
                    required: true,
                },
            },
        ],
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

export function getActiveMessageDynamicFields(template: ActiveMessageTemplate) {
    return template.parameters.flatMap((parameter) =>
        parameter.source.type === "dynamic"
            ? [
                  {
                      key: parameter.key,
                      ...parameter.source,
                  },
              ]
            : [],
    );
}

export function getActiveMessageTemplateParameters({
    template,
    clientName,
    dynamicValues = {},
}: {
    template: ActiveMessageTemplate;
    clientName: string | null | undefined;
    dynamicValues?: Record<string, string>;
}) {
    return Object.fromEntries(
        template.parameters.map((parameter) => [
            parameter.key,
            resolveParameterValue({
                parameter,
                clientName,
                dynamicValues,
            }),
        ]),
    );
}

export function renderActiveMessageText({
    template,
    clientName,
    dynamicValues = {},
}: {
    template: ActiveMessageTemplate;
    clientName: string | null | undefined;
    dynamicValues?: Record<string, string>;
}) {
    const parameters = getActiveMessageTemplateParameters({
        template,
        clientName,
        dynamicValues,
    });

    return Object.entries(parameters).reduce(
        (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
        template.preview,
    );
}

function resolveParameterValue({
    parameter,
    clientName,
    dynamicValues,
}: {
    parameter: ActiveMessageTemplateParameter;
    clientName: string | null | undefined;
    dynamicValues: Record<string, string>;
}) {
    if (parameter.source.type === "static") {
        return parameter.source.value;
    }

    if (parameter.source.type === "database") {
        if (parameter.source.field === "client_first_name") {
            return getClientFirstName(clientName);
        }

        return "";
    }

    return (
        dynamicValues[parameter.source.field_id]?.trim() ||
        parameter.source.default_value?.trim() ||
        ""
    );
}
