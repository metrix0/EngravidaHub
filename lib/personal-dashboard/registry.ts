import type { AppTabId } from "@/lib/auth/userAccess";

export type DashboardWidgetKind = "kpi" | "chart" | "table";
export type DashboardWidgetSource =
    | "atendimento"
    | "canais"
    | "financeiro"
    | "jornada"
    | "eventos"
    | "clientes"
    | "funil"
    | "mensagem_ativa";

export type DashboardWidgetDefinition = {
    id: string;
    title: string;
    kind: DashboardWidgetKind;
    source: DashboardWidgetSource;
    sourcePath: string;
    permissionTab: AppTabId;
};

export const DASHBOARD_WIDGETS = [
    { id: "atendimento.conversas_analisadas", title: "Conversas analisadas", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.resolucao_real", title: "Resolução real", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.clientes_satisfeitos", title: "Clientes satisfeitos", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.taxa_agendamentos", title: "Taxa agendamentos", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.primeira_resposta_humana", title: "1ª resposta humana", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.marcacoes", title: "Marcações", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.agendamentos", title: "Agendamentos", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.agendamentos_unicos", title: "Agendamentos únicos", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.cancelou", title: "Cancelou", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.faltou", title: "Faltou", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.compareceu", title: "Compareceu", kind: "kpi", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.evolucao_conversas", title: "Evolução de conversas", kind: "chart", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.objetivo_conversas", title: "Objetivo das conversas", kind: "chart", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.momentos_perda", title: "Momentos de perda mais comuns", kind: "chart", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.mapa_palavras", title: "Mapa de palavras", kind: "chart", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.palavras_unidade", title: "Palavras por unidade", kind: "table", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.agendamentos_periodo", title: "Agendamentos no período", kind: "chart", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.marcacoes_dia", title: "Marcações por dia", kind: "chart", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.online_presencial", title: "Online e presencial", kind: "table", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.eficiencia_unidades", title: "Mapa de eficiência das unidades", kind: "chart", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "atendimento.visao_unidade", title: "Visão por unidade", kind: "table", source: "atendimento", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "canais.instagram_conversas", title: "Instagram", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "canais.messenger_conversas", title: "Messenger", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "canais.ligacoes", title: "Ligações", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "canais.site", title: "Acessos do site", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "financeiro.faturamento_autorizado", title: "Faturamento autorizado", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.notas_autorizadas", title: "Notas autorizadas", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.ticket_medio", title: "Ticket médio", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.pacientes_faturados", title: "Pacientes faturados", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.valor_cancelado", title: "Valor cancelado", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.taxa_cancelamento", title: "Taxa de cancelamento", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.investimento_midia", title: "Investimento em mídia", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.receita_midia", title: "Receita atribuída à mídia", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.retorno_midia", title: "Retorno sobre mídia", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.custo_agendamento", title: "Custo por agendamento", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.custo_paciente_faturado", title: "Custo por paciente faturado", kind: "kpi", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.evolucao_faturamento", title: "Evolução do faturamento", kind: "chart", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.status_fiscal", title: "Status fiscal", kind: "chart", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.faturamento_12_meses", title: "Faturamento e investimento — 12 meses", kind: "chart", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.faturamento_procedimento", title: "Faturamento por procedimento", kind: "chart", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.faturamento_unidade", title: "Faturamento por unidade", kind: "table", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.procedimentos_cidade", title: "Procedimentos por cidade", kind: "chart", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.faturamento_origem", title: "Faturamento por origem", kind: "chart", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.faturamento_medico", title: "Faturamento por médico", kind: "chart", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.investimento_receita_midia", title: "Investimento x receita atribuída", kind: "chart", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.eficiencia_plataforma", title: "Eficiência por plataforma", kind: "table", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.roas_plataforma", title: "ROAS por plataforma", kind: "chart", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.campanhas", title: "Campanhas com maior investimento", kind: "table", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.verba_cidade", title: "Verba de mídia por cidade", kind: "table", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "financeiro.retorno_cidade", title: "Retorno real da mídia por cidade", kind: "chart", source: "financeiro", sourcePath: "/financeiro", permissionTab: "financeiro" },
    { id: "jornada.jornada_completa", title: "Jornada completa", kind: "chart", source: "jornada", sourcePath: "/jornada", permissionTab: "jornada" },
    { id: "jornada.cobertura_whatsapp", title: "Cobertura das conversas no WhatsApp", kind: "chart", source: "jornada", sourcePath: "/jornada", permissionTab: "jornada" },
    { id: "jornada.fontes_whatsapp", title: "De onde vem o WhatsApp rastreado", kind: "table", source: "jornada", sourcePath: "/jornada", permissionTab: "jornada" },
    { id: "jornada.funil_conversa", title: "Jornada na Conversa", kind: "chart", source: "jornada", sourcePath: "/jornada", permissionTab: "jornada" },
    { id: "jornada.avaliacao_presencial", title: "1ª Avaliação presencial", kind: "chart", source: "jornada", sourcePath: "/jornada", permissionTab: "jornada" },
    { id: "jornada.avaliacao_online", title: "1ª Avaliação online", kind: "chart", source: "jornada", sourcePath: "/jornada", permissionTab: "jornada" },
    { id: "jornada.pontos_abandono", title: "Pontos de abandono", kind: "chart", source: "jornada", sourcePath: "/jornada", permissionTab: "jornada" },
    { id: "jornada.resultados_intencao", title: "Resultados por intenção inicial", kind: "table", source: "jornada", sourcePath: "/jornada", permissionTab: "jornada" },
    { id: "jornada.objecoes", title: "Principais objeções", kind: "chart", source: "jornada", sourcePath: "/jornada", permissionTab: "jornada" },
    { id: "eventos.eventos_unicos", title: "Eventos únicos", kind: "kpi", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "eventos.eventos_enviados", title: "Eventos enviados", kind: "kpi", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "eventos.meta_ads", title: "Meta Ads", kind: "kpi", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "eventos.google_ads", title: "Google Ads", kind: "kpi", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "eventos.qualified_lead", title: "Qualified Lead", kind: "kpi", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "eventos.schedule", title: "Schedule", kind: "kpi", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "eventos.falhas_envio", title: "Falhas no envio", kind: "kpi", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "eventos.eventos_dia", title: "Eventos enviados por dia", kind: "chart", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "eventos.eventos_tipo", title: "Eventos por tipo", kind: "chart", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "eventos.parametros_clique", title: "Parâmetros de clique", kind: "chart", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "eventos.eventos_recentes", title: "Eventos recentes", kind: "table", source: "eventos", sourcePath: "/eventos", permissionTab: "eventos" },
    { id: "clientes.clientes_totais", title: "Clientes totais", kind: "kpi", source: "clientes", sourcePath: "/clientes", permissionTab: "clientes" },
    { id: "clientes.sem_funil", title: "Sem funil", kind: "kpi", source: "clientes", sourcePath: "/clientes", permissionTab: "clientes" },
    { id: "clientes.agendados", title: "Agendados", kind: "kpi", source: "clientes", sourcePath: "/clientes", permissionTab: "clientes" },
    { id: "clientes.sem_interacao", title: "Sem interação", kind: "kpi", source: "clientes", sourcePath: "/clientes", permissionTab: "clientes" },
    { id: "funil.avaliacoes_agendadas", title: "Avaliações agendadas", kind: "kpi", source: "funil", sourcePath: "/funil", permissionTab: "funil" },
    { id: "funil.comparecimento_avaliacao", title: "Comparecimento avaliação", kind: "kpi", source: "funil", sourcePath: "/funil", permissionTab: "funil" },
    { id: "funil.procedimentos_agendados", title: "Procedimentos agendados", kind: "kpi", source: "funil", sourcePath: "/funil", permissionTab: "funil" },
    { id: "funil.comparecimento_procedimento", title: "Comparecimento procedimento", kind: "kpi", source: "funil", sourcePath: "/funil", permissionTab: "funil" },
    { id: "mensagem_ativa.templates_utilizados", title: "Templates utilizados", kind: "chart", source: "mensagem_ativa", sourcePath: "/mensagem-ativa", permissionTab: "mensagem_ativa" },
    { id: "mensagem_ativa.volume_resultados", title: "Volume e resultados de Envios Ativos", kind: "chart", source: "mensagem_ativa", sourcePath: "/mensagem-ativa", permissionTab: "mensagem_ativa" },
    { id: "mensagem_ativa.historico_envios", title: "Histórico de envios", kind: "table", source: "mensagem_ativa", sourcePath: "/mensagem-ativa", permissionTab: "mensagem_ativa" },
] satisfies DashboardWidgetDefinition[];

const widgetById = new Map<string, DashboardWidgetDefinition>(
    DASHBOARD_WIDGETS.map((widget) => [widget.id, widget]),
);

export const DASHBOARD_PRESETS: Record<string, string[]> = {
    admin: [
        "atendimento.conversas_analisadas",
        "atendimento.resolucao_real",
        "atendimento.agendamentos",
        "financeiro.faturamento_autorizado",
        "financeiro.ticket_medio",
        "financeiro.evolucao_faturamento",
        "jornada.funil_conversa",
        "eventos.eventos_enviados",
        "atendimento.online_presencial",
    ],
    gestor: [
        "atendimento.conversas_analisadas",
        "atendimento.resolucao_real",
        "atendimento.agendamentos",
        "financeiro.faturamento_autorizado",
        "financeiro.evolucao_faturamento",
        "jornada.funil_conversa",
        "atendimento.online_presencial",
    ],
    atendente: [
        "atendimento.conversas_analisadas",
        "atendimento.resolucao_real",
        "atendimento.agendamentos",
        "funil.avaliacoes_agendadas",
    ],
    marketing: [
        "atendimento.conversas_analisadas",
        "atendimento.taxa_agendamentos",
        "jornada.funil_conversa",
        "eventos.eventos_enviados",
        "eventos.eventos_dia",
        "canais.instagram_conversas",
    ],
};

export function getDashboardWidget(
    id: string,
): DashboardWidgetDefinition | null {
    return widgetById.get(id) ?? null;
}

export function isDashboardWidgetId(id: unknown): id is string {
    return typeof id === "string" && widgetById.has(id);
}

export function filterDashboardWidgetIds(
    ids: readonly string[],
    allowedTabs: readonly AppTabId[],
) {
    const allowed = new Set(allowedTabs);
    return [...new Set(ids)].filter((id) => {
        const widget = getDashboardWidget(id);
        return Boolean(widget && allowed.has(widget.permissionTab));
    });
}

export function getDashboardPreset(
    preset: string,
    allowedTabs: readonly AppTabId[],
) {
    return filterDashboardWidgetIds(DASHBOARD_PRESETS[preset] ?? [], allowedTabs);
}

export function findDashboardWidgetBySource(
    sourcePath: string,
    title: string,
    kind?: DashboardWidgetKind,
): DashboardWidgetDefinition | null {
    const normalized = normalizeTitle(title);
    return (
        DASHBOARD_WIDGETS.find(
            (widget) =>
                widget.sourcePath === sourcePath &&
                (!kind || widget.kind === kind) &&
                normalizeTitle(widget.title) === normalized,
        ) ?? null
    );
}

function normalizeTitle(value: string) {
    return value.trim().toLocaleLowerCase("pt-BR");
}
