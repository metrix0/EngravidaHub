import type { DashboardWidgetDefinition } from "@/lib/personal-dashboard/registry";

export const CHANNEL_DASHBOARD_WIDGETS = [
    // Instagram analysis (/atendimento)
    { id: "instagram.conversas_analisadas", title: "Conversas analisadas", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.resolucao_real", title: "Resolução real", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.clientes_satisfeitos", title: "Clientes satisfeitos", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.taxa_abandono", title: "Taxa de abandono", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.primeira_resposta_humana", title: "1ª resposta humana", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.qualidade_atendimento", title: "Qualidade do atendimento", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.evolucao_diaria", title: "Evolução diária do Instagram", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.pontos_abandono", title: "Pontos de abandono", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.motivos_abandono", title: "Motivos prováveis de abandono", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.estado_final", title: "Estado final do cliente", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.resultado_resolucao", title: "Resultado da resolução", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.status_objetivo", title: "Status do objetivo", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.intencao_inicial", title: "Intenção inicial", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.objetivo_conversa", title: "Objetivo da conversa", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.sentimento_cliente", title: "Sentimento do cliente", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.dimensoes_qualidade", title: "Dimensões da qualidade", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.objecoes", title: "Objeções identificadas", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.origem_paga", title: "Origem paga dos clientes", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "instagram.clientes_campanha", title: "Clientes por campanha", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },

    // Messenger analysis (/atendimento)
    { id: "messenger.conversas_analisadas", title: "Conversas analisadas", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "messenger.resolucao_real", title: "Resolução real", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "messenger.clientes_satisfeitos", title: "Clientes satisfeitos", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "messenger.taxa_abandono", title: "Taxa de abandono", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "messenger.primeira_resposta_humana", title: "1ª resposta humana", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "messenger.qualidade_atendimento", title: "Qualidade do atendimento", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "messenger.evolucao_diaria", title: "Evolução diária do Messenger", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },

    // Calls (/atendimento)
    { id: "ligacoes.realizadas", title: "Ligações realizadas", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "ligacoes.final_bom", title: "Final bom", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "ligacoes.final_neutro", title: "Final neutro", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "ligacoes.final_ruim", title: "Final ruim", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "ligacoes.evolucao", title: "Evolução das ligações", kind: "chart", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },

    // Web pages (/atendimento)
    { id: "web.visualizacoes_site", title: "Visualizações — site principal", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "web.visualizacoes_landing", title: "Visualizações — landing pages", kind: "kpi", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "web.site_principal", title: "Site principal", kind: "table", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },
    { id: "web.landing_pages", title: "Landing pages", kind: "table", source: "canais", sourcePath: "/atendimento", permissionTab: "dashboard" },

    // Channel share charts (/jornada)
    { id: "jornada.participacao_instagram", title: "Participação do Instagram nas conversas", kind: "chart", source: "canais", sourcePath: "/jornada", permissionTab: "jornada" },
    { id: "jornada.participacao_messenger", title: "Participação do Messenger nas conversas", kind: "chart", source: "canais", sourcePath: "/jornada", permissionTab: "jornada" },
] satisfies DashboardWidgetDefinition[];
