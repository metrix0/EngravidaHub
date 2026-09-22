import type {
    DashboardWidgetDefinition,
    DashboardWidgetFilterKey,
} from "@/lib/personal-dashboard/registry";

const UNIT_FILTERS = [
    "units",
] as const satisfies readonly DashboardWidgetFilterKey[];
const NO_FILTERS = [] as const satisfies readonly DashboardWidgetFilterKey[];

export const CHANNEL_DASHBOARD_WIDGETS = [
    // Instagram analysis (/atendimento)
    { id: "instagram.conversas_analisadas", title: "Conversas analisadas", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.resolucao_real", title: "Resolução real", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.clientes_satisfeitos", title: "Clientes satisfeitos", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.taxa_abandono", title: "Taxa de abandono", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.primeira_resposta_humana", title: "1ª resposta humana", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.qualidade_atendimento", title: "Qualidade do atendimento", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.evolucao_diaria", title: "Evolução diária do Instagram", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.pontos_abandono", title: "Pontos de abandono", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.motivos_abandono", title: "Motivos prováveis de abandono", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.estado_final", title: "Estado final do cliente", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.resultado_resolucao", title: "Resultado da resolução", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.status_objetivo", title: "Status do objetivo", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.intencao_inicial", title: "Intenção inicial", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.objetivo_conversa", title: "Objetivo da conversa", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.sentimento_cliente", title: "Sentimento do cliente", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.dimensoes_qualidade", title: "Dimensões da qualidade", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.objecoes", title: "Objeções identificadas", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.origem_paga", title: "Origem paga dos clientes", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "instagram.clientes_campanha", title: "Clientes por campanha", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },

    // Messenger analysis (/atendimento)
    { id: "messenger.conversas_analisadas", title: "Conversas analisadas", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "messenger.resolucao_real", title: "Resolução real", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "messenger.clientes_satisfeitos", title: "Clientes satisfeitos", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "messenger.taxa_abandono", title: "Taxa de abandono", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "messenger.primeira_resposta_humana", title: "1ª resposta humana", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "messenger.qualidade_atendimento", title: "Qualidade do atendimento", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "messenger.evolucao_diaria", title: "Evolução diária do Messenger", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },

    // Calls (/atendimento)
    { id: "ligacoes.realizadas", title: "Ligações realizadas", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: UNIT_FILTERS },
    { id: "ligacoes.final_bom", title: "Final bom", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: UNIT_FILTERS },
    { id: "ligacoes.final_neutro", title: "Final neutro", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: UNIT_FILTERS },
    { id: "ligacoes.final_ruim", title: "Final ruim", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: UNIT_FILTERS },
    { id: "ligacoes.evolucao", title: "Evolução das ligações", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: UNIT_FILTERS },

    // Web pages (/atendimento)
    { id: "web.visualizacoes_site", title: "Visualizações — site principal", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "web.visualizacoes_landing", title: "Visualizações — landing pages", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "web.site_principal", title: "Site principal", kind: "table", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },
    { id: "web.landing_pages", title: "Landing pages", kind: "table", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard", supportedFilters: NO_FILTERS },

    // Channel share charts (/jornada)
    { id: "jornada.participacao_instagram", title: "Participação do Instagram nas conversas", kind: "chart", source: "canais", sourcePath: "/jornada", permissionTab: "jornada", supportedFilters: NO_FILTERS },
    { id: "jornada.participacao_messenger", title: "Participação do Messenger nas conversas", kind: "chart", source: "canais", sourcePath: "/jornada", permissionTab: "jornada", supportedFilters: NO_FILTERS },
] satisfies DashboardWidgetDefinition[];
