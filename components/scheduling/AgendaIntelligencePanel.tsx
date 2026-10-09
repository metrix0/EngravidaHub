// components/scheduling/AgendaIntelligencePanel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import AgendaIntelligenceSkeleton from "@/components/scheduling/AgendaIntelligenceSkeleton";
import { applyCalendarDateParams, type CalendarPresetValue, type DateRange } from "@/components/ui/CalendarButton";
import DashboardWidget from "@/components/personal-dashboard/DashboardWidget";
import { AgendaIntelligenceWidget } from "@/components/scheduling/AgendaIntelligenceWidgets";
import { AGENDA_INTELLIGENCE_WIDGETS } from "@/lib/personal-dashboard/agendaIntelligenceWidgets";
import type { AgendaIntelligenceReport } from "@/lib/scheduling/agendaIntelligence";

export default function AgendaIntelligencePanel({ unitIds, doctorIds, period, selectedRange, ready, optionsError }: {
    unitIds: string[]; doctorIds: string[]; period: CalendarPresetValue | null; selectedRange: DateRange; ready: boolean; optionsError: string | null;
}) {
    const [result, setResult] = useState<{ query: string | null; report: AgendaIntelligenceReport | null; error: string | null }>({ query: null, report: null, error: null });
    const unitKey = [...unitIds].sort().join(","), doctorKey = [...doctorIds].sort().join(",");
    const { start, end } = selectedRange;
    const query = useMemo(() => {
        const params = new URLSearchParams();
        applyCalendarDateParams({ params, selectedPreset: period, selectedRange: { start, end } });
        unitKey.split(",").filter(Boolean).forEach(id => params.append("unit_ids", id));
        doctorKey.split(",").filter(Boolean).forEach(id => params.append("doctor_ids", id));
        return params.toString();
    }, [period, start, end, unitKey, doctorKey]);
    const loading = !ready || result.query !== query;
    const report = result.report;
    const error = loading ? null : result.error;
    useEffect(() => {
        if (!ready) return;
        const controller = new AbortController();
        async function load() {
            try {
                const response = await fetch(`/api/scheduling/intelligence?${query}`, { cache: "no-store", signal: controller.signal });
                const json = await response.json();
                if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar a inteligência de agenda.");
                if (!controller.signal.aborted) setResult({ query, report: json.report, error: null });
            } catch (failure) {
                if (!controller.signal.aborted) {
                    setResult({ query, report: null, error: failure instanceof Error ? failure.message : "Não foi possível carregar a inteligência de agenda." });
                }
            }
        }
        void load();
        return () => controller.abort();
    }, [ready, query]);

    return <div className="relative space-y-5" aria-busy={loading}>
        {loading && !report ? <AgendaIntelligenceSkeleton /> : null}
        {loading && report ? <div role="status" className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-muted shadow-sm"><LoaderCircle size={14} className="animate-spin" />Atualizando...</div> : null}
        {report ? <div className={`space-y-5 transition-opacity ${loading ? "pointer-events-none opacity-50" : ""}`} inert={loading}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {AGENDA_INTELLIGENCE_WIDGETS.filter(widget => widget.kind === "kpi").map(widget => <DashboardWidget key={widget.id} widgetId={widget.id}><AgendaIntelligenceWidget widgetId={widget.id} report={report} /></DashboardWidget>)}
            </div>
            {AGENDA_INTELLIGENCE_WIDGETS.filter(widget => widget.kind !== "kpi").map(widget => {
                const content = <DashboardWidget key={`${widget.id}:${report.generatedAt}`} widgetId={widget.id}><AgendaIntelligenceWidget widgetId={widget.id} report={report} doctorFiltered={doctorIds.length > 0} /></DashboardWidget>;
                return widget.id === "inteligencia_agenda.demanda_horaria"
                    ? <div key={widget.id} className="xl:w-[calc(50%-0.625rem)]">{content}</div>
                    : content;
            })}
        </div> : null}
        {optionsError ? <div role="alert" className="rounded-xl bg-red-soft p-3 text-sm text-red">{optionsError}</div> : null}
        {error ? <div role="alert" className="rounded-xl border border-red/20 bg-red-soft p-4 text-sm text-red">{error}</div> : null}
    </div>;
}
