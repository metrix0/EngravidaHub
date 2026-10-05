// components/scheduling/AgendaIntelligencePanel.tsx
"use client";

import { useEffect, useState } from "react";
import Skeleton from "@/components/ui/Skeleton";
import { applyCalendarDateParams, type CalendarPresetValue, type DateRange } from "@/components/ui/CalendarButton";
import DashboardWidget from "@/components/personal-dashboard/DashboardWidget";
import { AgendaIntelligenceWidget } from "@/components/scheduling/AgendaIntelligenceWidgets";
import { AGENDA_INTELLIGENCE_WIDGETS } from "@/lib/personal-dashboard/agendaIntelligenceWidgets";
import type { AgendaIntelligenceReport } from "@/lib/scheduling/agendaIntelligence";

export default function AgendaIntelligencePanel({ unitIds, doctorIds, period, selectedRange, ready, optionsError }: {
    unitIds: string[]; doctorIds: string[]; period: CalendarPresetValue | null; selectedRange: DateRange; ready: boolean; optionsError: string | null;
}) {
    const [report, setReport] = useState<AgendaIntelligenceReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const unitKey = unitIds.join(","), doctorKey = doctorIds.join(",");
    useEffect(() => {
        if (!ready) return;
        const controller = new AbortController();
        const params = new URLSearchParams();
        applyCalendarDateParams({ params, selectedPreset: period, selectedRange });
        unitKey.split(",").filter(Boolean).forEach(id => params.append("unit_ids", id));
        doctorKey.split(",").filter(Boolean).forEach(id => params.append("doctor_ids", id));
        setLoading(true);
        setReport(null);
        setError(null);
        async function load() {
            try {
                const response = await fetch(`/api/scheduling/intelligence?${params}`, { cache: "no-store", signal: controller.signal });
                const json = await response.json();
                if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar a inteligência de agenda.");
                if (!controller.signal.aborted) setReport(json.report);
            } catch (failure) {
                if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar a inteligência de agenda.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void load();
        return () => controller.abort();
    }, [ready, period, selectedRange, unitKey, doctorKey]);

    return <div className="space-y-5">
        {loading ? <div aria-label="Carregando inteligência de agenda" className="grid gap-4 md:grid-cols-2"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-64 rounded-2xl md:col-span-2" /></div> : null}
        {!loading && report ? <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {AGENDA_INTELLIGENCE_WIDGETS.filter(widget => widget.kind === "kpi").map(widget => <DashboardWidget key={widget.id} widgetId={widget.id}><AgendaIntelligenceWidget widgetId={widget.id} report={report} /></DashboardWidget>)}
            </div>
            {AGENDA_INTELLIGENCE_WIDGETS.filter(widget => widget.kind !== "kpi").map(widget => <DashboardWidget key={`${widget.id}:${report.generatedAt}`} widgetId={widget.id}><AgendaIntelligenceWidget widgetId={widget.id} report={report} doctorFiltered={doctorIds.length > 0} /></DashboardWidget>)}
            <AgendaIntelligenceWarnings report={report} />
        </> : null}
        {optionsError ? <div role="alert" className="rounded-xl bg-red-soft p-3 text-sm text-red">{optionsError}</div> : null}
        {error ? <div role="alert" className="rounded-xl border border-red/20 bg-red-soft p-4 text-sm text-red">{error}</div> : null}
    </div>;
}

function AgendaIntelligenceWarnings({ report }: { report: AgendaIntelligenceReport }) {
    const historyPartial = report.history.startedAt && Date.parse(report.history.startedAt) > Date.parse(report.resultsStart);
    const date = (value: string) => new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return <aside aria-label="Avisos sobre os dados" className="space-y-3 text-sm">
        {report.missingDoctors.length ? <p className="rounded-xl border border-orange/20 bg-orange-soft p-3 text-orange">{report.missingDoctors.length} médico(s) sem agenda sincronizada. A capacidade exibida é parcial.</p> : null}
        {report.coverage.signalsPending ? <p className="rounded-xl bg-slate-50 p-3 text-muted">{report.coverage.signalsProcessed} de {report.coverage.analyzedConversations} conversas com sinais processados · {report.coverage.signalsPending} pendentes.</p> : null}
        {!report.history.observedFrom ? <p className="rounded-xl bg-slate-50 p-3 text-muted">Sem histórico de alterações para o período selecionado.</p> : historyPartial ? <p className="rounded-xl bg-slate-50 p-3 text-muted">Histórico de remarcações e recuperação disponível desde {date(report.history.startedAt!)}. Os cancelamentos usam as datas das consultas no período selecionado.</p> : null}
    </aside>;
}
