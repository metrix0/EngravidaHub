// components/dashboard/ExecutiveScheduleTable.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Card, Skeleton } from "@/components";
import { applyCalendarDateParams } from "@/components/ui/CalendarButton";
import type { ExecutiveDashboardData } from "@/types";

type ScheduleUnitRow = ExecutiveDashboardData["schedule_unit_table"]["rows"][number];

type MarkingUnitRow = {
    unit_name: string;
    markings: number;
    unique_markings: number;
    unique_projection: number;
    rescheduled: number;
    cancelled: number;
    first_appointments: number;
    first_appointments_projection: number;
};

type MarkingUnitTable = {
    rows: MarkingUnitRow[];
    total: MarkingUnitRow;
};

export default function ExecutiveScheduleTable({
    data,
}: {
    data: ExecutiveDashboardData["schedule_unit_table"];
}) {
    const unitNamesParam = data.rows.map((row) => row.unit_name).join(",");
    const [markings, setMarkings] = useState<MarkingUnitTable | null>(null);
    const [markingsLoading, setMarkingsLoading] = useState(true);
    const [markingsError, setMarkingsError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const browserParams = new URLSearchParams(window.location.search);
        const params = new URLSearchParams();

        applyCalendarDateParams({
            params,
            selectedRange: {
                start: browserParams.get("start_date"),
                end: browserParams.get("end_date"),
            },
            selectedPreset: browserParams.get("period") ?? "current_month",
        });
        if (unitNamesParam) params.set("unit_names", unitNamesParam);

        setMarkingsLoading(true);
        setMarkingsError(null);

        void fetch(`/api/dashboard/markings?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
        })
            .then(async (response) => {
                const payload = (await response.json()) as MarkingUnitTable & {
                    error?: string;
                };
                if (!response.ok) {
                    throw new Error(
                        payload.error ??
                            "Não foi possível carregar as marcações.",
                    );
                }

                const exactMarkingsByUnit = new Map(
                    data.rows.map((row) => [
                        normalizeUnitKey(row.unit_name),
                        row.markings,
                    ]),
                );

                setMarkings({
                    rows: payload.rows.map((row) => ({
                        ...row,
                        markings:
                            exactMarkingsByUnit.get(
                                normalizeUnitKey(row.unit_name),
                            ) ?? row.markings,
                    })),
                    total: {
                        ...payload.total,
                        markings: data.total.markings,
                    },
                });
            })
            .catch((error: unknown) => {
                if (
                    error instanceof DOMException &&
                    error.name === "AbortError"
                ) {
                    return;
                }
                setMarkings(null);
                setMarkingsError(
                    error instanceof Error
                        ? error.message
                        : "Não foi possível carregar as marcações.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) setMarkingsLoading(false);
            });

        return () => controller.abort();
    }, [data.rows, data.total.markings, unitNamesParam]);

    return (
        <div className="space-y-5">
            <AppointmentsTable data={data} />
            <MarkingsTable
                data={markings}
                loading={markingsLoading}
                error={markingsError}
            />
        </div>
    );
}

function AppointmentsTable({
    data,
}: {
    data: ExecutiveDashboardData["schedule_unit_table"];
}) {
    return (
        <Card className="min-w-0 max-w-full overflow-hidden">
            <h2 className="mb-5 text-lg font-bold">
                Online e presencial (Avaliações)
            </h2>

            <div className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-xl pb-2">
                <table className="w-max min-w-[1400px] border-collapse text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                        <tr>
                            {APPOINTMENT_HEADERS.map((label, index) => (
                                <th
                                    key={`${label}-${index}`}
                                    className={`whitespace-nowrap px-3 py-3 font-bold ${
                                        index === 0
                                            ? "sticky left-0 z-20 bg-slate-50 text-left"
                                            : "text-right"
                                    }`}
                                >
                                    {label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.rows.map((row) => (
                            <ScheduleRow key={row.unit_name} row={row} />
                        ))}
                        <ScheduleRow row={data.total} total />
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

const APPOINTMENT_HEADERS = [
    "Unidade",
    "Agendamentos",
    "Projeção",
    "Remarcações",
    "% remar.",
    "Únicos",
    "A realizar",
    "Compareceu",
    "% comp.",
    "Remarcou",
    "% rem.",
    "Cancelou",
    "% canc.",
    "Faltou",
    "% faltou",
];

function ScheduleRow({
    row,
    total = false,
}: {
    row: ScheduleUnitRow;
    total?: boolean;
}) {
    const values: (number | null)[] = [
        row.appointments,
        row.projection,
        row.reschedulings,
        row.rescheduling_rate,
        row.unique_appointments,
        row.pending,
        row.showed_up,
        row.showed_up_rate,
        row.rescheduled,
        row.rescheduled_rate,
        row.cancelled,
        row.cancelled_rate,
        row.no_show,
        row.no_show_rate,
    ];
    const projectionIndexes = new Set([1]);
    const percentageIndexes = new Set([3, 7, 9, 11, 13]);

    return (
        <TableRowShell label={row.unit_name} total={total}>
            {values.map((value, index) => (
                <td
                    key={index}
                    className="whitespace-nowrap px-3 py-3 text-right text-slate-600"
                >
                    {percentageIndexes.has(index)
                        ? formatPercentage(value)
                        : projectionIndexes.has(index)
                          ? formatProjection(value)
                          : formatNumber(value)}
                </td>
            ))}
        </TableRowShell>
    );
}

function MarkingsTable({
    data,
    loading,
    error,
}: {
    data: MarkingUnitTable | null;
    loading: boolean;
    error: string | null;
}) {
    return (
        <Card className="min-w-0 max-w-full overflow-hidden">
            <h2 className="mb-5 text-lg font-bold">
                Marcações
            </h2>

            {loading ? (
                <Skeleton className="h-[360px] w-full rounded-xl" />
            ) : error ? (
                <div className="rounded-xl border border-red/20 bg-red-soft/20 px-4 py-3 text-sm font-medium text-red">
                    {error}
                </div>
            ) : data ? (
                <div className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-xl pb-2">
                    <table className="w-full min-w-[980px] border-collapse text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                            <tr>
                                {MARKING_HEADERS.map((label, index) => (
                                    <th
                                        key={label}
                                        className={`whitespace-nowrap px-3 py-3 font-bold ${
                                            index === 0
                                                ? "sticky left-0 z-20 bg-slate-50 text-left"
                                                : "text-right"
                                        }`}
                                    >
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.map((row) => (
                                <MarkingRow key={row.unit_name} row={row} />
                            ))}
                            <MarkingRow row={data.total} total />
                        </tbody>
                    </table>
                </div>
            ) : null}
        </Card>
    );
}

const MARKING_HEADERS = [
    "Unidade",
    "Marcações",
    "Marcações únicas",
    "Projeção de marcações únicas",
    "Remarcações",
    "Desmarcações",
    "Primeira marcação",
    "Projeção de primeira marcação",
];

function MarkingRow({
    row,
    total = false,
}: {
    row: MarkingUnitRow;
    total?: boolean;
}) {
    const values = [
        row.markings,
        row.unique_markings,
        row.unique_projection,
        row.rescheduled,
        row.cancelled,
        row.first_appointments,
        row.first_appointments_projection,
    ];

    return (
        <TableRowShell label={row.unit_name} total={total}>
            {values.map((value, index) => (
                <td
                    key={index}
                    className="whitespace-nowrap px-3 py-3 text-right text-slate-600"
                >
                    {formatNumber(value)}
                </td>
            ))}
        </TableRowShell>
    );
}

function TableRowShell({
    label,
    total,
    children,
}: {
    label: string;
    total: boolean;
    children: ReactNode;
}) {
    return (
        <tr
            className={
                total
                    ? "border-t-2 border-slate-200 bg-slate-50 font-bold"
                    : "border-t border-slate-100 bg-white"
            }
        >
            <td
                className={`sticky left-0 z-10 whitespace-nowrap px-3 py-3 text-left font-medium text-slate-700 ${
                    total ? "bg-slate-50" : "bg-white"
                }`}
            >
                {label}
            </td>
            {children}
        </tr>
    );
}

function formatNumber(value: number | null) {
    if (value === null) return "—";
    return value.toLocaleString("pt-BR", {
        maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
    });
}

function formatProjection(value: number | null) {
    if (value === null) return "—";
    return Math.round(value).toLocaleString("pt-BR");
}

function formatPercentage(value: number | null) {
    if (value === null) return "—";
    return `${value.toLocaleString("pt-BR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
    })}%`;
}

function normalizeUnitKey(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLocaleLowerCase("pt-BR");
}
