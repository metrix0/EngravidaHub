"use client";

import { HelpCircle } from "lucide-react";
import {
    Cell,
    Funnel,
    FunnelChart,
    LabelList,
    ResponsiveContainer,
    Tooltip,
} from "recharts";

import { Card, InfoTooltip, PercentageBar } from "@/components";

type JourneyFunnelStage = {
    key: string;
    name: string;
    value: number;
    percentage: number | null;
    relative_percentage: number | null;
    fill: string;
};

type JourneyData = {
    journey_funnel: JourneyFunnelStage[];
    evaluation_journeys: {
        presencial: JourneyFunnelStage[];
        online: JourneyFunnelStage[];
    };
    dropoff_moments: Array<{
        moment: string;
        label: string;
        count: number;
        percentage: number | null;
    }>;
    objections: Array<{
        type: string;
        label: string;
        value: number;
        percentage: number | null;
    }>;
    audit?: { conversations_with_objections?: number } | null;
};

type Props = { widgetId: string; data: JourneyData };

export default function ExactJornadaSimpleDashboardGraphs({ widgetId, data }: Props) {
    if (widgetId === "jornada.funil_conversa") return <JourneyFunnelCard data={data} />;
    if (widgetId === "jornada.avaliacao_presencial") return <EvaluationJourneyFunnelCard title="1ª Avaliação presencial" stages={data.evaluation_journeys.presencial} />;
    if (widgetId === "jornada.avaliacao_online") return <EvaluationJourneyFunnelCard title="1ª Avaliação online" stages={data.evaluation_journeys.online} />;
    if (widgetId === "jornada.pontos_abandono") return <DropoffCard data={data} />;
    if (widgetId === "jornada.objecoes") return <ObjectionsCard data={data} />;
    return null;
}

function JourneyFunnelCard({ data }: { data: JourneyData }) {
    return (
        <Card>
            <div className="mb-5"><h2 className="text-lg font-bold">Jornada na Conversa</h2></div>
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(245px,0.65fr)] items-center gap-5">
                <div className="h-[330px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <FunnelChart margin={{ top: 10, right: 64, bottom: 10, left: 6 }}>
                            <Tooltip />
                            <Funnel dataKey="value" data={data.journey_funnel} isAnimationActive={false}>
                                <LabelList position="right" fill="#334155" stroke="none" dataKey="value" />
                                {data.journey_funnel.map((item) => <Cell key={item.key} fill={item.fill} />)}
                            </Funnel>
                        </FunnelChart>
                    </ResponsiveContainer>
                </div>
                <div className="space-y-4">
                    {data.journey_funnel.map((item) => (
                        <div key={item.key} className="flex items-center justify-between gap-1 border-b border-slate-100 pb-2 text-sm last:border-b-0">
                            <div className="flex min-w-0 items-center gap-3"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} /><span className="truncate font-medium text-slate-700" title={item.name}>{item.name}</span></div>
                            <div className="grid grid-cols-[48px_52px] items-center gap-1"><span className="text-right text-xs font-bold text-slate-500">{formatRate(item.relative_percentage)}</span><span className="text-right text-xs font-medium text-slate-500">({formatRate(item.percentage)})</span></div>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}

function EvaluationJourneyFunnelCard({ title, stages }: { title: string; stages: JourneyFunnelStage[] }) {
    const totalConversion = stages[stages.length - 1]?.percentage ?? null;

    return (
        <Card>
            <div className="mb-5"><h2 className="text-lg font-bold">{title}</h2></div>
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(245px,0.65fr)] items-center gap-5">
                <div className="h-[330px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <FunnelChart margin={{ top: 10, right: 64, bottom: 10, left: 6 }}>
                            <Tooltip />
                            <Funnel dataKey="value" data={stages} isAnimationActive={false}>
                                <LabelList position="right" fill="#334155" stroke="none" dataKey="value" />
                                {stages.map((item) => <Cell key={item.key} fill={item.fill} />)}
                            </Funnel>
                        </FunnelChart>
                    </ResponsiveContainer>
                </div>
                <div className="space-y-4">
                    {stages.map((item) => (
                        <div key={item.key} className="flex items-center justify-between gap-1 border-b border-slate-100 pb-2 text-sm last:border-b-0">
                            <div className="flex min-w-0 items-center gap-3"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} /><span className="truncate font-medium text-slate-700" title={item.name}>{item.name}</span></div>
                            <div className="grid grid-cols-[48px_52px] items-center gap-1"><span className="text-right text-xs font-bold text-slate-500">{formatRate(item.relative_percentage)}</span><span className="text-right text-xs font-medium text-slate-500">({formatRate(item.percentage)})</span></div>
                        </div>
                    ))}
                    <div className="pt-1 text-xs font-semibold text-slate-500">
                        Conversão total: <span className="font-bold text-slate-700">{formatRate(totalConversion)}</span>
                    </div>
                </div>
            </div>
        </Card>
    );
}

function DropoffCard({ data }: { data: JourneyData }) {
    return (
        <Card>
            <div className="mb-5"><div className="flex items-center gap-2"><h2 className="text-lg font-bold">Pontos de abandono</h2><InfoTooltip text="Base: abandonos observáveis"><HelpCircle size={16} className="text-slate-400" /></InfoTooltip></div></div>
            <div className="space-y-7">
                {data.dropoff_moments.map((item, index) => (
                    <div key={item.moment} className="flex items-center gap-3"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple text-xs font-bold text-white">{index + 1}</span><div className="w-full"><div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium text-slate-700">{item.label}</span><span className="font-bold text-slate-700">{formatRate(item.percentage)}</span></div><PercentageBar value={item.percentage ?? 0} color="purple" /></div></div>
                ))}
                {data.dropoff_moments.length === 0 ? <EmptyCardMessage message="Nenhum abandono com evidência no período." /> : null}
            </div>
        </Card>
    );
}

function ObjectionsCard({ data }: { data: JourneyData }) {
    return (
        <Card>
            <div className="mb-5"><div className="flex items-center gap-2"><h2 className="text-lg font-bold">Principais objeções</h2><InfoTooltip text={`Base: ${data.audit?.conversations_with_objections ?? 0} conversas com objeções observáveis`}><HelpCircle size={16} className="text-slate-400" /></InfoTooltip></div></div>
            <div className="space-y-4">
                {data.objections.map((item, index) => (
                    <div key={item.type} className="flex items-center gap-3"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple text-xs font-bold text-white">{index + 1}</span><div className="w-full"><div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium text-slate-700">{item.label}</span><span className="font-bold text-slate-700">{formatRate(item.percentage)}</span></div><PercentageBar value={item.percentage ?? 0} color="purple" /></div></div>
                ))}
                {data.objections.length === 0 ? <EmptyCardMessage message="Nenhuma objeção com evidência no período." /> : null}
            </div>
        </Card>
    );
}

function EmptyCardMessage({ message }: { message: string }) { return <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">{message}</div>; }
function formatRate(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${value}%`; }
