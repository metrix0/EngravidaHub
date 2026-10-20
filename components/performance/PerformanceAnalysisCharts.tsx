"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "@/components/ui/Card";
import type { PerformanceAttendant } from "@/lib/performance/report";

const monthLabel = (month: string) => new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(month + "-01T12:00:00Z")).replace(".", "");
const colors = { resolved: "#0fbb73", goal: "#1683ff", partial: "#e29229", unresolved: "#ef4444" };

function chartData(person: PerformanceAttendant) {
    return person.monthly.map(month => ({
        month: monthLabel(month.month),
        resolutionRate: month.eligibleResolution ? Math.round(1000 * month.resolved / month.eligibleResolution) / 10 : null,
        goalRate: month.goalEligible ? Math.round(1000 * month.goalAchieved / month.goalEligible) / 10 : null,
        resolved: month.resolved,
        partial: month.partial,
        unresolved: Math.max(0, month.eligibleResolution - month.resolved - month.partial),
    }));
}
function Legend({ items }: { items: { label: string; color: string }[] }) {
    return <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-500">{items.map(item =>
        <span key={item.label} className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span>
    )}</div>;
}

export function PerformanceResolutionEvolutionChart({ person }: { person: PerformanceAttendant }) {
    return <Card className="min-w-0">
        <h3 className="text-lg font-bold">Evolução da resolução IA</h3>
        <p className="mt-1 text-xs text-muted">Percentual de conversas resolvidas e objetivos atingidos, entre análises classificáveis.</p>
        <Legend items={[{ label: "Resolvidas", color: colors.resolved }, { label: "Objetivo atingido", color: colors.goal }]} />
        <div className="mt-5 h-72 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 288 }}>
            <LineChart data={chartData(person)} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11} />
                <YAxis domain={[0, 100]} unit="%" axisLine={false} tickLine={false} fontSize={11} />
                <Tooltip formatter={(value, name) => [Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%", name]} />
                <Line type="monotone" dataKey="resolutionRate" name="Resolvidas" stroke={colors.resolved} strokeWidth={2} connectNulls={false} />
                <Line type="monotone" dataKey="goalRate" name="Objetivo atingido" stroke={colors.goal} strokeWidth={2} connectNulls={false} />
            </LineChart>
        </ResponsiveContainer></div>
    </Card>;
}

export function PerformanceResolutionOutcomesChart({ person }: { person: PerformanceAttendant }) {
    return <Card className="min-w-0">
        <h3 className="text-lg font-bold">Desfecho das conversas</h3>
        <p className="mt-1 text-xs text-muted">Quantidade mensal de conversas classificadas pela IA em cada resultado.</p>
        <Legend items={[{ label: "Resolvidas", color: colors.resolved }, { label: "Parciais", color: colors.partial }, { label: "Não resolvidas", color: colors.unresolved }]} />
        <div className="mt-5 h-72 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 288 }}>
            <BarChart data={chartData(person)} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} fontSize={11} />
                <Tooltip formatter={value => Number(value).toLocaleString("pt-BR")} />
                <Bar dataKey="resolved" name="Resolvidas" stackId="result" fill={colors.resolved} />
                <Bar dataKey="partial" name="Parciais" stackId="result" fill={colors.partial} />
                <Bar dataKey="unresolved" name="Não resolvidas" stackId="result" fill={colors.unresolved} />
            </BarChart>
        </ResponsiveContainer></div>
    </Card>;
}
