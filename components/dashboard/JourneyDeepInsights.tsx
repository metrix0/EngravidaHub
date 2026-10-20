"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, MessageCircle, RotateCcw, Megaphone, AlertCircle } from "lucide-react";
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

function MetricTitle({ icon: Icon, children }: { icon: typeof Clock3; children: string }) {
    return (
        <div className="mb-4 flex items-center gap-2">
            <Icon size={18} className="text-slate-500" />
            <h3 className="text-lg font-bold text-slate-900">{children}</h3>
        </div>
    );
}

export default function JourneyDeepInsights({ query }: { query: string }) {
    const [data, setData] = useState<Response | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sort, setSort] = useState<"authorized_revenue" | "contacts" | "completed_procedures" | "attended_consultations">("authorized_revenue");
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
            .sort((left, right) => right[sort] - left[sort] || right.contacts - left.contacts);
    }, [data, sort, minimum]);

    return (
        <section data-assistant-section="jornada-tempos" className="mt-6 min-w-0 space-y-5">
            <div>
                <h2 className="text-xl font-bold text-slate-900">Análises da jornada</h2>
                <p className="mt-1 text-sm text-slate-500">
                    Caminhos de clientes que entraram no período selecionado. Resultados clínicos posteriores são acompanhados até hoje.
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
                        Base: {formatCount(data.analytics.scope.clients)} clientes únicos com WhatsApp no período. Dias clínicos são datas de calendário, não horários inferidos.
                    </p>
                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                        <Card>
                            <MetricTitle icon={Clock3}>Tempo até a conversão</MetricTitle>
                            <p className="mb-4 text-xs text-slate-500">Medianas e intervalo P25–P75, somente eventos vinculados com data válida.</p>
                            <div className="divide-y divide-slate-100">
                                {data.analytics.timelines.map(timeline => (
                                    <div key={timeline.metric} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                        <div>
                                            <p className="text-sm font-medium text-slate-700">{durationLabels[timeline.metric] ?? timeline.metric}</p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                {formatCount(timeline.sample)} clientes · P25 {formatDuration(timeline.p25)} / P75 {formatDuration(timeline.p75)}
                                            </p>
                                        </div>
                                        <span className="text-lg font-bold tabular-nums text-slate-900">{formatDuration(timeline.median)}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 border-t border-slate-100 pt-4">
                                <h4 className="mb-2 text-sm font-semibold text-slate-700">Agendamentos por origem registrada</h4>
                                <div className="space-y-2">
                                    {data.analytics.sources.map(source => (
                                        <div key={source.origin} className="flex items-center justify-between gap-3 text-xs">
                                            <span className="min-w-0 truncate text-slate-600" title={source.origin}>{source.origin}</span>
                                            <span className="shrink-0 font-semibold tabular-nums text-slate-700">
                                                {formatCount(source.bookings)} / {formatCount(source.clients)} · {percent(source.bookings, source.clients)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </Card>

                        <Card>
                            <MetricTitle icon={MessageCircle}>Interações até o agendamento</MetricTitle>
                            <p className="mb-4 text-xs text-slate-500">
                                Mediana de interações desde a entrada no período até o primeiro agendamento; sem agendamento, janela de 30 dias.
                            </p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead className="border-b border-slate-200 text-slate-500">
                                        <tr>
                                            <th className="py-3 pr-2">Grupo</th>
                                            <th className="p-2 text-right">Conversas</th>
                                            <th className="p-2 text-right">Atendentes</th>
                                            <th className="p-2 text-right">Ligações</th>
                                            <th className="py-3 pl-2 text-right">Retornos*</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.analytics.touchpoints.map(item => (
                                            <tr key={item.segment} className="border-b border-slate-100 last:border-0">
                                                <td className="py-3 pr-2">
                                                    <span className="font-semibold text-slate-800">
                                                        {item.segment === "agendaram" ? "Agendaram" : "Sem agendamento em 30 dias"}
                                                    </span>
                                                    <span className="block text-slate-400">{formatCount(item.sample)} clientes</span>
                                                </td>
                                                {[item.conversations, item.attendants, item.calls, item.followups].map((value, index) => (
                                                    <td key={index} className="p-2 text-right tabular-nums text-slate-700">{value ?? "—"}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="mt-3 text-xs text-slate-500">
                                *Conversas com acompanhamento identificado pela IA. Atendentes são pessoas distintas registradas, não atribuição de crédito.
                                Clientes recentes sem agendamento aguardam 30 dias antes de entrar na comparação.
                            </p>
                        </Card>

                        <Card>
                            <MetricTitle icon={RotateCcw}>Abandono e recuperação</MetricTitle>
                            <p className="mb-4 text-xs text-slate-500">
                                Após abandono identificado pela IA: nova conversa entre 1 e 30 dias depois. Só clientes com janela completa entram nas taxas.
                            </p>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                {[
                                    ["Abandonos", formatCount(data.analytics.recovery.total)],
                                    ["Retornaram", formatCount(data.analytics.recovery.returned)],
                                    ["Taxa de retorno", percent(data.analytics.recovery.returned, data.analytics.recovery.mature)],
                                    ["Mediana até voltar", formatDuration(data.analytics.recovery.median_days)],
                                ].map(([label, value]) => (
                                    <div key={label} className="rounded-xl bg-slate-50 px-3 py-4">
                                        <p className="text-xs text-slate-500">{label}</p>
                                        <p className="mt-2 text-xl font-bold tabular-nums text-slate-800">{value}</p>
                                    </div>
                                ))}
                            </div>
                            <p className="mt-3 text-xs text-slate-500">
                                {formatCount(data.analytics.recovery.mature)} abandonos com 30 dias completos ·{" "}
                                {formatCount(data.analytics.recovery.booked)} agendaram depois de retornar.
                            </p>
                            {data.analytics.recovery_moments.some(item => item.eligible > 0) && (
                                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                                    <h4 className="mb-2 text-sm font-semibold text-slate-700">Retorno por ponto de abandono</h4>
                                    {data.analytics.recovery_moments.filter(item => item.eligible > 0).map(item => (
                                        <div key={item.moment} className="flex items-center justify-between gap-3 text-xs">
                                            <span className="min-w-0 truncate text-slate-600" title={getDropoffMomentLabel(item.moment)}>
                                                {getDropoffMomentLabel(item.moment)}
                                            </span>
                                            <span className="shrink-0 font-semibold tabular-nums text-slate-700">
                                                {formatCount(item.returned)} / {formatCount(item.eligible)} · {percent(item.returned, item.eligible)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>

                        <Card>
                            <MetricTitle icon={Megaphone}>Criativos com resultados clínicos</MetricTitle>
                            <div className="mb-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-600">
                                <AlertCircle size={16} className="mt-0.5 shrink-0 text-slate-500" />
                                <span>
                                    Meta (Instagram/Facebook). Somente vínculos comprovados ao CRM geram resultados clínicos ou receita.
                                    Sem custo por anúncio, ROAS não está disponível. A atribuição usa o primeiro criativo vinculado por cliente.
                                </span>
                            </div>
                            {data.creative_error ? (
                                <p className="text-sm text-red">Não foi possível carregar os criativos.</p>
                            ) : data.creatives ? (
                                <>
                                    <div className="mb-3 space-y-1 text-xs text-slate-500">
                                        <p>{formatCount(data.creatives.scope.creatives)} criativos · {formatCount(data.creatives.scope.ad_contacts)} contatos por anúncio</p>
                                        <p>
                                            <strong className="text-slate-700">{formatCount(data.creatives.scope.verified_clients)} clientes</strong> vinculados ao CRM nesta amostra.
                                            Contatos sem vínculo não recebem valores presumidos.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <label className="flex items-center gap-2 text-xs text-slate-500">
                                            Ordenar
                                            <select className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-slate-700" value={sort}
                                                onChange={event => setSort(event.target.value as typeof sort)}>
                                                <option value="authorized_revenue">Receita autorizada</option>
                                                <option value="completed_procedures">Procedimentos</option>
                                                <option value="attended_consultations">Comparecimentos</option>
                                                <option value="contacts">Contatos</option>
                                            </select>
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-slate-500">
                                            Mínimo
                                            <select className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-slate-700" value={minimum}
                                                onChange={event => setMinimum(Number(event.target.value))}>
                                                <option value={0}>Todos</option>
                                                <option value={10}>10 contatos</option>
                                                <option value={30}>30 contatos</option>
                                                <option value={100}>100 contatos</option>
                                            </select>
                                        </label>
                                    </div>
                                </>
                            ) : null}
                        </Card>
                    </div>

                    {data.creatives && !data.creative_error && (
                        <Card>
                            <h3 className="mb-1 text-lg font-bold text-slate-900">Ranking de criativos</h3>
                            <p className="mb-4 text-xs text-slate-500">
                                Contatos do criativo não são consultas. Valores clínicos são exibidos apenas quando o cliente está vinculado ao anúncio e ao CliniSys.
                                Receita = faturas autorizadas, não pagamento confirmado.
                            </p>
                            {creatives.length ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[940px] text-left text-xs">
                                        <thead className="border-b border-slate-200 text-slate-500">
                                            <tr>
                                                <th className="py-3 pr-3">Criativo</th>
                                                <th className="p-2 text-right">Contatos</th>
                                                <th className="p-2 text-right">Clientes vinculados</th>
                                                <th className="p-2 text-right">Consultas</th>
                                                <th className="p-2 text-right">Compareceram</th>
                                                <th className="p-2 text-right">Procedimentos</th>
                                                <th className="p-2 text-right">Receita</th>
                                                <th className="p-2 text-right">Investimento</th>
                                                <th className="py-3 pl-2 text-right">ROAS</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {creatives.map(creative => (
                                                <tr key={creative.ad_id} className="border-b border-slate-100 last:border-0">
                                                    <td className="max-w-[250px] py-3 pr-3">
                                                        <div className="truncate font-semibold text-slate-800" title={creative.name}>{creative.name}</div>
                                                        <div className="mt-1 truncate text-slate-400" title={creative.ad_id}>ID {creative.ad_id}</div>
                                                        {creative.campaign_name && <div className="truncate text-slate-500" title={creative.campaign_name}>{creative.campaign_name}</div>}
                                                    </td>
                                                    <td className="p-2 text-right tabular-nums">{formatCount(creative.contacts)}</td>
                                                    <td className="p-2 text-right tabular-nums">{formatCount(creative.linked_clients)}</td>
                                                    <td className="p-2 text-right tabular-nums">{creative.linked_clients ? formatCount(creative.consultations) : "—"}</td>
                                                    <td className="p-2 text-right tabular-nums">{creative.linked_clients ? formatCount(creative.attended_consultations) : "—"}</td>
                                                    <td className="p-2 text-right tabular-nums">{creative.linked_clients ? formatCount(creative.completed_procedures) : "—"}</td>
                                                    <td className="p-2 text-right font-semibold tabular-nums">
                                                        {creative.linked_clients ? currencyFormatter.format(creative.authorized_revenue) : "—"}
                                                    </td>
                                                    <td className="p-2 text-right">—</td>
                                                    <td className="py-3 pl-2 text-right">—</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="py-8 text-center text-sm text-slate-500">Nenhum criativo atende ao filtro.</p>
                            )}
                            <p className="mt-3 text-xs text-slate-500">Miniaturas e investimento individual não estão presentes nos dados atuais; nenhum valor foi estimado.</p>
                        </Card>
                    )}
                </>
            ) : null}
        </section>
    );
}
