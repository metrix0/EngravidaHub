// components/dashboard/ExecutiveScheduleTable.tsx
"use client";

import { Card } from "@/components";
import type { ExecutiveDashboardData } from "@/types";

type ScheduleUnitRow = ExecutiveDashboardData["schedule_unit_table"]["rows"][number];

export default function ExecutiveScheduleTable({
    data,
}: {
    data: ExecutiveDashboardData["schedule_unit_table"];
}) {
    return (
        <Card className="min-w-0 max-w-full overflow-hidden">
            <h2 className="mb-5 text-lg font-bold">Online e presencial</h2>

            <div className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-xl pb-2">
                <table className="w-max min-w-[1480px] border-collapse text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                        <tr>
                            {HEADERS.map((label, index) => (
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
                            <ScheduleRow key={row.unit_name} row={row} />
                        ))}
                        <ScheduleRow row={data.total} total />
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

const HEADERS = [
    "Unidade",
    "Agendamentos",
    "Remarcações",
    "% remar.",
    "Únicos",
    "A realizar",
    "Compareceu",
    "% comp.",
    "Projeção",
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
        row.reschedulings,
        row.rescheduling_rate,
        row.unique_appointments,
        row.pending,
        row.showed_up,
        row.showed_up_rate,
        row.projection,
        row.rescheduled,
        row.rescheduled_rate,
        row.cancelled,
        row.cancelled_rate,
        row.no_show,
        row.no_show_rate,
    ];
    const percentageIndexes = new Set([2, 6, 9, 11, 13]);

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
                {row.unit_name}
            </td>
            {values.map((value, index) => (
                <td
                    key={index}
                    className="whitespace-nowrap px-3 py-3 text-right text-slate-600"
                >
                    {percentageIndexes.has(index)
                        ? formatPercentage(value)
                        : formatNumber(value)}
                </td>
            ))}
        </tr>
    );
}

function formatNumber(value: number | null) {
    if (value === null) return "—";
    return value.toLocaleString("pt-BR", {
        maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
    });
}

function formatPercentage(value: number | null) {
    if (value === null) return "—";
    return `${value.toLocaleString("pt-BR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
    })}%`;
}
