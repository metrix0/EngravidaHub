// components/performance/BlipPerformance.tsx
"use client";

import { useEffect, useState } from "react";
import { MapPin, Users } from "lucide-react";
import Card from "@/components/ui/Card";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import Skeleton from "@/components/ui/Skeleton";
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

export default function BlipPerformance({ start, end }: { start: string; end: string }) {
    const [scope, setScope] = useState<"all" | "ra" | "ac">("ac");
    const [unitName, setUnitName] = useState("");
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

    if (error) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
    if (!data) return <section className="space-y-5" aria-busy="true">
        <h2 className="text-lg font-bold">Atendimento no Blip</h2>
        <Skeleton className="h-48 rounded-2xl" />
    </section>;

    const unit = scope === "ac" ? data.units.find(unit => unit.name === unitName) : undefined;
    const metrics = unit ?? data[scope];
    const acTickets = unit ? unit.acTickets : data.acTickets;
    const net = metrics.closed - metrics.lost;
    const units = unit ? [unit] : data.units;
    const rows = scope === "ac" ? units : scope === "ra" ? data.queues.filter(row => row.name === "RA") : data.queues;
    const summary = [
        { label: "Tickets abertos", value: count(metrics.opened) },
        { label: "Tickets fechados", value: count(metrics.closed) },
        { label: "1ª resposta média", value: duration(metrics.firstResponse) },
        { label: "Colaboradores no período", value: count(metrics.collaborators) },
    ];

    return <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Atendimento no Blip</h2>
            <div className="flex flex-wrap gap-3">
                <DropdownSelect icon={<Users size={16} />} value={scope} widthClassName="w-[230px]" onChange={value => {
                    if (value === "all" || value === "ra" || value === "ac") setScope(value);
                }} options={[
                    { value: "all", label: "Todas as filas" }, { value: "ra", label: "RA" },
                    { value: "ac", label: "Assistência Centralizada" },
                ]} />
                {scope === "ac" && <DropdownSelect icon={<MapPin size={16} />} value={unitName} onChange={setUnitName}
                    widthClassName="w-[200px]" options={[
                        { value: "", label: "Todas as unidades" }, ...data.units.map(unit => ({ value: unit.name, label: unit.name })),
                    ]} />}
            </div>
        </div>
        {scope === "ac" && <section className="space-y-4">
            <Card>
                <h3 className="text-lg font-bold">Contribuição AC por unidade</h3>
                <p className="mt-2 text-sm text-muted"><strong className="text-text">{count(net)}</strong> tickets fechados, descontados os perdidos.</p>
                {acTickets === null
                    ? <p className="mt-1 text-sm text-muted">Cadastre os atendentes da Assistência Centralizada para calcular a contribuição.</p>
                    : <p className="mt-1 text-sm text-muted"><strong className="text-green">{count(acTickets)} tickets · {percent(acTickets, net)}</strong> atendidos pela AC</p>}
            </Card>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {units.map(unit => {
                    const total = unit.closed - unit.lost;
                    return <Card key={unit.name} className="min-w-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h4 className="text-sm font-bold">{unit.name}</h4>
                            {unit.acTickets !== null && <strong className="text-green">{percent(unit.acTickets, total)}</strong>}
                        </div>
                        <p className="mt-3 text-xs text-muted">{unit.acTickets === null
                            ? `${count(total)} tickets` : `${count(unit.acTickets)} de ${count(total)} tickets`}</p>
                    </Card>;
                })}
            </div>
        </section>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summary.map(item => <Card key={item.label}>
                <p className="text-xs text-muted">{item.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{item.value}</p>
            </Card>)}
        </div>
        <Card className="min-w-0 !p-0">
            <h3 className="p-4 text-lg font-bold md:px-6">Painel de tickets</h3>
            <DataTable rows={rows} columns={COLUMNS} minWidth={780} getRowKey={row => row.name}
                emptyMessage="Nenhum ticket no período." />
        </Card>
    </section>;
}
