// app/saude/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Activity, AlertCircle, AlertTriangle, Check, CheckCircle2,
    ChevronDown, ChevronUp, Clock3, Database,
    ShieldAlert, Webhook,
} from "lucide-react";

import { Badge, DataTable, DropdownSelect, KpiCard, TableHeaderPreset, type DataTableColumn } from "@/components";
import type { HealthSnapshot, HealthService, HealthStatus, HealthCategory, HealthAttempt } from "@/lib/saude/monitor";
import type { HealthAlert } from "@/lib/saude/alerts";

type ResponseData = { snapshot: HealthSnapshot; alerts: HealthAlert[]; error?: string };

const labels: Record<HealthCategory, string> = {
    cron: "Cron jobs",
    webhook: "Webhooks",
    api: "APIs",
    database: "Supabase",
};

const statusBadges: Record<HealthStatus, { value: string; label: string }> = {
    healthy: { value: "resolvida", label: "Saudável" },
    warning: { value: "parcial", label: "Atenção" },
    failed: { value: "nao_resolvida", label: "Falha" },
    unknown: { value: "sem dados", label: "Sem dados" },
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
    const badge = statusBadges[status];
    return <Badge value={badge.value} label={badge.label} />;
}

export default function SaudePage() {
    const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
    const [alerts, setAlerts] = useState<HealthAlert[]>([]);
    const [loading, setLoading] = useState(true);
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
    const selectedService = filtered.find(item => item.id === expandedService) ?? null;
    const serviceColumns: DataTableColumn<HealthService>[] = [
        {
            id: "service", label: "Serviço", width: "36%",
            render: (item) => <div className="flex min-w-0 items-center gap-2">
                <ServiceIcon category={item.category} />
                <span className="min-w-0 truncate font-semibold text-slate-800" title={item.name}>{item.name}</span>
            </div>,
        },
        { id: "origin", label: "Origem", width: "16%", render: (item) => labels[item.category] },
        { id: "status", label: "Status", width: "15%", render: (item) => <StatusTag status={item.status} /> },
        { id: "last_seen", label: "Última atividade", width: "20%", render: (item) => <span className="whitespace-nowrap">{formatDate(item.last_seen)}</span> },
        { id: "failures", label: "Falhas", width: "8%", render: (item) => item.failures },
        { id: "details", label: "", width: "5%", render: (item) => item.id === expandedService ? <ChevronUp size={16} /> : <ChevronDown size={16} /> },
    ];
    const attemptColumns: DataTableColumn<HealthAttempt>[] = [
        { id: "time", label: "Horário", width: "20%", render: (item) => <span className="whitespace-nowrap">{formatDate(item.at)}</span> },
        { id: "service", label: "Serviço", width: "45%", render: (item) => <div className="min-w-0">
            <span className="block truncate font-medium text-slate-800">{item.service}</span>
            <span className="block truncate text-xs text-slate-400" title={item.path}>{item.path}</span>
        </div> },
        { id: "result", label: "Resultado", width: "15%", render: (item) => <StatusTag status={item.status === "failed" ? "failed" : "healthy"} /> },
        { id: "details", label: "Detalhes", width: "20%", render: (item) => item.detail },
    ];

    return <main className="h-full min-h-0 w-full overflow-y-auto bg-white text-slate-900">
        <section className="min-w-0 px-4 py-5 md:px-8 md:py-8">
            <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">Saúde</h1>
                    <p className="mt-2 text-sm text-slate-500">Acompanhe cron jobs, webhooks e integrações do Hub.</p>
                </div>
            </header>

            {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
            {loading && !snapshot ? <div className="space-y-4">
                {[1, 2, 3].map(id => <div key={id} className="h-24 animate-pulse rounded-2xl bg-slate-100" />)}
            </div> : <div className="space-y-6">
                <section aria-labelledby="saude-alertas">
                    <div className="mb-4 flex items-center gap-2">
                        <AlertTriangle size={19} className="text-red" />
                        <h2 id="saude-alertas" className="text-lg font-bold">Alertas</h2>
                        <Badge value={activeAlerts.length + pendingFailures.length ? "nao_resolvida" : "resolvida"} label={String(activeAlerts.length + pendingFailures.length)} />
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
                                Nenhum alerta ativo.
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

                <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiCard icon={<Activity size={26} />} label="Serviços monitorados" currentValue={services.length} color="blue" />
                    <KpiCard icon={<CheckCircle2 size={26} />} label="Saudáveis" currentValue={services.filter(item => item.status === "healthy").length} color="green" />
                    <KpiCard icon={<AlertCircle size={26} />} label="Falhas / atenção" currentValue={services.filter(item => item.status === "failed" || item.status === "warning").length} color="orange" />
                    <KpiCard icon={<Clock3 size={26} />} label="Sem dados" currentValue={services.filter(item => item.status === "unknown").length} color="purple" />
                </section>

                <section aria-label="Serviços monitorados">
                    <TableHeaderPreset
                        title="Conexões e serviços"
                        count={filtered.length}
                        searchValue={search}
                        onSearchChange={setSearch}
                        searchPlaceholder="Buscar serviço..."
                    >
                        <DropdownSelect
                            value={category}
                            onChange={(value) => setCategory(value as HealthCategory | "all")}
                            options={[{ label: "Todas as categorias", value: "all" }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]}
                            widthClassName="w-[220px]"
                        />
                        <DropdownSelect
                            value={filter}
                            onChange={(value) => setFilter(value as typeof filter)}
                            options={[
                                { label: "Todos os status", value: "all" },
                                { label: "Falhas e atenção", value: "failed" },
                                { label: "Sem dados", value: "unknown" },
                            ]}
                            widthClassName="w-[200px]"
                        />
                    </TableHeaderPreset>
                    <div className="mb-4 mt-4 flex flex-wrap items-center gap-2 px-4 sm:px-6">
                        <Badge value={snapshot?.sources.vercel.ok ? "resolvida" : "nao_resolvida"} label={snapshot?.sources.vercel.ok ? "Vercel conectado" : "Vercel indisponível"} />
                        <Badge value={snapshot?.sources.supabase.ok ? "resolvida" : "nao_resolvida"} label={snapshot?.sources.supabase.ok ? "Supabase conectado" : "Supabase indisponível"} />
                    </div>
                    <DataTable
                        columns={serviceColumns}
                        rows={filtered}
                        getRowKey={(item) => item.id}
                        onRowClick={(item) => setExpandedService(current => current === item.id ? null : item.id)}
                        emptyMessage="Nenhum serviço encontrado."
                        minWidth={800}
                    />
                    {selectedService && <div className="mt-4 border-t border-border px-4 pt-4 text-sm text-slate-600 sm:px-6">
                        <h3 className="mb-3 text-sm font-bold text-text">{selectedService.name}</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <p><strong>Rota:</strong> {selectedService.path}</p>
                            <p><strong>Agendamento:</strong> {selectedService.schedule || "—"}</p>
                            <p><strong>Último sucesso:</strong> {formatDate(selectedService.last_success)}</p>
                            <p><strong>Última falha:</strong> {formatDate(selectedService.last_failure)}</p>
                        </div>
                        <p className="mt-3">{selectedService.detail}</p>
                    </div>}
                </section>

                <section aria-label="Tentativas recentes">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
                        <h2 className="text-lg font-bold text-text">Tentativas recentes</h2>
                        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                            <input type="checkbox" checked={attemptsOnlyFailures} onChange={event => setAttemptsOnlyFailures(event.target.checked)} className="accent-red-500" />
                            Apenas falhas
                        </label>
                    </div>
                    <DataTable
                        columns={attemptColumns}
                        rows={attempts.slice(0, 80)}
                        getRowKey={(item) => item.id}
                        emptyMessage="Sem tentativas disponíveis."
                        minWidth={700}
                    />
                </section>
            </div>}
        </section>
    </main>;
}

function ServiceIcon({ category }: { category: HealthCategory }) {
    const Icon = category === "database" ? Database :
        category === "webhook" ? Webhook : category === "cron" ? Clock3 : ShieldAlert;
    return <Icon size={16} className="shrink-0 text-slate-400" />;
}
