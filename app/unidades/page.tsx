"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  History,
  LoaderCircle,
  MapPin,
  MessageSquarePlus,
  RefreshCw,
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
  UnitAnalysisType,
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

export default function UnidadesPage() {
  const { currentUser } = useCurrentUser();
  const canAnalyze =
    currentUser?.permission?.allowed_tabs.includes("assistente") ?? false;
  const [units, setUnits] = useState<MacroUnit[]>([]);
  const [analyses, setAnalyses] = useState<UnitMacroAnalysis[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [selected, setSelected] = useState<UnitMacroAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal, offset = 0) => {
      const params = new URLSearchParams({ offset: String(offset) });
      if (unitId) params.set("unit_id", unitId);
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
    },
    [unitId],
  );

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

  const openAnalysis = useCallback(async (id: string) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/unidades/analises?analysis_id=${id}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.analyses[0])
        throw new Error(data.error ?? "Análise não encontrada.");
      setSelected(data.analyses[0]);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error ? error.message : "Falha ao abrir a análise.",
        );
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }, []);

  useEffect(() => () => detailRequest.current?.abort(), []);
  useEffect(() => {
    if (
      selected &&
      selected.status !== "completed" &&
      analyses.find((item) => item.id === selected.id)?.status === "completed"
    )
      void openAnalysis(selected.id);
  }, [analyses, selected, openAnalysis]);

  function selectUnit(id: string | null) {
    detailRequest.current?.abort();
    setUnitId(id);
    setSelected(null);
    setDetailLoading(false);
    setLoading(true);
    setError(null);
    setNotice(null);
  }

  async function trigger(type: UnitAnalysisType, id?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/unidades/analises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, unit_id: unitId, analysis_id: id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error ?? "Falha ao iniciar a análise.");
      setNotice(
        "Análise solicitada. O progresso fica salvo e o histórico será atualizado.",
      );
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Falha ao iniciar a análise.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function continueChat() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/unidades/continuar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis_id: selected.id }),
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

  const unit = units.find((item) => item.id === unitId);
  return (
    <main className="h-full overflow-y-auto bg-slate-50/50 p-4 text-slate-900 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {unitId && (
              <button
                className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-slate-500 hover:text-slate-900"
                onClick={() => {
                  selectUnit(null);
                }}
              >
                <ArrowLeft size={16} />
                Todas as unidades
              </button>
            )}
            <h1 className="text-2xl font-bold tracking-tight">
              {unit?.name ?? "Unidades"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Conversas, agendamentos e resultados — com análise e histórico por
              unidade.
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={14} />
                Semanal aos domingos
              </span>
              <span>Mensal no dia 30 · fevereiro no último dia</span>
            </div>
          </div>
          {canAnalyze && (
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={busy}
                onClick={() => void trigger("weekly")}
              >
                <Sparkles size={16} />
                Análise semanal
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => void trigger("monthly")}
              >
                <CalendarDays size={16} />
                Análise mensal
              </button>
            </div>
          )}
        </header>
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600"
          >
            {notice}
          </div>
        )}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-72 rounded-2xl" />
            ))}
          </div>
        ) : !unitId ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {units.map((item) => {
              const latest = analyses.find(
                (analysis) => analysis.unit_id === item.id,
              );
              return (
                <button
                  key={item.id}
                  className="cursor-pointer text-left transition hover:-translate-y-0.5 focus-visible:rounded-2xl focus-visible:outline-2 focus-visible:outline-brand"
                  onClick={() => {
                    selectUnit(item.id);
                  }}
                >
                  <Card className="h-full">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-lg font-bold">{item.name}</h2>
                      <MapPin size={18} className="text-brand" />
                    </div>
                    <UnitMap state={item.state} name={item.name} />
                    <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs">
                      <span className="text-slate-500">
                        {item.city} · {item.state}
                        {!item.active ? " · Inativa" : ""}
                      </span>
                      <span className="font-semibold text-slate-700">
                        {latest ? statusLabel[latest.status] : "Sem análise"}
                      </span>
                    </div>
                    {latest && (
                      <p className="mt-2 text-xs text-slate-400">
                        {periodLabel(latest)}
                      </p>
                    )}
                  </Card>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <Card>
                {unit && <UnitMap state={unit.state} name={unit.name} />}
                <h2 className="mt-4 flex items-center gap-2 font-semibold">
                  <History size={16} />
                  Histórico de análises
                </h2>
                <div className="mt-4 space-y-2">
                  {analyses.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Nenhuma análise disponível ainda.
                    </p>
                  ) : (
                    analyses.map((analysis) => (
                      <div
                        key={analysis.id}
                        className={`rounded-xl border p-3 ${selected?.id === analysis.id ? "border-brand bg-slate-50" : "border-slate-200"}`}
                      >
                        <button
                          className="w-full cursor-pointer text-left"
                          onClick={() => void openAnalysis(analysis.id)}
                        >
                          <span className="text-sm font-semibold">
                            {analysis.analysis_type === "weekly"
                              ? "Semanal"
                              : "Mensal"}
                          </span>
                          <p className="mt-1 text-xs text-slate-500">
                            {periodLabel(analysis)}
                          </p>
                          <p className="mt-2 text-xs font-medium text-slate-600">
                            {statusLabel[analysis.status]}
                          </p>
                        </button>
                        {canAnalyze && analysis.status !== "completed" && (
                          <button
                            className="mt-3 flex cursor-pointer items-center gap-1 text-xs font-semibold text-brand disabled:opacity-50"
                            disabled={busy}
                            onClick={() =>
                              void trigger(analysis.analysis_type, analysis.id)
                            }
                          >
                            <RefreshCw size={12} />
                            {analysis.status === "failed"
                              ? "Tentar novamente"
                              : "Continuar processamento"}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {nextOffset !== null && (
                  <button
                    className={`${button} mt-4 w-full`}
                    onClick={() =>
                      void load(undefined, nextOffset).catch((error) =>
                        setError(error.message),
                      )
                    }
                  >
                    Carregar anteriores
                  </button>
                )}
              </Card>
            </aside>
            <section className="min-w-0 space-y-5">
              {detailLoading ? (
                <Skeleton className="h-96 rounded-2xl" />
              ) : selected ? (
                <>
                  <Card>
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold">
                          Análise{" "}
                          {selected.analysis_type === "weekly"
                            ? "semanal"
                            : "mensal"}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                          {periodLabel(selected)}
                        </p>
                      </div>
                      {selected.status === "completed" && canAnalyze && (
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() => void continueChat()}
                        >
                          {busy ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <MessageSquarePlus size={16} />
                          )}
                          Continuar conversa na IA
                        </button>
                      )}
                    </div>
                    {selected.status === "completed" ? (
                      <AssistantMarkdown content={selected.report} />
                    ) : (
                      <p className="text-sm text-slate-500">
                        {selected.status === "failed"
                          ? "A análise não foi concluída. Você pode tentar novamente mantendo o progresso salvo."
                          : "A análise está sendo preparada. O resultado aparecerá no histórico quando estiver concluído."}
                      </p>
                    )}
                  </Card>
                  {selected.cards?.some(
                    (card) => card.type === "conversation",
                  ) && (
                    <div className="space-y-4">
                      <h3 className="font-semibold">Exemplos das conversas</h3>
                      {selected.cards
                        .filter((card) => card.type === "conversation")
                        .map((card) => (
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
                    </div>
                  )}
                </>
              ) : (
                <Card>
                  <div className="py-16 text-center">
                    <Sparkles className="mx-auto mb-4 text-brand" size={28} />
                    <h2 className="font-semibold">Análises da unidade</h2>
                    <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                      Selecione uma análise no histórico para ver os resultados,
                      os padrões de atendimento e exemplos das conversas.
                    </p>
                  </div>
                </Card>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
