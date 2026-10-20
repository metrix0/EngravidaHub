import type { DashboardWidgetDefinition } from "./registry";
export const PERFORMANCE_KPI_IDS = [
    "performance.tickets", "performance.consultas", "performance.primeira_resposta",
    "performance.resposta_media", "performance.score_ia", "performance.resolucao_confirmada",
] as const;
export const PERFORMANCE_WIDGETS: DashboardWidgetDefinition[] = [
    { id: "performance.ranking", title: "Ranking comparativo", kind: "table", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.tickets", title: "Tickets", kind: "kpi", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.consultas", title: "Consultas marcadas", kind: "kpi", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.primeira_resposta", title: "1ª resposta", kind: "kpi", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.resposta_media", title: "Resposta média", kind: "kpi", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.score_ia", title: "Score de resolução IA", kind: "kpi", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.resolucao_confirmada", title: "Resolução confirmada IA", kind: "kpi", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.evolucao_mensal", title: "Evolução mensal", kind: "table", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.evolucao_tickets", title: "Evolução de tickets e consultas", kind: "chart", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.evolucao_resposta", title: "Evolução do tempo de resposta", kind: "chart", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.contribuicao_unidade", title: "Contribuição RA por unidade", kind: "chart", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units", "attendants"] },
    { id: "performance.marcado_por_atendente", title: "Marcado por atendente", kind: "table", source: "performance", sourcePath: "/performance", permissionTab: "performance", supportedFilters: ["units"] },
];
