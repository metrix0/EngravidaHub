// app/saude/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
    Activity, AlertCircle, AlertTriangle, Check, CheckCircle2,
    ChevronDown, ChevronUp, Clock3, Database, HeartPulse,
    RefreshCw, Search, ShieldAlert, Webhook,
} from "lucide-react";

import { Card } from "@/components";
import type { HealthSnapshot, HealthService, HealthStatus, HealthCategory } from "@/lib/saude/monitor";
import type { HealthAlert } from "@/lib/saude/alerts";

type ResponseData = { snapshot: HealthSnapshot; alerts: HealthAlert[]; error?: string };

const labels: Record<HealthCategory, string> = {
    cron: "Cron jobs",
    webhook: "Webhooks",
    api: "APIs",
    database: "Supabase",
};

const statuses: Record<HealthStatus, { label: string; color: string; background: string }> = {
    healthy: { label: "Saudável", color: "text-green", background: "bg-green-soft" },
    warning: { label: "Atenção", color: "text-orange", background: "bg-orange-soft" },
    failed: { label: "Falha", color: "text-red", background: "bg-red-soft" },
    unknown: { label: "Sem dados", color: "text-slate-500", background: "bg-slate-100" },
};

function formatDate(value: string | null) {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(date);
}

function StatusTag({ status }: { status: HealthStatus }) {
    const item = statuses[status];
    return <span className={"inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold " +
        item.background + " " + item.color}>{item.label}</span>;
}

function SummaryTile({ title, value, icon }: { title: string; value: number; icon: ReactNode }) {
    return <Card className="min-w-0">
        <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">{icon}</div>
            <div><p className="text-xs font-medium text-slate-500">{title}</p>
                <p className="text-3xl font-bold tracking-tight text-slate-900">{value}</p></div>
        </div>
    </Card>;
}

export default function SaudePage() {
    const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
    const [alerts, setAlerts] = useState<HealthAlert[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState<HealthCategory | "all">("all");
    const [filter, setFilter] = useState<"all" | "failed" | "unknown">("all");
    const [attemptsOnlyFailures, setAttemptsOnlyFailures] = useState(false);
    const [expandedService, setExpandedService] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [acknowledging, setAcknowledging] = useState<string | null>(null);

    const refresh = useCallback(async (initial = false) => {
        if (initial) setLoading(true);
        else setRefreshing(true);
        try {
            const response = await fetch("/api/saude", { cache: "no-store" });
            const result = await response.json() as ResponseData;
            if (!response.ok) throw new Error(result.error || "Não foi possível carregar o monitor");
            setSnapshot(result.snapshot);
            setAlerts(result.alerts);
            setError(null);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Falha na consulta de saúde");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void refresh(true);
        const interval = window.setInterval(() => {
            if (document.visibilityState === "visible") void refresh();
        }, 60_000);
        return () => window.clearInterval(interval);
    }, [refresh]);

    async function acknowledge(id: string) {
        setAcknowledging(id);
        try {
            const response = await fetch("/api/saude", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            if (!response.ok) throw new Error("Não foi possível reconhecer o alerta");
            await refresh();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Falha ao reconhecer alerta");
        } finally {
            setAcknowledging(null);
        }
    }

    const services = snapshot?.services ?? [];
    const activeAlerts = alerts.filter(item => item.status === "active");
    const otherAlerts = alerts.filter(item => item.status !== "active");
    const pendingFailures = services.filter(item => item.status === "failed" &&
        !activeAlerts.some(alert => alert.alert_key === "health:" + item.id));
    const filtered = useMemo(() => services.filter(item => {
        if (category !== "all" && item.category !== category) return false;
        if (filter === "failed" && item.status !== "failed" && item.status !== "warning") return false;
        if (filter === "unknown" && item.status !== "unknown") return false;
        const term = search.trim().toLowerCase();
        return !term || (item.name + " " + item.path + " " + item.detail).toLowerCase().includes(term);
    }), [services, category, filter, search]);
    const attempts = (snapshot?.attempts ?? []).filter(item => !attemptsOnlyFailures || item.status === "failed");

    return <main className="sidepanel-scrollbar-hidden h-full min-h-0 w-full overflow-x-hidden overflow-y-auto bg-white text-slate-900">
        <div className="mx-auto w-full max-w-[1500px] px-4 py-5 md:px-8 md:py-8">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <HeartPulse className="text-red" size={26} />
                        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Saúde</h1>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">Monitor de integrações, cron jobs, webhooks e falhas do Hub.</p>
                    {snapshot && <p className="mt-1 text-xs text-slate-400">Última consulta: {formatDate(snapshot.checked_at)}</p>}
                </div>
                <button type="button" onClick={() => void refresh()} disabled={refreshing || loading}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /> Atualizar
                </button>
            </div>

            {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
            {loading && !snapshot ? <div className="space-y-4">
                {[1, 2, 3].map(id => <div key={id} className="h-24 animate-pulse rounded-2xl bg-slate-100" />)}
            </div> : <div className="space-y-6">
                <section aria-labelledby="saude-alertas">
                    <div className="mb-3 flex items-center gap-2">
                        <AlertTriangle size={19} className="text-red" />
                        <h2 id="saude-alertas" className="text-lg font-bold">Alertas</h2>
                        <span className="rounded-md bg-red-soft px-2 py-0.5 text-xs font-bold text-red">{activeAlerts.length + pendingFailures.length}</span>
                    </div>
                    {snapshot && (!snapshot.sources.vercel.ok || !snapshot.sources.supabase.ok) &&
                        <div role="alert" className="mb-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
                            <strong>Monitoramento incompleto.</strong>{" "}
                            {!snapshot.sources.vercel.ok ? snapshot.sources.vercel.detail : snapshot.sources.supabase.detail}
                        </div>}
                    {activeAlerts.length === 0 && pendingFailures.length === 0 ?
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 size={18} className="text-green" />
                                Nenhum alerta ativo registrado.
                            </div>
                        </div> :
                        <div className="space-y-3">
                            {activeAlerts.map(alert => <div key={alert.id}
                                className={"flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4 " +
                                    (alert.severity === "critical" ? "border-red-200 bg-red-50" : "border-orange-200 bg-orange-50")}>
                                <div className="min-w-0">
                                    <p className="font-semibold text-slate-900">{alert.title}</p>
                                    <p className="mt-1 text-sm text-slate-600">{alert.details}</p>
                                    <p className="mt-2 text-xs text-slate-500">Detectado: {formatDate(alert.last_seen_at)} · {alert.occurrences} ocorrência(s)</p>
                                </div>
                                <button disabled={acknowledging === alert.id} onClick={() => void acknowledge(alert.id)}
                                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                    <Check size={14} /> Reconhecer
                                </button>
                            </div>)}
                            {pendingFailures.map(item => <div key={item.id} className="rounded-xl border border-red-200 bg-red-50 p-4">
                                <p className="font-semibold text-slate-900">{item.name}</p>
                                <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
                                <p className="mt-2 text-xs text-slate-500">Detectado na consulta atual; aguardando registro pelo watchdog.</p>
                            </div>)}
                        </div>}
                    {otherAlerts.length > 0 && <div className="mt-3">
                        <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
                            {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Histórico de alertas ({otherAlerts.length})
                        </button>
                        {showHistory && <div className="mt-2 space-y-2">
                            {otherAlerts.map(item => <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600">
                                <span className="font-semibold text-slate-800">{item.title}</span> · {item.status === "resolved" ? "Recuperado" : "Reconhecido"} · {formatDate(item.last_seen_at)}
                            </div>)}
                        </div>}
                    </div>}
                </section>

                <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <SummaryTile title="Serviços monitorados" value={services.length} icon={<Activity size={22} />} />
                    <SummaryTile title="Saudáveis" value={services.filter(item => item.status === "healthy").length} icon={<CheckCircle2 size={22} />} />
                    <SummaryTile title="Falhas / atenção" value={services.filter(item => item.status === "failed" || item.status === "warning").length} icon={<AlertCircle size={22} />} />
                    <SummaryTile title="Sem dados" value={services.filter(item => item.status === "unknown").length} icon={<Clock3 size={22} />} />
                </section>

                <section aria-label="Serviços monitorados">
                    <Card>
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">Conexões e serviços</h2>
                                <p className="mt-1 text-xs text-slate-500">Dados do Vercel e histórico nativo de pg_cron. Sem cópias de execuções no banco.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <span className={"rounded-md px-2 py-1 text-xs font-semibold " + (snapshot?.sources.vercel.ok ? "bg-green-soft text-green" : "bg-orange-soft text-orange")}>
                                    Vercel {snapshot?.sources.vercel.ok ? "conectado" : "indisponível"}
                                </span>
                                <span className={"rounded-md px-2 py-1 text-xs font-semibold " + (snapshot?.sources.supabase.ok ? "bg-green-soft text-green" : "bg-orange-soft text-orange")}>
                                    Supabase {snapshot?.sources.supabase.ok ? "conectado" : "indisponível"}
                                </span>
                            </div>
                        </div>
                        <div className="mb-4 flex flex-wrap items-center gap-2">
                            <label className="flex h-10 min-w-40 flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 text-slate-500 md:max-w-xs">
                                <Search size={16} />
                                <input value={search} onChange={event => setSearch(event.target.value)}
                                    aria-label="Buscar serviços" placeholder="Buscar serviço..." className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400" />
                            </label>
                            <select aria-label="Categoria de serviço" value={category} onChange={event => setCategory(event.target.value as HealthCategory | "all")}
                                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
                                <option value="all">Todas as categorias</option>
                                {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                            <select aria-label="Status do serviço" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}
                                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
                                <option value="all">Todos os status</option>
                                <option value="failed">Falhas e atenção</option>
                                <option value="unknown">Sem dados</option>
                            </select>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                                    <th className="px-3 py-3 font-semibold">Serviço</th>
                                    <th className="px-3 py-3 font-semibold">Origem</th>
                                    <th className="px-3 py-3 font-semibold">Status</th>
                                    <th className="px-3 py-3 font-semibold">Última atividade</th>
                                    <th className="px-3 py-3 font-semibold">Falhas</th>
                                    <th className="w-9" />
                                </tr></thead>
                                <tbody>
                                    {filtered.map(service => <FragmentService key={service.id} service={service}
                                        expanded={expandedService === service.id}
                                        toggle={() => setExpandedService(current => current === service.id ? null : service.id)} />)}
                                </tbody>
                            </table>
                            {filtered.length === 0 && <p className="py-10 text-center text-sm text-slate-500">Nenhum serviço encontrado.</p>}
                        </div>
                    </Card>
                </section>

                <section aria-label="Tentativas recentes">
                    <Card>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div><h2 className="text-lg font-bold">Tentativas recentes</h2>
                                <p className="mt-1 text-xs text-slate-500">Requisições registradas no Vercel (janela recente; histórico sujeito à retenção da plataforma).</p>
                            </div>
                            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                                <input type="checkbox" checked={attemptsOnlyFailures} onChange={event => setAttemptsOnlyFailures(event.target.checked)} className="accent-red-500" />
                                Apenas falhas
                            </label>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                                    <th className="px-3 py-3">Horário</th><th className="px-3 py-3">Serviço</th>
                                    <th className="px-3 py-3">Resultado</th><th className="px-3 py-3">Detalhes</th>
                                </tr></thead>
                                <tbody>{attempts.slice(0, 80).map(item => <tr key={item.id} className="border-t border-slate-100">
                                    <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDate(item.at)}</td>
                                    <td className="px-3 py-3"><span className="font-medium text-slate-800">{item.service}</span>
                                        <span className="block max-w-sm truncate text-xs text-slate-400">{item.path}</span></td>
                                    <td className="px-3 py-3"><StatusTag status={item.status === "failed" ? "failed" : "healthy"} /></td>
                                    <td className="px-3 py-3 text-slate-500">{item.detail}</td>
                                </tr>)}</tbody>
                            </table>
                            {attempts.length === 0 && <p className="py-10 text-center text-sm text-slate-500">Nenhuma tentativa disponível nessa consulta.</p>}
                        </div>
                    </Card>
                </section>
            </div>}
        </div>
    </main>;
}

function FragmentService({ service, expanded, toggle }: { service: HealthService; expanded: boolean; toggle: () => void }) {
    const Icon = service.category === "database" ? Database :
        service.category === "webhook" ? Webhook : service.category === "cron" ? Clock3 : ShieldAlert;
    return <>
        <tr className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-3 py-3"><button type="button" onClick={toggle} aria-expanded={expanded} className="flex items-center gap-2 text-left">
                <Icon size={16} className="shrink-0 text-slate-400" />
                <span className="min-w-0 font-semibold text-slate-800">{service.name}</span>
            </button></td>
            <td className="px-3 py-3 text-slate-500">{labels[service.category]}</td>
            <td className="px-3 py-3"><StatusTag status={service.status} /></td>
            <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDate(service.last_seen)}</td>
            <td className="px-3 py-3 text-slate-500">{service.failures}</td>
            <td className="px-3 py-3">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
        </tr>
        {expanded && <tr className="border-t border-slate-100 bg-slate-50"><td colSpan={6} className="px-4 py-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
                <p><strong>Rota:</strong> {service.path}</p>
                <p><strong>Agendamento:</strong> {service.schedule || "—"}</p>
                <p><strong>Último sucesso:</strong> {formatDate(service.last_success)}</p>
                <p><strong>Última falha:</strong> {formatDate(service.last_failure)}</p>
            </div>
            <p className="mt-3 text-slate-600">{service.detail}</p>
        </td></tr>}
    </>;
}
