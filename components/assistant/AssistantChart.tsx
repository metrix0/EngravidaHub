// components/assistant/AssistantChart.tsx
"use client";

import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

export type AssistantChartConfig = {
    type: "pie" | "bar" | "line";
    title: string;
    data: Array<{ label: string; value: number }>;
    valueSuffix?: string;
};

const CHART_COLORS = [
    "#ff3f45",
    "#7c3aed",
    "#0ea5e9",
    "#10b981",
    "#f59e0b",
    "#ec4899",
    "#6366f1",
    "#14b8a6",
];

export default function AssistantChart({
    config,
}: {
    config: AssistantChartConfig;
}) {
    const data = config.data
        .filter(
            (item) =>
                typeof item.label === "string" &&
                item.label.trim() &&
                Number.isFinite(item.value),
        )
        .slice(0, 16)
        .map((item) => ({
            label: item.label.trim().slice(0, 80),
            value: Number(item.value),
        }));

    if (data.length === 0) return null;

    return (
        <section className="my-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
                <h4 className="text-sm font-bold text-slate-950">
                    {config.title || "Gráfico"}
                </h4>
            </div>

            <div className="h-[300px] w-full px-2 py-4 sm:px-4">
                {config.type === "pie" ? (
                    <PizzaGraph
                        data={data}
                        valueSuffix={config.valueSuffix}
                    />
                ) : config.type === "line" ? (
                    <AssistantLineGraph
                        data={data}
                        valueSuffix={config.valueSuffix}
                    />
                ) : (
                    <AssistantBarGraph
                        data={data}
                        valueSuffix={config.valueSuffix}
                    />
                )}
            </div>
        </section>
    );
}

function PizzaGraph({
    data,
    valueSuffix,
}: {
    data: Array<{ label: string; value: number }>;
    valueSuffix?: string;
}) {
    return (
        <ResponsiveContainer width="100%" height="100%">
            <PieChart>
                <Pie
                    data={data}
                    dataKey="value"
                    nameKey="label"
                    cx="50%"
                    cy="46%"
                    outerRadius={92}
                    innerRadius={45}
                    paddingAngle={2}
                >
                    {data.map((item, index) => (
                        <Cell
                            key={`${item.label}:${index}`}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                        />
                    ))}
                </Pie>
                <Tooltip formatter={(value: unknown) => formatValue(value, valueSuffix)} />
                <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12 }}
                />
            </PieChart>
        </ResponsiveContainer>
    );
}

function AssistantBarGraph({
    data,
    valueSuffix,
}: {
    data: Array<{ label: string; value: number }>;
    valueSuffix?: string;
}) {
    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 38 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                    dataKey="label"
                    angle={-24}
                    textAnchor="end"
                    interval={0}
                    height={64}
                    tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip formatter={(value: unknown) => formatValue(value, valueSuffix)} />
                <Bar dataKey="value" name="Valor" radius={[7, 7, 0, 0]}>
                    {data.map((item, index) => (
                        <Cell
                            key={`${item.label}:${index}`}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                        />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}

function AssistantLineGraph({
    data,
    valueSuffix,
}: {
    data: Array<{ label: string; value: number }>;
    valueSuffix?: string;
}) {
    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 38 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                    dataKey="label"
                    angle={-24}
                    textAnchor="end"
                    interval={0}
                    height={64}
                    tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip formatter={(value: unknown) => formatValue(value, valueSuffix)} />
                <Line
                    type="monotone"
                    dataKey="value"
                    name="Valor"
                    stroke="#ff3f45"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}

function formatValue(value: unknown, suffix?: string) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value ?? "");

    return `${new Intl.NumberFormat("pt-BR", {
        maximumFractionDigits: 2,
    }).format(numeric)}${suffix ?? ""}`;
}
