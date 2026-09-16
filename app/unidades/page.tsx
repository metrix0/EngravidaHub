"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Frown,
  HelpCircle,
  History,
  Info,
  LoaderCircle,
  Meh,
  Smile,
  Sparkles,
} from "lucide-react";
import { Card, Skeleton } from "@/components";
import AssistantMarkdown from "@/components/assistant/AssistantMarkdown";
import AssistantConversationCard from "@/components/assistant/AssistantConversationCard";
import { useCurrentUser } from "@/components/auth/CurrentUserProvider";
import { openClientProfile } from "@/components/clientes/PermanentClientProfilePanel";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import InfoTooltip from "@/components/ui/InfoTooltip";
import UnitMap from "@/components/units/UnitMap";
import type {
  MacroUnit,
  UnitMacroAnalysis,
} from "@/types/unit-macro-analysis";

const button =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50";
const statusLabel = {
  pending: "Na fila",
  processing: "Analisando",
  completed: "Concluída",
  failed: "Falha na análise",
};
type SidebarMetricKey =
  | "markings"
  | "schedules"
  | "conversations"
  | "attended"
  | "revenue";
type SidebarStat = {
  key: SidebarMetricKey;
  label: string;
  value: string;
  change: number | null;
};
const SIDEBAR_METRICS: Array<{
  key: SidebarMetricKey;
  label: string;
  currency?: boolean;
}> = [
  { key: "markings", label: "Marcações" },
  { key: "schedules", label: "Agendamentos" },
  { key: "conversations", label: "Conversas" },
  { key: "attended", label: "Atendidos" },
  { key: "revenue", label: "Faturamento", currency: true },
];
type FeelingMetricKey =
  | "scheduling_or_confirmation_rate"
  | "dropoff_rate_all_analyzed_conversations"
  | "resolution_rate"
  | "median_first_human_response_seconds"
  | "attendant_quality_score";
type FeelingMetric = {
  key: FeelingMetricKey;
  label: string;
  higherIsBetter: boolean;
  threshold: number;
  weight: number;
  unit: "pp" | "seconds" | "score";
};
const FEELING_METRICS: FeelingMetric[] = [
  {
    key: "scheduling_or_confirmation_rate",
    label: "Agendamento",
    higherIsBetter: true,
    threshold: 3,
    weight: 2,
    unit: "pp",
  },
  {
    key: "dropoff_rate_all_analyzed_conversations",
    label: "Abandono",
    higherIsBetter: false,
    threshold: 5,
    weight: 2,
    unit: "pp",
  },
  {
    key: "resolution_rate",
    label: "Resolução",
    higherIsBetter: true,
    threshold: 5,
    weight: 2,
    unit: "pp",
  },
  {
    key: "median_first_human_response_seconds",
    label: "1ª resposta",
    higherIsBetter: false,
    threshold: 120,
    weight: 1,
    unit: "seconds",
  },
  {
    key: "attendant_quality_score",
    label: "Qualidade",
    higherIsBetter: true,
    threshold: 0.5,
    weight: 1,
    unit: "score",
  },
];
function date(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
}
function periodLabel(analysis: UnitMacroAnalysis) {
  const end = new Date(`${analysis.period_end}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return `${date(analysis.period_start)} – ${date(end.toISOString())}`;
}
function analysisTypeLabel(analysis: UnitMacroAnalysis) {
  return analysis.analysis_type === "weekly" ? "Semanal" : "Mensal";
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function metricValue(analysis: UnitMacroAnalysis, key: SidebarMetricKey) {
  const schedule = asRecord(analysis.metrics.get_schedule_overview);
  const scheduleTotals = asRecord(schedule.totals);
  const conversations = asRecord(
    analysis.metrics.get_conversation_analysis_overview,
  );
  const conversationCoverage = asRecord(conversations.coverage);
  const financial = asRecord(analysis.metrics.get_financial_overview);
  const financialTotals = asRecord(financial.totals);
  const deterministic = asRecord(analysis.metrics.deterministic_stats);
  if (key === "markings") return finiteNumber(deterministic.markings);
  if (key === "schedules") return finiteNumber(scheduleTotals.total);
  if (key === "conversations")
    return finiteNumber(conversationCoverage.total_conversations);
  if (key === "attended") return finiteNumber(scheduleTotals.attended);
  return finiteNumber(financialTotals.authorized_revenue);
}
function metricDisplay(value: number, currency = false) {
  return currency
    ? value.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      })
    : value.toLocaleString("pt-BR");
}
function weeklyAverage(
  analysis: UnitMacroAnalysis,
  unitAnalyses: UnitMacroAnalysis[],
  key: SidebarMetricKey,
) {
  if (analysis.analysis_type !== "weekly") return null;
  const values = unitAnalyses
    .filter(
      (candidate) =>
        candidate.id !== analysis.id &&
        candidate.analysis_type === "weekly" &&
        candidate.status === "completed" &&
        candidate.period_end <= analysis.period_start,
    )
    .sort((a, b) => b.period_end.localeCompare(a.period_end))
    .slice(0, 4)
    .map((candidate) => metricValue(candidate, key))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function percentageChange(current: number, average: number | null) {
  if (average === null) return null;
  if (average === 0) return current === 0 ? 0 : null;
  return ((current - average) / average) * 100;
}
function sidebarStats(
  analysis: UnitMacroAnalysis,
  unitAnalyses: UnitMacroAnalysis[],
): SidebarStat[] {
  return SIDEBAR_METRICS.flatMap((metric) => {
    const current = metricValue(analysis, metric.key);
    if (current === null) return [];
    return [
      {
        key: metric.key,
        label: metric.label,
        value: metricDisplay(current, metric.currency),
        change: percentageChange(
          current,
          weeklyAverage(analysis, unitAnalyses, metric.key),
        ),
      },
    ];
  });
}
function changeText(change: number | null) {
  if (change === null) return null;
  const percentage = Math.abs(change).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (change > 0) return `↑ ${percentage}%`;
  if (change < 0) return `↓ ${percentage}%`;
  return `${percentage}%`;
}
function changeTone(change: number | null) {
  if (change === null) return "slate" as const;
  if (change >= 5) return "green" as const;
  if (change <= -5) return "red" as const;
  return "orange" as const;
}
function changeTextClass(change: number | null) {
  const tone = changeTone(change);
  if (tone === "green") return "text-green";
  if (tone === "red") return "text-red";
  if (tone === "orange") return "text-orange";
  return "text-slate-400";
}
function changeBarClass(change: number | null) {
  const tone = changeTone(change);
  if (tone === "green") return "bg-green";
  if (tone === "red") return "bg-red";
  if (tone === "orange") return "bg-orange";
  return "bg-slate-300";
}
function changeBarWidth(change: number | null) {
  if (change === null) return 0;
  return Math.min(100, Math.max(4, 50 + Math.max(-50, Math.min(50, change))));
}
function feelingDifference(value: number, unit: FeelingMetric["unit"]) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  if (unit === "seconds") {
    const amount = absolute >= 60
      ? `${(absolute / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`
      : `${Math.round(absolute)} s`;
    return `${sign}${amount}`;
  }
  const amount = absolute.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: unit === "score" ? 2 : 1,
  });
  return `${sign}${amount}${unit === "pp" ? " pp" : ""}`;
}
function feelingDirection(value: number, metric: FeelingMetric) {
  if (value === 0) return "igual";
  const favorable = metric.higherIsBetter ? value > 0 : value < 0;
  return favorable ? "melhor" : "pior";
}
function feelingSignal(value: number, metric: FeelingMetric) {
  const oriented = value * (metric.higherIsBetter ? 1 : -1);
  if (oriented >= metric.threshold) return metric.weight;
  if (oriented <= -metric.threshold) return -metric.weight;
  return 0;
}
function analysisFeeling(analysis: UnitMacroAnalysis | null) {
  if (!analysis || analysis.status !== "completed")
    return {
      label: "Sem classificação",
      icon: "average" as const,
      badgeClass: "bg-slate-100 text-slate-500",
      tooltip: "Sem classificação disponível para esta análise.",
    };
  const network = asRecord(analysis.metrics.network_benchmark);
  const networkMetrics = asRecord(network.metrics);
  const self = asRecord(analysis.metrics.self_benchmark);
  const selfMetrics = asRecord(self.metrics);
  const networkLines: string[] = [];
  const selfLines: string[] = [];
  let selfScore = 0;
  let selfSignals = 0;

  for (const metric of FEELING_METRICS) {
    const networkMetric = asRecord(networkMetrics[metric.key]);
    const networkDifference = finiteNumber(
      networkMetric.difference_from_other_units_median,
    );
    if (networkDifference !== null) {
      const rank = finiteNumber(networkMetric.rank);
      const compared = finiteNumber(networkMetric.compared_units);
      const rankText = rank !== null && compared !== null
        ? ` · ${rank}º/${compared}`
        : "";
      networkLines.push(
        `${metric.label}: ${feelingDifference(networkDifference, metric.unit)} (${feelingDirection(networkDifference, metric)})${rankText}`,
      );
    }

    const selfMetric = asRecord(selfMetrics[metric.key]);
    const baselineDifference = finiteNumber(
      selfMetric.difference_from_previous_4_weeks_median,
    );
    if (baselineDifference !== null) {
      selfScore += feelingSignal(baselineDifference, metric);
      selfSignals += 1;
      const comparedPeriods = finiteNumber(selfMetric.compared_periods);
      const previousDifference = finiteNumber(
        selfMetric.difference_from_previous_week,
      );
      const previousText = previousDifference === null
        ? ""
        : ` · ${feelingDifference(previousDifference, metric.unit)} (${feelingDirection(previousDifference, metric)}) vs semana anterior`;
      selfLines.push(
        `${metric.label}: ${feelingDifference(baselineDifference, metric.unit)} (${feelingDirection(baselineDifference, metric)}) vs mediana de ${comparedPeriods ?? 0} sem.${previousText}`,
      );
    }
  }

  if (selfSignals === 0)
    return {
      label: "Sem classificação",
      icon: "average" as const,
      badgeClass: "bg-slate-100 text-slate-500",
      tooltip: "Sem histórico semanal suficiente para classificar esta análise.",
    };
  const label = selfScore >= 2 ? "Bom" : selfScore <= -2 ? "Ruim" : "Na média";
  const icon = selfScore >= 2 ? "happy" as const : selfScore <= -2 ? "sad" as const : "average" as const;
  const badgeClass = selfScore >= 2 ? "bg-green-soft text-green" : selfScore <= -2 ? "bg-red-soft text-red" : "bg-orange-soft text-orange";
  const lines = [label, "", "Comparação com a própria unidade"];
  lines.push(...(selfLines.length ? selfLines : ["Sem histórico semanal comparável."]));
  lines.push("", "Comparação com a rede");
  lines.push(...(networkLines.length ? networkLines : ["Sem benchmark de rede."]));
  return { label, icon, badgeClass, tooltip: lines.join("\n") };
}

export default function UnidadesPage() {
  const { currentUser } = useCurrentUser();
  const canContinue =
    currentUser?.permission?.allowed_tabs.includes("assistente") ?? false;
  const [units, setUnits] = useState<MacroUnit[]>([]);
  const [analyses, setAnalyses] = useState<UnitMacroAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
  const [selectedWeekEnd, setSelectedWeekEnd] = useState("");

  const load = useCallback(async (signal?: AbortSignal, offset = 0) => {
    const params = new URLSearchParams({
      offset: String(offset),
      include_details: "true",
    });
    const response = await fetch(`/api/unidades/analises?${params}`, {
      cache: "no-store",
      signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw new Error(data.error ?? "Não foi possível carregar as unidades.");
    setUnits(data.units);
    setAnalyses((previous) =>
      offset ? [...previous, ...data.analyses] : data.analyses,
    );
    setNextOffset(data.next_offset);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);

  const hasPending = analyses.some(
    (a) => a.status === "pending" || a.status === "processing",
  );
  useEffect(() => {
    if (!hasPending) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void load(controller.signal).catch(() => undefined);
    }, 15_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [hasPending, load]);

  const weekOptions = useMemo(() => {
    const periods = new Map<string, string>();
    analyses
      .filter(
        (analysis) =>
          analysis.analysis_type === "weekly" && analysis.status === "completed",
      )
      .sort((a, b) => b.period_end.localeCompare(a.period_end))
      .forEach((analysis) => {
        if (!periods.has(analysis.period_end))
          periods.set(analysis.period_end, periodLabel(analysis));
      });
    return Array.from(periods, ([value, label]) => ({ value, label }));
  }, [analyses]);
  const selectedWeek = selectedWeekEnd || weekOptions[0]?.value || "";

  async function continueChat(analysis: UnitMacroAnalysis) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/unidades/continuar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis_id: analysis.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error ?? "Falha ao abrir o Assistente.");
      window.location.assign(data.href);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Falha ao abrir o Assistente.",
      );
      setBusy(false);
    }
  }

  function latestForUnit(unitId: string) {
    return analyses.find((analysis) => analysis.unit_id === unitId) ?? null;
  }

  function completedForUnit(unitId: string) {
    return (
      analyses.find(
        (analysis) =>
          analysis.unit_id === unitId && analysis.status === "completed",
      ) ?? null
    );
  }
  return (
    <main className="h-full overflow-y-auto bg-slate-50/50 p-4 text-slate-900 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Unidades</h1>
            <p className="mt-2 text-sm text-slate-500">
              Acompanhe as análises mensais de cada unidade em um só lugar.
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={14} />
                Semanal aos domingos
              </span>
            </div>
          </div>
          <DropdownSelect
            value={selectedWeek}
            onChange={(value) => {
              setSelectedWeekEnd(value);
              setSelectedAnalysisId(null);
            }}
            options={weekOptions}
            placeholder="Semana"
            icon={<CalendarDays size={16} />}
            disabled={loading || weekOptions.length === 0}
            widthClassName="w-full sm:w-[240px]"
          />
        </header>
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        {loading ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-[34rem] rounded-2xl" />
            ))}
          </div>
        ) : units.length === 0 ? (
          <Card>
            <div className="py-16 text-center text-sm text-slate-500">
              Nenhuma unidade disponível.
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {units.map((item) => {
              const latest = latestForUnit(item.id);
              const completed = completedForUnit(item.id);
              const selected = selectedAnalysisId
                ? analyses.find(
                    (analysis) =>
                      analysis.id === selectedAnalysisId &&
                      analysis.unit_id === item.id,
                  ) ?? null
                : null;
              const weekAnalysis = selectedWeek
                ? analyses.find(
                    (analysis) =>
                      analysis.unit_id === item.id &&
                      analysis.analysis_type === "weekly" &&
                      analysis.status === "completed" &&
                      analysis.period_end === selectedWeek,
                  ) ?? null
                : null;
              const focus =
                selected ??
                weekAnalysis ??
                (selectedWeek ? null : completed ?? latest);
              const unitAnalyses = analyses.filter(
                (analysis) => analysis.unit_id === item.id,
              );
              const stats = focus ? sidebarStats(focus, unitAnalyses) : [];
              const feeling = analysisFeeling(focus);
              const cards =
                focus?.cards?.filter((card) => card.type === "conversation") ??
                [];
              return (
                <Card key={item.id} className="overflow-hidden">
                  <div className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
                    <aside>
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-xl font-bold">{item.name}</h2>
                        <InfoTooltip
                          text={feeling.tooltip}
                          portal
                          widthClassName="w-[360px]"
                        >
                          <span
                            aria-label={feeling.label}
                            className={`inline-flex max-w-full cursor-help items-center gap-1.5 truncate whitespace-nowrap rounded-md px-2.5 py-1 ${feeling.badgeClass}`}
                          >
                            {feeling.icon === "happy" ? (
                              <Smile size={14} />
                            ) : feeling.icon === "sad" ? (
                              <Frown size={14} />
                            ) : (
                              <Meh size={14} />
                            )}
                            <span className="text-xs font-bold uppercase leading-none">
                              {feeling.label}
                            </span>
                            <Info size={11} className="ml-0.5 opacity-60" />
                          </span>
                        </InfoTooltip>
                      </div>
                      <UnitMap state={item.state} name={item.name} />
                      <p className="mt-2 text-sm text-slate-500">
                        {item.city} · {item.state}
                        {!item.active ? " · Inativa" : ""}
                      </p>
                      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs">
                        <p className="font-semibold text-slate-700">
                          {focus ? statusLabel[focus.status] : "Sem análise"}
                        </p>
                        {focus && (
                          <p className="mt-1 text-slate-500">
                            {analysisTypeLabel(focus)} · {periodLabel(focus)}
                          </p>
                        )}
                        {stats.length > 0 && (
                          <div className="mt-3 border-t border-slate-200 pt-3">
                            <div className="mb-3 flex items-center gap-1.5 font-semibold text-slate-600">
                              <span>Dados do período</span>
                              <InfoTooltip text="Comparação com a média semanal do último mês (até 4 semanas anteriores).">
                                <HelpCircle size={13} className="text-slate-400" />
                              </InfoTooltip>
                            </div>
                            <div className="space-y-3">
                              {stats.map((stat) => {
                                const trend = changeText(stat.change);
                                return (
                                  <div key={stat.key} className="min-w-0">
                                    <div className="truncate text-[10px] text-slate-500">
                                      {stat.label}
                                    </div>
                                    <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
                                      <span
                                        title={stat.value}
                                        className="truncate text-sm font-bold text-slate-800"
                                      >
                                        {stat.value}
                                      </span>
                                      {trend && (
                                        <span
                                          className={`shrink-0 text-[10px] font-semibold ${changeTextClass(stat.change)}`}
                                        >
                                          ({trend})
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                                      <div
                                        className={`h-full rounded-full transition-all ${changeBarClass(stat.change)}`}
                                        style={{ width: `${changeBarWidth(stat.change)}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                      {focus?.status === "completed" && canContinue && (
                        <button
                          className={`${button} mt-4 w-full`}
                          disabled={busy}
                          onClick={() => void continueChat(focus)}
                        >
                          {busy ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <Sparkles size={16} />
                          )}
                          Continuar no Assistente
                        </button>
                      )}
                    </aside>
                    <div className="min-w-0 space-y-6">
                      <section>
                        {latest && latest.status !== "completed" && !selected && (
                          <div className="mb-4 flex justify-end">
                            <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
                              {latest.status === "failed"
                                ? "A última análise falhou"
                                : latest.status === "processing"
                                  ? "A última análise está em andamento"
                                  : "A última análise está na fila"}
                            </span>
                          </div>
                        )}
                        {focus?.status === "completed" ? (
                          <AssistantMarkdown content={focus.report} />
                        ) : (
                          <p className="text-sm text-slate-500">
                            Nenhuma análise concluída para esta unidade ainda.
                          </p>
                        )}
                      </section>
                      {cards.length > 0 && (
                        <section className="space-y-4">
                          <h3 className="font-semibold">
                            Exemplos das conversas que não avançaram
                          </h3>
                          {cards.map((card) => (
                            <AssistantConversationCard
                              key={card.data.id}
                              conversation={card.data}
                              emptyStateText={card.data.preview ?? undefined}
                              onOpenClient={(clientId) =>
                                clientId
                                  ? openClientProfile(clientId)
                                  : openFloatingConversation({
                                      type: "conversation",
                                      id: card.data.id,
                                    })
                              }
                            />
                          ))}
                        </section>
                      )}
                      <section>
                        <h3 className="flex items-center gap-2 font-semibold">
                          <History size={16} />
                          Histórico de análises
                        </h3>
                        {unitAnalyses.length === 0 ? (
                          <p className="mt-3 text-sm text-slate-500">
                            Nenhuma análise disponível ainda.
                          </p>
                        ) : (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {unitAnalyses.map((analysis) => {
                              const active = focus?.id === analysis.id;
                              return (
                                <button
                                  type="button"
                                  key={analysis.id}
                                  onClick={() => setSelectedAnalysisId(analysis.id)}
                                  className={`cursor-pointer rounded-xl border p-3 text-left transition ${
                                    active
                                      ? "border-brand bg-brand/5"
                                      : "border-slate-200 hover:bg-slate-50"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-semibold">
                                      {analysisTypeLabel(analysis)}
                                    </span>
                                    <span className="text-xs font-medium text-slate-600">
                                      {statusLabel[analysis.status]}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {periodLabel(analysis)}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        {!loading && nextOffset !== null && (
          <button
            className={`${button} mx-auto`}
            onClick={() =>
              void load(undefined, nextOffset).catch((error) =>
                setError(
                  error instanceof Error
                    ? error.message
                    : "Não foi possível carregar mais análises.",
                ),
              )
            }
          >
            Carregar mais análises
          </button>
        )}
      </div>
    </main>
  );
}