import type { DashboardWidgetDefinition } from "./registry";

export type AgendaReportSource = "agenda_disponibilidade" | "agenda_indicadores";
const availability = [
    ["espera", "Tempo de espera", "table"],
    ["datas", "Próximas datas", "table"],
    ["semanas", "Disponibilidade semanal", "table"],
    ["sabados", "Próximos sábados", "table"],
] as const;
const indicators = [
    ["total", "Total de vagas", "kpi"], ["disponiveis", "Disponíveis", "kpi"],
    ["ra", "Agendado RA", "kpi"], ["unidade", "Agendado Unidade", "kpi"],
    ["bloqueados", "Bloqueados", "kpi"], ["ocupacao", "Ocupação total", "kpi"],
    ["ocupacao_ra", "Ocupação RA", "kpi"], ["ocupacao_unidade", "Ocupação Unidade", "kpi"],
    ["grafico_unidades", "Agendamentos por unidade", "chart"],
    ["distribuicao", "Distribuição das vagas", "chart"],
    ["unidades", "Indicadores por unidade", "table"],
    ["atendentes", "Marcado por atendente", "table"],
] as const;
const definition = (source: AgendaReportSource, rows: ReadonlyArray<readonly [string, string, "kpi" | "chart" | "table"]>): DashboardWidgetDefinition[] => rows.map(([id, title, kind]) => ({
    id: `${source}.${id}`, title, kind, source, sourcePath: "/inteligencia-agenda", permissionTab: "inteligencia_agenda", supportedFilters: ["units"],
}));
export const AGENDA_AVAILABILITY_WIDGETS = definition("agenda_disponibilidade", availability);
export const AGENDA_INDICATOR_WIDGETS = definition("agenda_indicadores", indicators);
export const AGENDA_REPORT_WIDGETS = [...AGENDA_AVAILABILITY_WIDGETS, ...AGENDA_INDICATOR_WIDGETS];

// Availability is a daily view; indicators cover the complete month of that day.
export function agendaReportDashboardUrl(source: AgendaReportSource, dateParams: URLSearchParams, unitIds: string[]) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const date = dateParams.get("end_date") || dateParams.get("start_date") || today;
    const month = date.slice(0, 7);
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1, 12)).toISOString().slice(0, 10);
    const params = new URLSearchParams({ view: "reports", start: `${month}-01`, end, report_date: source === "agenda_disponibilidade" ? date : `${month}-01` });
    unitIds.forEach(id => params.append("unit_ids", id));
    return `/api/scheduling/reports?${params.toString()}`;
}
