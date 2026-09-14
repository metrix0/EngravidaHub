"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  History,
  LoaderCircle,
  MapPin,
  Sparkles,
} from "lucide-react";
import { Card, Skeleton } from "@/components";
import AssistantMarkdown from "@/components/assistant/AssistantMarkdown";
import AssistantConversationCard from "@/components/assistant/AssistantConversationCard";
import { useCurrentUser } from "@/components/auth/CurrentUserProvider";
import { openClientProfile } from "@/components/clientes/PermanentClientProfilePanel";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
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
type SidebarStat = { label: string; value: string };
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
function countValue(value: unknown) {
  const number = finiteNumber(value);
  return number === null ? null : number.toLocaleString("pt-BR");
}
function currencyValue(value: unknown) {
  const number = finiteNumber(value);
  return number === null
    ? null
    : number.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      });
}
function sidebarStats(analysis: UnitMacroAnalysis): SidebarStat[] {
  const schedule = asRecord(analysis.metrics.get_schedule_overview);
  const scheduleTotals = asRecord(schedule.totals);
  const conversations = asRecord(
    analysis.metrics.get_conversation_analysis_overview,
  );
  const conversationCoverage = asRecord(conversations.coverage);
  const financial = asRecord(analysis.metrics.get_financial_overview);
  const financialTotals = asRecord(financial.totals);
  const deterministic = asRecord(analysis.metrics.deterministic_stats);
  const values: Array<[string, string | null]> = [
    ["Marcações", countValue(deterministic.markings)],
    ["Agendamentos", countValue(scheduleTotals.total)],
    ["Conversas", countValue(conversationCoverage.total_conversations)],
    ["A realizar", countValue(scheduleTotals.pending)],
    ["Compareceu", countValue(scheduleTotals.showed_up)],
    ["Atendidos", countValue(scheduleTotals.attended)],
    ["Remarcou", countValue(scheduleTotals.rescheduled)],
    ["Cancelou", countValue(scheduleTotals.cancelled)],
    ["Faltou", countValue(scheduleTotals.no_show)],
    ["Faturamento", currencyValue(financialTotals.authorized_revenue)],
    ["Notas", countValue(financialTotals.authorized_invoices)],
  ];
  return values.flatMap(([label, value]) =>
    value === null ? [] : [{ label, value }],
  );
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
              const focus = selected ?? completed ?? latest;
              const stats = focus ? sidebarStats(focus) : [];
              const unitAnalyses = analyses.filter(
                (analysis) => analysis.unit_id === item.id,
              );
              const cards =
                focus?.cards?.filter((card) => card.type === "conversation") ??
                [];
              return (
                <Card key={item.id} className="overflow-hidden">
                  <div className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
                    <aside>
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-xl font-bold">{item.name}</h2>
                        <MapPin size={18} className="text-brand" />
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
                            <p className="mb-2 font-semibold text-slate-600">
                              Dados do período
                            </p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                              {stats.map((stat) => (
                                <div key={stat.label} className="min-w-0">
                                  <div className="truncate text-[10px] text-slate-500">
                                    {stat.label}
                                  </div>
                                  <div
                                    title={stat.value}
                                    className="mt-0.5 truncate text-sm font-bold text-slate-800"
                                  >
                                    {stat.value}
                                  </div>
                                </div>
                              ))}
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
