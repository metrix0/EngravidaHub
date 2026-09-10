"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  History,
  LoaderCircle,
  MapPin,
  MessageSquarePlus,
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
function coverageLabel(analysis: UnitMacroAnalysis) {
  const coverage = analysis.metrics?.coverage;
  if (!coverage || typeof coverage !== "object") return null;
  const values = coverage as {
    conversations?: number;
    messages?: number;
  };
  if (
    typeof values.conversations !== "number" ||
    typeof values.messages !== "number"
  )
    return null;
  return `${values.conversations.toLocaleString("pt-BR")} conversas · ${values.messages.toLocaleString("pt-BR")} mensagens`;
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
              Conversas, agendamentos e resultados — todas as unidades na mesma
              página.
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={14} />
                Semanal aos domingos
              </span>
              <span>Mensal no dia 30 · fevereiro no último dia</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600">
            <Sparkles size={16} className="text-brand" />
            Análises automáticas
          </span>
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
              const focus = completed ?? latest;
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
                          {latest ? statusLabel[latest.status] : "Sem análise"}
                        </p>
                        {latest && (
                          <p className="mt-1 text-slate-500">
                            {analysisTypeLabel(latest)} · {periodLabel(latest)}
                          </p>
                        )}
                        {focus && coverageLabel(focus) && (
                          <p className="mt-2 text-slate-500">
                            {coverageLabel(focus)}
                          </p>
                        )}
                      </div>
                      {completed && canContinue && (
                        <button
                          className={`${button} mt-4 w-full`}
                          disabled={busy}
                          onClick={() => void continueChat(completed)}
                        >
                          {busy ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <MessageSquarePlus size={16} />
                          )}
                          Continuar conversa na IA
                        </button>
                      )}
                    </aside>
                    <div className="min-w-0 space-y-6">
                      <section>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-lg font-bold">
                              {focus
                                ? `Análise ${analysisTypeLabel(focus).toLowerCase()}`
                                : "Análise"}
                            </h3>
                            {focus && (
                              <p className="mt-1 text-sm text-slate-500">
                                {periodLabel(focus)}
                              </p>
                            )}
                          </div>
                          {latest && latest.status !== "completed" && (
                            <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
                              {latest.status === "failed"
                                ? "A última análise falhou"
                                : "A última análise está em andamento"}
                            </span>
                          )}
                        </div>
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
                            {unitAnalyses.map((analysis) => (
                              <div
                                key={analysis.id}
                                className="rounded-xl border border-slate-200 p-3"
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
                              </div>
                            ))}
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
                setError(error.message),
              )
            }
          >
            Carregar análises anteriores
          </button>
        )}
      </div>
    </main>
  );
}
