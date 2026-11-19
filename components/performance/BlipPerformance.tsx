// components/performance/BlipPerformance.tsx
"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import Card from "@/components/ui/Card";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import Skeleton from "@/components/ui/Skeleton";
import DashboardWidget from "@/components/personal-dashboard/DashboardWidget";
import type { ContributedUnit } from "@/components/performance/PerformanceWidgets";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import type { DeskPerformance, DeskQueue } from "@/lib/blip/deskPerformance";

const CLIENT_CACHE_MS = 60_000;
const CLIENT_CACHE_SIZE = 8;
type CachedReport = { data: DeskPerformance; receivedAt: number };

const count = (value: number) => value.toLocaleString("pt-BR");
const percent = (part: number, total: number) => total > 0
    ? (part / total).toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—";

function duration(value: number | null) {
    if (value === null) return "—";
    return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60]
        .map(part => String(part).padStart(2, "0")).join(":");
}

const COLUMNS: DataTableColumn<DeskQueue>[] = [
    { id: "queue", label: "Fila ou unidade", width: "21%", render: row => row.name },
    { id: "closed", label: "Fechados", width: "10%", align: "right", render: row => count(row.closed) },
    { id: "lost", label: "Perdidos", width: "10%", align: "right", render: row => count(row.lost) },
    { id: "abandoned", label: "Abandonados", width: "11%", align: "right", render: row => count(row.abandoned) },
    { id: "wait", label: "Espera", width: "12%", align: "right", render: row => duration(row.wait) },
    { id: "queue_time", label: "Tempo de fila", width: "12%", align: "right", render: row => duration(row.queue) },
    { id: "service", label: "Atendimento", width: "12%", align: "right", render: row => duration(row.service) },
    { id: "first", label: "1ª resposta", width: "12%", align: "right", render: row => duration(row.firstResponse) },
];

function unitKey(name: string) {
    const normalized = name.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return normalized === "brasilia" ? "distrito federal" : normalized;
}

export default function BlipPerformance({ start, end, unitName, bookings, raOnly }: {
    start: string; end: string; unitName: string; bookings: ContributedUnit[]; raOnly: boolean;
}) {
    const [scope, setScope] = useState<"all" | "ra" | "ac">("ac");
    const [reports, setReports] = useState(() => new Map<string, CachedReport>());
    const [failure, setFailure] = useState<{ key: string; message: string }>();
    const key = start + ":" + end;
    const cached = reports.get(key);
    const data = cached?.data;
    const error = failure?.key === key ? failure.message : undefined;

    useEffect(() => {
        if (cached && Date.now() - cached.receivedAt < CLIENT_CACHE_MS) return;
        const controller = new AbortController();
        const params = new URLSearchParams({ start, end });
        void (async () => {
            try {
                const response = await fetch("/api/performance/blip?" + params, { signal: controller.signal });
                const body = await response.json();
                if (!response.ok) throw new Error(body.error);
                if (!controller.signal.aborted) {
                    const report = { data: body.report, receivedAt: Date.now() };
                    setReports(previous => {
                        const updated = new Map(previous);
                        updated.delete(key);
                        updated.set(key, report);
                        if (updated.size > CLIENT_CACHE_SIZE) updated.delete(updated.keys().next().value!);
                        return updated;
                    });
                    setFailure(previous => previous?.key === key ? undefined : previous);
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    setFailure({ key, message: error instanceof Error ? error.message : "Não foi possível carregar o Blip." });
                }
            }
        })();
        return () => controller.abort();
    }, [cached, key, start, end]);

    const ticketUnits = data?.units.filter(unit => !unitName || unitKey(unit.name) === unitKey(unitName)) ?? [];
    const ticketsByUnit = new Map(ticketUnits.map(unit => [unitKey(unit.name), unit]));
    const bookingsByUnit = new Map(bookings.map(unit => [unitKey(unit.name), unit]));
    const units = new Set([...bookingsByUnit.keys(), ...ticketsByUnit.keys()]);
    const ac = unitName ? ticketUnits[0] : data?.ac;
    const acTickets = unitName ? ticketUnits[0]?.acTickets : data?.acTickets;
    const net = ac ? ac.closed - ac.lost : 0;
    const metrics = scope === "ac" ? ac : data?.[scope];
    const rows = scope === "ac" ? ticketUnits : data?.queues.filter(row => scope === "all" || row.name === "RA") ?? [];
    const summary = metrics && [
        { label: "Abertos", value: count(metrics.opened) },
        { label: "Fechados", value: count(metrics.closed) },
        { label: "1ª resposta média", value: duration(metrics.firstResponse) },
        { label: "Colaboradores no período", value: count(metrics.collaborators) },
    ];

    return <section className="space-y-7" aria-label="Desempenho por unidade e atendimento">
        <DashboardWidget widgetId="performance.contribuicao_unidade">
            <section className="space-y-4" aria-labelledby="performance-units-title">
                <div>
                    <h2 id="performance-units-title" className="text-lg font-bold">Desempenho por unidade</h2>
                    {ac ? <p className="mt-1 text-sm text-muted">
                        {acTickets == null
                            ? <>{count(net)} tickets no recorte da AC. Cadastre os atendentes para calcular a contribuição.</>
                            : <><strong className="text-green">{count(acTickets)} de {count(net)} tickets ({percent(acTickets, net)})</strong> atendidos pela AC</>}
                    </p> : null}
                </div>
                {units.size ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {[...units].map(key => {
                        const booking = bookingsByUnit.get(key);
                        const ticket = ticketsByUnit.get(key);
                        const name = booking?.name ?? ticket?.name;
                        const total = ticket ? ticket.closed - ticket.lost : 0;
                        return <Card key={key} className="min-w-0">
                            <h3 className="text-sm font-bold">{name}</h3>
                            {booking ? <div className="mt-3 text-xs text-muted">
                                <p>{raOnly ? "Marcações da RA" : "Marcações da seleção"}</p>
                                <p className="tabular-nums"><strong className="text-text">{count(booking.contributed)} de {count(booking.total)}</strong>
                                    {" · "}{booking.contributionShare.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</p>
                                {booking.matched < booking.total ? <p>{count(booking.total - booking.matched)} sem atendente identificado</p> : null}
                            </div> : null}
                            {ticket ? <div className="mt-3 text-xs text-muted">
                                <p>{ticket.acTickets == null ? "Tickets na fila de assistência" : "Tickets atendidos pela AC"}</p>
                                <p className="tabular-nums">{ticket.acTickets == null ? count(total)
                                    : <><strong className="text-text">{count(ticket.acTickets)} de {count(total)}</strong>{" · "}{percent(ticket.acTickets, total)}</>}</p>
                            </div> : null}
                        </Card>;
                    })}
                </div> : !data && !error ? <Skeleton className="h-36 rounded-2xl" /> : null}
            </section>
        </DashboardWidget>
        <section className="space-y-4" aria-labelledby="performance-tickets-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="performance-tickets-title" className="text-lg font-bold">Atendimento no Blip</h2>
                <DropdownSelect icon={<Users size={16} />} value={scope} widthClassName="w-[250px]" onChange={value => {
                    if (value === "all" || value === "ra" || value === "ac") setScope(value);
                }} options={[
                    { value: "all", label: "Todas as filas" }, { value: "ra", label: "RA" },
                    { value: "ac", label: "Assistência Centralizada" },
                ]} />
            </div>
            {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
                : !data ? <div aria-busy="true"><Skeleton className="h-28 rounded-2xl" /></div>
                : !summary ? <p className="text-sm text-muted">Sem fila da Assistência Centralizada associada a {unitName}.</p>
                : <>
                    {unitName && scope !== "ac" ? <p className="text-xs text-muted">Este recorte de filas considera todas as unidades.</p> : null}
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {summary.map(item => <Card key={item.label}>
                            <p className="text-xs text-muted">{item.label}</p>
                            <p className="mt-1 text-2xl font-bold tabular-nums">{item.value}</p>
                        </Card>)}
                    </div>
                    <Card className="min-w-0 !p-0">
                        <details className="group">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-semibold md:px-6 [&::-webkit-details-marker]:hidden">
                                Detalhes dos tickets
                                <ChevronDown size={16} className="text-muted group-open:rotate-180" />
                            </summary>
                            <DataTable rows={rows} columns={COLUMNS} minWidth={780} getRowKey={row => row.name}
                                emptyMessage="Nenhum ticket no período." />
                        </details>
                    </Card>
                </>}
        </section>
    </section>;
}
