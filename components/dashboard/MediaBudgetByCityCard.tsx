// components/dashboard/MediaBudgetByCityCard.tsx
"use client";

import { useEffect, useState } from "react";
import { Building2, Megaphone } from "lucide-react";
import { FaGoogle, FaMeta } from "react-icons/fa6";

import { Card, Skeleton } from "@/components";
import type {
    MediaBudgetByCityResponse,
    MediaBudgetByCityRow,
} from "@/types/media-budget-by-city";

type MediaBudgetByCityCardProps = {
    queryString: string;
};

export default function MediaBudgetByCityCard({
    queryString,
}: MediaBudgetByCityCardProps) {
    const [data, setData] = useState<MediaBudgetByCityResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        async function load() {
            setLoading(true);
            setError(null);

            try {
                const response = await fetch(
                    `/api/dashboard/financeiro/media-by-city?${queryString}`,
                    {
                        cache: "no-store",
                        signal: controller.signal,
                    },
                );
                const json = (await response.json()) as
                    | MediaBudgetByCityResponse
                    | { error?: string };

                if (!response.ok) {
                    throw new Error(
                        "error" in json && json.error
                            ? json.error
                            : "Falha ao carregar a verba de mídia por cidade.",
                    );
                }

                setData(json as MediaBudgetByCityResponse);
            } catch (loadError) {
                if (controller.signal.aborted) return;
                console.error(
                    "[financeiro] media budget by city failed",
                    loadError,
                );
                setData(null);
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Falha ao carregar a verba de mídia por cidade.",
                );
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        void load();
        return () => controller.abort();
    }, [queryString]);

    return (
        <Card>
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <Megaphone size={19} className="text-blue" />
                        <h2 className="text-xl font-bold text-slate-900">
                            Verba de mídia por cidade
                        </h2>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                        Meta e Google Ads pareados pelo nome da campanha com os
                        agendamentos do CliniSys
                    </p>
                </div>

                {data ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Competência
                        </div>
                        <div className="mt-0.5 text-sm font-bold text-slate-700">
                            {formatReferenceMonth(data.reference_month)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                            até {formatDate(data.as_of_date)}
                        </div>
                    </div>
                ) : null}
            </div>

            {loading ? (
                <TableSkeleton />
            ) : error ? (
                <div className="flex min-h-[170px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 text-center text-sm text-slate-500">
                    {error}
                </div>
            ) : !data || data.rows.length === 0 ? (
                <div className="flex min-h-[170px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 text-center text-sm text-slate-500">
                    Nenhuma cidade disponível para os filtros selecionados.
                </div>
            ) : (
                <>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <div className="min-w-[1180px]">
                            <div className="grid grid-cols-[minmax(180px,1.35fr)_0.9fr_1fr_0.95fr_0.95fr_0.95fr_0.72fr_0.78fr_0.95fr] gap-3 bg-slate-50 px-4 py-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                <div>Cidade</div>
                                <div>Verba mensal</div>
                                <div>Investido</div>
                                <div>Restante</div>
                                <div>Verba diária</div>
                                <div>Projeção</div>
                                <div>Ritmo</div>
                                <div>Agendamentos</div>
                                <div>Custo/agend.</div>
                            </div>

                            {data.rows.map((row) => (
                                <MediaBudgetRow key={row.key} row={row} />
                            ))}
                        </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400">
                        <span>
                            {data.remaining_days > 0
                                ? `Verba diária = saldo ÷ ${data.remaining_days} dias restantes. Projeção baseada em ${data.elapsed_days} dias decorridos.`
                                : "Competência encerrada; a projeção corresponde ao valor realizado."}
                        </span>

                        {data.audit.unmatched_spend > 0 ? (
                            <span
                                className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-slate-500"
                                title="Campanhas nacionais ou sem uma cidade/abreviação reconhecível no nome não são distribuídas entre as unidades."
                            >
                                {formatCurrency(data.audit.unmatched_spend)} sem cidade
                                identificada no nome da campanha
                            </span>
                        ) : null}
                    </div>
                </>
            )}
        </Card>
    );
}

function MediaBudgetRow({ row }: { row: MediaBudgetByCityRow }) {
    const investedPercentage =
        row.monthly_budget > 0
            ? Math.max(0, Math.min(100, (row.spend / row.monthly_budget) * 100))
            : 0;
    const platforms = getPlatformLabel(row);

    return (
        <div className="grid grid-cols-[minmax(180px,1.35fr)_0.9fr_1fr_0.95fr_0.95fr_0.95fr_0.72fr_0.78fr_0.95fr] items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm">
            <div className="min-w-0">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                    <Building2 size={15} className="shrink-0 text-slate-400" />
                    <span className="truncate">{row.city}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                    {row.meta_spend > 0 ? <FaMeta size={10} /> : null}
                    {row.google_spend > 0 ? <FaGoogle size={10} /> : null}
                    <span>{platforms}</span>
                    <span>·</span>
                    <span>
                        {row.matched_campaigns} {row.matched_campaigns === 1 ? "campanha" : "campanhas"}
                    </span>
                </div>
            </div>

            <div className="font-semibold text-slate-700">
                {formatCurrency(row.monthly_budget)}
            </div>

            <div className="min-w-0">
                <div className="font-bold text-slate-800">
                    {formatCurrency(row.spend)}
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                        className="h-full rounded-full bg-orange-400"
                        style={{ width: `${investedPercentage}%` }}
                    />
                </div>
                <div className="mt-1 text-[10px] text-slate-400">
                    {formatPercentage(
                        row.monthly_budget > 0
                            ? (row.spend / row.monthly_budget) * 100
                            : 0,
                    )}
                </div>
            </div>

            <div
                className={
                    row.remaining >= 0
                        ? "font-semibold text-emerald-600"
                        : "font-semibold text-red-500"
                }
            >
                {formatCurrency(row.remaining)}
            </div>

            <div className="font-semibold text-blue-600">
                {row.daily_budget === null
                    ? "—"
                    : formatCurrency(row.daily_budget)}
            </div>

            <div
                className={
                    row.projection > row.monthly_budget
                        ? "font-semibold text-red-500"
                        : "font-semibold text-slate-700"
                }
            >
                {formatCurrency(row.projection)}
            </div>

            <div>
                <span className={paceBadgeClass(row.pace_percentage)}>
                    {row.pace_percentage === null
                        ? "—"
                        : formatPercentage(row.pace_percentage)}
                </span>
            </div>

            <div className="font-semibold text-slate-700">
                {formatInteger(row.schedules)}
            </div>

            <div className={costClass(row.cost_per_schedule)}>
                {row.cost_per_schedule === null
                    ? "—"
                    : formatCurrency(row.cost_per_schedule)}
            </div>
        </div>
    );
}

function TableSkeleton() {
    return (
        <div className="overflow-hidden rounded-xl border border-slate-200">
            <Skeleton className="h-11 w-full rounded-none" />
            {Array.from({ length: 7 }).map((_, index) => (
                <div
                    key={index}
                    className="grid grid-cols-9 gap-3 border-t border-slate-100 px-4 py-4"
                >
                    {Array.from({ length: 9 }).map((__, column) => (
                        <Skeleton
                            key={column}
                            className={column === 0 ? "h-8 w-full" : "h-5 w-full"}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

function getPlatformLabel(row: MediaBudgetByCityRow) {
    if (row.meta_spend > 0 && row.google_spend > 0) {
        return "Meta + Google Ads";
    }
    if (row.meta_spend > 0) return "Meta Ads";
    if (row.google_spend > 0) return "Google Ads";
    return "Sem investimento pareado";
}

function paceBadgeClass(value: number | null) {
    const base =
        "inline-flex rounded-full px-2 py-1 text-[10px] font-bold tabular-nums";
    if (value === null) return `${base} bg-slate-100 text-slate-500`;
    if (value > 110) return `${base} bg-red-50 text-red-600`;
    if (value >= 90) return `${base} bg-amber-50 text-amber-700`;
    if (value >= 75) return `${base} bg-emerald-50 text-emerald-700`;
    return `${base} bg-blue-50 text-blue-600`;
}

function costClass(value: number | null) {
    if (value === null) return "font-semibold text-slate-400";
    if (value <= 500) return "font-semibold text-emerald-600";
    if (value <= 600) return "font-semibold text-amber-600";
    return "font-semibold text-red-500";
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

function formatInteger(value: number) {
    return new Intl.NumberFormat("pt-BR", {
        maximumFractionDigits: 0,
    }).format(value);
}

function formatPercentage(value: number) {
    return `${new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    }).format(value)}%`;
}

function formatReferenceMonth(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        month: "long",
        year: "numeric",
        timeZone: "America/Sao_Paulo",
    }).format(new Date(`${value}-01T12:00:00-03:00`));
}

function formatDate(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "America/Sao_Paulo",
    }).format(new Date(`${value}T12:00:00-03:00`));
}
