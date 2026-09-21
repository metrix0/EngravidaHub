"use client";

import { Check, ChevronDown, Clock3, HelpCircle, Info } from "lucide-react";
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
import { DataTable, HoverBadgeList, InfoTooltip, Pagination, type DataTableColumn } from "@/components";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
import type { ActiveMessageSendHistory } from "@/types/activeMessages";

export type HistoryItem = {
    id: string;
    template_id: string;
    template_name: string;
    sent_count: number;
    response_count: number;
    schedule_count: number;
    created_at: string;
    automation: string | null;
};

type Props = { widgetId: string; data: { history: HistoryItem[] } };

export default function ExactMensagemAtivaDashboardGraphs({ widgetId, data }: Props) {
    if (widgetId === "mensagem_ativa.templates_utilizados") {
        return <TemplatesUsedCard history={data.history} />;
    }
    if (widgetId === "mensagem_ativa.volume_resultados") {
        return <VolumeResultsCard history={data.history} />;
    }
    if (widgetId === "mensagem_ativa.fluxo_resgate_leads") {
        return <ResgateLeadsCard history={data.history} />;
    }
    if (widgetId === "mensagem_ativa.historico_envios") {
        return <HistoryTable history={data.history} />;
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

export function TemplatesUsedCard({ history, loading = false, title = "Templates utilizados Mensagem Ativa" }: { history: HistoryItem[]; loading?: boolean; title?: string }) {
    const templateData = useMemo(() => buildTemplateData(history), [history]);
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-bold text-slate-950">{title}</h3>
            {loading ? <Skeleton className="mt-5 h-[280px] rounded-xl" /> : templateData.length > 0 ? (
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

export function ResgateLeadsCard({ history, loading = false }: { history: HistoryItem[]; loading?: boolean }) {
    const resgateHistory = useMemo(
        () => history.filter((item) => item.automation === "resgate"),
        [history],
    );

    return (
        <TemplatesUsedCard
            history={resgateHistory}
            loading={loading}
            title="Fluxo de Resgate de Leads"
        />
    );
}

export function VolumeResultsCard({ history, loading = false }: { history: HistoryItem[]; loading?: boolean }) {
    const templateData = useMemo(() => buildTemplateData(history), [history]);
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
                <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-950">Volume e resultados de Envios Ativos</h3>
                    <InfoTooltip text="Mostra, por dia, quantos Envios Ativos foram enviados e quantos geraram respostas e agendamentos, com filtro por template.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
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
            {loading ? <Skeleton className="mt-5 h-[280px] rounded-xl" /> : dailyData.length > 0 ? (
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

const HISTORY_PER_PAGE = 10;

export function HistoryTable({ history }: { history: ActiveMessageSendHistory[] | HistoryItem[] }) {
    const [currentPage, setCurrentPage] = useState(1);
    const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE));
    const visiblePage = Math.min(currentPage, totalPages);
    const pageHistory = useMemo(() => history.slice((visiblePage - 1) * HISTORY_PER_PAGE, visiblePage * HISTORY_PER_PAGE), [history, visiblePage]);
    const pageStart = history.length === 0 ? 0 : (visiblePage - 1) * HISTORY_PER_PAGE + 1;
    const pageEnd = Math.min(visiblePage * HISTORY_PER_PAGE, history.length);
    const isFullHistory = history.length === 0 || "recipients" in history[0];

    if (!isFullHistory) {
        const rows = pageHistory as HistoryItem[];
        return (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-soft text-blue"><Clock3 size={19} /></div><div><h2 className="font-bold text-slate-950">Histórico de envios</h2><p className="mt-1 text-sm text-slate-500">Últimos disparos realizados pela equipe.</p></div></div>
                <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead><tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500"><th className="px-4 py-3">Enviado em</th><th className="px-4 py-3">Template</th><th className="px-4 py-3 text-right">Enviados</th><th className="px-4 py-3 text-right">Respostas</th><th className="px-4 py-3 text-right">Agendamentos</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((item) => <tr key={item.id}><td className="px-4 py-3 text-sm text-slate-600">{formatDateTime(item.created_at)}</td><td className="px-4 py-3 text-sm font-medium text-slate-700">{item.template_name}</td><td className="px-4 py-3 text-right text-sm text-slate-600">{item.sent_count}</td><td className="px-4 py-3 text-right text-sm text-slate-600">{item.response_count}</td><td className="px-4 py-3 text-right text-sm text-slate-600">{item.schedule_count}</td></tr>)}</tbody></table></div>
                {history.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 px-6 py-5"><div className="text-sm text-slate-500">{`Mostrando ${pageStart}–${pageEnd} de ${history.length}`}</div>{totalPages > 1 ? <Pagination totalPages={totalPages} currentPage={visiblePage} onPageChange={setCurrentPage} /> : null}</div> : null}
            </section>
        );
    }

    const fullRows = pageHistory as ActiveMessageSendHistory[];
    const columns: DataTableColumn<ActiveMessageSendHistory>[] = [
        { id: "created_at", label: "Enviado em", width: "11%", render: (item) => formatDateTime(item.created_at) },
        { id: "template", label: "Template", width: "16%", render: (item) => <div className="min-w-0" title={`${item.template_name}\n${item.template_id}`}><div className="truncate font-medium text-slate-700">{item.template_name}</div><div className="mt-1 truncate text-xs text-slate-400">{item.template_id}</div></div> },
        { id: "recipients", label: "Clientes/Conversas", width: "31%", render: (item) => <HoverBadgeList items={[...item.recipients].sort((a,b) => Number(b.responded)-Number(a.responded)).map((recipient) => { const canOpen=recipient.responded && recipient.response_target_type!==null && recipient.response_target_id!==null; const statusDescription=recipient.responded ? "Respondeu ao disparo — clique para abrir a conversa" : recipient.status==="failed" ? "Falha no envio" : "Sem resposta nas 24 horas após o disparo"; return { key: recipient.client_id, label: recipient.client_name, title: `${recipient.client_name} — ${statusDescription}`, ariaLabel: `${recipient.client_name}. ${statusDescription}`, className: recipient.responded ? "bg-soft-green text-green" : recipient.status==="failed" ? "bg-red-soft text-red" : "bg-slate-100 text-slate-600", onClick: canOpen ? () => openFloatingConversation({ type: recipient.response_target_type!, id: recipient.response_target_id! }) : undefined }; })} badgeClassName="rounded-full px-2.5 py-1 text-[11px] font-bold" maxBadgeWidthClassName="max-w-[145px]" expandedBadgeClassName="max-w-[260px]" popupMaxWidthClassName="max-w-[680px]" overflowIndicatorThreshold={30} previewCount={0} /> },
        { id: "routing", label: "Roteamento", width: "11%", render: (item) => <div className="text-xs text-slate-600"><div>{item.normal_message_count} normais</div><div className="mt-1">{item.template_message_count} templates</div></div> },
        { id: "result", label: "Resultado", width: "10%", render: (item) => <div className="text-xs text-slate-600"><div>{item.sent_count} enviados</div><div className="mt-1">{item.failed_count} falhas</div></div> },
        { id: "metrics", label: <span className="inline-flex items-center gap-1.5">Métricas<span title="Respostas: clientes que enviaram ao menos uma mensagem nas 24 horas após o disparo. Agendamentos: registros do Clinisys criados para clientes que receberam o envio, desde a data do disparo até 30 dias depois." aria-label="Explicação das métricas" className="inline-flex shrink-0 cursor-help text-slate-400"><Info size={14} /></span></span>, width: "13%", render: (item) => <div className="text-xs text-slate-600"><div>{item.response_count} respostas {item.response_count/item.sent_count > 0 ? `(${((item.response_count/item.sent_count)*100).toFixed(1)}%)` : ""}</div><div className="mt-1">{item.schedule_count} agendamentos {item.schedule_count/item.sent_count > 0 ? `(${((item.schedule_count/item.sent_count)*100).toFixed(1)}%)` : ""}</div></div> },
        { id: "status", label: "Status", width: "8%", render: (item) => <HistoryStatus status={item.status} /> },
    ];
    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-soft text-blue"><Clock3 size={19} /></div><div><h2 className="font-bold text-slate-950">Histórico de envios</h2><p className="mt-1 text-sm text-slate-500">Últimos disparos realizados pela equipe.</p></div></div>
            <DataTable columns={columns} rows={fullRows} getRowKey={(item) => item.id} emptyMessage="Nenhuma mensagem ativa foi enviada ainda." />
            {history.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 px-6 py-5"><div className="text-sm text-slate-500">{`Mostrando ${pageStart}–${pageEnd} de ${history.length}`}</div>{totalPages > 1 ? <Pagination totalPages={totalPages} currentPage={visiblePage} onPageChange={setCurrentPage} /> : null}</div> : null}
        </section>
    );
}
function HistoryStatus({ status }: { status: ActiveMessageSendHistory["status"] }) {
    const styles = { processing: "bg-blue-soft text-blue", completed: "bg-green-soft text-green", partial: "bg-orange-soft text-orange", failed: "bg-red-soft text-red" }[status];
    const label = { processing: "Enviando", completed: "Concluído", partial: "Parcial", failed: "Falhou" }[status];
    return <span className={`inline-flex rounded-xl px-2.5 py-1 text-xs font-bold ${styles}`}>{label}</span>;
}
function formatDateTime(value: string | null) {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}
