// app/api/assistente/chat/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib";
import { ASSISTANT_TOOLS } from "@/lib/ai/assistantTools";
import { executeAssistantTool } from "@/lib/ai/executeAssistantTool";
import { openai } from "@/lib/ai/openai";
import { toStatelessContinuationItems } from "@/lib/ai/assistantResponseState";
import {
    ASSISTANT_HUB_KNOWLEDGE_BASE,
    ASSISTANT_PLAIN_LANGUAGE_RULE,
    findInternalTechnicalTerms,
    replaceInternalTechnicalTerms,
} from "@/lib/ai/assistantHubKnowledge";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import type { AssistantCard, AssistantChatRequest } from "@/types/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "gpt-5.6-luna";
const MAX_MESSAGES = 24;
const MAX_EMPTY_RESPONSE_RETRIES = 1;
const MAX_PLAIN_LANGUAGE_RETRIES = 1;
const MAX_OUTPUT_TOKENS = 6_000;
const MAX_PRESENTATION_TOOL_ROUNDS = 4;
const MAX_CUSTOM_CSV_ROWS = 500;
const MAX_RESPONSE_CARDS = 3;
const SUPABASE_MCP_SERVER_LABEL = "supabase";

const PRESENTATION_TOOLS = [
    cloneAssistantTool(
        "get_client_context",
        "show_client_card",
        "Exibe o card clicável de um cliente já identificado pelo MCP. Use somente depois de confirmar o cliente e obter seu ID pelo MCP.",
    ),
    cloneAssistantTool(
        "get_conversation_context",
        "show_conversation_card",
        "Exibe o card clicável de uma conversa já identificada pelo MCP. Use somente depois de confirmar a conversa e obter seu ID pelo MCP.",
    ),
    cloneAssistantTool(
        "create_csv_export",
        "create_csv_export",
        "Cria um arquivo CSV real para download nos formatos padrão de clientes, agendamentos ou conversas. Use quando esse formato padrão atender ao pedido.",
    ),
    {
        type: "function",
        name: "create_csv_download",
        description:
            "Cria um arquivo CSV real para download a partir de linhas já consultadas pelo MCP. Use para planilhas personalizadas ou que cruzem fontes.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                file_name: {
                    type: "string",
                    description: "Nome curto do arquivo, terminando ou não em .csv.",
                },
                columns: {
                    type: "array",
                    minItems: 1,
                    maxItems: 40,
                    items: { type: "string" },
                },
                rows: {
                    type: "array",
                    maxItems: MAX_CUSTOM_CSV_ROWS,
                    items: {
                        type: "array",
                        items: {
                            type: ["string", "number", "boolean", "null"],
                        },
                    },
                },
            },
            required: ["file_name", "columns", "rows"],
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

    const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();

    if (!supabaseAccessToken) {
        return NextResponse.json(
            {
                ok: false,
                error: "SUPABASE_ACCESS_TOKEN não está configurado para o MCP do Assistente.",
            },
            { status: 500 },
        );
    }

    if (access.permission.unit_lock) {
        return NextResponse.json(
            {
                ok: false,
                error: "O Assistente MCP não está disponível para acessos restritos a uma unidade.",
            },
            { status: 403 },
        );
    }

    let supabaseMcpTool: Record<string, unknown>;

    try {
        supabaseMcpTool = buildSupabaseMcpTool(supabaseAccessToken);
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível configurar o MCP do Assistente.",
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
        !isUuid(body.session_id) ||
        messages.length === 0 ||
        messages[messages.length - 1]?.role !== "user"
    ) {
        return NextResponse.json(
            { ok: false, error: "Chat ou mensagem do usuário inválidos." },
            { status: 400 },
        );
    }

    const sessionMemory = await loadSessionMemory(
        body.session_id,
        access.user.id,
    );

    if (sessionMemory === null) {
        return NextResponse.json(
            { ok: false, error: "Chat não encontrado." },
            { status: 404 },
        );
    }

    const encoder = new TextEncoder();
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    let streamClosed = false;
    const sendEvent = async (event: Record<string, unknown>) => {
        if (streamClosed) return;

        try {
            await writer.write(
                encoder.encode(`${JSON.stringify(event)}\n`),
            );
        } catch {
            streamClosed = true;
        }
    };

    void (async () => {
        const startedAt = Date.now();
        const usage = emptyUsage();
        const toolsUsed = new Set<string>();
        const cards = new Map<string, AssistantCard>();
        let toolRounds = 0;
        let presentationToolRounds = 0;
        const toolContext = {
            authUserId: access.user.id,
            sessionId: body.session_id,
            unitLock: access.permission.unit_lock ?? null,
        };

        try {
        await sendEvent({
            type: "status",
            status: "Entendendo a pergunta...",
        });
        let emptyResponseRetries = 0;
        let plainLanguageRetries = 0;
        let input: unknown[] = messages.map((message) => ({
            role: message.role,
            content: message.content,
        }));

        while (true) {
            await sendEvent({
                type: "status",
                status:
                    emptyResponseRetries > 0 || plainLanguageRetries > 0
                        ? "Refinando a resposta..."
                        : "Consultando os dados do Hub...",
            });
            const response = await openai.responses.create({
                model: MODEL,
                store: false,
                include: ["reasoning.encrypted_content"],
                reasoning: { effort: "medium" },
                instructions: buildInstructions(
                    access.user.name,
                    sessionMemory,
                ),
                input,
                tools: [supabaseMcpTool, ...PRESENTATION_TOOLS],
                tool_choice: "auto",
                max_output_tokens: MAX_OUTPUT_TOKENS,
                prompt_cache_key: `assistente:${access.user.id}`,
            }, { signal: request.signal });
            addUsage(usage, response.usage);

            const output = (response.output ?? []) as unknown as Array<
                Record<string, unknown>
            >;
            const mcpCalls = output.filter(
                (item) => item.type === "mcp_call",
            );
            const functionCalls = output.filter(
                (item) => item.type === "function_call",
            );

            if (mcpCalls.length > 0 || functionCalls.length > 0) {
                toolRounds += 1;
            }

            if (mcpCalls.length > 0) {
                const names = mcpCalls
                    .map((call) =>
                        typeof call.name === "string" ? call.name : "",
                    )
                    .filter(Boolean);

                for (const name of names) {
                    toolsUsed.add(name);
                }

                const failedCalls = mcpCalls.filter((call) => call.error);
                if (failedCalls.length > 0) {
                    console.error("[assistente] MCP tool call failed", {
                        tools: failedCalls.map((call) => call.name),
                    });
                }

                await sendEvent({
                    type: "status",
                    status: "Cruzando os resultados...",
                    tools: names,
                });
            }

            if (functionCalls.length > 0) {
                if (presentationToolRounds >= MAX_PRESENTATION_TOOL_ROUNDS) {
                    throw new Error(
                        "Limite de etapas de apresentação do Assistente atingido.",
                    );
                }
                presentationToolRounds += 1;

                const names = functionCalls
                    .map((call) =>
                        typeof call.name === "string" ? call.name : "",
                    )
                    .filter(Boolean);
                for (const name of names) toolsUsed.add(name);

                await sendEvent({
                    type: "status",
                    status: names.some((name) => name.includes("csv"))
                        ? "Preparando o arquivo..."
                        : "Preparando os resultados...",
                    tools: names,
                });

                const toolOutputs: Array<Record<string, unknown>> = [];

                for (const call of functionCalls) {
                    const callId =
                        typeof call.call_id === "string" ? call.call_id : "";
                    const name =
                        typeof call.name === "string" ? call.name : "";
                    const args = parseToolArguments(call.arguments);

                    try {
                        const execution = await executePresentationTool(
                            name,
                            args,
                            toolContext,
                        );
                        addRelevantCards(cards, execution.cards);
                        toolOutputs.push({
                            type: "function_call_output",
                            call_id: callId,
                            output: JSON.stringify(execution.output),
                        });
                    } catch (error) {
                        console.error(
                            "[assistente] presentation tool failed",
                            { tool: name, error },
                        );
                        toolOutputs.push({
                            type: "function_call_output",
                            call_id: callId,
                            output: JSON.stringify({
                                ok: false,
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : "Falha ao preparar o resultado.",
                            }),
                        });
                    }
                }

                input = [
                    ...input,
                    ...toStatelessContinuationItems(output),
                    ...toolOutputs,
                ];
                continue;
            }

            const content =
                typeof response.output_text === "string"
                    ? sanitizeAssistantMarkdown(response.output_text)
                    : "";

            if (
                !content &&
                emptyResponseRetries < MAX_EMPTY_RESPONSE_RETRIES
            ) {
                emptyResponseRetries += 1;
                console.error("[assistente] empty model response", {
                    model: response.model,
                    status: response.status,
                    incompleteReason:
                        response.incomplete_details?.reason ?? null,
                    outputTypes: output.map((item) => item.type),
                    outputTokens: response.usage?.output_tokens ?? null,
                });

                input = [
                    ...input,
                    ...toStatelessContinuationItems(output),
                    {
                        role: "user",
                        content:
                            "A tentativa anterior terminou sem texto. Conclua a resposta agora. Se faltarem dados, consulte o MCP novamente; se os dados realmente não existirem, explique exatamente qual cobertura está ausente.",
                    },
                ];
                continue;
            }

            const internalTechnicalTerms = content
                ? findInternalTechnicalTerms(content)
                : [];
            if (
                content &&
                internalTechnicalTerms.length > 0 &&
                plainLanguageRetries < MAX_PLAIN_LANGUAGE_RETRIES
            ) {
                plainLanguageRetries += 1;
                console.error("[assistente] technical language rewritten", {
                    terms: internalTechnicalTerms,
                });
                await sendEvent({
                    type: "status",
                    status: "Simplificando a resposta...",
                });
                input = [
                    ...input,
                    ...toStatelessContinuationItems(output),
                    {
                        role: "user",
                        content:
                            "Reescreva a resposta inteira em linguagem comum. Preserve todos os fatos e números, mas remova nomes internos do código, infraestrutura, fornecedores, campos, funções e siglas de programação.",
                    },
                ];
                continue;
            }

            const finalContent =
                (content
                    ? replaceInternalTechnicalTerms(content)
                    : "") ||
                "## Não foi possível concluir a consulta\n\nO assistente não produziu uma resposta final mesmo após uma nova tentativa. Tente novamente; se persistir, informe o horário da consulta para verificarmos o problema.";
            const runId = await recordAssistantRun({
                authUserId: access.user.id,
                sessionId: body.session_id,
                status: content ? "completed" : "incomplete",
                usage,
                toolsUsed,
                toolRounds,
                durationMs: Date.now() - startedAt,
                errorMessage: content
                    ? null
                    : "Modelo sem resposta textual após nova tentativa.",
            });

            await sendEvent({
                type: "message",
                message: {
                    role: "assistant",
                    content: finalContent,
                    cards: selectResponseCards(cards),
                    run_id: runId,
                },
            });
            return;
        }
    } catch (error) {
        console.error("[assistente] chat failed", error);
        const errorMessage =
            request.signal.aborted
                ? "Solicitação interrompida."
                : error instanceof Error
                ? error.message
                : "Não foi possível consultar o assistente.";
        await recordAssistantRun({
            authUserId: access.user.id,
            sessionId: body.session_id,
            status: "failed",
            usage,
            toolsUsed,
            toolRounds,
            durationMs: Date.now() - startedAt,
            errorMessage,
        });

        await sendEvent({ type: "error", error: errorMessage });
    } finally {
        if (!streamClosed) {
            streamClosed = true;
            await writer.close().catch(() => undefined);
        }
    }
    })();

    return new Response(stream.readable, {
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

function buildInstructions(
    userName: string,
    sessionMemory: string,
) {
    const now = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "full",
        timeStyle: "long",
    }).format(new Date());

    return `
Você é o Assistente IA interno do Engravida Hub.

${ASSISTANT_HUB_KNOWLEDGE_BASE}

${ASSISTANT_PLAIN_LANGUAGE_RULE}

ACESSO A DADOS:
1. Você tem acesso direto ao projeto Engravida por um servidor MCP completo, limitado pelo servidor e pela credencial a operações de leitura.
2. Para qualquer fato atual sobre clientes, agenda, médicos, unidades, conversas, análises, funil, faturamento, mídia, Instagram, Facebook, Mensagem Ativa, eventos ou operação interna, consulte o MCP. Nunca invente números ou estados atuais.
3. Não existe mais uma lista de consultas internas pré-selecionadas para este chat. Descubra e use livremente as ferramentas de leitura oferecidas pelo MCP. Quando precisar de dados do banco, prefira consultas SQL de leitura e inspecione o esquema quando necessário.
4. O assistente é estritamente somente leitura. Nunca tente INSERT, UPDATE, DELETE, MERGE, DDL, migrações, deploys, criação/remoção de branches, alteração de configuração, segredos ou qualquer outra operação que mude o projeto. Nunca diga que alterou, cancelou, marcou, reatribuiu ou criou algo.
5. Consulte apenas o necessário. Agregue no banco quando possível, use filtros de período e LIMIT para linhas brutas, e evite carregar grandes volumes quando uma soma, contagem ou agrupamento responder à pergunta.
6. Quando cruzar pessoas ou eventos entre fontes, só conclua que existe vínculo quando houver chave confiável nos dados. Não una registros por aproximação de nome se houver possibilidade de homônimos.

REGRAS DE NEGÓCIO IMPORTANTES:
7. Agenda: cada registro representa um agendamento na data marcada. "Não" = pendente/sem desfecho; "Sim", "Em Atendimento" e "Atendido" contam como compareceu; "Faltou" = não compareceu; "Desmarcou" = cancelado; "Remarcou" = remarcado. Agendamentos futuros não são faltas.
8. Conversas: objeções, abandono, sentimento, satisfação e qualidade provenientes de análise de conversa são classificações automáticas. Informe cobertura/confiança quando isso mudar a conclusão.
9. Financeiro: faturamento autorizado é a soma das NFS-e autorizadas. Não chame isso de recebimento, caixa, pagamento confirmado ou lucro.
10. Mídia: conversões reportadas pelas plataformas não são automaticamente agendamentos, pacientes ou faturamento reais do Hub. Diferencie essas fontes.
11. Primeira resposta humana: a média principal do Dashboard inclui somente tempos observados de até 2 horas (7.200 segundos). Valores maiores ficam fora da média principal; mediana e P90 podem considerar todos os tempos.
12. Em pedidos de "últimos N dias", considere hoje como o primeiro dia. Use datas absolutas na resposta quando houver risco de ambiguidade.
13. Informe período, fonte, cobertura e qualquer limitação relevante. Se não houver dados suficientes, diga exatamente o que falta.

FORMATO DA RESPOSTA:
14. Responda em português do Brasil, exceto quando o usuário escrever claramente em outro idioma.
15. Sempre comece com um título Markdown descritivo usando ##.
16. Em respostas com várias unidades, use ### Nome da unidade para cada uma.
17. Para comparações, prefira uma tabela Markdown compacta antes da análise textual.
18. Escreva parágrafos curtos. Use listas apenas para conjuntos genuínos de itens e evite repetir o mesmo dado.
19. Nunca exponha identificadores internos, nomes de tabelas/colunas, comandos, ferramentas, rotas, fornecedores de infraestrutura ou detalhes técnicos do MCP. Use esses dados silenciosamente e traduza tudo para linguagem de negócio.
20. O MCP é a fonte de dados. As funções locais show_client_card, show_conversation_card, create_csv_export e create_csv_download servem somente para apresentação/download; não substitua a consulta pelo MCP por essas funções.
20-A. Quando a resposta for sobre uma pessoa específica, depois de confirmar o cliente pelo MCP use show_client_card. Quando uma conversa específica for evidência importante, use show_conversation_card. Use no máximo um card de cliente e um de conversa por resposta.
20-B. Quando o usuário pedir CSV, planilha, exportação ou download, sempre crie um arquivo real. Use create_csv_export para os formatos padrão de clientes/agendamentos/conversas. Para colunas personalizadas ou cruzamento de fontes, consulte os dados pelo MCP e passe as linhas finais para create_csv_download. Nunca diga que não pode criar o arquivo por ser somente leitura.
21. Quando o usuário pedir um gráfico, inclua o gráfico em um bloco exatamente neste formato, usando somente dados consultados:
\`\`\`assistant-chart
{"type":"line","title":"Título","data":[{"label":"11/07/2026","value":0}],"valueSuffix":""}
\`\`\`
Use line para evolução temporal, bar para comparação e pie para composição.

CONTEXTO DINÂMICO DESTA SOLICITAÇÃO:
Usuário atual: ${userName}
Data e hora atuais em America/Sao_Paulo: ${now}
Escopo de unidade: todas as unidades permitidas
${
    sessionMemory
        ? `\nCONTEXTO PERSISTENTE DE MENSAGENS ANTERIORES DESTE CHAT:\n<session_memory>\n${sessionMemory.slice(0, 12_000)}\n</session_memory>\nUse esse contexto apenas para continuidade. Para qualquer dado atual do Hub, consulte novamente o MCP.`
        : ""
}
`.trim();
}

function buildSupabaseMcpTool(authorization: string) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

    if (!supabaseUrl) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL não está configurada.");
    }

    let hostname: string;
    try {
        hostname = new URL(supabaseUrl).hostname.toLowerCase();
    } catch {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL é inválida.");
    }

    const suffix = ".supabase.co";
    if (!hostname.endsWith(suffix)) {
        throw new Error(
            "Não foi possível identificar o projeto Supabase para o MCP.",
        );
    }

    const projectRef = hostname.slice(0, -suffix.length);
    if (!projectRef || projectRef.includes(".")) {
        throw new Error(
            "Não foi possível identificar o projeto Supabase para o MCP.",
        );
    }

    const serverUrl = new URL("https://mcp.supabase.com/mcp");
    serverUrl.searchParams.set("project_ref", projectRef);
    serverUrl.searchParams.set("read_only", "true");

    return {
        type: "mcp",
        server_label: SUPABASE_MCP_SERVER_LABEL,
        server_description:
            "Projeto Supabase do Engravida Hub em modo completo e somente leitura. Consulte livremente os dados necessários sem executar alterações.",
        server_url: serverUrl.toString(),
        authorization,
        require_approval: "never",
    };
}

function cloneAssistantTool(
    sourceName: string,
    name: string,
    description: string,
) {
    const source = ASSISTANT_TOOLS.find((tool) => tool.name === sourceName);
    if (!source) {
        throw new Error(`Ferramenta de apresentação ausente: ${sourceName}`);
    }
    return { ...source, name, description };
}

async function executePresentationTool(
    name: string,
    args: Record<string, unknown>,
    context: {
        authUserId: string;
        sessionId: string;
        unitLock: {
            id: string;
            name: string;
            city: string;
        } | null;
    },
) {
    if (name === "show_client_card") {
        const execution = await executeAssistantTool(
            "get_client_context",
            args,
            context,
        );
        return {
            output: {
                ok: execution.cards.some((card) => card.type === "client"),
                card_ready: true,
            },
            cards: execution.cards,
        };
    }

    if (name === "show_conversation_card") {
        const execution = await executeAssistantTool(
            "get_conversation_context",
            args,
            context,
        );
        return {
            output: {
                ok: execution.cards.some(
                    (card) => card.type === "conversation",
                ),
                card_ready: true,
            },
            cards: execution.cards,
        };
    }

    if (name === "create_csv_export") {
        return executeAssistantTool(name, args, context);
    }

    if (name === "create_csv_download") {
        return createCustomCsvDownload(args, context);
    }

    throw new Error(`Ferramenta de apresentação desconhecida: ${name}`);
}

async function createCustomCsvDownload(
    args: Record<string, unknown>,
    context: { authUserId: string; sessionId: string },
) {
    const columns = Array.isArray(args.columns)
        ? args.columns
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean)
              .slice(0, 40)
        : [];
    const rows = Array.isArray(args.rows)
        ? args.rows
              .filter((row): row is unknown[] => Array.isArray(row))
              .slice(0, MAX_CUSTOM_CSV_ROWS)
        : [];

    if (columns.length === 0) {
        throw new Error("O CSV precisa ter ao menos uma coluna.");
    }

    const normalizedRows = rows.map((row) =>
        columns.map((_, index) => normalizeCsvValue(row[index])),
    );
    const requestedName =
        typeof args.file_name === "string" ? args.file_name.trim() : "";
    const safeBase =
        requestedName
            .replace(/\.csv$/i, "")
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "assistente-export";
    const fileName = `${safeBase}.csv`;
    const csv = [
        columns.map(csvCell).join(";"),
        ...normalizedRows.map((row) => row.map(csvCell).join(";")),
    ].join("\r\n");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data, error } = await supabase
        .from("assistant_exports")
        .insert({
            auth_user_id: context.authUserId,
            session_id: context.sessionId,
            file_name: fileName,
            mime_type: "text/csv; charset=utf-8",
            content: `\uFEFF${csv}`,
            row_count: normalizedRows.length,
            expires_at: expiresAt,
        })
        .select("id")
        .single();

    if (error || !data) {
        throw new Error(
            `Falha ao preparar o CSV: ${error?.message ?? "arquivo não criado"}`,
        );
    }

    const card: AssistantCard = {
        type: "export",
        data: {
            id: data.id,
            file_name: fileName,
            row_count: normalizedRows.length,
            expires_at: expiresAt,
        },
    };

    return {
        output: {
            ok: true,
            download_ready: true,
            file_name: fileName,
            row_count: normalizedRows.length,
            expires_at: expiresAt,
        },
        cards: [card],
    };
}

function normalizeCsvValue(value: unknown) {
    return value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
        ? value
        : "";
}

function csvCell(value: unknown) {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

type AssistantUsageTotals = {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    estimatedCostUsd: number | null;
};

function emptyUsage(): AssistantUsageTotals {
    return {
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        estimatedCostUsd: 0,
    };
}

function addUsage(target: AssistantUsageTotals, value: unknown) {
    const usage = asRecord(value);
    if (!usage) return;

    const inputTokens = nonnegativeInteger(usage.input_tokens);
    const outputTokens = nonnegativeInteger(usage.output_tokens);
    const inputDetails = asRecord(usage.input_tokens_details);
    const outputDetails = asRecord(usage.output_tokens_details);
    const cachedInputTokens = nonnegativeInteger(inputDetails?.cached_tokens);
    const cacheWriteTokens = nonnegativeInteger(
        inputDetails?.cache_write_tokens,
    );
    const reasoningTokens = nonnegativeInteger(outputDetails?.reasoning_tokens);
    const requestCost = estimateRequestCost({
        model: MODEL,
        inputTokens,
        cachedInputTokens,
        outputTokens,
    });

    target.inputTokens += inputTokens;
    target.cachedInputTokens += cachedInputTokens;
    target.cacheWriteTokens += cacheWriteTokens;
    target.outputTokens += outputTokens;
    target.reasoningTokens += reasoningTokens;
    target.estimatedCostUsd =
        target.estimatedCostUsd === null || requestCost === null
            ? null
            : target.estimatedCostUsd + requestCost;
}

function estimateRequestCost({
    model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
}: {
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
}) {
    const longContext = inputTokens > 272_000;
    const prices = model.startsWith("gpt-5.6-luna")
        ? longContext
            ? { input: 0.4, cached: 0.04, output: 1.8 }
            : { input: 0.2, cached: 0.02, output: 1.2 }
        : model.startsWith("gpt-5.6-terra")
          ? longContext
              ? { input: 4, cached: 0.4, output: 18 }
              : { input: 2, cached: 0.2, output: 12 }
          : model.startsWith("gpt-5-mini")
            ? { input: 0.25, cached: 0.025, output: 2 }
            : null;
    if (!prices) return null;

    const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
    return (
        (uncachedInputTokens * prices.input +
            cachedInputTokens * prices.cached +
            outputTokens * prices.output) /
        1_000_000
    );
}

async function loadSessionMemory(sessionId: string, authUserId: string) {
    const { data, error } = await supabase
        .from("assistant_chat_sessions")
        .select("summary")
        .eq("id", sessionId)
        .eq("auth_user_id", authUserId)
        .maybeSingle();

    if (error) {
        throw new Error(`Falha ao carregar a memória do chat: ${error.message}`);
    }

    if (!data) return null;
    return typeof data.summary === "string" ? data.summary.trim() : "";
}

async function recordAssistantRun({
    authUserId,
    sessionId,
    status,
    usage,
    toolsUsed,
    toolRounds,
    durationMs,
    errorMessage,
}: {
    authUserId: string;
    sessionId: string;
    status: "completed" | "failed" | "incomplete";
    usage: AssistantUsageTotals;
    toolsUsed: Set<string>;
    toolRounds: number;
    durationMs: number;
    errorMessage: string | null;
}) {
    const { data, error } = await supabase
        .from("assistant_chat_runs")
        .insert({
            auth_user_id: authUserId,
            session_id: sessionId,
            model: MODEL,
            status,
            input_tokens: usage.inputTokens,
            cached_input_tokens: usage.cachedInputTokens,
            cache_write_tokens: usage.cacheWriteTokens,
            output_tokens: usage.outputTokens,
            reasoning_tokens: usage.reasoningTokens,
            estimated_cost_usd:
                usage.estimatedCostUsd === null
                    ? null
                    : Math.round(usage.estimatedCostUsd * 1_000_000) /
                      1_000_000,
            tool_names: [...toolsUsed].filter(Boolean),
            tool_rounds: toolRounds,
            duration_ms: Math.max(0, Math.trunc(durationMs)),
            error_message: errorMessage?.slice(0, 1_000) ?? null,
        })
        .select("id")
        .single();

    if (error) {
        console.error("[assistente] failed to save run telemetry", error);
        return null;
    }

    return data?.id ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function nonnegativeInteger(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function isUuid(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value,
        )
    );
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
                    const normalized = normalizeMetricMarkdown(
                        item.slice(0, separator).trim(),
                        item.slice(separator + 1).trim(),
                    );
                    const label = normalized.label;
                    const result = normalized.result;
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

function normalizeMetricMarkdown(label: string, result: string) {
    const delimiter = label.startsWith("**")
        ? "**"
        : label.startsWith("__")
          ? "__"
          : null;

    if (!delimiter) return { label, result };

    let normalizedLabel = label.slice(delimiter.length);
    let normalizedResult = result;

    if (normalizedLabel.endsWith(delimiter)) {
        normalizedLabel = normalizedLabel.slice(0, -delimiter.length);
    } else if (normalizedResult.startsWith(delimiter)) {
        normalizedResult = normalizedResult
            .slice(delimiter.length)
            .trimStart();
    } else if (normalizedResult.endsWith(delimiter)) {
        normalizedResult = normalizedResult
            .slice(0, -delimiter.length)
            .trimEnd();
    }

    return { label: normalizedLabel, result: normalizedResult };
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
        const key = `${card.type}:${card.data.id}`;
        if (!target.has(key)) target.set(key, card);
    }
}

function selectResponseCards(
    candidates: Map<string, AssistantCard>,
): AssistantCard[] {
    const selected: AssistantCard[] = [];
    for (const type of ["client", "conversation", "export"] as const) {
        const card = [...candidates.values()].find(
            (candidate) => candidate.type === type,
        );
        if (card && selected.length < MAX_RESPONSE_CARDS) selected.push(card);
    }
    return selected;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
    if (typeof value !== "string") return {};
    try {
        const parsed = JSON.parse(value);
        return typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
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

