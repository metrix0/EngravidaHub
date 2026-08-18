from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"missing anchor in {path}: {old[:120]!r}")
    p.write_text(s.replace(old, new, 1))


route = Path("app/api/assistente/chat/route.ts")
route_text = route.read_text()

if "assistantOperationalTools" not in route_text:
    replace_once(
        str(route),
        '''import {
    executeAssistantSocialDataTool,
    isAssistantSocialDataTool,
} from "@/lib/ai/assistantSocialDataTools";
import { openai } from "@/lib/ai/openai";''',
        '''import {
    executeAssistantSocialDataTool,
    isAssistantSocialDataTool,
} from "@/lib/ai/assistantSocialDataTools";
import {
    executeAssistantOperationalTool,
    isAssistantOperationalTool,
} from "@/lib/ai/assistantOperationalTools";
import { openai } from "@/lib/ai/openai";''',
    )

    tool_anchor = '''    {
        type: "function",
        name: "get_business_overview",
        description:
            "Retorna visão macro de clientes, conversas, análises, agendamentos, threads abertas, mensagens ativas, follow-ups e unidades.",'''
    operational_tools = '''    {
        type: "function",
        name: "get_funnel_overview",
        description:
            "Retorna a posição atual dos clientes por funil/etapa e os KPIs de jornada do CliniSys no período. Use para perguntas sobre /funil, quantidade por etapa, avaliações, procedimentos ou comparecimento da jornada.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"], description: "YYYY-MM-DD; null usa os últimos 30 dias para KPIs de jornada." },
                date_to: { type: ["string", "null"], description: "YYYY-MM-DD; null usa hoje." },
                unit_name: { type: ["string", "null"] },
            },
            required: ["date_from", "date_to", "unit_name"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_active_message_overview",
        description:
            "Consulta Mensagem Ativa e automações como resgate: lotes, mensagens enviadas, respostas, agendamentos, desempenho por template/automação e execuções recentes.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"], description: "YYYY-MM-DD; null usa os últimos 30 dias." },
                date_to: { type: ["string", "null"], description: "YYYY-MM-DD; null usa hoje." },
                automation: { type: ["string", "null"], description: "null/all = tudo; resgate = somente resgate; manual = envios sem automação; ou outro nome exato." },
            },
            required: ["date_from", "date_to", "automation"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_tracking_events_overview",
        description:
            "Consulta a tela Eventos e o pipeline de eventos enviados pelo Hub para Meta Ads/Google Ads: enviados, falhas, cobertura fbclid/gclid, tipos, plataformas, status e evolução. Para investimento/campanhas use get_paid_media_overview.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"], description: "YYYY-MM-DD; null usa os últimos 30 dias." },
                date_to: { type: ["string", "null"], description: "YYYY-MM-DD; null usa hoje." },
                unit_name: { type: ["string", "null"] },
                platform: { type: "string", enum: ["all", "meta_ads", "google_ads"] },
                event_types: { type: "array", items: { type: "string", enum: ["lead", "schedule"] } },
                statuses: { type: "array", items: { type: "string", enum: ["sent", "failed"] } },
                sources: { type: "array", items: { type: "string" } },
                tunnels: { type: "array", items: { type: "string" } },
                origins: { type: "array", items: { type: "string" } },
            },
            required: ["date_from", "date_to", "unit_name", "platform", "event_types", "statuses", "sources", "tunnels", "origins"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_internal_team_overview",
        description:
            "Consulta o diretório interno do Hub para saber quem está online/offline, função e fila. Use para perguntas sobre equipe interna ou disponibilidade de atendentes. É somente leitura.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                query: { type: ["string", "null"], description: "Nome, função ou fila; null retorna visão geral." },
                status: { type: "string", enum: ["all", "online", "offline"] },
            },
            required: ["query", "status"],
            additionalProperties: false,
        },
    },
'''
    route_text = route.read_text()
    if tool_anchor not in route_text:
        raise SystemExit("missing assistant tool anchor")
    route.write_text(route_text.replace(tool_anchor, operational_tools + tool_anchor, 1))

    replace_once(
        str(route),
        '''                    execution = isAssistantSocialDataTool(name)
                        ? await executeAssistantSocialDataTool(
                              name,
                              parsedArguments,
                          )
                        : await executeAssistantDataTool(
                              name,
                              parsedArguments,
                          );''',
        '''                    execution = isAssistantOperationalTool(name)
                        ? await executeAssistantOperationalTool(
                              name,
                              parsedArguments,
                          )
                        : isAssistantSocialDataTool(name)
                          ? await executeAssistantSocialDataTool(
                                name,
                                parsedArguments,
                            )
                          : await executeAssistantDataTool(
                                name,
                                parsedArguments,
                            );''',
    )

    replace_once(
        str(route),
        "2. Consulte ferramentas para qualquer fato sobre clientes, agenda, médicos, unidades, conversas, conversão, faturamento, Instagram, Facebook ou operação. Nunca invente dados.",
        "2. Consulte ferramentas para qualquer fato sobre clientes, agenda, médicos, unidades, conversas, conversão, faturamento, Instagram, Facebook, funil, Mensagem Ativa, resgate, eventos de conversão, equipe interna ou operação. Nunca invente dados.",
    )

    replace_once(
        str(route),
        '''8. Para perguntas financeiras do CliniSys, use get_financial_overview. Para Google Ads, Meta Ads, investimento, CTR, CPC, campanhas, ROAS, resultados atribuídos ou o pipeline de mídia até faturamento, use get_paid_media_overview. Combine as duas quando a pergunta cruzar faturamento geral e mídia paga. Trate "faturamento autorizado" como soma das NFS-e autorizadas: não chame isso de recebimento, caixa, pagamento ou lucro. Diferencie sempre conversões reportadas pelas plataformas de agendamentos, pacientes e NFS-e reais do Hub. Clique → WhatsApp é aproximado porque compara cliques agregados com clientes únicos por Origem.

FORMATO DA RESPOSTA:''',
        '''8. Para perguntas financeiras do CliniSys, use get_financial_overview. Para Google Ads, Meta Ads, investimento, CTR, CPC, campanhas, ROAS, resultados atribuídos ou o pipeline de mídia até faturamento, use get_paid_media_overview. Combine as duas quando a pergunta cruzar faturamento geral e mídia paga. Trate "faturamento autorizado" como soma das NFS-e autorizadas: não chame isso de recebimento, caixa, pagamento ou lucro. Diferencie sempre conversões reportadas pelas plataformas de agendamentos, pacientes e NFS-e reais do Hub. Clique → WhatsApp é aproximado porque compara cliques agregados com clientes únicos por Origem.

FERRAMENTAS OPERACIONAIS RECENTES:
- Para quantidade atual de clientes por etapa do Funil ou KPIs de avaliação/procedimento, use get_funnel_overview. As contagens de etapa são posição atual; o período se aplica aos KPIs de jornada.
- Para Mensagem Ativa, recaptacao e resgate, use get_active_message_overview. Diferencie lotes de mensagens efetivamente enviadas, respostas e agendamentos atribuídos.
- Para a tela Eventos, falhas de envio, fbclid/gclid ou eventos lead/schedule enviados pelo Hub, use get_tracking_events_overview. Isso é entrega de eventos; não confunda com investimento, campanhas, CTR, CPC ou ROAS de get_paid_media_overview.
- Para saber quem está online/offline ou em qual fila interna, use get_internal_team_overview. Não diga que enviou mensagens ou mudou status: o assistente continua somente leitura.

FORMATO DA RESPOSTA:''',
    )


page = Path("app/page.tsx")
page_text = page.read_text()
if 'label="Conversas analisadas"' in page_text and 'color="purple"' in page_text:
    replace_once(
        str(page),
        'label="Conversas analisadas"\n                                        currentValue={data.kpis.conversations_analyzed}\n                                        previousValue={data.previous_kpis.conversations_analyzed}\n                                        formatter={(value: number) => value.toLocaleString("pt-BR")}\n                                        color="purple"',
        'label="Conversas analisadas"\n                                        currentValue={data.kpis.conversations_analyzed}\n                                        previousValue={data.previous_kpis.conversations_analyzed}\n                                        formatter={(value: number) => value.toLocaleString("pt-BR")}\n                                        color="blue"',
    )
    replace_once(
        str(page),
        'label="Clientes satisfeitos"\n                                        currentValue={data.kpis.clear_satisfaction_rate}\n                                        previousValue={data.previous_kpis.clear_satisfaction_rate}\n                                        suffix="%"\n                                        color="blue"',
        'label="Clientes satisfeitos"\n                                        currentValue={data.kpis.clear_satisfaction_rate}\n                                        previousValue={data.previous_kpis.clear_satisfaction_rate}\n                                        suffix="%"\n                                        color="purple"',
    )
    replace_once(str(page), '<h2 className="text-lg font-bold">Evolução diária</h2>', '<h2 className="text-lg font-bold">Evolução de conversas</h2>')
    replace_once(str(page), '<LegendDot color="bg-violet-500" label="Resolução (%)" />', '<LegendDot color="bg-emerald-500" label="Resolução (%)" />')
    replace_once(str(page), '<LegendDot color="bg-emerald-500" label="Satisfação (%)" />', '<LegendDot color="bg-violet-500" label="Satisfação (%)" />')
    replace_once(str(page), 'dataKey="resolution_rate"\n                            yAxisId="percentage"\n                            stroke="#8b5cf6"', 'dataKey="resolution_rate"\n                            yAxisId="percentage"\n                            stroke="#10b981"')
    replace_once(str(page), 'dataKey="satisfaction_rate"\n                            yAxisId="percentage"\n                            stroke="#10b981"', 'dataKey="satisfaction_rate"\n                            yAxisId="percentage"\n                            stroke="#8b5cf6"')
