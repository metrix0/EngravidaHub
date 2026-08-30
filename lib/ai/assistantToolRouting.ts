// lib/ai/assistantToolRouting.ts
export const ASSISTANT_TOOL_NAMES = [
    "search_clients",
    "get_client_context",
    "search_appointments",
    "get_schedule_overview",
    "search_conversations",
    "get_conversation_context",
    "get_conversation_analysis_overview",
    "search_conversation_content",
    "get_cancellation_analysis",
    "search_social_conversations",
    "get_social_conversation_context",
    "get_meta_attribution_overview",
    "analyze_unit_performance",
    "compare_unit_performance",
    "get_financial_overview",
    "get_paid_media_overview",
    "get_funnel_overview",
    "get_active_message_overview",
    "get_tracking_events_overview",
    "get_internal_team_overview",
    "get_business_overview",
    "create_csv_export",
] as const;

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];

type RoutingMessage = {
    role: "user" | "assistant";
    content: string;
};

const GROUPS: Array<{
    pattern: RegExp;
    tools: AssistantToolName[];
}> = [
    {
        pattern:
            /\b(cliente|clientes|paciente|pacientes|telefone|celular|cpf|e-?mail|cadastro|perfil)\b/i,
        tools: ["search_clients", "get_client_context"],
    },
    {
        pattern:
            /\b(agenda|agendamento|agendamentos|agendar|consulta|consultas|compareceu|comparecimento|faltou|falta|cancelad|cancelamento|desmarc|remarc|m[eé]dic[oa]|doutor[ae]?|dra\.?|procedimento)\w*/i,
        tools: [
            "search_appointments",
            "get_schedule_overview",
            "get_cancellation_analysis",
        ],
    },
    {
        pattern:
            /\b(conversa|conversas|whats?app|mensagem|mensagens|obje[cç][aã]o|obje[cç][oõ]es|abandono|atendimento|resolu[cç][aã]o|satisfa[cç][aã]o|resposta humana|contato humano|tempo de resposta|transcri[cç][aã]o|frase|palavra|texto)\w*/i,
        tools: [
            "search_conversations",
            "get_conversation_context",
            "get_conversation_analysis_overview",
            "search_conversation_content",
        ],
    },
    {
        pattern: /\b(instagram|facebook|messenger|direct|social|dm)\b/i,
        tools: [
            "search_social_conversations",
            "get_social_conversation_context",
            "get_meta_attribution_overview",
        ],
    },
    {
        pattern:
            /\b(unidade|unidades|convers[aã]o|desempenho|benchmark|comparar|compara[cç][aã]o|ranking)\w*/i,
        tools: ["analyze_unit_performance", "compare_unit_performance"],
    },
    {
        pattern:
            /\b(faturamento|financeiro|receita|ticket|nota fiscal|nfs-?e|nfse|m[eé]dico|origem paga)\w*/i,
        tools: ["get_financial_overview"],
    },
    {
        pattern:
            /\b(an[uú]ncio|an[uú]ncios|ads|meta|google|campanha|campanhas|conjunto|ad set|ctr|cpc|roas|m[ií]dia|investimento|atribui[cç][aã]o)\w*/i,
        tools: ["get_paid_media_overview", "get_meta_attribution_overview"],
    },
    {
        pattern: /\b(funil|etapa|etapas|jornada)\w*/i,
        tools: ["get_funnel_overview"],
    },
    {
        pattern:
            /\b(mensagem ativa|resgate|recapta[cç][aã]o|disparo|disparos|template|automa[cç][aã]o)\w*/i,
        tools: ["get_active_message_overview"],
    },
    {
        pattern:
            /\b(evento|eventos|fbclid|gclid|tracking|rastreamento)\w*/i,
        tools: ["get_tracking_events_overview"],
    },
    {
        pattern: /\b(equipe|online|offline|fila|atendente|atendentes)\w*/i,
        tools: ["get_internal_team_overview"],
    },
    {
        pattern: /\b(exportar|exporte|exporta[cç][aã]o|csv|planilha|baixar|download)\w*/i,
        tools: ["create_csv_export"],
    },
    {
        pattern: /\b(geral|neg[oó]cio|opera[cç][aã]o|resumo executivo|vis[aã]o geral)\w*/i,
        tools: ["get_business_overview"],
    },
];

export function selectAssistantToolNames(
    messages: RoutingMessage[],
): AssistantToolName[] {
    const context = messages
        .slice(-6)
        .map((message) => message.content)
        .join("\n");
    const selected = new Set<AssistantToolName>();

    for (const group of GROUPS) {
        if (!group.pattern.test(context)) continue;
        for (const tool of group.tools) selected.add(tool);
    }

    if (selected.has("get_cancellation_analysis")) {
        selected.add("search_conversations");
        selected.add("get_conversation_context");
    }

    if (selected.has("create_csv_export")) {
        selected.add("search_clients");
        selected.add("search_appointments");
        selected.add("search_conversations");
    }

    return selected.size > 0
        ? ASSISTANT_TOOL_NAMES.filter((name) => selected.has(name))
        : [...ASSISTANT_TOOL_NAMES];
}
