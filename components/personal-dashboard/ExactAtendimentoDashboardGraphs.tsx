"use client";

import { HelpCircle } from "lucide-react";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    Pie,
    PieChart,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
    ZAxis,
} from "recharts";

import { Card, InfoTooltip, PercentageBar } from "@/components";
import type { ExecutiveDashboardData } from "@/types";

type Props = {
    widgetId: string;
    data: ExecutiveDashboardData;
};

export default function ExactAtendimentoDashboardGraphs({ widgetId, data }: Props) {
    switch (widgetId) {
        case "atendimento.evolucao_conversas":
            return <DailyEvolutionCard data={data} />;
        case "atendimento.objetivo_conversas":
            return <ConversationGoalsCard data={data} />;
        case "atendimento.momentos_perda":
            return <DropoffCard data={data} />;
        case "atendimento.mapa_palavras":
            return <WordMapCard data={data} />;
        case "atendimento.agendamentos_periodo":
            return <ScheduleEvolutionCard data={data} />;
        case "atendimento.marcacoes_dia":
            return <ScheduleCreationEvolutionCard data={data} />;
        case "atendimento.eficiencia_unidades":
            return <UnitEfficiencyMapCard data={data} />;
        default:
            return null;
    }
}

function DailyEvolutionCard({ data }: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <h2 className="text-lg font-bold">Evolução de conversas</h2>
                <div className="mt-3 flex items-center gap-6 text-xs text-slate-500">
                    <LegendDot color="bg-blue-500" label="Conversas" />
                    <LegendDot color="bg-emerald-500" label="Resolução (%)" />
                    <LegendDot color="bg-violet-500" label="Satisfação (%)" />
                </div>
            </div>
            <div className="h-[290px]">
                <ResponsiveContainer width="100%" height="100%" debounce={200}>
                    <AreaChart data={data.daily_evolution}>
                        <defs>
                            <linearGradient id="personalConversationFillExact" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#1683ff" stopOpacity={0.22} />
                                <stop offset="95%" stopColor="#1683ff" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <YAxis yAxisId="conversations" tick={{ fontSize: 12 }} stroke="#94a3b8" allowDecimals={false} />
                        <YAxis
                            yAxisId="percentage"
                            hide
                            orientation="right"
                            domain={[0, 100]}
                            ticks={[0, 25, 50, 75, 100]}
                            tick={{ fontSize: 12 }}
                            tickFormatter={(value: number) => `${value}%`}
                            stroke="#94a3b8"
                            width={44}
                        />
                        <Tooltip content={<DailyEvolutionTooltip />} />
                        <Area
                            type="monotone"
                            dataKey="conversations"
                            yAxisId="conversations"
                            stroke="#1683ff"
                            strokeWidth={3}
                            fill="url(#personalConversationFillExact)"
                        />
                        <Line type="monotone" dataKey="resolution_rate" yAxisId="percentage" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="satisfaction_rate" yAxisId="percentage" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4 }} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function ConversationGoalsCard({ data }: { data: ExecutiveDashboardData }) {
    const colors = ["#8b5cf6", "#1683ff", "#10b981", "#f97316", "#06b6d4"];
    return (
        <Card>
            <div className="mb-4 flex items-center gap-2">
                <h2 className="text-lg font-bold">Objetivo das conversas</h2>
                <InfoTooltip text="Participação de cada objetivo no total de conversas analisadas do período.">
                    <HelpCircle size={16} className="text-slate-400" />
                </InfoTooltip>
            </div>
            <div className="grid grid-cols-[180px_1fr] items-center gap-4">
                <div className="relative h-48">
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <PieChart>
                            <Pie data={data.conversation_goals} dataKey="percentage" nameKey="label" innerRadius={52} outerRadius={82}>
                                {data.conversation_goals.map((_, index) => (
                                    <Cell key={index} fill={colors[index % colors.length]} />
                                ))}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <div className="text-xl font-bold">{data.kpis.conversations_analyzed.toLocaleString("pt-BR")}</div>
                        <div className="text-xs text-slate-500">conversas</div>
                    </div>
                </div>
                <div className="space-y-3">
                    {data.conversation_goals.map((item, index) => (
                        <div key={item.goal} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                                <span className="text-slate-600">{item.label}</span>
                            </div>
                            <span className="font-medium text-slate-600">{item.percentage === null ? "—" : `${item.percentage}%`}</span>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}

function DropoffCard({ data }: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Momentos de perda mais comuns</h2>
                    <InfoTooltip text="Somente abandonos com evidência de mensagem. A porcentagem usa como base apenas os abandonos observáveis do período.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
            </div>
            <div className="space-y-7">
                {data.dropoff_moments.map((item, index) => (
                    <div key={item.moment} className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-xs font-bold text-white">{index + 1}</span>
                        <div className="w-full">
                            <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">{item.label}</span>
                                <span className="font-bold text-slate-700">{item.percentage === null ? "—" : `${item.percentage}%`}</span>
                            </div>
                            <PercentageBar value={item.percentage ?? 0} color="purple" />
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}

function WordMapCard({ data }: { data: ExecutiveDashboardData }) {
    const words = data.word_map?.words ?? [];
    const maximum = Math.max(1, ...words.map((word) => word.mentions));
    const minimum = Math.min(maximum, ...words.map((word) => word.mentions));
    const palette = ["#0866ff", "#1683ff", "#8b5cf6", "#0f9f94", "#d97706"];
    return (
        <Card>
            <h2 className="text-lg font-bold">Mapa de palavras</h2>
            {words.length === 0 ? (
                <div className="flex h-[300px] items-center justify-center text-sm text-slate-400">Nenhuma palavra disponível neste período.</div>
            ) : (
                <div className="flex min-h-[300px] flex-wrap content-center items-center justify-center gap-x-4 gap-y-3 px-3 py-6 text-center">
                    {words.map((word, index) => {
                        const scale = maximum === minimum ? 0.5 : (word.mentions - minimum) / (maximum - minimum);
                        return (
                            <span
                                key={word.word}
                                className="cursor-default font-bold leading-none"
                                style={{
                                    color: palette[index % palette.length],
                                    fontSize: `${14 + scale * 24}px`,
                                    opacity: 0.68 + scale * 0.32,
                                }}
                                title={`${word.mentions.toLocaleString("pt-BR")} citações em ${word.conversations.toLocaleString("pt-BR")} conversas`}
                            >
                                {word.word}
                            </span>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

function ScheduleEvolutionCard({ data }: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <h2 className="text-lg font-bold">Agendamentos no período</h2>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                    <LegendDot color="bg-blue-500" label="Agendamentos únicos" />
                    <LegendDot color="bg-rose-500" label="Cancelados" />
                    <LegendDot color="bg-amber-500" label="Reagendados" />
                </div>
            </div>
            <div className="h-[290px]">
                <ResponsiveContainer width="100%" height="100%" debounce={200}>
                    <BarChart data={data.schedule_evolution} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barCategoryGap="24%">
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" minTickGap={24} />
                        <YAxis
                            tick={{ fontSize: 12 }}
                            stroke="#94a3b8"
                            allowDecimals={false}
                            domain={[0, (maximum: number) => Math.max(1, Math.ceil(maximum * 1.18))]}
                        />
                        <Tooltip content={<ScheduleEvolutionTooltip />} cursor={{ fill: "#f8fafc" }} />
                        <Bar dataKey="unique_total" fill="#1683ff" shape={<ScheduleOverlayBar />} isAnimationActive={false} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function ScheduleCreationEvolutionCard({ data }: { data: ExecutiveDashboardData }) {
    return (
        <Card>
            <div className="mb-5">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Marcações por dia</h2>
                    <InfoTooltip text="Mostra quantos agendamentos foram criados no CliniSys em cada dia do período, independentemente da data marcada para a consulta.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
                <div className="mt-3 flex items-center gap-6 text-xs text-slate-500">
                    <LegendDot color="bg-cyan-500" label="Marcações realizadas" />
                </div>
            </div>
            <div className="h-[290px]">
                <ResponsiveContainer width="100%" height="100%" debounce={200}>
                    <BarChart data={data.schedule_creation_evolution} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barCategoryGap="24%">
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" minTickGap={24} />
                        <YAxis
                            tick={{ fontSize: 12 }}
                            stroke="#94a3b8"
                            allowDecimals={false}
                            domain={[0, (maximum: number) => Math.max(1, Math.ceil(maximum * 1.18))]}
                        />
                        <Tooltip content={<ScheduleCreationEvolutionTooltip />} cursor={{ fill: "#f8fafc" }} />
                        <Bar dataKey="total" fill="#06b6d4" shape={<ScheduleCreationBar />} isAnimationActive={false} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}

function UnitEfficiencyMapCard({ data }: { data: ExecutiveDashboardData }) {
    const rows = data.by_unit.flatMap((unit) => {
        const normalizedUnitName = normalizeUnitName(unit.unit_name);
        if (normalizedUnitName === "campinas" || normalizedUnitName === "sem unidade") return [];
        if (unit.raw_conversations <= 0 || unit.resolution_rate === null) return [];
        return [{
            unit: unit.unit_name,
            resolution_rate: unit.resolution_rate,
            real_schedule_rate: Number(((unit.unique_appointments_count / unit.raw_conversations) * 100).toFixed(1)),
            conversations: unit.raw_conversations,
            appointments: unit.unique_appointments_count,
            no_show_rate: unit.no_show_rate,
            fill: unitEfficiencyColor(unit.no_show_rate),
        }];
    });
    const averageResolution = average(rows.map((row) => row.resolution_rate));
    const averageScheduling = average(rows.map((row) => row.real_schedule_rate));
    const minimumResolution = Math.min(25, ...rows.map((row) => row.resolution_rate));
    const maximumResolution = Math.max(75, ...rows.map((row) => row.resolution_rate));
    const resolutionDomain: [number, number] = [
        minimumResolution < 25 ? Math.max(0, Math.floor((minimumResolution - 5) / 5) * 5) : 25,
        maximumResolution > 75 ? Math.min(100, Math.ceil((maximumResolution + 5) / 5) * 5) : 75,
    ];
    const maximumScheduling = Math.max(10, ...rows.map((row) => row.real_schedule_rate));

    return (
        <Card>
            <div className="mb-4">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Mapa de eficiência das unidades</h2>
                    <InfoTooltip text="Cruza a resolução com clientes únicos agendados no CliniSys divididos por todas as conversas da unidade no período. Reagendamentos e registros repetidos do mesmo paciente não inflam a taxa. O tamanho representa o volume total de conversas e a cor representa o no-show.">
                        <HelpCircle size={16} className="text-slate-400" />
                    </InfoTooltip>
                </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                <LegendDot color="bg-emerald-500" label="No-show ≤ 5%" />
                <LegendDot color="bg-amber-500" label="No-show 5–10%" />
                <LegendDot color="bg-rose-500" label="No-show > 10%" />
                <span>Bolha maior = mais conversas</span>
            </div>
            {rows.length === 0 ? (
                <div className="flex h-[280px] items-center justify-center text-sm text-slate-400">Sem base suficiente por unidade neste período.</div>
            ) : (
                <div className="h-[390px]">
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <ScatterChart margin={{ top: 20, right: 24, bottom: 28, left: 8 }}>
                            <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                            <XAxis
                                type="number"
                                dataKey="resolution_rate"
                                name="Resolução"
                                unit="%"
                                domain={resolutionDomain}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                                label={{ value: "Resolução real (%)", position: "insideBottom", offset: -16, fontSize: 12, fill: "#64748b" }}
                            />
                            <YAxis
                                type="number"
                                dataKey="real_schedule_rate"
                                name="Agendamento real"
                                unit="%"
                                domain={[0, Math.ceil(maximumScheduling * 1.15)]}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                                label={{ value: "Agendamentos por conversa (%)", angle: -90, position: "insideLeft", dy: 44, fontSize: 12, fill: "#64748b" }}
                            />
                            <ZAxis type="number" dataKey="conversations" range={[90, 650]} />
                            <ReferenceLine x={averageResolution} stroke="#94a3b8" strokeDasharray="5 5" />
                            <ReferenceLine y={averageScheduling} stroke="#94a3b8" strokeDasharray="5 5" />
                            <Tooltip cursor={{ strokeDasharray: "4 4" }} content={<UnitEfficiencyTooltip />} />
                            <Scatter data={rows} shape={<UnitEfficiencyBubble />} isAnimationActive={false} />
                        </ScatterChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

type ChartTooltipPayloadItem = {
    dataKey: string;
    value: string | number | null;
    color?: string;
    payload?: Record<string, unknown>;
};

function DailyEvolutionTooltip({ active, payload, label }: { active?: boolean; payload?: ChartTooltipPayloadItem[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const labels: Record<string, string> = { conversations: "Conversas", resolution_rate: "Resolução", satisfaction_rate: "Satisfação" };
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="mb-3 text-sm font-semibold text-slate-800">{label}</div>
            <div className="mt-2 space-y-2 text-sm">
                {payload.map((item) => (
                    <div key={item.dataKey} className="flex items-center justify-between gap-6">
                        <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                            <span style={{ color: item.color }}>{labels[item.dataKey] ?? item.dataKey}</span>
                        </div>
                        <span className="font-semibold" style={{ color: item.color }}>
                            {item.value === null ? "—" : item.value}{item.value !== null && item.dataKey.includes("rate") ? "%" : ""}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ScheduleEvolutionTooltip({ active, payload, label }: { active?: boolean; payload?: ChartTooltipPayloadItem[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload ?? {};
    const total = typeof row.unique_total === "number" ? row.unique_total : 0;
    const cancelled = typeof row.unique_cancelled === "number" ? row.unique_cancelled : 0;
    const rescheduled = typeof row.unique_rescheduled === "number" ? row.unique_rescheduled : 0;
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="mb-3 text-sm font-semibold text-slate-800">{label}</div>
            <div className="space-y-2 text-sm">
                <TooltipRow dot="bg-blue-500" label="Agendamentos únicos" value={total} />
                <TooltipRow dot="bg-rose-500" label="Cancelados" value={cancelled} />
                <TooltipRow dot="bg-amber-500" label="Reagendados" value={rescheduled} />
            </div>
        </div>
    );
}

function TooltipRow({ dot, label, value }: { dot: string; label: string; value: number }) {
    return (
        <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${dot}`} /><span className="text-slate-600">{label}</span></div>
            <span className="font-semibold text-slate-800">{value.toLocaleString("pt-BR")}</span>
        </div>
    );
}

function ScheduleCreationEvolutionTooltip({ active, payload, label }: { active?: boolean; payload?: ChartTooltipPayloadItem[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const total = Number(payload[0]?.value ?? 0);
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="mb-3 text-sm font-semibold text-slate-800">{label}</div>
            <TooltipRow dot="bg-cyan-500" label="Marcações realizadas" value={total} />
        </div>
    );
}

type ScheduleCreationBarProps = { x?: number; y?: number; width?: number; height?: number; payload?: { total?: number } };
function ScheduleCreationBar({ x = 0, y = 0, width = 0, height = 0, payload }: ScheduleCreationBarProps) {
    const total = Math.max(Number(payload?.total ?? 0), 0);
    return (
        <g>
            <rect x={x} y={y} width={width} height={height} rx={6} fill="#06b6d4" />
            <text x={x + width / 2} y={y - 7} textAnchor="middle" fill="#334155" fontSize={11} fontWeight={700}>{total.toLocaleString("pt-BR")}</text>
        </g>
    );
}

type ScheduleOverlayBarProps = {
    x?: number; y?: number; width?: number; height?: number;
    payload?: { unique_total?: number; unique_cancelled?: number; unique_rescheduled?: number };
};
function ScheduleOverlayBar({ x = 0, y = 0, width = 0, height = 0, payload }: ScheduleOverlayBarProps) {
    const total = Math.max(Number(payload?.unique_total ?? 0), 0);
    const cancelled = Math.min(Math.max(Number(payload?.unique_cancelled ?? 0), 0), total);
    const rescheduled = Math.min(Math.max(Number(payload?.unique_rescheduled ?? 0), 0), total);
    const cancelledHeight = total > 0 ? (height * cancelled) / total : 0;
    const rescheduledHeight = total > 0 ? (height * rescheduled) / total : 0;
    const cancelledWidth = Math.max(8, Math.min(width * 0.5, 18));
    const rescheduledWidth = Math.max(6, Math.min(width * 0.3, 11));
    return (
        <g>
            <rect x={x} y={y} width={width} height={height} rx={6} fill="#1683ff" />
            {cancelled > 0 ? <rect x={x + (width - cancelledWidth) / 2} y={y + height - cancelledHeight} width={cancelledWidth} height={cancelledHeight} rx={Math.min(4, cancelledWidth / 2)} fill="#f43f5e" /> : null}
            {rescheduled > 0 ? <rect x={x + width - rescheduledWidth - 1} y={y + height - rescheduledHeight} width={rescheduledWidth} height={rescheduledHeight} rx={Math.min(3, rescheduledWidth / 2)} fill="#f59e0b" /> : null}
            <text x={x + width / 2} y={y - 7} textAnchor="middle" fill="#334155" fontSize={11} fontWeight={700}>{total.toLocaleString("pt-BR")}</text>
        </g>
    );
}

type UnitEfficiencyBubbleProps = { cx?: number; cy?: number; size?: number; payload?: { unit?: string; fill?: string } };
function UnitEfficiencyBubble({ cx = 0, cy = 0, size = 90, payload }: UnitEfficiencyBubbleProps) {
    const radius = Math.max(7, Math.sqrt(Math.max(size, 1) / Math.PI));
    const label = unitAbbreviation(payload?.unit ?? "");
    const color = payload?.fill ?? "#94a3b8";
    return (
        <g>
            <circle cx={cx} cy={cy} r={radius} fill={color} fillOpacity={0.82} stroke={color} strokeWidth={1.5} />
            <text x={cx} y={cy - radius - 6} textAnchor="middle" fill="#334155" fontSize={10} fontWeight={800} style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 }}>{label}</text>
        </g>
    );
}

function UnitEfficiencyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: { unit?: string; resolution_rate?: number; real_schedule_rate?: number; conversations?: number; appointments?: number; no_show_rate?: number | null } }> }) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs shadow-lg">
            <div className="mb-2 text-sm font-bold text-slate-800">{row.unit}</div>
            <div className="space-y-1 text-slate-600">
                <div>Resolução: {formatPercent(row.resolution_rate)}</div>
                <div>Agendamentos por conversa: {formatPercent(row.real_schedule_rate)}</div>
                <div>{Number(row.appointments ?? 0).toLocaleString("pt-BR")} agendamentos · {Number(row.conversations ?? 0).toLocaleString("pt-BR")} conversas</div>
                <div>No-show: {formatPercent(row.no_show_rate)}</div>
            </div>
        </div>
    );
}

function unitAbbreviation(unitName: string) {
    const normalized = normalizeUnitName(unitName);
    const abbreviations: Record<string, string> = {
        "sao paulo": "SP", "rio de janeiro": "RJ", salvador: "SA", brasilia: "BR",
        "juiz de fora": "JF", "belo horizonte": "BH", manaus: "MA", vitoria: "VI", bauru: "BA",
    };
    return abbreviations[normalized] ?? normalized.split(/\s+/).filter((part) => part.length > 2).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("pt-BR")).join("").slice(0, 2);
}

function normalizeUnitName(unitName: string) {
    return unitName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}
function unitEfficiencyColor(noShowRate: number | null) {
    if (noShowRate === null) return "#94a3b8";
    if (noShowRate <= 5) return "#10b981";
    if (noShowRate <= 10) return "#f59e0b";
    return "#f43f5e";
}
function average(values: number[]) { return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length; }
function formatPercent(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`; }
function LegendDot({ color, label }: { color: string; label: string }) { return <div className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${color}`} /><span>{label}</span></div>; }
