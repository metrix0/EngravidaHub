// scripts/test-assistant-routing.ts
import assert from "node:assert/strict";

import { summarizeFirstHumanResponseTimes } from "../lib/ai/assistantMetrics";
import { toStatelessContinuationItems } from "../lib/ai/assistantResponseState";
import { applyAssistantUnitScope } from "../lib/ai/assistantToolContext";
import {
    selectAssistantToolNames,
    type AssistantToolName,
} from "../lib/ai/assistantToolRouting";

type RoutingMessage = { role: "user" | "assistant"; content: string };

const routingCases: Array<{
    name: string;
    messages: RoutingMessage[];
    expected: AssistantToolName[];
    forbidden?: AssistantToolName[];
}> = [
    {
        name: "objeções WhatsApp com período relativo",
        messages: [{ role: "user", content: "Analise as objeções nas conversas de WhatsApp dos últimos 15 dias." }],
        expected: ["get_conversation_analysis_overview"],
        forbidden: ["get_paid_media_overview"],
    },
    {
        name: "cancelamentos de primeira avaliação",
        messages: [{ role: "user", content: "Quais os motivos dos cancelamentos de primeiras avaliações?" }],
        expected: ["get_cancellation_analysis", "get_schedule_overview"],
    },
    {
        name: "busca de frase em mensagens",
        messages: [{ role: "user", content: "Procure a frase não consigo pagar nas mensagens." }],
        expected: ["search_conversation_content"],
        forbidden: ["get_financial_overview"],
    },
    {
        name: "atribuição social por cidade",
        messages: [{ role: "user", content: "Compare campanhas e conjuntos do Instagram por cidade." }],
        expected: ["get_meta_attribution_overview", "get_paid_media_overview"],
    },
    {
        name: "exportação de agenda",
        messages: [{ role: "user", content: "Exporte os agendamentos cancelados em CSV." }],
        expected: ["create_csv_export", "get_schedule_overview"],
    },
    {
        name: "financeiro por unidade",
        messages: [{ role: "user", content: "Como está o faturamento por unidade?" }],
        expected: ["get_financial_overview", "analyze_unit_performance"],
    },
    {
        name: "primeira resposta humana",
        messages: [{ role: "user", content: "Qual o 1º contato humano médio do WhatsApp?" }],
        expected: ["get_conversation_analysis_overview"],
    },
    {
        name: "cliente específico",
        messages: [{ role: "user", content: "Encontre o cadastro da paciente Sheila dos Santos." }],
        expected: ["search_clients", "get_client_context"],
        forbidden: ["get_business_overview"],
    },
    {
        name: "agenda de médica",
        messages: [{ role: "user", content: "A Dra. Leila está ocupada amanhã?" }],
        expected: ["search_appointments", "get_schedule_overview"],
    },
    {
        name: "mídia paga",
        messages: [{ role: "user", content: "Compare CTR, CPC e ROAS do Google Ads e Meta Ads neste mês." }],
        expected: ["get_paid_media_overview"],
        forbidden: ["get_internal_team_overview"],
    },
    {
        name: "funil",
        messages: [{ role: "user", content: "Quantos clientes estão em cada etapa do funil?" }],
        expected: ["get_funnel_overview"],
    },
    {
        name: "mensagem ativa",
        messages: [{ role: "user", content: "Mostre respostas e agendamentos do último disparo de Mensagem Ativa." }],
        expected: ["get_active_message_overview"],
    },
    {
        name: "eventos de tracking",
        messages: [{ role: "user", content: "Houve falhas nos eventos com gclid?" }],
        expected: ["get_tracking_events_overview"],
    },
    {
        name: "equipe interna",
        messages: [{ role: "user", content: "Quais atendentes estão online e em qual fila?" }],
        expected: ["get_internal_team_overview"],
    },
    {
        name: "visão geral",
        messages: [{ role: "user", content: "Faça um resumo executivo geral da operação nos últimos 30 dias." }],
        expected: ["get_business_overview"],
    },
    {
        name: "continuidade multivolta",
        messages: [
            { role: "user", content: "Compare a conversão das unidades nos últimos 30 dias." },
            { role: "assistant", content: "Qual unidade você quer aprofundar?" },
            { role: "user", content: "Agora aprofunde a de Londrina e mostre as objeções." },
        ],
        expected: ["analyze_unit_performance", "get_conversation_analysis_overview"],
    },
];

for (const testCase of routingCases) {
    const selected = selectAssistantToolNames(testCase.messages);

    for (const expectedTool of testCase.expected) {
        assert.ok(
            selected.includes(expectedTool),
            `${testCase.name} deveria disponibilizar ${expectedTool}`,
        );
    }

    for (const forbiddenTool of testCase.forbidden ?? []) {
        assert.ok(
            !selected.includes(forbiddenTool),
            `${testCase.name} não deveria disponibilizar ${forbiddenTool}`,
        );
    }
}

const firstResponse = summarizeFirstHumanResponseTimes([
    60,
    120,
    7_200,
    7_201,
    null,
]);
assert.equal(firstResponse.first_human_response_observed, 4);
assert.equal(firstResponse.first_human_response_included_in_average, 3);
assert.equal(firstResponse.first_human_response_excluded_over_2h, 1);
assert.equal(firstResponse.average_first_human_response_seconds, 2_460);
assert.equal(firstResponse.raw_average_first_human_response_seconds, 3_645);

const responseOutput = [
    {
        id: "reasoning_1",
        type: "reasoning",
        encrypted_content: "encrypted",
        summary: [],
        status: "completed",
    },
    {
        id: "message_1",
        type: "message",
        role: "assistant",
        status: "completed",
        phase: "commentary",
        content: [{ type: "output_text", text: "Vou consultar." }],
    },
    {
        id: "call_1",
        type: "function_call",
        call_id: "call_1",
        name: "get_schedule_overview",
        arguments: "{}",
        status: "completed",
    },
] as Array<Record<string, unknown>>;
assert.deepEqual(
    toStatelessContinuationItems(responseOutput),
    responseOutput,
    "A continuação stateless deve preservar todos os itens e campos de saída.",
);

const lockedContext = {
    authUserId: "user",
    sessionId: "session",
    unitLock: { id: "unit", name: "Londrina", city: "Londrina" },
};
assert.deepEqual(
    applyAssistantUnitScope({ unit_name: "Outra" }, lockedContext),
    { unit_name: "Londrina" },
    "O bloqueio de unidade deve substituir argumentos enviados pelo modelo.",
);
assert.deepEqual(
    applyAssistantUnitScope(
        { unit_name: "Outra" },
        { ...lockedContext, unitLock: null },
    ),
    { unit_name: "Outra" },
    "Acesso sem bloqueio deve preservar o filtro solicitado.",
);

console.log(
    `Assistant eval passed: ${routingCases.length} routing cases, metric normalization, complete continuation replay, and unit-scope enforcement.`,
);
