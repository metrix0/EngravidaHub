// app/api/assistente/chat/route.ts
import { NextResponse } from "next/server";
import { ASSISTANT_TOOLS as TOOLS } from "@/lib/ai/assistantTools";

import { supabase } from "@/lib";
import { executeAssistantTool } from "@/lib/ai/executeAssistantTool";
import { openai } from "@/lib/ai/openai";
import { toStatelessContinuationItems } from "@/lib/ai/assistantResponseState";
import { selectAssistantToolNames } from "@/lib/ai/assistantToolRouting";
import {
    ASSISTANT_HUB_KNOWLEDGE_BASE,
    ASSISTANT_PLAIN_LANGUAGE_RULE,
    findInternalTechnicalTerms,
    replaceInternalTechnicalTerms,
} from "@/lib/ai/assistantHubKnowledge";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import type {
    AssistantCard,
    AssistantChatRequest,
} from "@/types/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "gpt-5.6-luna";
const MAX_MESSAGES = 24;
const MAX_TOOL_ROUNDS = 8;
const MAX_EMPTY_RESPONSE_RETRIES = 1;
const MAX_PLAIN_LANGUAGE_RETRIES = 1;
const MAX_OUTPUT_TOKENS = 6_000;
const MAX_RESPONSE_CARDS = 3;
const MAX_CONVERSATION_CARDS = 1;
const MAX_CLIENT_CARDS = 1;
const MAX_EXPORT_CARDS = 1;
const MAX_CARD_CANDIDATES = 12;


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
        let toolRounds = 0;
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
        const cards = new Map<string, AssistantCard>();
        let emptyResponseRetries = 0;
        let plainLanguageRetries = 0;
        const selectedToolNames = new Set<string>(
            selectAssistantToolNames(messages),
        );
        const availableTools = TOOLS.filter((tool) =>
            selectedToolNames.has(tool.name),
        );
        let input: unknown[] = messages.map((message) => ({
            role: message.role,
            content: message.content,
        }));

        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
            await sendEvent({
                type: "status",
                status:
                    round === 0
                        ? "Analisando a solicitação..."
                        : "Cruzando os resultados...",
            });
            const response = await openai.responses.create({
                model: MODEL,
                store: false,
                include: ["reasoning.encrypted_content"],
                reasoning: { effort: "medium" },
                instructions: buildInstructions(
                    access.user.name,
                    sessionMemory,
                    access.permission.unit_lock?.name ?? null,
                ),
                input,
                tools: availableTools,
                tool_choice: "auto",
                max_output_tokens: MAX_OUTPUT_TOKENS,
                prompt_cache_key: `assistente:${access.user.id}`,
            }, { signal: request.signal });
            addUsage(usage, response.usage);

            const output = (response.output ?? []) as unknown as Array<
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
                                "A tentativa anterior terminou sem texto. Conclua a resposta agora. Se faltarem dados, use a ferramenta adequada; se os dados realmente não existirem, explique exatamente qual cobertura está ausente.",
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

            toolRounds = round + 1;
            await sendEvent({
                type: "status",
                status: "Consultando os dados do Hub...",
                tools: functionCalls
                    .map((call) =>
                        typeof call.name === "string" ? call.name : "",
                    )
                    .filter(Boolean),
            });
            const executions = await Promise.all(functionCalls.map(async (call) => {
                const callId =
                    typeof call.call_id === "string" ? call.call_id : "";
                const name =
                    typeof call.name === "string" ? call.name : "";
                const parsedArguments = parseToolArguments(call.arguments);
                let execution: {
                    output: unknown;
                    cards: AssistantCard[];
                };
                toolsUsed.add(name);

                try {
                    execution = await executeAssistantTool(name, parsedArguments, toolContext);
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

                return {
                    callId,
                    execution,
                    toolOutput: {
                        type: "function_call_output",
                        call_id: callId,
                        output: JSON.stringify(execution.output),
                    } as Record<string, unknown>,
                };
            }));
            const toolOutputs: Array<Record<string, unknown>> = [];

            for (const result of executions) {
                addRelevantCards(cards, result.execution.cards);
                toolOutputs.push(result.toolOutput);
            }

            input = [
                ...input,
                ...toStatelessContinuationItems(output),
                ...toolOutputs,
            ];
        }

        const runId = await recordAssistantRun({
            authUserId: access.user.id,
            sessionId: body.session_id,
            status: "incomplete",
            usage,
            toolsUsed,
            toolRounds,
            durationMs: Date.now() - startedAt,
            errorMessage: "Limite de etapas de ferramentas atingido.",
        });

        await sendEvent({
            type: "message",
            message: {
                role: "assistant",
                content:
                    "## Consulta incompleta\n\nA análise atingiu o limite seguro de etapas. Refinar o período ou o foco da pergunta permite concluir sem misturar resultados parciais.",
                cards: selectResponseCards(cards),
                run_id: runId,
            },
        });
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
    unitName: string | null,
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

REGRAS:
1. Responda em português do Brasil, exceto quando o usuário escrever claramente em outro idioma.
2. Consulte ferramentas para qualquer fato sobre clientes, agenda, médicos, unidades, conversas, conversão, faturamento, Instagram, Facebook, funil, Mensagem Ativa, resgate, eventos de conversão, equipe interna ou operação. Nunca invente dados.
3. Para uma pessoa específica do CRM/WhatsApp, use search_clients e depois get_client_context antes da resposta final. Para pessoas ou conversas do Instagram/Facebook, use search_social_conversations e depois get_social_conversation_context; nesses canais a identidade vem do perfil social e pode não existir em clients.
4. Para totais, taxas, cancelamentos ou comparecimento da agenda, use get_schedule_overview; para uma consulta específica, use search_appointments. Cada linha de schedules é um agendamento e o período usa a data marcada. No mês atual, encerre o período em hoje e use include_future=false, salvo se o usuário pedir explicitamente próximos, futuros ou o mês completo incluindo datas futuras. Nunca trate agendamentos futuros como falta de desfecho. Interprete agenda_chegou assim: Não = pendente/sem desfecho, Sim = chegou, Em Atendimento = compareceu e está em atendimento, Atendido = atendimento concluído, Faltou = não compareceu, Desmarcou = cancelado e Remarcou = remarcado. "Não" nunca significa automaticamente falta. "Compareceu" inclui Sim, Em Atendimento e Atendido. Use datas absolutas.
5. Para uma análise geral de conversas do WhatsApp, objeções, motivos de não agendamento ou explicação de conversas sem análise, use get_conversation_analysis_overview. Em pedidos de “últimos N dias”, envie relative_days=N para que hoje conte como o primeiro dia; não calcule date_from manualmente. Para Instagram/Facebook, use somente as ferramentas sociais disponíveis e informe quando elas não oferecerem uma análise agregada. Em perguntas de baixa conversão de uma unidade, use analyze_unit_performance e compare taxas com o benchmark geral. Considere abandono, motivos, objeções, satisfação, qualidade e velocidade.
6. Informe limites de cobertura quando existirem. Quando a cobertura de análise for menor que 100% ou o usuário perguntar por que faltam análises, explique os grupos retornados: conversas ainda abertas, na fila, em análise e sem conteúdo suficiente/com falha. Nunca suponha que todas são apenas conversas recentes. Uma conversa marcada como em análise, especialmente por muito tempo, não prova sozinha que o serviço responsável continua trabalhando nela.
7. Este assistente é somente leitura. Nunca diga que alterou, cancelou, marcou ou reatribuiu algo.
8. Para perguntas financeiras do CliniSys, use get_financial_overview. Para Google Ads, Meta Ads, investimento, CTR, CPC, campanhas, ROAS, resultados atribuídos ou o pipeline de mídia até faturamento, use get_paid_media_overview. Combine as duas quando a pergunta cruzar faturamento geral e mídia paga. Trate "faturamento autorizado" como soma das NFS-e autorizadas: não chame isso de recebimento, caixa, pagamento ou lucro. Diferencie sempre conversões reportadas pelas plataformas de agendamentos, pacientes e NFS-e reais do Hub. Clique → WhatsApp é aproximado porque compara cliques agregados com clientes únicos por Origem.
9. Sempre que usar “1ª resposta humana” ou “1º contato humano”, siga exatamente o Dashboard: a média principal inclui somente tempos observados de até 2 horas (7.200 segundos). Valores maiores não entram na média principal; informe quantos foram excluídos quando esse dado estiver disponível. Mediana e P90 podem incluir todos os tempos observados. Nunca apresente a média bruta como a métrica principal, salvo se o usuário pedir explicitamente.
10. Para buscar uma palavra, frase ou fala dentro das mensagens, use search_conversation_content. Para motivos de cancelamento/remarcação cruzados com conversas, use get_cancellation_analysis e diferencie motivo comprovado em texto de motivo desconhecido. Para campanhas, conjuntos e cidade de origem social, use get_meta_attribution_overview.
11. Quando o usuário pedir CSV, planilha, exportação ou download, use create_csv_export. Nunca prometa um arquivo sem criar o card de download.
12. Informe o período consultado, a fonte e qualquer limite relevante. Se não houver cobertura suficiente, diga objetivamente qual dado está ausente; nunca responda apenas que “não conseguiu produzir uma resposta”.
12-A. Objeções, abandono, sentimento, satisfação e qualidade vindos da análise de conversas são classificações automáticas. Identifique-as assim, priorize sinais de alta confiança e separe ou ressalve sinais de baixa confiança.

FERRAMENTAS OPERACIONAIS RECENTES:
- Para quantidade atual de clientes por etapa do Funil ou KPIs de avaliação/procedimento, use get_funnel_overview. As contagens de etapa são posição atual; o período se aplica aos KPIs de jornada.
- Para Mensagem Ativa, recaptacao e resgate, use get_active_message_overview. Diferencie lotes de mensagens efetivamente enviadas, respostas e agendamentos atribuídos.
- Para a tela Eventos, falhas de envio, fbclid/gclid ou eventos lead/schedule enviados pelo Hub, use get_tracking_events_overview. Isso é entrega de eventos; não confunda com investimento, campanhas, CTR, CPC ou ROAS de get_paid_media_overview.
- Para saber quem está online/offline ou em qual fila interna, use get_internal_team_overview. Não diga que enviou mensagens ou mudou status: o assistente continua somente leitura.

FORMATO DA RESPOSTA:
13. Sempre comece com um título Markdown descritivo usando ##.
14. Em respostas com várias unidades, cada unidade deve aparecer obrigatoriamente como subtítulo ### Nome da unidade. Nunca escreva o nome da unidade como uma linha solta.
15. Para comparar unidade e benchmark, use uma tabela Markdown compacta antes da análise textual.
16. Depois da tabela, escreva parágrafos curtos com rótulos em negrito, como **Ponto forte:** e **Principal pressão:**.
17. Use listas apenas para conjuntos genuínos de itens. Nunca transforme cada frase ou cada métrica em bullet. Use no máximo 3 bullets consecutivos.
18. Evite repetir o mesmo dado na tabela e no texto.
19. Nunca mostre identificadores internos, nomes de colunas, tabelas, funções, ferramentas, rotas, arquivos, fornecedores de infraestrutura, modelos de IA, estados escritos como no código ou listas de identificadores. Identifique pessoas, unidades, médicos e conversas apenas por nomes, datas e contexto humano. Explique o funcionamento do sistema somente pelo fluxo e pelo efeito no trabalho, sempre em linguagem comum.
20. Quando uma ferramenta retornar IDs para permitir outra consulta, use-os silenciosamente apenas nas chamadas de ferramenta. Eles jamais devem aparecer na resposta ao usuário.

CARDS:
21. Cards são evidência, não decoração. Use normalmente um card quando houver uma entidade ou conversa diretamente relevante.
22. Em análises de desempenho de uma ou várias unidades, use analyze_unit_performance com include_examples=true. O servidor escolherá somente a conversa mais forte entre todas as candidatas.
23. Nunca tente gerar um card para cada unidade. O resultado final terá no máximo uma conversa.
24. A conversa escolhida deve sustentar diretamente a principal conclusão, especialmente abandono, baixa qualidade, baixa satisfação ou problema de resolução.
25. Para perguntas sobre uma pessoa específica, inclua o card do cliente quando houver um cliente CRM associado.
26. Não chame get_conversation_context repetidamente para aumentar o número de cards.
27. Evidências visuais têm limite de um cliente e uma conversa; um arquivo de exportação solicitado pode aparecer adicionalmente.
28. Quando o usuário pedir um gráfico, inclua o gráfico em um bloco exatamente neste formato, usando os dados reais da ferramenta:
\`\`\`assistant-chart
{"type":"line","title":"Título","data":[{"label":"11/07/2026","value":0}],"valueSuffix":""}
\`\`\`
Use \`line\` para evolução por dia, \`bar\` para comparação e \`pie\` para composição. Nunca escreva \`assistant-chart\` e o JSON fora do bloco.

CONTEXTO DINÂMICO DESTA SOLICITAÇÃO:
Usuário atual: ${userName}
Data e hora atuais em America/Sao_Paulo: ${now}
Escopo de unidade: ${unitName ?? "todas as unidades permitidas"}
${
    sessionMemory
        ? `\nCONTEXTO PERSISTENTE DE MENSAGENS ANTERIORES DESTE CHAT:\n<session_memory>\n${sessionMemory.slice(0, 12_000)}\n</session_memory>\nUse esse contexto apenas para continuidade. Para qualquer dado atual do Hub, consulte novamente a ferramenta correta.`
        : ""
}
`.trim();
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
    const exportCards = allCards.filter(
        (card): card is Extract<AssistantCard, { type: "export" }> =>
            card.type === "export",
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

    if (
        exportCards.length > 0 &&
        selected.filter((card) => card.type === "export").length <
            MAX_EXPORT_CARDS &&
        selected.length < MAX_RESPONSE_CARDS
    ) {
        selected.push(exportCards[0]);
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
