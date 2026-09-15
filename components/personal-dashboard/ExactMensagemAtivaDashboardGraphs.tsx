"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import Skeleton from "@/components/ui/Skeleton";

type HistoryItem = {
    id: string;
    template_id: string;
    template_name: string;
    sent_count: number;
    response_count: number;
    schedule_count: number;
    created_at: string;
};

type Props = { widgetId: string; data: { history: HistoryItem[] } };

export default function ExactMensagemAtivaDashboardGraphs({ widgetId, data }: Props) {
    const templateData = useMemo(() => buildTemplateData(data.history), [data.history]);
    if (widgetId === "mensagem_ativa.templates_utilizados") {
        return <TemplatesUsedCard templateData={templateData} />;
    }
    if (widgetId === "mensagem_ativa.volume_resultados") {
        return <VolumeResultsCard history={data.history} templateData={templateData} />;
    }
    return null;
}

function buildTemplateData(history: HistoryItem[]) {
    const totals = new Map<string, { key: string; name: string; sent: number; responses: number; schedules: number }>();
    for (const send of history) {
        const key = send.template_id || send.template_name;
        const current = totals.get(key) ?? { key, name: send.template_name, sent: 0, responses: 0, schedules: 0 };
        current.sent += send.sent_count;
        current.responses += send.response_count;
        current.schedules += send.schedule_count;
        totals.set(key, current);
    }
    return [...totals.values()].sort((first, second) => second.sent - first.sent);
}

type TemplateData = ReturnType<typeof buildTemplateData>;

function TemplatesUsedCard({ templateData }: { templateData: TemplateData }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-bold text-slate-950">Templates utilizados</h3>
            {templateData.length > 0 ? (
                <div style={{ height: Math.max(280, templateData.length * 54) }} className="mt-5 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={templateData} layout="vertical" margin={{ top: 0, right: 18, bottom: 0, left: 8 }}>
                            <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" horizontal={false} />
                            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                            <YAxis type="category" dataKey="name" width={138} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                            <Tooltip formatter={(value) => [Number(value).toLocaleString("pt-BR"), "Envios"]} />
                            <Bar dataKey="sent" name="Envios" fill="#06b6d4" radius={[0, 6, 6, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            ) : <ActiveMessageChartEmpty />}
        </section>
    );
}

function VolumeResultsCard({ history, templateData }: { history: HistoryItem[]; templateData: TemplateData }) {
    const [selectedTemplateKeys, setSelectedTemplateKeys] = useState<Set<string> | null>(null);
    const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
    const templateMenuRef = useRef<HTMLDivElement | null>(null);
    const visibleTemplateKeys = useMemo(() => {
        const availableKeys = new Set(templateData.map((item) => item.key));
        if (selectedTemplateKeys === null) return availableKeys;
        return new Set([...selectedTemplateKeys].filter((key) => availableKeys.has(key)));
    }, [selectedTemplateKeys, templateData]);
    const dailyData = useMemo(() => {
        const totals = new Map<string, { date: string; sent: number; responses: number; schedules: number }>();
        for (const send of history) {
            const templateKey = send.template_id || send.template_name;
            if (!visibleTemplateKeys.has(templateKey)) continue;
            const timestamp = new Date(send.created_at);
            if (!Number.isFinite(timestamp.getTime())) continue;
            const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
            const current = totals.get(date) ?? { date, sent: 0, responses: 0, schedules: 0 };
            current.sent += send.sent_count;
            current.responses += send.response_count;
            current.schedules += send.schedule_count;
            totals.set(date, current);
        }
        return [...totals.values()].sort((first, second) => first.date.localeCompare(second.date)).map((item) => ({ ...item, label: formatChartDate(item.date) }));
    }, [history, visibleTemplateKeys]);
    const chartTotals = useMemo(() => dailyData.reduce((totals, item) => ({ sent: totals.sent + item.sent, responses: totals.responses + item.responses, schedules: totals.schedules + item.schedules }), { sent: 0, responses: 0, schedules: 0 }), [dailyData]);

    useEffect(() => {
        if (!templateMenuOpen) return;
        function closeOnOutsideClick(event: MouseEvent) {
            if (templateMenuRef.current && !templateMenuRef.current.contains(event.target as Node)) setTemplateMenuOpen(false);
        }
        document.addEventListener("mousedown", closeOnOutsideClick);
        return () => document.removeEventListener("mousedown", closeOnOutsideClick);
    }, [templateMenuOpen]);

    const allTemplatesSelected = templateData.length > 0 && visibleTemplateKeys.size === templateData.length;
    const templateSelectionLabel = allTemplatesSelected ? "Todos os templates" : `${visibleTemplateKeys.size} de ${templateData.length}`;
    function toggleTemplate(templateKey: string) {
        setSelectedTemplateKeys((current) => {
            const next = new Set(current ?? templateData.map((item) => item.key));
            if (next.has(templateKey)) next.delete(templateKey); else next.add(templateKey);
            return next.size === templateData.length ? null : next;
        });
    }
    function toggleAllTemplates() { setSelectedTemplateKeys(allTemplatesSelected ? new Set() : null); }

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="font-bold text-slate-950">Volume e resultados</h3>
                {templateData.length > 0 ? (
                    <div ref={templateMenuRef} className="relative">
                        <button type="button" onClick={() => setTemplateMenuOpen((open) => !open)} className="flex min-w-[172px] cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-cyan-300 hover:text-slate-800" aria-haspopup="listbox" aria-expanded={templateMenuOpen}>
                            <span className="truncate">{templateSelectionLabel}</span>
                            <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${templateMenuOpen ? "rotate-180" : ""}`} />
                        </button>
                        {templateMenuOpen ? (
                            <div className="absolute right-0 z-50 mt-2 w-[280px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.16)]" role="listbox" aria-label="Templates exibidos no gráfico" aria-multiselectable="true">
                                <button type="button" onClick={toggleAllTemplates} className={`flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${allTemplatesSelected ? "bg-cyan-50 font-semibold text-cyan-700" : "text-slate-600 hover:bg-slate-50"}`} role="option" aria-selected={allTemplatesSelected}><span>Todos os templates</span>{allTemplatesSelected ? <Check size={15} /> : null}</button>
                                <div className="my-1 border-t border-slate-100" />
                                <div className="max-h-[286px] overflow-y-auto pr-1">
                                    {templateData.map((template) => {
                                        const selected = visibleTemplateKeys.has(template.key);
                                        return <button key={template.key} type="button" title={template.name} onClick={() => toggleTemplate(template.key)} className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${selected ? "bg-cyan-50 font-semibold text-cyan-700" : "text-slate-600 hover:bg-slate-50"}`} role="option" aria-selected={selected}><span className="truncate" title={template.name}>{shortTemplateSelectorLabel(template.name)}</span>{selected ? <Check size={15} className="shrink-0" /> : null}</button>;
                                    })}
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
            {templateData.length > 0 ? <div className="mt-5 grid grid-cols-3 gap-3"><ActiveMessageTotal label="Enviados" value={chartTotals.sent} color="#06b6d4" /><ActiveMessageTotal label="Respostas" value={chartTotals.responses} color="#10b981" /><ActiveMessageTotal label="Agendamentos" value={chartTotals.schedules} color="#8b5cf6" /></div> : null}
            {dailyData.length > 0 ? (
                <div className="mt-5 h-[320px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={dailyData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" minTickGap={18} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" width={42} />
                            <Tooltip />
                            <Bar dataKey="sent" name="Envios" fill="#06b6d4" radius={[5, 5, 0, 0]} />
                            <Line type="monotone" dataKey="responses" name="Respostas" stroke="#10b981" strokeWidth={3} />
                            <Line type="monotone" dataKey="schedules" name="Agendamentos" stroke="#8b5cf6" strokeWidth={3} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            ) : templateData.length > 0 ? <div className="mt-5 flex h-[280px] items-center justify-center rounded-xl bg-slate-50 px-6 text-center text-sm text-slate-500">Selecione ao menos um template.</div> : <ActiveMessageChartEmpty />}
        </section>
    );
}

function ActiveMessageTotal({ label, value, color }: { label: string; value: number; color: string }) { return <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"><div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />{label}</div><div className="mt-1 text-xl font-bold text-slate-900">{value.toLocaleString("pt-BR")}</div></div>; }
function ActiveMessageChartEmpty() { return <div className="mt-5 flex h-[280px] items-center justify-center rounded-xl bg-slate-50 px-6 text-center text-sm text-slate-500">Os gráficos serão preenchidos após os primeiros envios.</div>; }
function shortTemplateSelectorLabel(name: string) { const [, ...suffixParts] = name.split("—"); const suffix = suffixParts.join("—").trim(); return suffix || name.trim(); }
function formatChartDate(date: string) { const [, month, day] = date.split("-"); return month && day ? `${day}/${month}` : date; }
