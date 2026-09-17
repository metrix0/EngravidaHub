// lib/ai/assistantAnalyticsQuery.ts
import type { AssistantToolContext } from "@/lib/ai/assistantToolContext";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MAX_SQL_LENGTH = 12_000;

const FORBIDDEN_SQL_KEYWORDS =
    /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|copy|call|do|execute|prepare|deallocate|vacuum|analyze|refresh|reindex|cluster|comment|security|label|lock|listen|unlisten|notify|set|reset|into|returning)\b/i;
const FORBIDDEN_SCHEMAS =
    /\b(public|auth|storage|realtime|vault|extensions|information_schema|pg_catalog)\s*\./i;
const FORBIDDEN_SYSTEM_IDENTIFIER = /\bpg_[a-z0-9_]+\b/i;
const FORBIDDEN_FUNCTIONS =
    /\b(setval|nextval|set_config|lo_[a-z0-9_]*)\s*\(/i;

export const ASSISTANT_ANALYTICS_GUIDE = `
CONSULTA ANALÍTICA GENÉRICA:
- query_hub_data existe para cruzamentos/coortes que exigem acompanhar os mesmos registros ao longo do tempo ou combinar fontes. Ela é somente leitura e aceita uma única SELECT/CTE.
- Prefira as ferramentas dedicadas para pessoa específica, conversa/transcrição, cards, CSV e métricas prontas do Dashboard. Use a consulta genérica quando essas ferramentas não conseguem estabelecer o vínculo solicitado.
- Não use nomes internos na resposta final. Explique a fonte em linguagem de negócio.

VISÕES DISPONÍVEIS NA CONSULTA GENÉRICA (use os nomes abaixo sem prefixo de schema):
- clinisys_events(id, client_id, scheduled_for, created_in_source_at, unit_name, procedure_name, status, event_kind): histórico amplo de agendamentos importados do CliniSys. Para coortes históricas, esta é a fonte principal. event_kind é amplo; quando o usuário definir quais tratamentos/procedimentos contam, filtre procedure_name conforme essa definição.
- schedules(id, client_id, scheduled_for, created_in_source_at, unit_name, attendant_name, procedure_name, status, source): agenda operacional importada; pode ter cobertura menor que clinisys_events para histórico completo.
- invoices(source_invoice_id, issued_at, amount, description, category, status, unit_id, unit_name, doctor_id, doctor_name, client_id): NFS-e/financeiro do CliniSys.
- clients(id, unit_id, first_seen_at, last_interaction_at, created_at, state, country, utm_source, utm_medium, utm_campaign, utm_content, utm_term, last_tunnel, last_origin, last_closing_tag, last_closing_tag_at): vínculo analítico de clientes sem dados pessoais diretos.
- units(id, name, city, state, active), doctors(id, name, specialty, active), attendants(id, name, unit_id, active, is_online, queue_id).
- conversations(id, client_id, thread_id, started_at, ended_at, attendant_id, attendant_chat_name, unit_id, service_id, tunnel, origin, channel, analysis_status, instagram_user_id).
- conversation_analysis(id, conversation_id, client_id, started_at, ended_at, attendant_id, unit_id, service_id, customer_start_intent, conversation_goal, goal_status, customer_final_state, dropoff_happened, dropoff_moment, dropoff_likely_reason, dropoff_confidence, customer_sentiment, satisfaction_score, sentiment_confidence, clarity_score, empathy_score, proactivity_score, objection_handling_score, response_speed_score, attendant_quality_score, first_human_response_time_seconds, normalized_first_human_response_time_seconds, first_human_response_excluded_over_2h, average_human_response_time_seconds, longest_human_delay_seconds, resolution_result, resolution_score, resolution_reasoning_category, short_label, notable, notable_reason, analysis_completed_at, response_eligible, first_response_anchor, instagram_user_id).
- ad_attributions(id, instagram_user_id, thread_id, channel, platform, campaign_id, campaign_name, ad_set_id, ad_set_name, ad_name, referral_received_at, enrichment_status).
- ad_daily_metrics(platform, account_id, account_name, campaign_id, campaign_name, metric_date, currency_code, impressions, clicks, spend, reported_conversions, reported_conversion_value, reported_conversion_type, whatsapp_impressions, whatsapp_clicks, whatsapp_conversations).
- active_message_sends(id, template_id, template_name, requested_count, sent_count, failed_count, normal_message_count, template_message_count, status, client_ids, created_by, created_by_name, created_at, completed_at).
- funnels(id, name, active), funnel_stages(id, funnel_id, name, position), funnel_history(id, client_id, funnel_id, from_stage_id, to_stage_id, moved_by_attendant_id, moved_at).

REGRAS IMPORTANTES:
- CliniSys: status de comparecimento segue a regra existente do Hub: Sim, Em Atendimento e Atendido significam compareceu; Desmarcou = cancelado; Remarcou = remarcado; Faltou = não compareceu; Não = pendente/sem desfecho.
- “1ª resposta humana” / “1º contato humano”: para a média principal use SEMPRE AVG(normalized_first_human_response_time_seconds). Esse campo já aplica a normalização do Dashboard e exclui observações acima de 2 horas (7.200 s). Para informar exclusões, conte first_human_response_excluded_over_2h = true. Só use o campo bruto first_human_response_time_seconds para mediana/P90 ou quando o usuário pedir explicitamente a métrica bruta.
- Quando o usuário disser que “fechou” significa ter um agendamento posterior, não substitua por faturamento ou atendimento financeiro. Use o vínculo por client_id e a data posterior exatamente como solicitado.
- Agregue no banco sempre que possível; não retorne centenas de linhas para contar no modelo.
`.trim();

export function normalizeAndValidateAssistantAnalyticsSql(value: string) {
    const sql = value.trim().replace(/;+\s*$/, "").trim();

    if (!sql || sql.length > MAX_SQL_LENGTH) {
        throw new Error("Consulta analítica vazia ou longa demais.");
    }
    if (!/^(select|with)\b/i.test(sql)) {
        throw new Error("A consulta analítica deve ser somente SELECT.");
    }
    if (/;|--|\/\*|\*\//.test(sql)) {
        throw new Error("A consulta analítica deve conter uma única instrução sem comentários.");
    }
    if (FORBIDDEN_SQL_KEYWORDS.test(sql)) {
        throw new Error("A consulta analítica contém uma operação não permitida.");
    }
    if (FORBIDDEN_SCHEMAS.test(sql)) {
        throw new Error("A consulta analítica só pode usar as visões aprovadas.");
    }
    if (FORBIDDEN_SYSTEM_IDENTIFIER.test(sql) || FORBIDDEN_FUNCTIONS.test(sql)) {
        throw new Error("A consulta analítica contém uma função ou relação não permitida.");
    }

    return sql;
}

export async function executeAssistantAnalyticsQuery(
    args: Record<string, unknown>,
    context: AssistantToolContext,
) {
    if (context.unitLock) {
        return {
            output: {
                ok: false,
                error:
                    "A consulta analítica ampla não está disponível neste escopo de unidade. Use as consultas específicas já limitadas à unidade.",
            },
            cards: [],
        };
    }

    const rawSql = typeof args.sql === "string" ? args.sql : "";
    const sql = normalizeAndValidateAssistantAnalyticsSql(rawSql);
    const requestedLimit =
        typeof args.limit === "number" && Number.isInteger(args.limit)
            ? args.limit
            : DEFAULT_LIMIT;
    const limit = Math.min(MAX_LIMIT, Math.max(1, requestedLimit));

    const { supabase } = await import("@/lib");
    const { data, error } = await supabase.rpc("assistant_readonly_query", {
        p_sql: sql,
        p_limit: limit,
    });

    if (error) {
        throw new Error(`Falha na consulta analítica: ${error.message}`);
    }

    const payload =
        data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : {};
    const rows = Array.isArray(payload.rows) ? payload.rows : [];

    return {
        output: {
            ok: true,
            source: "Dados analíticos internos do Engravida Hub",
            rows,
            row_count: rows.length,
            limit,
            may_be_truncated: rows.length >= limit,
            metric_rules: {
                first_human_response:
                    "A média principal deve usar normalized_first_human_response_time_seconds (até 7.200 s). Valores acima de 2h ficam fora da média principal.",
            },
        },
        cards: [],
    };
}
