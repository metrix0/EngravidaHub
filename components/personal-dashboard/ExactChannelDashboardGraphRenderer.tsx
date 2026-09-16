"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import Card from "@/components/ui/Card";
import InfoTooltip from "@/components/ui/InfoTooltip";
import Skeleton from "@/components/ui/Skeleton";
import InstagramConversationInsights from "@/components/dashboard/InstagramConversationInsights";
import MessengerConversationInsights from "@/components/dashboard/MessengerConversationInsights";
import InstagramAdAttributionInsights from "@/components/dashboard/InstagramAdAttributionInsights";
import {
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";

type Props = {
    widgetId: string;
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
    unitNames: string[];
};

const INSTAGRAM_TITLES: Record<string, string> = {
    "instagram.evolucao_diaria": "Evolução diária do Instagram",
    "instagram.pontos_abandono": "Pontos de abandono",
    "instagram.motivos_abandono": "Motivos prováveis de abandono",
    "instagram.estado_final": "Estado final do cliente",
    "instagram.resultado_resolucao": "Resultado da resolução",
    "instagram.status_objetivo": "Status do objetivo",
    "instagram.intencao_inicial": "Intenção inicial",
    "instagram.objetivo_conversa": "Objetivo da conversa",
    "instagram.sentimento_cliente": "Sentimento do cliente",
    "instagram.dimensoes_qualidade": "Dimensões da qualidade",
    "instagram.objecoes": "Objeções identificadas",
};

const ATTRIBUTION_TITLES: Record<string, string> = {
    "instagram.origem_paga": "Origem paga dos clientes",
    "instagram.clientes_campanha": "Clientes por campanha",
};

const SHARE_TITLES: Record<string, string> = {
    "jornada.participacao_instagram": "Participação do Instagram nas conversas",
    "jornada.participacao_messenger": "Participação do Messenger nas conversas",
};

type CallDashboardData = {
    total: number;
    good: number;
    neutral: number;
    bad: number;
    good_rate: number;
    neutral_rate: number;
    bad_rate: number;
    daily_evolution: Array<{
        date: string;
        date_iso: string;
        good: number;
        neutral: number;
        bad: number;
    }>;
};

const CALL_VOLUME = "#94a3b8";
const CALL_GOOD = "#0fbb73";
const CALL_NEUTRAL = "#1683ff";
const CALL_BAD = "#e43535";

export default function ExactChannelDashboardGraphRenderer({
    widgetId,
    period,
    selectedRange,
    unitNames,
}: Props) {
    if (widgetId === "ligacoes.evolucao") {
        return (
            <ExactCallEvolutionCard
                period={period}
                selectedRange={selectedRange}
                unitNames={unitNames}
            />
        );
    }

    if (widgetId === "messenger.evolucao_diaria") {
        return (
            <IsolatedSourceCard title="Evolução diária do Messenger">
                <MessengerConversationInsights
                    mode="analysis"
                    period={period}
                    selectedRange={selectedRange}
                />
            </IsolatedSourceCard>
        );
    }

    const instagramTitle = INSTAGRAM_TITLES[widgetId];
    if (instagramTitle) {
        return (
            <IsolatedSourceCard title={instagramTitle}>
                <InstagramConversationInsights
                    mode="analysis"
                    period={period}
                    selectedRange={selectedRange}
                />
            </IsolatedSourceCard>
        );
    }

    const attributionTitle = ATTRIBUTION_TITLES[widgetId];
    if (attributionTitle) {
        return (
            <IsolatedSourceCard title={attributionTitle}>
                <InstagramAdAttributionInsights
                    searchParams={buildSearchParams(period, selectedRange)}
                />
            </IsolatedSourceCard>
        );
    }

    if (widgetId === "jornada.participacao_instagram") {
        return (
            <IsolatedSourceCard title={SHARE_TITLES[widgetId]}>
                <InstagramConversationInsights
                    mode="share"
                    period={period}
                    selectedRange={selectedRange}
                />
            </IsolatedSourceCard>
        );
    }

    if (widgetId === "jornada.participacao_messenger") {
        return (
            <IsolatedSourceCard title={SHARE_TITLES[widgetId]}>
                <MessengerConversationInsights
                    mode="share"
                    period={period}
                    selectedRange={selectedRange}
                />
            </IsolatedSourceCard>
        );
    }

    return null;
}

function IsolatedSourceCard({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    const rootRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        let frame = 0;
        const isolate = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const heading = [...root.querySelectorAll<HTMLElement>("h1,h2,h3")].find(
                    (element) => element.textContent?.trim() === title,
                );
                const target = heading?.closest<HTMLElement>("[data-dashboard-card='true']");
                if (!target) return;

                let current: HTMLElement = target;
                while (current.parentElement && current.parentElement !== root) {
                    const parent = current.parentElement;
                    for (const sibling of [...parent.children]) {
                        if (sibling !== current && sibling instanceof HTMLElement) {
                            sibling.style.display = "none";
                        }
                    }
                    parent.style.display = "block";
                    parent.style.gridTemplateColumns = "none";
                    parent.style.gap = "0";
                    parent.style.margin = "0";
                    current = parent;
                }
            });
        };

        isolate();
        const observer = new MutationObserver(isolate);
        observer.observe(root, { childList: true, subtree: true });
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [title]);

    return <div ref={rootRef}>{children}</div>;
}

function buildSearchParams(
    period: CalendarPresetValue | null,
    selectedRange: DateRange,
) {
    const params = new URLSearchParams();
    applyCalendarDateParams({
        params,
        selectedRange,
        selectedPreset: period,
    });
    return params.toString();
}

function ExactCallEvolutionCard({
    period,
    selectedRange,
    unitNames,
}: {
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
    unitNames: string[];
}) {
    const [data, setData] = useState<CallDashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const query = useMemo(() => {
        const params = new URLSearchParams();
        applyCalendarDateParams({ params, selectedRange, selectedPreset: period });
        for (const unit of unitNames) params.append("unit", unit);
        return params.toString();
    }, [period, selectedRange.end, selectedRange.start, unitNames.join("|")]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        void fetch(`/api/dashboard/calls?${query}`, {
            cache: "no-store",
            signal: controller.signal,
        })
            .then(async (response) => {
                const json = (await response.json()) as CallDashboardData & { error?: string };
                if (!response.ok) throw new Error(json.error ?? "Falha ao carregar dados de ligações.");
                setData(json);
            })
            .catch((loadError) => {
                if (!controller.signal.aborted) {
                    setError(loadError instanceof Error ? loadError.message : "Falha ao carregar dados de ligações.");
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [query]);

    if (loading) return <Skeleton className="h-[370px] w-full rounded-2xl" />;
    if (error || !data) {
        return (
            <Card>
                <div className="py-10 text-center text-sm text-slate-500">{error ?? "Dados indisponíveis."}</div>
            </Card>
        );
    }

    const chartData = data.daily_evolution.map((item) => ({
        ...item,
        total: item.good + item.neutral + item.bad,
    }));

    return (
        <Card className="min-w-0 overflow-hidden">
            <div>
                <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">Evolução das ligações</h3>
                    <InfoTooltip
                        text={"Final bom, final neutro e final ruim seguem as classificações registradas nas ligações."}
                        portal
                        fitContent
                    >
                        <HelpCircle size={15} className="text-slate-400" />
                    </InfoTooltip>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                    Volume diário de ligações com uma linha para cada tipo de final.
                </p>
            </div>

            {data.total === 0 ? (
                <div className="mt-6 rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center text-sm text-slate-400">
                    Nenhuma ligação registrada no período.
                </div>
            ) : (
                <>
                    <div className="mt-5 h-[300px] min-w-0">
                        <ResponsiveContainer width="100%" height="100%" debounce={150}>
                            <ComposedChart
                                data={chartData}
                                margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                                barCategoryGap="24%"
                            >
                                <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" minTickGap={22} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                                <Tooltip content={<CallTooltip />} />
                                <Bar
                                    dataKey="total"
                                    name="Volume de ligações"
                                    fill={CALL_VOLUME}
                                    fillOpacity={0.22}
                                    stroke={CALL_VOLUME}
                                    radius={[5, 5, 0, 0]}
                                    maxBarSize={44}
                                    isAnimationActive={false}
                                />
                                <Line type="monotone" dataKey="good" name="Final bom" stroke={CALL_GOOD} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                                <Line type="monotone" dataKey="neutral" name="Final neutro" stroke={CALL_NEUTRAL} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                                <Line type="monotone" dataKey="bad" name="Final ruim" stroke={CALL_BAD} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-500">
                        <Legend color={CALL_VOLUME} label="Volume de ligações" />
                        <Legend color={CALL_GOOD} label="Final bom" />
                        <Legend color={CALL_NEUTRAL} label="Final neutro" />
                        <Legend color={CALL_BAD} label="Final ruim" />
                    </div>
                </>
            )}
        </Card>
    );
}

function CallTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ name?: string; value?: number }>;
    label?: string;
}) {
    if (!active || !payload?.length) return null;
    return (
        <div className="min-w-[180px] rounded-xl border border-border bg-white px-4 py-3 shadow-lg">
            <div className="mb-2 text-xs font-bold text-slate-800">{label ?? ""}</div>
            <div className="space-y-1.5">
                {payload.map((item) => (
                    <div key={item.name} className="flex items-center justify-between gap-5 text-xs">
                        <span className="text-slate-500">{item.name}</span>
                        <span className="font-semibold text-slate-800">{(item.value ?? 0).toLocaleString("pt-BR")}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function Legend({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span>{label}</span>
        </div>
    );
}
