"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, DataTable, DropdownSelect, Pagination, PercentageBar, Skeleton, type DataTableColumn } from "@/components";
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
    platform?: "meta_ads" | "google_ads";
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
    const [sort, setSort] = useState<"authorized_revenue" | "contacts" | "linked_clients" | "completed_procedures" | "attended_consultations">("authorized_revenue");
    const [minimum, setMinimum] = useState(0);
    const [page, setPage] = useState(1);

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


    const pages = Math.max(1, Math.ceil(creatives.length / 10));
    const currentPage = Math.min(page, pages);
    const timelineColumns: DataTableColumn<Timeline>[] = [
        { id: "metric", label: "Conversão", width: "43%", render: item => durationLabels[item.metric] ?? item.metric },
        { id: "median", label: "Mediana", width: "19%", align: "right", render: item => <strong>{formatDuration(item.median)}</strong> },
        { id: "range", label: <span title="Intervalo que reúne os 50% centrais dos clientes (P25–P75), em dias.">P25–P75</span>, width: "23%", align: "right", render: item => item.p25 === null ? "—" : `${formatCount(item.p25)}–${formatCount(item.p75 ?? item.p25)}` },
        { id: "clients", label: "Clientes", width: "15%", align: "right", render: item => formatCount(item.sample) },
    ];
    const touchColumns: DataTableColumn<Touchpoints>[] = [
        { id: "segment", label: "Grupo", width: "36%", render: item => <div><span className="block font-medium text-slate-700">{item.segment === "agendaram" ? "Agendaram" : "Sem agendamento em 30 dias"}</span><span className="text-muted">{formatCount(item.sample)} clientes</span></div> },
        ...([ ["conversations", "Conversas"], ["attendants", "Atendentes"], ["calls", "Ligações"], ["followups", "Retornos"] ] as const).map(([id, label]) => ({ id, label, width: "16%" as const, align: "right" as const, render: (item: Touchpoints) => item[id] ?? "—" })),
    ];
    const creativeColumns: DataTableColumn<Creative>[] = [
        { id: "name", label: "Criativo", width: "30%", render: item => <div className="flex min-w-0 items-center gap-3">
            {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" />}
            <div className="min-w-0"><span className="block truncate font-medium text-slate-700" title={item.name}>{item.name}</span>
                {item.campaign_name && <span className="block truncate text-muted" title={item.campaign_name}>{item.campaign_name}</span>}
                <span className="block truncate text-muted">{item.platform === "google_ads" ? "Google" : "Meta"} · {item.ad_id}</span></div>
        </div> },
        { id: "contacts", label: "Contatos", width: "10%", align: "right", render: item => formatCount(item.contacts) },
        { id: "linked", label: "Vinculados", width: "10%", align: "right", render: item => formatCount(item.linked_clients) },
        { id: "consultations", label: "Consultas", width: "11%", align: "right", render: item => item.linked_clients ? formatCount(item.consultations) : "—" },
        { id: "attended", label: "Compareceram", width: "12%", align: "right", render: item => item.linked_clients ? formatCount(item.attended_consultations) : "—" },
        { id: "procedures", label: "Procedimentos", width: "13%", align: "right", render: item => item.linked_clients ? formatCount(item.completed_procedures) : "—" },
        { id: "revenue", label: "Receita autorizada", width: "14%", align: "right", render: item => item.linked_clients ? <strong>{currencyFormatter.format(item.authorized_revenue)}</strong> : "—" },
    ];

    return (
        <section className="mt-6 min-w-0 space-y-5">
            {loading ? (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2" aria-busy="true">
                    {[0, 1, 2, 3].map(item => <Card key={item}><Skeleton className="mb-5 h-6 w-52" /><Skeleton className="h-40 w-full" /></Card>)}
                </div>
            ) : error ? (
                <Card><p className="text-sm text-red" role="alert">{error}</p></Card>
            ) : data ? (
                <>
                    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
                        <div data-assistant-section="jornada-tempos" className="min-w-0">
                            <Card className="!p-0">
                                <div className="p-4 md:p-6"><h2 className="text-lg font-bold">Tempo até a conversão</h2>
                                    <p className="mt-1 text-xs text-muted">Dias de calendário desde o contato. Somente eventos vinculados com data válida.</p></div>
                                <DataTable columns={timelineColumns} rows={data.analytics.timelines} getRowKey={item => item.metric} minWidth={530} />
                                <details className="p-4 md:p-6">
                                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">Agendamentos por origem</summary>
                                    <div className="mt-5 space-y-4">{data.analytics.sources.map(item => <div key={item.origin}>
                                        <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate font-medium text-slate-700" title={item.origin}>{item.origin}</span>
                                            <span className="shrink-0 font-bold text-slate-700">{percent(item.bookings, item.clients)}</span></div>
                                        <PercentageBar value={item.clients ? item.bookings / item.clients * 100 : 0} color="blue" />
                                        <p className="mt-1 text-xs text-muted">{formatCount(item.bookings)} de {formatCount(item.clients)} clientes agendaram</p>
                                    </div>)}</div>
                                </details>
                            </Card>
                        </div>
                        <div data-assistant-section="jornada-touchpoints" className="min-w-0">
                            <Card className="!p-0">
                                <div className="p-4 md:p-6"><h2 className="text-lg font-bold">Interações até o agendamento</h2>
                                    <p className="mt-1 text-xs text-muted">Mediana por cliente até agendar; sem agendamento, janela de 30 dias.</p></div>
                                <DataTable columns={touchColumns} rows={data.analytics.touchpoints} getRowKey={item => item.segment} minWidth={530} />
                                <p className="p-4 text-xs text-muted md:p-6">Retornos: acompanhamento identificado pela IA. Atendentes: pessoas distintas. Clientes recentes sem agendamento aguardam 30 dias para entrar na comparação.</p>
                            </Card>
                        </div>
                    </div>
                    <div data-assistant-section="jornada-recuperacao">
                        <Card>
                            <div className="mb-5"><h2 className="text-lg font-bold">Abandono e recuperação</h2>
                                <p className="mt-1 text-xs text-muted">Nova conversa de 1 a 30 dias após o abandono identificado pela IA. Taxas com janela completa.</p></div>
                            <div className="grid gap-6 xl:grid-cols-2">
                                <div>
                                    <div className="grid grid-cols-2 gap-5">
                                        {([
                                            ["Abandonos", formatCount(data.analytics.recovery.total)],
                                            ["Retornaram", formatCount(data.analytics.recovery.returned)],
                                            ["Taxa de retorno", percent(data.analytics.recovery.returned, data.analytics.recovery.mature)],
                                            ["Mediana até voltar", formatDuration(data.analytics.recovery.median_days)],
                                        ] as const).map(([label, value]) => <div key={label}><p className="text-xs font-medium text-muted">{label}</p><p className="mt-1 text-3xl font-bold tracking-tight text-text">{value}</p></div>)}
                                    </div>
                                    <p className="mt-5 text-xs text-muted">{formatCount(data.analytics.recovery.mature)} abandonos com janela completa · {formatCount(data.analytics.recovery.booked)} agendaram após retornar.</p>
                                </div>
                                <div className="space-y-4">{data.analytics.recovery_moments.filter(item => item.eligible > 0).map(item => <div key={item.moment}>
                                    <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate font-medium text-slate-700" title={getDropoffMomentLabel(item.moment)}>{getDropoffMomentLabel(item.moment)}</span>
                                        <span className="shrink-0 font-bold text-slate-700">{percent(item.returned, item.eligible)}</span></div>
                                    <PercentageBar value={item.returned / item.eligible * 100} color="green" />
                                    <p className="mt-1 text-xs text-muted">{formatCount(item.returned)} de {formatCount(item.eligible)} retornaram</p>
                                </div>)}</div>
                            </div>
                        </Card>
                    </div>
                    <div data-assistant-section="jornada-criativos">
                        <Card className="!p-0">
                            <div className="p-4 md:p-6">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div><h2 className="text-lg font-bold">Resultados por criativo</h2><p className="mt-1 text-xs text-muted">Meta e Google · atribuição por ID do anúncio, com resultados clínicos após o contato.</p></div>
                                    <div className="flex flex-wrap gap-2">
                                        <DropdownSelect value={sort} onChange={value => { setSort(value as typeof sort); setPage(1); }} widthClassName="w-[220px]" options={[
                                            { value: "authorized_revenue", label: "Receita autorizada" }, { value: "completed_procedures", label: "Procedimentos" },
                                            { value: "attended_consultations", label: "Comparecimentos" }, { value: "linked_clients", label: "Clientes vinculados" }, { value: "contacts", label: "Contatos" },
                                        ]} />
                                        <DropdownSelect value={String(minimum)} onChange={value => { setMinimum(Number(value)); setPage(1); }} widthClassName="w-[200px]" options={[
                                            { value: "0", label: "Todos os contatos" }, { value: "10", label: "10+ contatos" }, { value: "30", label: "30+ contatos" }, { value: "100", label: "100+ contatos" },
                                        ]} />
                                    </div>
                                </div>
                                {data.creatives && <p className="mt-4 text-xs text-muted">{formatCount(data.creatives.scope.creatives)} criativos · {formatCount(data.creatives.scope.ad_contacts)} contatos · {formatCount(data.creatives.scope.verified_clients)} clientes vinculados</p>}
                            </div>
                            {data.creative_error ? <p className="px-4 pb-6 text-sm text-red md:px-6">Não foi possível carregar os criativos.</p> : data.creatives ? <>
                                <DataTable columns={creativeColumns} rows={creatives.slice((currentPage - 1) * 10, currentPage * 10)} getRowKey={item => `${item.platform}:${item.ad_id}`} minWidth={1100} emptyMessage="Nenhum criativo no período e filtro selecionados." />
                                {pages > 1 && <div className="flex justify-end px-4 py-3 md:px-6"><Pagination totalPages={pages} currentPage={currentPage} onPageChange={setPage} activeTone="brand" /></div>}
                                <div className="border-t border-slate-100 px-4 py-3 text-xs text-muted md:px-6">
                                    <p>Receita = faturas autorizadas, não pagamento confirmado. Contatos sem vínculo ao CRM não recebem resultados clínicos.</p>
                                    <p className="mt-1">O gasto disponível é por campanha, sem divisão por anúncio; investimento e ROAS por criativo não podem ser calculados com essa base.</p>
                                    {data.creatives.scope.verified_clients === 0 && <p className="mt-1">Nenhum cliente identificado para os anúncios deste período. IDs de UTM com data de atribuição estão incluídos; períodos sem esses registros continuam sem resultados clínicos comprovados.</p>}
                                </div>
                            </> : <p className="px-4 pb-6 text-sm text-muted md:px-6">Nenhum criativo registrado no período.</p>}
                        </Card>
                    </div>
                </>
            ) : null}
        </section>
    );
}
