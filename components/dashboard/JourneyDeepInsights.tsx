"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Skeleton } from "@/components";
import { getDropoffMomentLabel } from "@/lib/conversationAnalysisLabels";
import { useAssistantPageContext } from "@/lib/ai/assistantPageContext";

type Quantiles = { sample: number; p25: number | null; median: number | null; p75: number | null };
type Timeline = Quantiles & { metric: string };
type Touchpoints = {
    segment: string;
    sample: number;
    conversations: number | null;
    attendants: number | null;
    calls: number | null;
    followups: number | null;
};
type Recovery = { total: number; mature: number; returned: number; booked: number; median_days: number | null };
type Analytics = {
    scope: { clients: number };
    timelines: Timeline[];
    touchpoints: Touchpoints[];
    recovery: Recovery;
    recovery_moments: Array<{ moment: string; eligible: number; returned: number }>;
    sources: Array<{ origin: string; clients: number; bookings: number }>;
};
type Creative = {
    ad_id: string;
    name: string;
    campaign_name: string | null;
    thumbnail: string | null;
    contacts: number;
    linked_clients: number;
    consultations: number;
    attended_consultations: number;
    completed_procedures: number;
    authorized_revenue: number;
    spend: number | null;
    roas: number | null;
};
type CreativeData = {
    scope: {
        creatives: number;
        ad_contacts: number;
        verified_clients: number;
        spend_available: boolean;
    };
    creatives: Creative[];
};
type Response = { analytics: Analytics; creatives: CreativeData | null; creative_error: boolean };

const durationLabels: Record<string, string> = {
    consulta: "Contato → 1ª avaliação agendada",
    comparecimento: "Contato → 1ª avaliação comparecida",
    procedimento: "Contato → procedimento realizado",
    fatura: "Contato → 1ª fatura autorizada",
};
const formatter = new Intl.NumberFormat("pt-BR");
const currencyFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const formatCount = (value: number) => formatter.format(value);
const formatDuration = (value: number | null) =>
    value === null ? "—" : value.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " dias";
const percent = (numerator: number, denominator: number) =>
    denominator ? (100 * numerator / denominator).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "—";

export default function JourneyDeepInsights({ query }: { query: string }) {
    const [data, setData] = useState<Response | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sort, setSort] = useState<"authorized_revenue" | "contacts" | "linked_clients" | "completed_procedures" | "attended_consultations">("linked_clients");
    const [minimum, setMinimum] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        void (async () => {
            try {
                const response = await fetch("/api/dashboard/jornada/insights?" + query, {
                    cache: "no-store", signal: controller.signal,
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as análises.");
                if (!controller.signal.aborted) setData(payload as Response);
            } catch (cause) {
                if (!controller.signal.aborted) setError(
                    cause instanceof Error ? cause.message : "Falha ao carregar as análises.",
                );
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        })();
        return () => controller.abort();
    }, [query]);

    useAssistantPageContext("jornada-insights", () => data ? ({
        title: "Jornada — análises",
        sections: [
            { id: "jornada-tempos", title: "Tempo até a conversão", data: { timelines: data.analytics.timelines, sources: data.analytics.sources } },
            { id: "jornada-touchpoints", title: "Interações até o agendamento", data: data.analytics.touchpoints },
            { id: "jornada-recuperacao", title: "Abandono e recuperação", data: { recovery: data.analytics.recovery, moments: data.analytics.recovery_moments } },
            { id: "jornada-criativos", title: "Ranking de criativos", data: data.creatives },
        ],
    }) : null);

    const creatives = useMemo(() => {
        const rows = data?.creatives?.creatives ?? [];
        return rows.filter(creative => creative.contacts >= minimum)
            .sort((left, right) => right[sort] - left[sort] || right.linked_clients - left.linked_clients || right.contacts - left.contacts);
    }, [data, sort, minimum]);


    const maxTimelineDays = Math.max(1, ...(data?.analytics.timelines ?? []).map(item => item.p75 ?? 0));
    const hasClinicalOutcomes = (data?.creatives?.creatives ?? []).some(item =>
        item.consultations > 0 || item.attended_consultations > 0 ||
        item.completed_procedures > 0 || item.authorized_revenue > 0);

    return (
        <section className="mt-6 min-w-0 space-y-5">
            <div>
                <h2 className="text-xl font-bold text-slate-900">Análises da jornada</h2>
                <p className="mt-1 text-sm text-slate-500">
                    Clientes que chegaram no período selecionado. Os resultados clínicos são acompanhados até hoje.
                </p>
            </div>
            {loading ? (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2" aria-busy="true">
                    {[0, 1, 2, 3].map(item => (
                        <Card key={item}>
                            <Skeleton className="mb-4 h-5 w-52 rounded-lg" />
                            <Skeleton className="mb-2 h-12 w-full rounded-lg" />
                            <Skeleton className="h-20 w-full rounded-lg" />
                        </Card>
                    ))}
                </div>
            ) : error ? (
                <Card>
                    <p className="text-sm text-red" role="alert">{error}</p>
                </Card>
            ) : data ? (
                <>
                    <p className="text-xs text-slate-500">
                        {formatCount(data.analytics.scope.clients)} clientes únicos com WhatsApp na base · Tempo em dias de calendário
                    </p>
                    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
                        <div data-assistant-section="jornada-tempos" className="min-w-0">
                            <Card>
                                <h3 className="text-base font-bold text-slate-900">Tempo até a conversão</h3>
                                <p className="mt-1 text-xs text-slate-500">Mediana e faixa entre 25% e 75% dos clientes.</p>
                                <div className="mt-4 divide-y divide-slate-100">
                                    {data.analytics.timelines.map(item => {
                                        const low = Math.max(0, item.p25 ?? 0);
                                        const high = Math.max(low, item.p75 ?? low);
                                        const median = Math.max(0, item.median ?? 0);
                                        return (
                                            <div key={item.metric} className="py-3 first:pt-0 last:pb-0">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-slate-700">
                                                            {durationLabels[item.metric] ?? item.metric}
                                                        </p>
                                                        <p className="mt-1 text-xs text-slate-500">{formatCount(item.sample)} clientes</p>
                                                    </div>
                                                    <div className="shrink-0 text-right">
                                                        <p className="text-xl font-bold tabular-nums text-slate-950">{formatDuration(item.median)}</p>
                                                        <p className="mt-0.5 text-xs tabular-nums text-slate-400">P25 {formatDuration(item.p25)} · P75 {formatDuration(item.p75)}</p>
                                                    </div>
                                                </div>
                                                <div className="relative mt-2 h-1.5 rounded-full bg-slate-100" aria-hidden="true">
                                                    <div className="absolute h-full rounded-full bg-brand/30"
                                                        style={{ left: (low / maxTimelineDays * 100) + "%", width: (Math.min(high, maxTimelineDays) - Math.min(low, maxTimelineDays)) / maxTimelineDays * 100 + "%" }} />
                                                    {item.median !== null && (
                                                        <div className="absolute -top-0.5 h-2.5 w-1 rounded-full bg-brand"
                                                            style={{ left: Math.min(median / maxTimelineDays * 100, 99) + "%" }} />
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="mt-5 border-t border-slate-100 pt-4">
                                    <h4 className="text-sm font-semibold text-slate-900">Agendamentos por origem</h4>
                                    <p className="mt-1 text-xs text-slate-500">Clientes com agendamento / clientes da origem</p>
                                    <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
                                        {data.analytics.sources.map(source => (
                                            <div key={source.origin}>
                                                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                                                    <span className="min-w-0 truncate text-slate-600" title={source.origin}>{source.origin}</span>
                                                    <span className="shrink-0 font-semibold tabular-nums text-slate-800">
                                                        {formatCount(source.bookings)} / {formatCount(source.clients)} · {percent(source.bookings, source.clients)}
                                                    </span>
                                                </div>
                                                <div className="h-1 rounded-full bg-slate-100">
                                                    <div className="h-full rounded-full bg-brand/70"
                                                        style={{ width: Math.min(100, source.clients ? source.bookings / source.clients * 100 : 0) + "%" }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </Card>
                        </div>

                        <div data-assistant-section="jornada-touchpoints" className="min-w-0">
                            <Card>
                                <h3 className="text-base font-bold text-slate-900">Interações até o agendamento</h3>
                                <p className="mt-1 text-xs text-slate-500">
                                    Medianas por cliente. Sem agendamento, consideramos até 30 dias após o contato.
                                </p>
                                <div className="mt-4 space-y-3">
                                    {data.analytics.touchpoints.map(item => (
                                        <div key={item.segment} className="rounded-xl border border-slate-100 p-4">
                                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                                <h4 className="text-sm font-semibold text-slate-900">
                                                    {item.segment === "agendaram" ? "Agendaram" : "Sem agendamento em 30 dias"}
                                                </h4>
                                                <span className="text-xs font-medium tabular-nums text-slate-500">{formatCount(item.sample)} clientes</span>
                                            </div>
                                            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                                                {([
                                                    ["Conversas", item.conversations],
                                                    ["Atendentes", item.attendants],
                                                    ["Ligações", item.calls],
                                                    ["Retornos", item.followups],
                                                ] as const).map(([label, value]) => (
                                                    <div key={label}>
                                                        <p className="text-xs text-slate-500">{label}</p>
                                                        <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value ?? "—"}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <p className="mt-3 text-xs text-slate-500">
                                    Retornos = conversas com acompanhamento detectado pela IA. Atendentes = pessoas distintas.
                                </p>
                            </Card>
                        </div>

                        <div data-assistant-section="jornada-recuperacao" className="min-w-0">
                            <Card>
                                <h3 className="text-base font-bold text-slate-900">Abandono e recuperação</h3>
                                <p className="mt-1 text-xs text-slate-500">Retorno entre 1 e 30 dias após o abandono, apenas com janela completa.</p>
                                <div className="mt-4 grid grid-cols-2 gap-4 border-b border-slate-100 pb-4 sm:grid-cols-4">
                                    {([
                                        ["Abandonos", formatCount(data.analytics.recovery.total)],
                                        ["Retornaram", formatCount(data.analytics.recovery.returned)],
                                        ["Taxa de retorno", percent(data.analytics.recovery.returned, data.analytics.recovery.mature)],
                                        ["Tempo até voltar", formatDuration(data.analytics.recovery.median_days)],
                                    ] as const).map(([label, value]) => (
                                        <div key={label}>
                                            <p className="text-xs text-slate-500">{label}</p>
                                            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</p>
                                        </div>
                                    ))}
                                </div>
                                <p className="mt-3 text-xs text-slate-500">
                                    {formatCount(data.analytics.recovery.mature)} com janela completa · {formatCount(data.analytics.recovery.booked)} agendaram após retornar
                                </p>
                                {data.analytics.recovery_moments.some(item => item.eligible > 0) && (
                                    <div className="mt-5">
                                        <h4 className="mb-3 text-sm font-semibold text-slate-900">Retorno por ponto de abandono</h4>
                                        <div className="space-y-3">
                                            {data.analytics.recovery_moments.filter(item => item.eligible > 0).map(item => (
                                                <div key={item.moment}>
                                                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                                                        <span className="min-w-0 truncate text-slate-600" title={getDropoffMomentLabel(item.moment)}>
                                                            {getDropoffMomentLabel(item.moment)}
                                                        </span>
                                                        <span className="shrink-0 font-semibold tabular-nums text-slate-800">
                                                            {formatCount(item.returned)} / {formatCount(item.eligible)} · {percent(item.returned, item.eligible)}
                                                        </span>
                                                    </div>
                                                    <div className="h-1 rounded-full bg-slate-100">
                                                        <div className="h-full rounded-full bg-brand/70"
                                                            style={{ width: Math.min(100, item.returned / item.eligible * 100) + "%" }} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </Card>
                        </div>

                        <div data-assistant-section="jornada-criativos" className="min-w-0">
                            <Card>
                                <h3 className="text-base font-bold text-slate-900">Criativos Meta</h3>
                                <p className="mt-1 text-xs text-slate-500">
                                    Contatos atribuídos aos anúncios do Instagram e Facebook no período.
                                </p>
                                {data.creative_error ? (
                                    <p className="mt-4 text-sm text-red">Não foi possível carregar os criativos.</p>
                                ) : data.creatives ? (
                                    <>
                                        <div className="mt-5 grid grid-cols-2 gap-5 border-b border-slate-100 pb-5 sm:grid-cols-3">
                                            <div>
                                                <p className="text-xs text-slate-500">Contatos de anúncios</p>
                                                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{formatCount(data.creatives.scope.ad_contacts)}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-slate-500">Criativos</p>
                                                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{formatCount(data.creatives.scope.creatives)}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-slate-500">Clientes vinculados</p>
                                                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{formatCount(data.creatives.scope.verified_clients)}</p>
                                            </div>
                                        </div>
                                        <div className="mt-4">
                                            <h4 className="text-sm font-semibold text-slate-900">Mais contatos</h4>
                                            <div className="mt-3 space-y-3">
                                                {[...data.creatives.creatives].sort((a, b) => b.contacts - a.contacts).slice(0, 5).map(item => (
                                                    <div key={item.ad_id} className="flex items-center justify-between gap-3 text-xs">
                                                        <span className="min-w-0 truncate text-slate-600" title={item.name}>{item.name}</span>
                                                        <span className="shrink-0 font-semibold tabular-nums text-slate-900">{formatCount(item.contacts)} contatos</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
                                            Resultados clínicos exigem vínculo individual entre anúncio, cliente e CliniSys.
                                            {data.creatives.scope.verified_clients === 0
                                                ? " Nenhum vínculo comprovado neste período."
                                                : " Vínculo não significa que houve agendamento ou procedimento."}
                                        </p>
                                    </>
                                ) : (
                                    <p className="mt-4 text-sm text-slate-500">Sem dados de criativos disponíveis.</p>
                                )}
                            </Card>
                        </div>
                    </div>

                    {data.creatives && !data.creative_error && (
                        <Card>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h3 className="text-base font-bold text-slate-900">Ranking de criativos</h3>
                                    <p className="mt-1 text-xs text-slate-500">
                                        Vínculos ao CRM comprovados, sem atribuir receita ou consultas a contatos não identificados.
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="text-xs text-slate-500">
                                        <span className="sr-only">Ordenar criativos</span>
                                        <select className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700"
                                            value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
                                            <option value="linked_clients">Clientes vinculados</option>
                                            <option value="contacts">Contatos</option>
                                            {hasClinicalOutcomes && <option value="authorized_revenue">Receita autorizada</option>}
                                            {hasClinicalOutcomes && <option value="completed_procedures">Procedimentos</option>}
                                            {hasClinicalOutcomes && <option value="attended_consultations">Comparecimentos</option>}
                                        </select>
                                    </label>
                                    <label className="text-xs text-slate-500">
                                        <span className="sr-only">Filtrar pelo mínimo de contatos</span>
                                        <select className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700"
                                            value={minimum} onChange={event => setMinimum(Number(event.target.value))}>
                                            <option value={0}>Todos os contatos</option>
                                            <option value={10}>10+ contatos</option>
                                            <option value={30}>30+ contatos</option>
                                            <option value={100}>100+ contatos</option>
                                        </select>
                                    </label>
                                </div>
                            </div>
                            {!hasClinicalOutcomes && (
                                <p className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                                    Não há consultas, procedimentos ou faturamento vinculados a estes criativos no CRM.
                                    Essas colunas ficam ocultas até existirem dados comprovados. O investimento individual também não está disponível.
                                </p>
                            )}
                            {creatives.length ? (
                                <div className="mt-4 overflow-x-auto">
                                    <table className="w-full min-w-[480px] text-left text-xs">
                                        <thead className="border-b border-slate-200 text-slate-500">
                                            <tr>
                                                <th className="py-3 pr-3">Criativo</th>
                                                <th className="px-2 py-3 text-right">Contatos</th>
                                                <th className="px-2 py-3 text-right">Vinculados</th>
                                                <th className="px-2 py-3 text-right">Taxa de vínculo</th>
                                                {hasClinicalOutcomes && <th className="px-2 py-3 text-right">Consultas</th>}
                                                {hasClinicalOutcomes && <th className="px-2 py-3 text-right">Compareceram</th>}
                                                {hasClinicalOutcomes && <th className="px-2 py-3 text-right">Procedimentos</th>}
                                                {hasClinicalOutcomes && <th className="py-3 pl-2 text-right">Receita</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {creatives.map(item => (
                                                <tr key={item.ad_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                                                    <td className="max-w-[320px] py-3 pr-3">
                                                        <div className="truncate font-semibold text-slate-800" title={item.name}>{item.name}</div>
                                                        {item.campaign_name && <div className="mt-0.5 truncate text-slate-500" title={item.campaign_name}>{item.campaign_name}</div>}
                                                        <div className="mt-0.5 truncate text-slate-400" title={item.ad_id}>ID {item.ad_id}</div>
                                                    </td>
                                                    <td className="px-2 py-3 text-right font-semibold tabular-nums text-slate-800">{formatCount(item.contacts)}</td>
                                                    <td className="px-2 py-3 text-right tabular-nums text-slate-700">{formatCount(item.linked_clients)}</td>
                                                    <td className="px-2 py-3 text-right tabular-nums text-slate-700">{percent(item.linked_clients, item.contacts)}</td>
                                                    {hasClinicalOutcomes && <td className="px-2 py-3 text-right tabular-nums">{item.linked_clients ? formatCount(item.consultations) : "—"}</td>}
                                                    {hasClinicalOutcomes && <td className="px-2 py-3 text-right tabular-nums">{item.linked_clients ? formatCount(item.attended_consultations) : "—"}</td>}
                                                    {hasClinicalOutcomes && <td className="px-2 py-3 text-right tabular-nums">{item.linked_clients ? formatCount(item.completed_procedures) : "—"}</td>}
                                                    {hasClinicalOutcomes && <td className="py-3 pl-2 text-right font-semibold tabular-nums">{item.linked_clients ? currencyFormatter.format(item.authorized_revenue) : "—"}</td>}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="py-8 text-center text-sm text-slate-500">Nenhum criativo atende ao filtro.</p>
                            )}
                        </Card>
                    )}
                </>
            ) : null}
        </section>
    );

}
