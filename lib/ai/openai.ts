// lib/ai/openai.ts
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
}

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const PRESENTATION_INSTRUCTIONS = `

REGRAS DE APRESENTAÇÃO OBRIGATÓRIAS:
- Nunca mostre nomes de tabelas, nomes de colunas, campos de banco, UUIDs, IDs internos ou termos técnicos como unit_id, client_id, conversation_id, thread_id, started_at, scheduled_rate ou semelhantes.
- Traduza sempre os dados para linguagem humana em português, como “unidade”, “cliente”, “conversa”, “início”, “taxa de agendamento” e “taxa de abandono”.
- Quando houver pelo menos três categorias numéricas comparáveis e um gráfico ajudar a leitura, insira um gráfico exatamente no ponto relevante da resposta usando um bloco fenced chamado assistant-chart.
- O bloco assistant-chart deve conter somente JSON válido no formato abaixo:
  {"type":"pie|bar|line","title":"Título curto","data":[{"label":"Nome humano","value":12.5}],"valueSuffix":"%"}
- Use pie para composição de um total, bar para comparar categorias e line apenas para evolução temporal.
- Não coloque o gráfico no fim por padrão; posicione-o entre os parágrafos que ele ajuda a explicar.
- Nunca invente dados de gráfico. Use exclusivamente valores retornados pelas ferramentas.
`.trim();

const TECHNICAL_REPLACEMENTS: Array<[RegExp, string]> = [
    [/\bunit_id\b/gi, "unidade"],
    [/\bunit_name\b/gi, "unidade"],
    [/\bclient_id\b/gi, "cliente"],
    [/\bclient_name\b/gi, "cliente"],
    [/\bconversation_id\b/gi, "conversa"],
    [/\bconversation_analysis_id\b/gi, "análise da conversa"],
    [/\bthread_id\b/gi, "conversa"],
    [/\battendant_id\b/gi, "atendente"],
    [/\bservice_id\b/gi, "serviço"],
    [/\banalysis_status\b/gi, "status da análise"],
    [/\bstarted_at\b/gi, "início"],
    [/\bended_at\b/gi, "término"],
    [/\bstarts_at\b/gi, "início"],
    [/\bends_at\b/gi, "término"],
    [/\bcreated_at\b/gi, "criação"],
    [/\bupdated_at\b/gi, "atualização"],
    [/\blast_interaction_at\b/gi, "última interação"],
    [/\bscheduled_rate\b/gi, "taxa de agendamento"],
    [/\bresolved_rate\b/gi, "taxa de resolução"],
    [/\bdropoff_rate\b/gi, "taxa de abandono"],
    [/\banalyzed_conversations\b/gi, "conversas analisadas"],
    [/\baverage_resolution_score\b/gi, "média de resolução"],
    [/\bresolution_score\b/gi, "pontuação de resolução"],
    [/\bresolution_result\b/gi, "resultado da resolução"],
    [/\bsatisfaction_score\b/gi, "satisfação"],
    [/\battendant_quality_score\b/gi, "qualidade do atendimento"],
    [/\bresponse_speed_score\b/gi, "velocidade de resposta"],
    [/\bfirst_human_response_time_seconds\b/gi, "tempo até a primeira resposta humana"],
    [/\baverage_human_response_time_seconds\b/gi, "tempo médio de resposta humana"],
    [/\blongest_human_delay_seconds\b/gi, "maior demora humana"],
    [/\bcustomer_final_state\b/gi, "situação final do cliente"],
    [/\bgoal_status\b/gi, "resultado do objetivo"],
    [/\bdropoff_happened\b/gi, "houve abandono"],
    [/\bdropoff_moment\b/gi, "momento do abandono"],
    [/\bnotable_reason\b/gi, "motivo de destaque"],
    [/\bdate_from\b/gi, "data inicial"],
    [/\bdate_to\b/gi, "data final"],
    [/\bminimum_conversations\b/gi, "mínimo de conversas"],
    [/\bupcoming_appointments\b/gi, "próximos agendamentos"],
    [/\bopen_thread\b/gi, "conversa aberta"],
    [/\brecent_conversations\b/gi, "conversas recentes"],
    [/\btotal_returned\b/gi, "total encontrado"],
    [/\boverall_benchmark\b/gi, "referência geral"],
    [/\bdata_notes\b/gi, "observações sobre os dados"],
];

function withPresentationInstructions(value: unknown) {
    const base = typeof value === "string" ? value.trim() : "";
    return base ? `${base}\n\n${PRESENTATION_INSTRUCTIONS}` : PRESENTATION_INSTRUCTIONS;
}

function sanitizeTechnicalLanguage(value: string) {
    const parts = value.split(/(```assistant-chart\s*[\s\S]*?```)/gi);

    return parts
        .map((part, index) => {
            if (index % 2 === 1) return part;

            let next = part;
            for (const [pattern, replacement] of TECHNICAL_REPLACEMENTS) {
                next = next.replace(pattern, replacement);
            }

            return next.replace(
                /\b[a-z][a-z0-9]*_(?:id|at|rate|score|status|count|result|reason|moment|seconds)\b/gi,
                (term) => term.replace(/_/g, " "),
            );
        })
        .join("");
}

export const openai = {
    responses: {
        async create(parameters: Record<string, unknown>) {
            const response = await client.responses.create({
                ...parameters,
                instructions: withPresentationInstructions(parameters.instructions),
            } as never);

            if (typeof response.output_text !== "string") return response;

            return new Proxy(response, {
                get(target, property, receiver) {
                    if (property === "output_text") {
                        return sanitizeTechnicalLanguage(target.output_text);
                    }
                    return Reflect.get(target, property, receiver);
                },
            });
        },
    },
};
