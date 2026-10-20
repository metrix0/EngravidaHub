// components/scheduling/BookingAuthorsTable.tsx
"use client";

import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";

import Card from "@/components/ui/Card";
import InfoTooltip from "@/components/ui/InfoTooltip";
import Pagination from "@/components/ui/Pagination";
import Skeleton from "@/components/ui/Skeleton";

type Row = {
    key: string; name: string; bookings: number; reschedules: number; rescheduleRate: number;
    unique: number; upcoming: number; attended: number; attendanceRate: number;
    projection: null; rescheduled: number; rescheduledRate: number;
    cancelled: number; cancelledRate: number; missed: number; missedRate: number;
};
type Result = { rows: Row[]; total: Row; doctorLimited: boolean };
const PAGE_SIZE = 10;
const integer = (value: number) => value.toLocaleString("pt-BR");
const rate = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
const COLUMNS: Array<{ title: string; field: keyof Row; percentage?: boolean }> = [
    { title: "Marcado por", field: "name" },
    { title: "Agendamentos", field: "bookings" },
    { title: "Remarcações", field: "reschedules" },
    { title: "% Rem.", field: "rescheduleRate", percentage: true },
    { title: "Únicos", field: "unique" },
    { title: "A realizar", field: "upcoming" },
    { title: "Compareceu", field: "attended" },
    { title: "% Comp.", field: "attendanceRate", percentage: true },
    { title: "Projeção", field: "projection" },
    { title: "Remarcou", field: "rescheduled" },
    { title: "% Rem.", field: "rescheduledRate", percentage: true },
    { title: "Cancelou", field: "cancelled" },
    { title: "% Canc.", field: "cancelledRate", percentage: true },
    { title: "Faltou", field: "missed" },
    { title: "% Faltou", field: "missedRate", percentage: true },
];

export default function BookingAuthorsTable({ month, unitIds = [], doctorIds = [] }: {
    month: string; unitIds?: string[]; doctorIds?: string[];
}) {
    const unitKey = [...unitIds].sort().join(",");
    const doctorKey = [...doctorIds].sort().join(",");
    const [result, setResult] = useState<Result | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setResult(null);
        setError(null);
        setPage(1);
        const params = new URLSearchParams({ month });
        unitKey.split(",").filter(Boolean).forEach(id => params.append("unit_ids", id));
        doctorKey.split(",").filter(Boolean).forEach(id => params.append("doctor_ids", id));
        void (async () => {
            try {
                const response = await fetch("/api/scheduling/booking-authors?" + params, {
                    cache: "no-store", signal: controller.signal,
                });
                const json = await response.json();
                if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar os dados.");
                if (!controller.signal.aborted) setResult(json as Result);
            } catch (cause) {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha ao carregar os dados.");
            }
        })();
        return () => controller.abort();
    }, [month, unitKey, doctorKey, reload]);

    const pages = Math.max(1, Math.ceil((result?.rows.length ?? 0) / PAGE_SIZE));
    const currentPage = Math.min(page, pages);
    const shown = result?.rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) ?? [];
    function cell(row: Row, field: keyof Row, percentage?: boolean) {
        const value = row[field];
        if (typeof value !== "number") return value ?? "—";
        return percentage ? rate(value) : integer(value);
    }
    return (
        <Card className="min-w-0 !p-0">
            <div className="flex items-center gap-2 px-4 py-5 md:px-6">
                <h3 className="text-lg font-bold">Marcado por atendente</h3>
                <InfoTooltip portal widthClassName="w-[350px]" text="Agendamentos criados no mês, por autor registrado no CliniSYS ou no Hub. Remarcações: registros com status Remarcou; Remarcou: clientes únicos nessa situação. Compareceu, cancelou e faltou: status atual. Percentuais de resultados sobre clientes únicos. Projeção não disponível.">
                    <HelpCircle size={14} className="shrink-0 text-slate-400" />
                </InfoTooltip>
            </div>
            {!result && !error ? <div className="space-y-3 px-4 pb-5 md:px-6"><Skeleton className="h-10 rounded-lg" /><Skeleton className="h-10 rounded-lg" /><Skeleton className="h-10 rounded-lg" /></div>
                : error ? <div className="px-4 pb-5 text-sm text-red md:px-6">{error}
                    <button type="button" onClick={() => setReload(value => value + 1)} className="ml-3 cursor-pointer font-semibold underline">Tentar novamente</button>
                </div>
                    : <>
                        <div className="max-w-full overflow-x-auto">
                            <table className="w-full min-w-[1450px] text-xs">
                                <thead><tr className="bg-slate-50 text-slate-600">{COLUMNS.map((column,index) =>
                                    <th key={index} className={"border-b border-slate-100 px-3 py-3 font-bold " + (index ? "text-center" : "text-left")}>{column.title}</th>
                                )}</tr></thead>
                                <tbody>
                                    {shown.length ? shown.map(row => <tr key={row.key} className="border-b border-slate-100 even:bg-slate-50/60">
                                        {COLUMNS.map((column,index) =>
                                            <td key={index} className={"px-3 py-3 tabular-nums " + (index ? "text-center" : "max-w-[190px] truncate font-semibold")} title={index === 0 ? row.name : undefined}>
                                                {cell(row, column.field, column.percentage)}
                                            </td>
                                        )}
                                    </tr>) : <tr><td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-sm text-muted">Nenhum agendamento no período.</td></tr>}
                                </tbody>
                                {result && result.total.bookings > 0 ? <tfoot><tr className="border-t border-slate-200 bg-slate-100 font-bold text-slate-800">
                                    {COLUMNS.map((column,index) => <td key={index} className={"px-3 py-3 tabular-nums " + (index ? "text-center" : "")}>
                                        {cell(result.total, column.field, column.percentage)}
                                    </td>)}
                                </tr></tfoot> : null}
                            </table>
                        </div>
                        {result && result.rows.length > PAGE_SIZE ? <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
                            <span className="text-xs text-muted">{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, result.rows.length)} de {result.rows.length} atendentes</span>
                            <Pagination totalPages={pages} currentPage={currentPage} onPageChange={setPage} />
                        </div> : null}
                        {result?.doctorLimited ? <p className="px-4 pb-4 text-xs text-muted md:px-6">Filtro de médico: somente agendamentos com médico identificado no Hub.</p> : null}
                    </>}
        </Card>
    );
}
