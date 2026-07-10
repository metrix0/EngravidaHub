// app/api/assistente/chat/route.ts
import { NextResponse } from "next/server";

import { executeAssistantDataTool } from "@/lib/ai/assistantDataTools";
import { openai } from "@/lib/ai/openai";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import type {
    AssistantCard,
    AssistantChatRequest,
} from "@/types/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = process.env.OPENAI_AI_CHAT_MODEL ?? "gpt-5-mini";
const MAX_MESSAGES = 30;
const MAX_TOOL_ROUNDS = 8;
const MAX_RESPONSE_CARDS = 2;
const MAX_CONVERSATION_CARDS = 1;
const MAX_CLIENT_CARDS = 1;
const MAX_CARD_CANDIDATES = 12;

const TOOLS = [
    {
        type: "function",
        name: "search_clients",
        description:
            "Busca clientes por nome, telefone, CPF ou e-mail. Use antes de get_client_context quando o id ainda não é conhecido.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                query: { type: "string" },
                limit: { type: "integer", minimum: 1, maximum: 25 },
            },
            required: ["query", "limit"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_client_context",
        description:
            "Carrega o perfil completo, próximos agendamentos, thread aberta e conversas recentes. Também gera o card clicável do cliente. Sempre use para perguntas sobre uma pessoa específica.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                client_id: { type: "string" },
            },
            required: ["client_id"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "search_appointments",
        description:
            "Busca agendamentos por paciente, médico, unidade, data e status.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                query: { type: ["string", "null"] },
                doctor_name: { type: ["string", "null"] },
                unit_name: { type: ["string", "null"] },
                start_date: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD",
                },
                end_date: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD",
                },
                future_only: { type: "boolean" },
                statuses: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: [
                            "scheduled",
                            "confirmed",
                            "completed",
                            "cancelled",
                            "no_show",
                        ],
                    },
                },
                limit: { type: "integer", minimum: 1, maximum: 50 },
            },
            required: [
                "query",
                "doctor_name",
                "unit_name",
                "start_date",
                "end_date",
                "future_only",
                "statuses",
                "limit",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "search_conversations",
        description:
            "Localiza conversas por cliente, unidade, período e resultado da análise.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                query: { type: ["string", "null"] },
                client_id: { type: ["string", "null"] },
                unit_name: { type: ["string", "null"] },
                date_from: { type: ["string", "null"] },
                date_to: { type: ["string", "null"] },
                final_state: { type: ["string", "null"] },
                goal_status: { type: ["string", "null"] },
                dropoff_only: { type: "boolean" },
                limit: { type: "integer", minimum: 1, maximum: 30 },
            },
            required: [
                "query",
                "client_id",
                "unit_name",
                "date_from",
                "date_to",
                "final_state",
                "goal_status",
                "dropoff_only",
                "limit",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_conversation_context",
        description:
            "Carrega análise e transcrição de uma conversa e gera seu card clicável. Use para validar exemplos e evidências.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                conversation_id: { type: "string" },
            },
            required: ["conversation_id"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "analyze_unit_performance",
        description:
            "Analisa conversão, metas, resolução, abandono, satisfação, qualidade, tempos e motivos de uma unidade contra o benchmark geral.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                unit_name: { type: "string" },
                date_from: { type: ["string", "null"] },
                date_to: { type: ["string", "null"] },
                include_examples: {
                    type: "boolean",
                    description:
                        "Mantenha true. A ferramenta gera uma conversa candidata e o servidor escolhe apenas a evidência mais relevante da resposta inteira.",
                },
            },
            required: [
                "unit_name",
                "date_from",
                "date_to",
                "include_examples",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "compare_unit_performance",
        description:
            "Compara todas as unidades por agendamento, resolução, abandono, satisfação, qualidade e velocidade.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"] },
                date_to: { type: ["string", "null"] },
                minimum_conversations: {
                    type: "integer",
                    minimum: 1,
                    maximum: 10000,
                },
            },
            required: [
                "date_from",
                "date_to",
                "minimum_conversations",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_business_overview",
        description:
            "Retorna visão macro de clientes, conversas, análises, agendamentos, threads abertas, mensagens ativas, follow-ups e unidades.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"] },
                date_to: { type: ["string", "null"] },
            },
            required: ["date_from", "date_to"],
            additionalProperties: false,
        },
    },
] as const;

export async function POST(request: Request) {
    const access = await getServerTabAccess("assistente");

    if (access.ok === false) {
        return NextResponse.json(
            { ok: false, error: access.error },
            { status: access.status },
        );
    }

    if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json(
            {
                ok: false,
                error: "OPENAI_API_KEY não está configurada.",
            },
            { status: 500 },
        );
    }

    let body: AssistantChatRequest;

    try {
        body = (await request.json()) as AssistantChatRequest;
    } catch {
        return NextResponse.json(
            { ok: false, error: "Corpo da requisição inválido." },
            { status: 400 },
        );
    }

    const messages = normalizeMessages(body.messages);

    if (
        messages.length === 0 ||
        messages[messages.length - 1]?.role !== "user"
    ) {
        return NextResponse.json(
            { ok: false, error: "Envie uma mensagem do usuário." },
            { status: 400 },
        );
    }

    try {
        const cards = new Map<string, AssistantCard>();
        let input: unknown[] = messages.map((message) => ({
            role: message.role,
            content: message.content,
        }));

        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
            const response: any = await openai.responses.create({
                model: MODEL,
                store: false,
                include: ["reasoning.encrypted_content"],
                instructions: buildInstructions(access.user.name),
                input,
                tools: TOOLS,
                tool_choice: "auto",
                max_output_tokens: 2_500,
            } as any);

            const output = (response.output ?? []) as Array<
                Record<string, unknown>
            >;
            const functionCalls = output.filter(
                (item) => item.type === "function_call",
            );

            if (functionCalls.length === 0) {
                const content =
                    typeof response.output_text === "string"
                        ? sanitizeAssistantMarkdown(response.output_text)
                        : "";

                return NextResponse.json({
                    ok: true,
                    message: {
                        role: "assistant",
                        content:
                            content ||
                            "Não consegui produzir uma resposta com os dados disponíveis.",
                        cards: selectResponseCards(cards),
                    },
                });
            }

            const toolOutputs: Array<Record<string, unknown>> = [];

            for (const call of functionCalls) {
                const callId =
                    typeof call.call_id === "string" ? call.call_id : "";
                const name =
                    typeof call.name === "string" ? call.name : "";
                const parsedArguments = parseToolArguments(call.arguments);
                let execution;

                try {
                    execution = await executeAssistantDataTool(
                        name,
                        parsedArguments,
                    );
                } catch (error) {
                    console.error("[assistente] tool execution failed", {
                        tool: name,
                        error,
                    });

                    execution = {
                        output: {
                            ok: false,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : "Falha inesperada ao consultar os dados.",
                        },
                        cards: [],
                    };
                }

                addRelevantCards(cards, execution.cards);

                toolOutputs.push({
                    type: "function_call_output",
                    call_id: callId,
                    output: JSON.stringify(execution.output),
                });
            }

            input = [
                ...input,
                ...toStatelessContinuationItems(output),
                ...toolOutputs,
            ];
        }

        return NextResponse.json({
            ok: true,
            message: {
                role: "assistant",
                content:
                    "A consulta exigiu etapas demais. Tente deixar a pergunta um pouco mais específica.",
                cards: selectResponseCards(cards),
            },
        });
    } catch (error) {
        console.error("[assistente] chat failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível consultar o assistente.",
            },
            { status: 500 },
        );
    }
}

function toStatelessContinuationItems(
    output: Array<Record<string, unknown>>,
) {
    const items: Array<Record<string, unknown>> = [];

    for (const item of output) {
        if (item.type === "function_call") {
            const callId =
                typeof item.call_id === "string" ? item.call_id : null;
            const name = typeof item.name === "string" ? item.name : null;
            const argumentsValue =
                typeof item.arguments === "string"
                    ? item.arguments
                    : "{}";

            if (callId && name) {
                items.push({
                    type: "function_call",
                    call_id: callId,
                    name,
                    arguments: argumentsValue,
                });
            }

            continue;
        }

        if (item.type === "reasoning") {
            const encryptedContent =
                typeof item.encrypted_content === "string"
                    ? item.encrypted_content
                    : null;

            if (encryptedContent) {
                items.push({
                    type: "reasoning",
                    encrypted_content: encryptedContent,
                    summary: Array.isArray(item.summary)
                        ? item.summary
                        : [],
                });
            }
        }
    }

    return items;
}

function buildInstructions(userName: string) {
    const now = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "full",
        timeStyle: "long",
    }).format(new Date());

    return `
Você é o Assistente IA interno do Engravida Hub.

Usuário atual: ${userName}
Data e hora atuais em America/Sao_Paulo: ${now}

REGRAS:
1. Responda em português do Brasil, exceto quando o usuário escrever claramente em outro idioma.
2. Consulte ferramentas para qualquer fato sobre clientes, agenda, médicos, unidades, conversas, conversão ou operação. Nunca invente dados.
3. Para uma pessoa específica, use search_clients e depois get_client_context antes da resposta final.
4. Em perguntas de agenda, diferencie scheduled/confirmed de cancelled/no_show/completed e use datas absolutas.
5. Em perguntas de baixa conversão, use analyze_unit_performance e compare taxas com o benchmark geral. Considere abandono, motivos, objeções, satisfação, qualidade e velocidade.
6. Informe limites de cobertura quando existirem.
7. Este assistente é somente leitura. Nunca diga que alterou, cancelou, marcou ou reatribuiu algo.

FORMATO DA RESPOSTA:
8. Sempre comece com um título Markdown descritivo usando ##.
9. Em respostas com várias unidades, cada unidade deve aparecer obrigatoriamente como subtítulo ### Nome da unidade. Nunca escreva o nome da unidade como uma linha solta.
10. Para comparar unidade e benchmark, use uma tabela Markdown compacta antes da análise textual.
11. Depois da tabela, escreva parágrafos curtos com rótulos em negrito, como **Ponto forte:** e **Principal pressão:**.
12. Use listas apenas para conjuntos genuínos de itens. Nunca transforme cada frase ou cada métrica em bullet. Use no máximo 3 bullets consecutivos.
13. Evite repetir o mesmo dado na tabela e no texto.
14. Nunca mostre UUIDs, IDs internos, nomes de colunas, chaves técnicas ou listas de identificadores. Identifique pessoas, unidades, médicos e conversas apenas por nomes, datas e contexto humano.
15. Quando uma ferramenta retornar IDs para permitir outra consulta, use-os silenciosamente apenas nas chamadas de ferramenta. Eles jamais devem aparecer na resposta ao usuário.

CARDS:
16. Cards são evidência, não decoração. Use normalmente um card quando houver uma entidade ou conversa diretamente relevante.
17. Em análises de desempenho de uma ou várias unidades, use analyze_unit_performance com include_examples=true. O servidor escolherá somente a conversa mais forte entre todas as candidatas.
18. Nunca tente gerar um card para cada unidade. O resultado final terá no máximo uma conversa.
19. A conversa escolhida deve sustentar diretamente a principal conclusão, especialmente abandono, baixa qualidade, baixa satisfação ou problema de resolução.
20. Para perguntas sobre uma pessoa específica, inclua o card do cliente.
21. Não chame get_conversation_context repetidamente para aumentar o número de cards.
22. O limite absoluto é dois cards: no máximo um de cliente e um de conversa.
`.trim();
}


const UUID_PATTERN =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function sanitizeAssistantMarkdown(value: string) {
    const cleaned = value
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => {
            let next = line.replace(UUID_PATTERN, "");

            next = next
                .replace(/,\s*(?=,|$)/g, "")
                .replace(/\(\s*\)/g, "")
                .replace(/\[\s*\]/g, "")
                .replace(/:\s*(?:,|;|\s)*$/g, "")
                .replace(/\s{2,}/g, " ")
                .trimEnd();

            if (/^\s*(?:[-*+]|\d+[.)])\s*$/.test(next)) {
                return "";
            }

            return next;
        })
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return normalizeStandaloneHeadings(convertLongMetricLists(cleaned));
}

function convertLongMetricLists(value: string) {
    const lines = value.split("\n");
    const output: string[] = [];

    for (let index = 0; index < lines.length; ) {
        const block: string[] = [];
        let cursor = index;

        while (cursor < lines.length) {
            const match = /^\s*[-*+]\s+(.+?)\s*$/.exec(lines[cursor]);

            if (match) {
                block.push(match[1]);
                cursor += 1;

                while (
                    cursor < lines.length &&
                    lines[cursor].trim() === ""
                ) {
                    cursor += 1;
                }

                continue;
            }

            break;
        }

        if (block.length >= 5) {
            const first = block[0];
            const firstIsHeading =
                first.length <= 80 && !first.includes(":");

            if (firstIsHeading) {
                output.push(`### ${first}`, "");
            }

            const metrics = firstIsHeading ? block.slice(1) : block;

            for (const item of metrics) {
                const separator = item.indexOf(":");

                if (separator > 0 && separator < 80) {
                    const label = item.slice(0, separator).trim();
                    const result = item.slice(separator + 1).trim();
                    output.push(`**${label}:** ${result}`, "");
                } else {
                    output.push(item, "");
                }
            }

            index = cursor;
            continue;
        }

        output.push(lines[index]);
        index += 1;
    }

    return output
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}


function normalizeStandaloneHeadings(value: string) {
    const lines = value.split("\n");
    const firstContentIndex = lines.findIndex((line) => line.trim());

    return lines
        .map((line, index) => {
            const trimmed = line.trim();

            if (!trimmed || isMarkdownStructure(trimmed)) {
                return line;
            }

            if (
                trimmed.length > 80 ||
                /[:;,.!?]$/.test(trimmed) ||
                trimmed.split(/\s+/).length > 10
            ) {
                return line;
            }

            const previousIsBlank =
                index === 0 || lines[index - 1].trim() === "";
            const nextIndex = findNextContentLine(lines, index + 1);
            const nextLine =
                nextIndex === -1 ? "" : lines[nextIndex].trim();

            if (!previousIsBlank || !nextLine) {
                return line;
            }

            if (index === firstContentIndex) {
                return `## ${trimmed}`;
            }

            const nextLooksLikeSectionContent =
                nextLine.startsWith("**") ||
                nextLine.startsWith("|") ||
                /^[-*+]\s+/.test(nextLine) ||
                /^\d+[.)]\s+/.test(nextLine);

            if (
                trimmed.length <= 50 &&
                trimmed.split(/\s+/).length <= 7 &&
                nextLooksLikeSectionContent
            ) {
                return `### ${trimmed}`;
            }

            return line;
        })
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function isMarkdownStructure(value: string) {
    return (
        /^#{1,6}\s+/.test(value) ||
        /^[-*+]\s+/.test(value) ||
        /^\d+[.)]\s+/.test(value) ||
        /^>/.test(value) ||
        /^\|/.test(value) ||
        /^```/.test(value)
    );
}

function findNextContentLine(lines: string[], startIndex: number) {
    for (let index = startIndex; index < lines.length; index += 1) {
        if (lines[index].trim()) return index;
    }

    return -1;
}

function addRelevantCards(
    target: Map<string, AssistantCard>,
    candidates: AssistantCard[],
) {
    for (const card of candidates) {
        if (target.size >= MAX_CARD_CANDIDATES) return;

        const key = cardKey(card);

        if (!target.has(key)) {
            target.set(key, card);
        }
    }
}

function selectResponseCards(
    candidates: Map<string, AssistantCard>,
): AssistantCard[] {
    const allCards = [...candidates.values()];
    const clientCards = allCards.filter(
        (card): card is Extract<AssistantCard, { type: "client" }> =>
            card.type === "client",
    );
    const conversationCards = allCards
        .filter(
            (
                card,
            ): card is Extract<AssistantCard, { type: "conversation" }> =>
                card.type === "conversation",
        )
        .sort(
            (first, second) =>
                conversationEvidenceScore(second) -
                conversationEvidenceScore(first),
        );

    const selected: AssistantCard[] = [];

    if (clientCards.length > 0 && selected.length < MAX_CLIENT_CARDS) {
        selected.push(clientCards[0]);
    }

    if (
        conversationCards.length > 0 &&
        selected.filter((card) => card.type === "conversation").length <
            MAX_CONVERSATION_CARDS &&
        selected.length < MAX_RESPONSE_CARDS
    ) {
        selected.push(conversationCards[0]);
    }

    return selected.slice(0, MAX_RESPONSE_CARDS);
}

function conversationEvidenceScore(
    card: Extract<AssistantCard, { type: "conversation" }>,
) {
    const conversation = card.data;
    let score = 0;

    if (conversation.dropoff_happened) score += 60;
    if (conversation.notable) score += 25;
    if (conversation.dropoff_moment) score += 12;
    if (conversation.notable_reason) score += 10;
    if (conversation.resolution_result === "unresolved") score += 18;
    if (conversation.goal_status === "not_achieved") score += 18;

    if (typeof conversation.attendant_quality_score === "number") {
        score += Math.max(
            0,
            (100 - conversation.attendant_quality_score) / 4,
        );
    }

    if (typeof conversation.satisfaction_score === "number") {
        score += Math.max(
            0,
            (100 - conversation.satisfaction_score) / 4,
        );
    }

    if (conversation.preview) score += 2;
    if ((conversation.messages?.length ?? 0) > 0) score += 5;

    return score;
}

function normalizeMessages(
    value: AssistantChatRequest["messages"] | undefined,
) {
    if (!Array.isArray(value)) return [];

    return value
        .filter(
            (message) =>
                (message?.role === "user" ||
                    message?.role === "assistant") &&
                typeof message.content === "string" &&
                message.content.trim(),
        )
        .slice(-MAX_MESSAGES)
        .map((message) => ({
            role: message.role,
            content: message.content.trim().slice(0, 12_000),
        }));
}

function parseToolArguments(value: unknown) {
    if (typeof value !== "string") return {};

    try {
        const parsed = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

function cardKey(card: AssistantCard) {
    return `${card.type}:${card.data.id}`;
}
