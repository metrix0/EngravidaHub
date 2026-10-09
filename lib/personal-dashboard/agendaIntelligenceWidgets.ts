// lib/personal-dashboard/agendaIntelligenceWidgets.ts
import type { DashboardWidgetDefinition } from "./registry";

const definitions = [
    ["ocupacao", "Ocupação prevista", "kpi"],
    ["vagas", "Vagas livres", "kpi"],
    ["espera", "Espera mediana", "kpi"],
    ["nao_comparecimento", "Não comparecimento", "kpi"],
    ["mapa", "Ocupação por dia e horário", "chart"],
    ["oportunidades", "Demanda × disponibilidade", "chart"],
    ["demanda_horaria", "Demanda por horário", "chart"],
    ["demanda_horaria_unidade", "Demanda por horário por unidade", "chart"],
    ["preferencias", "Horários pedidos nas conversas", "table"],
    ["medicos", "Capacidade por médico", "table"],
    ["recuperacao", "Cancelamentos e recuperação de vagas", "chart"],
] as const;

export const AGENDA_INTELLIGENCE_WIDGETS: DashboardWidgetDefinition[] = definitions.map(([id, title, kind]) => ({
    id: `inteligencia_agenda.${id}`, title, kind, source: "inteligencia_agenda",
    sourcePath: "/inteligencia-agenda", permissionTab: "inteligencia_agenda", supportedFilters: ["units"],
}));
