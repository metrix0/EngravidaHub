export const SOURCE_FAITHFUL_WIDGET_IDS = new Set([
    "atendimento.evolucao_conversas",
    "atendimento.objetivo_conversas",
    "atendimento.momentos_perda",
    "financeiro.faturamento_autorizado",
    "financeiro.evolucao_faturamento",
    "financeiro.faturamento_unidade",
    "financeiro.procedimentos_cidade",
    "jornada.funil_conversa",
    "jornada.pontos_abandono",
    "jornada.resultados_intencao",
    "jornada.objecoes",
    "eventos.eventos_unicos",
    "eventos.eventos_enviados",
    "eventos.meta_ads",
    "eventos.google_ads",
    "eventos.qualified_lead",
    "eventos.schedule",
    "eventos.falhas_envio",
    "eventos.eventos_dia",
    "eventos.eventos_tipo",
    "eventos.parametros_clique",
]);

export function isSourceFaithfulDashboardWidgetId(id: string) {
    return SOURCE_FAITHFUL_WIDGET_IDS.has(id);
}
