// scripts/test-assistant-routing.ts
import assert from "node:assert/strict";

import { summarizeFirstHumanResponseTimes } from "../lib/ai/assistantMetrics";
import {
    selectAssistantToolNames,
    type AssistantToolName,
} from "../lib/ai/assistantToolRouting";

const routingCases: Array<{
    prompt: string;
    expected: AssistantToolName[];
}> = [
    {
        prompt: "Analise as objeções nas conversas de WhatsApp dos últimos 15 dias.",
        expected: ["get_conversation_analysis_overview"],
    },
    {
        prompt: "Quais os motivos dos cancelamentos de primeiras avaliações?",
        expected: ["get_cancellation_analysis"],
    },
    {
        prompt: "Procure a frase não consigo pagar nas mensagens.",
        expected: ["search_conversation_content"],
    },
    {
        prompt: "Compare campanhas e conjuntos do Instagram por cidade.",
        expected: ["get_meta_attribution_overview"],
    },
    {
        prompt: "Exporte os agendamentos cancelados em CSV.",
        expected: ["create_csv_export", "get_schedule_overview"],
    },
    {
        prompt: "Como está o faturamento por unidade?",
        expected: ["get_financial_overview", "analyze_unit_performance"],
    },
    {
        prompt: "Qual o 1º contato humano médio do WhatsApp?",
        expected: ["get_conversation_analysis_overview"],
    },
];

for (const testCase of routingCases) {
    const selected = selectAssistantToolNames([
        { role: "user", content: testCase.prompt },
    ]);
    for (const expectedTool of testCase.expected) {
        assert.ok(
            selected.includes(expectedTool),
            `${testCase.prompt} deveria disponibilizar ${expectedTool}`,
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

console.log(
    `Assistant eval passed: ${routingCases.length} routing cases and dashboard first-human-response normalization.`,
);
