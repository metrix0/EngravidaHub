"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
    ArrowRight,
    BadgeCheck,
    CalendarCheck2,
    CircleDollarSign,
    ChevronDown,
    MousePointerClick,
    ReceiptText,
    UserCheck,
} from "lucide-react";
import { FaGoogle, FaMeta, FaInstagram } from "react-icons/fa6";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, Skeleton } from "@/components";

type PipelineStageKey =
    | "paid_impressions"
    | "paid_clicks"
    | "tracked_whatsapp"
    | "scheduled"
    | "attended"
    | "procedure_scheduled"
    | "procedure_attended"
    | "invoiced"
    | "authorized";

type FullJourneyPipeline = {
    query_params?: string;
    additional_pipelines?: Array<{ key: string; pipeline: FullJourneyPipeline }>;
    instagram?: { clicks: number | null; chats: number; to_whatsapp: number; to_consultation: number; unlinked_chats: number };
    revenue_branches?: Array<{ kind: string; clients: number; amount: number }>;
    available: boolean;
    ads_available: boolean;
    ads_scope_global: boolean;
    filters_applied: boolean;
    currency_code: string;
    stages: Array<{
        key: PipelineStageKey;
        label: string;
        value: number;
        secondary_value: number | null;
        secondary_kind: "count" | "currency" | null;
        secondary_label: string | null;
        metric_available?: boolean;
    }>;
    transitions: Array<{
        key: string;
        label: string;
        rate: number | null;
        from_value: number;
        to_value: number;
        lost: number | null;
        estimated: boolean;
    }>;
    acquisition_branches: Array<{
        platform: "google_ads" | "meta_ads";
        label: string;
        impressions: number;
        clicks: number;
        click_through_rate: number | null;
        tracked_clients: number;
        click_to_tracked_rate: number | null;
    }>;
    procedure_branches: Array<{
        key: string;
        procedure_name: string;
        event_kind: string;
        scheduled_appointments: number;
        attended_appointments: number;
        schedule_to_attendance_rate: number | null;
        lost_appointments: number;
    }>;
    audit: {
        tracked_sources: Array<{
            platform: "google_ads" | "meta_ads";
            field: string;
            source: string;
            clients: number;
            percentage: number;
            scheduled_clients?: number;
            attended_clients?: number;
            schedule_rate?: number | null;
            attendance_rate?: number | null;
        }>;
        whatsapp_coverage: {
            total_conversations: number;
            tracked_conversations: number;
            identified_clients?: number;
            paid_clients?: number;
            tracking_rate: number | null;
            google_conversations: number;
            meta_conversations: number;
            other_conversations: number;
            untracked_conversations: number;
        };
        entry_clients_total?: number;
        cohort_start_date?: string;
        cohort_end_date?: string;
        matured_through: string;
        error: string | null;
    };
};

type JourneyData = { full_pipeline: FullJourneyPipeline };
type JourneyDashboardData = JourneyData;

const TRACKED_WHATSAPP_PLATFORM_STYLE = {
    google_ads: { label: "Google Ads", color: "#d97706" },
    meta_ads: { label: "Meta Ads", color: "#0866ff" },
} as const;

type TrackedWhatsappSourceEvidence = "TinTim" | "UTM" | "Origem" | "ID de clique";
type TrackedWhatsappChartSource = {
    platform: "google_ads" | "meta_ads";
    source: string;
    evidence: TrackedWhatsappSourceEvidence;
    clients: number;
    percentage: number;
    scheduled_clients: number;
    attended_clients: number;
    schedule_rate: number | null;
    attendance_rate: number | null;
    schedule_rate_label: string;
    key: string;
    label: string;
};


type Props = { widgetId: string; data: JourneyData };

const PIPELINE_STAGE_STYLE: Record<PipelineStageKey, { accent: string; soft: string; eyebrow: string }> = {
    paid_impressions: { accent: "#0866ff", soft: "#eaf2ff", eyebrow: "Aquisição" },
    paid_clicks: { accent: "#1683ff", soft: "#e5f1ff", eyebrow: "Aquisição" },
    tracked_whatsapp: { accent: "#0f9f94", soft: "#e6f8f6", eyebrow: "CRM" },
    scheduled: { accent: "#8b5cf6", soft: "#f1ebff", eyebrow: "Conversão" },
    attended: { accent: "#0f9f94", soft: "#e6f8f6", eyebrow: "Clínica" },
    procedure_scheduled: { accent: "#8b5cf6", soft: "#f1ebff", eyebrow: "Conversão" },
    procedure_attended: { accent: "#0f9f94", soft: "#e6f8f6", eyebrow: "Clínica" },
    invoiced: { accent: "#d98916", soft: "#fff3df", eyebrow: "Receita" },
    authorized: { accent: "#0f9f61", soft: "#e6f8ef", eyebrow: "Receita" },
};

const WHATSAPP_COVERAGE_STYLE = {
    meta_ads: { label: "Meta Ads", color: "#0866ff" },
    google_ads: { label: "Google Ads", color: "#d97706" },
    other: { label: "Outras origens", color: "#8b5cf6" },
    untracked: { label: "Não rastreadas", color: "#94a3b8" },
} as const;

const EMPTY_WHATSAPP_COVERAGE: FullJourneyPipeline["audit"]["whatsapp_coverage"] = {
    total_conversations: 0,
    tracked_conversations: 0,
    tracking_rate: null,
    google_conversations: 0,
    meta_conversations: 0,
    other_conversations: 0,
    untracked_conversations: 0,
};

export default function ExactJornadaDashboardGraphs({ widgetId, data }: Props) {
    if (widgetId === "jornada.cobertura_whatsapp") return <WhatsappCoverageCard pipeline={data.full_pipeline} />;
    if (widgetId === "jornada.fontes_whatsapp") return <TrackedWhatsappSourcesCard pipeline={data.full_pipeline} />;
    return null;
}

export function FullJourneyPipelineCard({ data, onSourceTooltipChange }: { data: JourneyDashboardData; onSourceTooltipChange?: (text: string) => void }) {
    const [attempt, setAttempt] = useState(0);
    const [loaded, setLoaded] = useState<{ key: string; pipeline: FullJourneyPipeline } | null>(null);
    const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
    const params = new URLSearchParams(data.full_pipeline.query_params);
    params.delete("summary_only");
    params.set("full_pipeline_only", "1");
    const query = data.full_pipeline.query_params === undefined ? null : params.toString();
    const requestKey = `${query}:${attempt}`;
    const loading = query !== null && loaded?.key !== requestKey && failure?.key !== requestKey;
    const pipeline = loaded?.key === requestKey
        ? { ...loaded.pipeline, audit: {
            ...loaded.pipeline.audit,
            whatsapp_coverage: data.full_pipeline.audit.whatsapp_coverage ?? loaded.pipeline.audit.whatsapp_coverage,
        } }
        : data.full_pipeline;
    const error = failure?.key === requestKey ? failure.message : pipeline.audit.error;

    useEffect(() => {
        if (query === null) return;
        const controller = new AbortController();
        let timedOut = false;
        const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
        onSourceTooltipChange?.("Carregando detalhes da jornada...");
        void (async () => {
            try {
                const response = await fetch(`/api/dashboard/jornada?${query}`, { signal: controller.signal });
                const json = await response.json();
                if (!response.ok || !json.full_pipeline || !Array.isArray(json.full_pipeline.stages) ||
                    !Array.isArray(json.full_pipeline.transitions) || !json.full_pipeline.audit || json.full_pipeline.audit.error) {
                    throw new Error(json.error ?? json.full_pipeline?.audit?.error ?? "Falha ao carregar a jornada completa.");
                }
                if (!controller.signal.aborted) {
                    setLoaded({ key: requestKey, pipeline: json.full_pipeline });
                    onSourceTooltipChange?.(buildPipelineSourceTooltip(json.full_pipeline));
                }
            } catch (error) {
                if (controller.signal.aborted && !timedOut) return;
                setFailure({ key: requestKey, message: timedOut ? "A consulta demorou mais que o esperado." : error instanceof Error ? error.message : "Falha ao carregar a jornada completa." });
            } finally { window.clearTimeout(timeout); }
        })();
        return () => { window.clearTimeout(timeout); controller.abort(); };
    }, [query, requestKey, onSourceTooltipChange]);
    const clinicalTransitions = (pipeline.transitions ?? []).filter(
        (transition) =>
            !transition.estimated &&
            transition.rate !== null,
    );
    const aggregateBottleneck = clinicalTransitions.reduce<
        FullJourneyPipeline["transitions"][number] | null
    >((current, transition) => {
        if (!current) return transition;
        return (transition.rate ?? Infinity) < (current.rate ?? Infinity)
            ? transition
            : current;
    }, null);
    const procedureBottleneck = (pipeline.procedure_branches ?? [])
        .filter(
            (branch) =>
                branch.scheduled_appointments > 0 &&
                branch.schedule_to_attendance_rate !== null,
        )
        .reduce<FullJourneyPipeline["procedure_branches"][number] | null>(
            (current, branch) => {
                if (!current) return branch;
                return (branch.schedule_to_attendance_rate ?? Infinity) <
                    (current.schedule_to_attendance_rate ?? Infinity)
                    ? branch
                    : current;
            },
            null,
        );
    const trackedWhatsappStage = pipeline.stages.find(
        (stage) => stage.key === "tracked_whatsapp",
    );
    const authorizedStage = pipeline.stages.find(
        (stage) => stage.key === "authorized",
    );
    const endToEndRate = calculateRate(
        authorizedStage?.value ?? 0,
        pipeline.audit.entry_clients_total ?? trackedWhatsappStage?.value ?? 0,
    );

    return (
        <div className="min-w-0 overflow-hidden">
            {error ? (
                <div className="border-b border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">
                    A jornada completa não pôde ser carregada: {error}
                    <button type="button" onClick={() => setAttempt(value => value + 1)} className="ml-2 cursor-pointer underline">Tentar novamente</button>
                </div>
            ) : null}

            {!loading && !error && !pipeline.ads_available ? (
                <div className="border-b border-amber-100 bg-amber-50 px-6 py-3 text-sm text-amber-800">
                    Sem dados de Meta ou Google Ads neste período. As etapas do WhatsApp em diante continuam válidas.
                </div>
            ) : null}

            {pipeline.filters_applied ? (
                <div className="border-b border-blue-100 bg-blue-50 px-6 py-3 text-xs text-blue-800">
                    A medição das plataformas permanece global; os filtros selecionados valem do WhatsApp rastreado em diante.
                </div>
            ) : null}

            <div className="py-2">
                {loading ? <div className="px-6"><Skeleton className="h-[440px] w-full" /></div> : error ? null : pipeline.stages.length === 0 ? (
                    <EmptyCardMessage message="Nenhum dado rastreável no período." />
                ) : (
                    <PipelineCanvas multipleFlows={Boolean(pipeline.additional_pipelines?.length)}>
                        <div className="space-y-3">
                            <JourneyPipelineTree pipeline={pipeline} />
                            <div className="flex flex-col gap-12" style={{ marginLeft: 572 + 72 }}>
                                {(pipeline.additional_pipelines ?? []).map(group => (
                                    <JourneyPipelineTree key={group.key} pipeline={group.pipeline} groupKey={group.key} />
                                ))}
                            </div>
                        </div>
                    </PipelineCanvas>
                )}

                {!loading && !error ? <div className="mx-6 mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 md:grid-cols-3">
                    <PipelineInsight
                        label="Maior gargalo clínico"
                        value={
                            procedureBottleneck
                                ? formatRate(
                                      procedureBottleneck.schedule_to_attendance_rate,
                                  )
                                : aggregateBottleneck
                                  ? formatRate(aggregateBottleneck.rate)
                                  : "—"
                        }
                        detail={
                            procedureBottleneck
                                ? procedureBottleneckDetail(
                                      procedureBottleneck,
                                  )
                                : aggregateBottleneck
                                  ? aggregateBottleneckDetail(
                                        aggregateBottleneck,
                                    )
                                  : "Sem base suficiente"
                        }
                    />
                    <PipelineInsight
                        label="Conversão ponta a ponta"
                        value={formatRate(endToEndRate)}
                        detail="Entradas do fluxo pago → liberado"
                    />
                    <PipelineInsight
                        label="Receita liberada"
                        value={formatPipelineCurrency(
                            authorizedStage?.secondary_value ?? 0,
                            pipeline.currency_code,
                        )}
                        detail={`Desfechos observados até ${formatPipelineDate(
                            pipeline.audit.matured_through,
                        )}`}
                    />
                </div> : null}
            </div>
        </div>
    );
}

export function WhatsappCoverageCard({
    pipeline,
}: {
    pipeline: FullJourneyPipeline;
}) {
    const coverage = pipeline.audit.whatsapp_coverage ?? EMPTY_WHATSAPP_COVERAGE;
    const chartData: WhatsappCoverageChartItem[] = [
        {
            key: "meta_ads",
            ...WHATSAPP_COVERAGE_STYLE.meta_ads,
            value: coverage.meta_conversations,
            percentage: calculateRate(coverage.meta_conversations, coverage.total_conversations),
        },
        {
            key: "google_ads",
            ...WHATSAPP_COVERAGE_STYLE.google_ads,
            value: coverage.google_conversations,
            percentage: calculateRate(coverage.google_conversations, coverage.total_conversations),
        },
        {
            key: "other",
            ...WHATSAPP_COVERAGE_STYLE.other,
            value: coverage.other_conversations,
            percentage: calculateRate(coverage.other_conversations, coverage.total_conversations),
        },
        {
            key: "untracked",
            ...WHATSAPP_COVERAGE_STYLE.untracked,
            value: coverage.untracked_conversations,
            percentage: calculateRate(coverage.untracked_conversations, coverage.total_conversations),
        },
    ];

    return (
        <Card className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <h2 className="text-lg font-bold">Cobertura das conversas no WhatsApp</h2>
                {coverage.total_conversations > 0 && (
                    <div className="flex items-baseline gap-2">
                        <span className="text-xs text-slate-500">Total de conversas</span>
                        <strong className="text-xl font-bold tabular-nums text-slate-900">
                            {coverage.total_conversations.toLocaleString("pt-BR")}
                        </strong>
                    </div>
                )}
            </div>

            {coverage.total_conversations === 0 ? (
                <div className="mt-4">
                    <EmptyCardMessage message="Nenhuma conversa no período." />
                </div>
            ) : (
                <>
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                        <div className="flex items-baseline gap-2">
                            <span className="text-slate-500">Rastreadas</span>
                            <strong className="tabular-nums text-slate-800">
                                {coverage.tracked_conversations.toLocaleString("pt-BR")}
                            </strong>
                            <span className="text-xs text-slate-500">{formatRate(coverage.tracking_rate)}</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-slate-500">Clientes únicos</span>
                            <strong className="tabular-nums text-slate-800">
                                {coverage.identified_clients === undefined
                                    ? "—"
                                    : coverage.identified_clients.toLocaleString("pt-BR")}
                            </strong>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-slate-500">Com origem paga</span>
                            <strong className="tabular-nums text-slate-800">
                                {coverage.paid_clients === undefined
                                    ? "—"
                                    : coverage.paid_clients.toLocaleString("pt-BR")}
                            </strong>
                        </div>
                    </div>

                    <div
                        className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100"
                        role="img"
                        aria-label={chartData.map(item =>
                            item.label + ": " + item.value.toLocaleString("pt-BR") +
                            " (" + formatRate(item.percentage) + ")"
                        ).join("; ")}
                    >
                        {chartData.filter(item => item.value > 0).map(item => (
                            <div
                                key={item.key}
                                className="h-full"
                                style={{
                                    width: String(item.percentage ?? 0) + "%",
                                    backgroundColor: item.color,
                                }}
                                title={item.label + ": " + item.value.toLocaleString("pt-BR") +
                                    " (" + formatRate(item.percentage) + ")"}
                            />
                        ))}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 lg:grid-cols-4">
                        {chartData.map(item => (
                            <div key={item.key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1 py-1">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span
                                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                                        style={{ backgroundColor: item.color }}
                                    />
                                    <span className="truncate text-xs font-medium text-slate-600" title={item.label}>
                                        {item.label}
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-sm font-semibold tabular-nums text-slate-800">
                                        {item.value.toLocaleString("pt-BR")}
                                    </span>
                                    <span className="text-xs tabular-nums text-slate-500">
                                        {formatRate(item.percentage)}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </Card>
    );
}

type WhatsappCoverageChartItem = { key: string; label: string; value: number; percentage: number | null; color: string };

const PIPELINE_TREE_ROW_HEIGHT = 182;
const PIPELINE_TREE_ROW_GAP = 16;
function PipelineCanvas({ children, multipleFlows = false }: { children: ReactNode; multipleFlows?: boolean }) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = useState<number | null>(null);
    useEffect(() => {
        const content = contentRef.current;
        if (!content) return;
        const measure = () => setContentHeight(Math.ceil(content.scrollHeight));
        const observer = new ResizeObserver(measure);
        observer.observe(content);
        measure();
        return () => observer.disconnect();
    }, []);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const offsetRef = useRef(offset);
    const dragRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
    } | null>(null);

    function updateOffset(next: { x: number; y: number }) {
        offsetRef.current = next;
        setOffset(next);
    }

    function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        if ((event.target as HTMLElement).closest("button, a, input, summary")) return;
        const viewport = viewportRef.current;
        if (!viewport) return;

        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: offsetRef.current.x,
            originY: offsetRef.current.y,
        };
        viewport.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;

        updateOffset({
            x: drag.originX + event.clientX - drag.startX,
            y: drag.originY + event.clientY - drag.startY,
        });
    }

    function stopDragging(event: ReactPointerEvent<HTMLDivElement>) {
        const viewport = viewportRef.current;
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;

        dragRef.current = null;
        if (viewport?.hasPointerCapture(event.pointerId)) {
            viewport.releasePointerCapture(event.pointerId);
        }
    }

    const gridSize = 28;

    return (
        <div
            ref={viewportRef}
            className="relative min-h-[480px] w-full cursor-move select-none overflow-hidden"
            style={{
                height: contentHeight === null ? (multipleFlows ? 1100 : 560) : Math.max(480, contentHeight + 8),
                backgroundImage:
                    "linear-gradient(rgba(148,163,184,0.075) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.075) 1px, transparent 1px)",
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${offset.x % gridSize}px ${offset.y % gridSize}px`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onDragStart={(event) => event.preventDefault()}
            title="Arraste com o botão esquerdo para mover a jornada"
        >
            <div
                ref={contentRef}
                className="absolute left-0 top-0 w-max pb-4"
                style={{
                    transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
                    willChange: "transform",
                }}
            >
                {children}
            </div>
        </div>
    );
}

function JourneyPipelineTree({
    pipeline,
    groupKey = "paid",
}: {
    pipeline: FullJourneyPipeline;
    groupKey?: string;
}) {
    const stages = new Map(
        pipeline.stages.map((stage) => [stage.key, stage]),
    );
    const tracked = stages.get("tracked_whatsapp");
    const scheduled = stages.get("scheduled");
    const attended = stages.get("attended");
    const procedureScheduled = stages.get("procedure_scheduled");
    const procedureAttended = stages.get("procedure_attended");
    const authorized = stages.get("authorized");
    const acquisitionBranches = pipeline.acquisition_branches ?? [];
    const procedureBranches = pipeline.procedure_branches ?? [];
    const whatsappToSchedule = pipeline.transitions.find(
        (transition) => transition.key === "whatsapp_to_schedule",
    );
    const acquisitionRowCount = Math.max(1, acquisitionBranches.length);
    const showInstagram = Boolean(pipeline.instagram);
    const topOffset = ((acquisitionRowCount - 1) * (PIPELINE_TREE_ROW_HEIGHT + PIPELINE_TREE_ROW_GAP)) / 2;
    const metaRowIndex = acquisitionBranches.findIndex(branch => branch.platform === "meta_ads");
    const instagramChatMiddleY = 8 + metaRowIndex * (PIPELINE_TREE_ROW_HEIGHT + PIPELINE_TREE_ROW_GAP)
        + PIPELINE_TREE_ROW_HEIGHT * 1.5;
    const whatsappBottomY = 8 + topOffset + PIPELINE_TREE_ROW_HEIGHT;
    const consultationBottomY = whatsappBottomY + 32;
    const instagramUnlinked = Boolean(pipeline.instagram && pipeline.instagram.chats > 0 &&
        pipeline.instagram.unlinked_chats >= pipeline.instagram.chats);

    if (
        !tracked ||
        !scheduled ||
        !attended ||
        !procedureScheduled ||
        !procedureAttended ||
        !authorized
    ) {
        return (
            <EmptyCardMessage message="A jornada clínica está incompleta neste período." />
        );
    }

    return (
            <div className="relative flex min-w-max items-start py-2">
                {acquisitionBranches.length > 0 ? <>
                <div className="space-y-4" style={{ width: 572, paddingBottom: showInstagram ? PIPELINE_TREE_ROW_HEIGHT : 0 }}>
                    {acquisitionBranches.map((branch) => (
                        <div
                            key={branch.platform}
                            className="relative flex items-stretch"
                        >
                            <PipelineStageCard
                                stage={clientPipelineStage(
                                    "paid_impressions",
                                    "Impressões pagas",
                                    branch.impressions,
                                )}
                                eyebrow={branch.label}
                            />
                            <PipelineTransitionCard
                                transition={clientPipelineTransition({
                                    key: branch.platform + "_ctr",
                                    label: "CTR pago",
                                    fromValue: branch.impressions,
                                    toValue: branch.clicks,
                                    rate: branch.click_through_rate,
                                })}
                            />
                            <div className="relative shrink-0">
                                <PipelineStageCard
                                    stage={clientPipelineStage(
                                        "paid_clicks",
                                        "Cliques pagos",
                                        branch.clicks,
                                    )}
                                    eyebrow={branch.label}
                                    detail="cliques elegíveis"
                                    linkedBottom={branch.platform === "meta_ads" && Boolean(pipeline.instagram)}
                                />
                                {branch.platform === "meta_ads" && pipeline.instagram ? (
                                    <div className="absolute left-0 top-[182px] flex items-center">
                                        <PipelineStageCard
                                            stage={{ ...clientPipelineStage("paid_clicks", "Cliques pagos", pipeline.instagram.clicks ?? 0), metric_available: pipeline.instagram.clicks !== null }}
                                            eyebrow="Meta Ads"
                                            linkedTop
                                            detail={pipeline.instagram.clicks === null
                                                ? "Instagram Direct · dados indisponíveis"
                                                : "Instagram Direct · já incluídos acima"}
                                        />
                                        <PipelineTransitionCard transition={{
                                            ...clientPipelineTransition({
                                                key: "instagram_clicks_to_chat",
                                                label: "Clique → Instagram",
                                                fromValue: pipeline.instagram.clicks ?? 0,
                                                toValue: pipeline.instagram.chats,
                                                rate: pipeline.instagram.clicks
                                                    ? calculateRate(pipeline.instagram.chats, pipeline.instagram.clicks)
                                                    : null,
                                            }),
                                            estimated: true,
                                        }} />
                                        <PipelineStageCard
                                            stage={clientPipelineStage("tracked_whatsapp", "Instagram Chat", pipeline.instagram.chats)}
                                            eyebrow="Instagram"
                                            detail={`${pipeline.instagram.unlinked_chats.toLocaleString("pt-BR")} sem vínculo confirmado com o CRM`}
                                        />
                                    </div>
                                ) : null}
                            </div>
                            <PipelineTransitionCard
                                transition={clientPipelineTransition({
                                    key: branch.platform + "_click_to_tracked",
                                    label: "Clique → WhatsApp",
                                    fromValue: branch.clicks,
                                    toValue: branch.tracked_clients,
                                    rate: branch.click_to_tracked_rate,
                                })}
                            />
                        </div>
                    ))}
                </div>

                <PipelineTreeConnector
                    direction="merge"
                    rowCount={acquisitionRowCount}
                />
                </> : null}

                <div style={{ marginTop: topOffset }}>
                    <PipelineStageCard stage={tracked} />
                </div>

                {whatsappToSchedule ? (
                    <div style={{ marginTop: topOffset }}>
                        <PipelineTransitionCard
                            transition={whatsappToSchedule}
                        />
                    </div>
                ) : null}

                <div className="relative" style={{ marginTop: topOffset }}>
                    <div className="flex items-start">
                        <ProcedurePipelineStages scheduled={scheduled} attended={attended} idPrefix={groupKey}
                            branches={procedureBranches.filter(branch => branch.event_kind === "evaluation")}
                            topOffset={0} branchOffset={12} />
                        <PipelineTransitionCard transition={pipeline.transitions.find(item => item.key === "consultation_to_procedure") ?? clientPipelineTransition({ key: "consultation_to_procedure", label: "Consulta → procedimento", fromValue: 0, toValue: 0, rate: null })} />
                        <ProcedurePipelineStages scheduled={procedureScheduled} attended={procedureAttended} idPrefix={groupKey}
                            branches={procedureBranches.filter(branch => branch.event_kind !== "evaluation")}
                            topOffset={0} branchOffset={12} />
                        <div className="flex h-[182px] w-[118px] shrink-0 flex-col items-center justify-center px-2 text-center">
                            <span className="text-xs font-bold text-emerald-700">{formatPipelineCurrency(pipeline.revenue_branches?.find(branch => branch.kind === "procedure")?.amount ?? 0, pipeline.currency_code)}</span>
                            <ArrowRight size={24} className="my-3 text-emerald-600" />
                        </div>
                        <PipelineStageCard stage={authorized} width={210} />
                    </div>
                    <svg aria-label="Receita liberada após a consulta" className="pointer-events-none absolute left-0 top-0 h-[182px] w-[1642px] overflow-visible" viewBox="0 0 1642 182">
                        <path d="M 478 0 V -35 H 1537 V 0" fill="none" stroke="#0f9f61" strokeWidth="1" />
                        <path d="m 1532 -7 5 7 5 -7" fill="none" stroke="#0f9f61" strokeWidth="1" />
                        <text x="1000" y="-43" textAnchor="middle" fill="#0f9f61" fontSize="12" fontWeight="600">
                            {formatPipelineCurrency(pipeline.revenue_branches?.find(branch => branch.kind === "evaluation")?.amount ?? 0, pipeline.currency_code)} · consultas
                        </text>
                    </svg>
                </div>

                {pipeline.instagram && metaRowIndex >= 0 ? (
                    <svg aria-label="Caminhos confirmados do Instagram"
                        className="pointer-events-none absolute left-0 top-0 h-[700px] w-[1200px] overflow-visible"
                        viewBox="0 0 1200 700">
                        <g>
                            <title>{instagramUnlinked
                                ? "Os chats de Instagram ainda não possuem vínculo confirmado com pacientes do CRM."
                                : "Clientes com Instagram vinculado ao WhatsApp"}</title>
                            <path d={`M 740 ${instagramChatMiddleY - 12} H 852 V ${whatsappBottomY + 22} H 728 V ${whatsappBottomY}`}
                                fill="none" stroke="#0f9f94" strokeWidth="1" />
                            <path d={`m 723 ${whatsappBottomY + 6} 5 -6 5 6`}
                                fill="none" stroke="#0f9f94" strokeWidth="1" />
                            <text x="863" y={instagramChatMiddleY - 27} fill="#0f9f94" fontSize="11" fontWeight="600">
                                {instagramUnlinked ? "WhatsApp: —" : `${pipeline.instagram.to_whatsapp.toLocaleString("pt-BR")} → WhatsApp`}
                            </text>
                        </g>
                        <g>
                            <title>{instagramUnlinked
                                ? "Sem identificação de pacientes nos chats de Instagram para confirmar agendamentos."
                                : "Clientes que agendaram consulta a partir de Instagram"}</title>
                            <path d={`M 740 ${instagramChatMiddleY + 12} H 1050 V ${consultationBottomY}`}
                                fill="none" stroke="#8b5cf6" strokeWidth="1" />
                            <path d={`m 1045 ${consultationBottomY + 6} 5 -6 5 6`}
                                fill="none" stroke="#8b5cf6" strokeWidth="1" />
                            <text x="930" y={instagramChatMiddleY + 32} fill="#8b5cf6" fontSize="11" fontWeight="600">
                                {instagramUnlinked ? "Consultas: —" : `${pipeline.instagram.to_consultation.toLocaleString("pt-BR")} consultas`}
                            </text>
                        </g>
                    </svg>
                ) : null}
            </div>
    );
}

function ProcedurePipelineStages({
    scheduled,
    attended,
    branches,
    topOffset,
    branchOffset = 16,
    idPrefix,
}: {
    scheduled: FullJourneyPipeline["stages"][number];
    attended: FullJourneyPipeline["stages"][number];
    branches: FullJourneyPipeline["procedure_branches"];
    topOffset: number;
    branchOffset?: number;
    idPrefix: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const detailsId = `journey-details-${idPrefix}-${scheduled.key}`;
    const aggregateTransition = clientPipelineTransition({
        key: "procedure_schedule_to_attendance",
        label: "Agenda → presença",
        fromValue: scheduled.value,
        toValue: attended.value,
        rate: calculateRate(attended.value, scheduled.value),
        lost: Math.max(0, scheduled.value - attended.value),
    });

    return (
        <div
            className="shrink-0"
            style={{ paddingTop: topOffset }}
        >
            <div className="flex items-start">
                <div className="w-[240px] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
                    <PipelineStageCard stage={scheduled} width={240} embedded
                        detail="clientes únicos vinculados ao WhatsApp rastreado" />
                    <button type="button" aria-expanded={expanded} aria-controls={detailsId}
                        onClick={() => setExpanded(value => !value)}
                        className="flex w-full cursor-pointer items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100">
                        <span>{scheduled.key === "scheduled" ? "Consultas" : "Procedimentos"} ({branches.length})</span>
                        <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                </div>
                <PipelineTransitionCard transition={aggregateTransition} />
                <div className="w-[240px] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
                    <PipelineStageCard stage={attended} width={240} embedded
                        detail="clientes únicos que compareceram" />
                    <button type="button" aria-expanded={expanded} aria-controls={detailsId}
                        onClick={() => setExpanded(value => !value)}
                        className="flex w-full cursor-pointer items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100">
                        <span>{scheduled.key === "scheduled" ? "Consultas" : "Procedimentos"} ({branches.length})</span>
                        <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                </div>
            </div>
            <div style={{ marginTop: branchOffset }}>
                {expanded ? <div id={detailsId}>
            {branches.length > 0 ? (
                <div className="space-y-2">
                    {branches.map((branch) => (
                        <div
                            key={branch.key}
                            className="flex items-stretch"
                        >
                            <ProcedureMetricRow
                                value={branch.scheduled_appointments}
                                procedureName={branch.procedure_name}
                                stageKey="scheduled"
                            />
                            <ProcedureTransitionRow branch={branch} />
                            <ProcedureMetricRow
                                value={branch.attended_appointments}
                                procedureName={branch.procedure_name}
                                stageKey="attended"
                            />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex h-[86px] w-[598px] items-center justify-center rounded-2xl border border-dashed border-slate-200 px-6 text-center text-sm text-slate-400">
                    Nenhum procedimento dessa coorte foi encontrado no CliniSys.
                </div>
            )}
                </div> : null}
            </div>
        </div>
    );
}

function ProcedureMetricRow({
    value,
    procedureName,
    stageKey,
}: {
    value: number;
    procedureName: string;
    stageKey: "scheduled" | "attended";
}) {
    const style = PIPELINE_STAGE_STYLE[stageKey];

    return (
        <div
            className="flex h-[78px] w-[240px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-[0_5px_18px_rgba(15,23,42,0.04)]"
            title={`${value.toLocaleString("pt-BR")} — ${procedureName}`}
        >
            <span
                className="min-w-[58px] text-right text-xl font-black"
                style={{ color: style.accent }}
            >
                {value.toLocaleString("pt-BR")}
            </span>
            <span className="line-clamp-3 text-[11px] font-semibold leading-4 text-slate-600">
                {procedureName}
            </span>
        </div>
    );
}
function ProcedureTransitionRow({
    branch,
}: {
    branch: FullJourneyPipeline["procedure_branches"][number];
}) {
    return (
        <div className="flex h-[78px] w-[118px] shrink-0 flex-col items-center justify-center px-2 text-center">
            <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${
                    branch.schedule_to_attendance_rate === null
                        ? "border-slate-200 bg-slate-50 text-slate-400"
                        : "border-blue-100 bg-blue-50 text-blue-700"
                }`}
            >
                {formatRate(branch.schedule_to_attendance_rate)}
            </span>
            <div className="my-1.5 -mx-2 w-[calc(100%+16px)]">
                <PipelineArrowLine />
            </div>
            <span className="h-3 text-[9px] text-slate-400">
                {branch.lost_appointments > 0
                    ? `−${branch.lost_appointments}`
                    : ""}
            </span>
        </div>
    );
}

function PipelineTreeConnector({
    direction,
    rowCount,
}: {
    direction: "merge" | "split";
    rowCount: number;
}) {
    const height = rowCount * PIPELINE_TREE_ROW_HEIGHT + (rowCount - 1) * PIPELINE_TREE_ROW_GAP;
    const firstCenter = PIPELINE_TREE_ROW_HEIGHT / 2;
    const lastCenter = height - firstCenter;
    const midpoint = height / 2;
    const junctionX = direction === "merge" ? 48 : 24;
    return (
        <svg width={72} height={height} viewBox={`0 0 72 ${height}`}
            className="shrink-0 overflow-visible" aria-hidden="true">
            <path d={`M ${junctionX} ${firstCenter} V ${lastCenter}`}
                fill="none" stroke="#93c5fd" strokeWidth="1" />
            {Array.from({ length: rowCount }).map((_, index) => {
                const center = index * (PIPELINE_TREE_ROW_HEIGHT + PIPELINE_TREE_ROW_GAP) + firstCenter;
                return <path key={index}
                    d={direction === "merge" ? `M 0 ${center} H ${junctionX}` : `M ${junctionX} ${center} H 72`}
                    fill="none" stroke="#93c5fd" strokeWidth="1" />;
            })}
            <path d={direction === "merge" ? `M ${junctionX} ${midpoint} H 72` : `M 0 ${midpoint} H ${junctionX}`}
                fill="none" stroke="#93c5fd" strokeWidth="1" />
        </svg>
    );
}

function PipelineStageCard({
    stage,
    eyebrow,
    detail,
    width = 168,
    compact = false,
    embedded = false,
    linkedTop = false,
    linkedBottom = false,
}: {
    stage: FullJourneyPipeline["stages"][number];
    eyebrow?: string;
    detail?: string;
    width?: number;
    compact?: boolean;
    embedded?: boolean;
    linkedTop?: boolean;
    linkedBottom?: boolean;
}) {
    const defaultStyle = PIPELINE_STAGE_STYLE[stage.key];
    const style =
        eyebrow === "Google Ads" &&
        (stage.key === "paid_impressions" || stage.key === "paid_clicks")
            ? {
                  accent: "#d97706",
                  soft: "#fffbeb",
                  eyebrow: defaultStyle.eyebrow,
              }
            : eyebrow === "Instagram"
                ? { accent: "#ec4899", soft: "#fdf2f8", eyebrow: "Instagram" }
                : defaultStyle;

    return (
        <div
            className={`relative flex shrink-0 flex-col overflow-hidden bg-white ${embedded ? "" : "rounded-2xl border border-slate-200 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"} ${linkedTop ? "rounded-t-none border-t-0" : ""} ${linkedBottom ? "rounded-b-none" : ""} ${compact ? "h-[160px] p-3" : "h-[182px] p-3"}`}
            style={{ width }}
            title={`${stage.label}: ${stage.value.toLocaleString("pt-BR")}${detail ? ` — ${detail}` : ""}`}
        >
            <span
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: style.accent }}
            />
            <div className="flex items-start justify-between gap-3">
                <span
                    className="flex h-9 w-9 items-center justify-center rounded-xl"
                    style={{ backgroundColor: style.soft, color: style.accent }}
                >
                    <PipelineStageIcon
                        stageKey={stage.key}
                        platformLabel={eyebrow}
                    />
                </span>
                <span
                    className="shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.13em]"
                    style={{ backgroundColor: style.soft, color: style.accent }}
                >
                    {eyebrow ?? style.eyebrow}
                </span>
            </div>

            <div className="mt-2 text-xs font-semibold leading-4 text-slate-500">
                {stage.label}
            </div>
            <div className={`mt-1 font-black tracking-tight text-slate-900 ${stage.key === "authorized" ? "text-[22px]" : "text-[28px]"}`}>
                {formatPipelineStageValue(stage)}
            </div>
            <div className="mt-1 line-clamp-3 text-[11px] font-medium leading-4 text-slate-500">
                {detail ?? formatPipelineSecondary(stage)}
            </div>
        </div>
    );
}
function PipelineTransitionCard({
    transition,
    lossUnit = "clientes",
}: {
    transition: FullJourneyPipeline["transitions"][number];
    lossUnit?: "clientes" | "agendamentos";
}) {
    return (
        <div className="flex h-[182px] w-[118px] shrink-0 flex-col items-center justify-center px-2 text-center">
            <span
                className={`rounded-full border px-2.5 py-1 text-xs font-black ${
                    transition.rate === null
                        ? "border-slate-200 bg-slate-50 text-slate-400"
                        : "border-blue-100 bg-blue-50 text-blue-700"
                }`}
                title={
                    transition.estimated
                        ? transition.key === "instagram_clicks_to_chat"
                            ? "Estimativa agregada: chats pagos de Instagram divididos por cliques para Instagram Direct no período. Não representa conversão individual rastreada."
                            : "Estimativa de cobertura: compara eventos agregados da plataforma com clientes únicos identificados no CRM."
                        : undefined
                }
            >
                {transition.estimated && transition.rate !== null ? "~" : ""}
                {formatRate(transition.rate)}
            </span>
            <div className="my-3 -mx-2 w-[calc(100%+16px)]">
                <PipelineArrowLine />
            </div>
            <span className="min-h-8 text-[10px] font-bold leading-4 text-slate-500">
                {transition.label}
            </span>
            <span className="mt-1 h-4 text-[10px] text-slate-400">
                {transition.lost === null ? "" : `−${transition.lost} ${lossUnit}`}
            </span>
        </div>
    );
}
function PipelineArrowLine() {
    return (
        <svg className="block h-[15px] w-full overflow-visible" viewBox="0 0 118 15"
            preserveAspectRatio="none" aria-hidden="true">
            <path d="M 0 7.5 H 118 M 112 2.5 L 118 7.5 L 112 12.5"
                fill="none" stroke="#93c5fd" strokeWidth="1.5"
                strokeLinejoin="round" />
        </svg>
    );
}

function PipelineStageIcon({
    stageKey,
    platformLabel,
}: {
    stageKey: PipelineStageKey;
    platformLabel?: string;
}) {
    if (platformLabel === "Instagram") return <FaInstagram size={20} />;
    if (stageKey === "paid_impressions") {
        if (platformLabel === "Meta Ads") return <FaMeta size={20} />;
        if (platformLabel === "Google Ads") return <FaGoogle size={20} />;
        return (
            <span className="flex items-center gap-1">
                <FaMeta size={14} />
                <FaGoogle size={14} />
            </span>
        );
    }
    if (stageKey === "paid_clicks") return <MousePointerClick size={20} />;
    if (stageKey === "tracked_whatsapp") return <UserCheck size={20} />;
    if (stageKey === "scheduled" || stageKey === "procedure_scheduled") return <CalendarCheck2 size={20} />;
    if (stageKey === "attended" || stageKey === "procedure_attended") return <UserCheck size={20} />;
    if (stageKey === "invoiced") return <ReceiptText size={20} />;
    if (stageKey === "authorized") return <BadgeCheck size={20} />;
    return <CircleDollarSign size={20} />;
}
function PipelineInsight({
    label,
    value,
    detail,
}: {
    label: string;
    value: string;
    detail: string;
}) {
    return (
        <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                {label}
            </div>
            <div className="mt-1 text-lg font-black text-slate-800">{value}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{detail}</div>
        </div>
    );
}
function EmptyCardMessage({ message }: { message: string }) {
    return (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
            {message}
        </div>
    );
}
function clientPipelineStage(
    key: PipelineStageKey,
    label: string,
    value: number,
): FullJourneyPipeline["stages"][number] {
    return {
        key,
        label,
        value,
        secondary_value: null,
        secondary_kind: null,
        secondary_label: null,
    };
}
function clientPipelineTransition({
    key,
    label,
    fromValue,
    toValue,
    rate,
    lost = null,
}: {
    key: string;
    label: string;
    fromValue: number;
    toValue: number;
    rate: number | null;
    lost?: number | null;
}): FullJourneyPipeline["transitions"][number] {
    return {
        key,
        label,
        rate,
        from_value: fromValue,
        to_value: toValue,
        lost,
        estimated: false,
    };
}
function calculateRate(value: number, total: number) {
    if (total <= 0) return null;
    return Number(((value / total) * 100).toFixed(1));
}
function formatRate(value: number | null): string {
    return value === null ? "—" : `${value}%`;
}
function formatPipelineStageValue(
    stage: FullJourneyPipeline["stages"][number],
) {
    if (stage.metric_available === false) return "—";
    if (stage.key === "authorized") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(stage.secondary_value ?? 0);
    if (stage.key === "paid_impressions" && stage.value >= 1_000_000) {
        return `${Math.round(stage.value / 1_000_000).toLocaleString("pt-BR")}m`;
    }

    return stage.value.toLocaleString("pt-BR");
}
function formatPipelineSecondary(
    stage: FullJourneyPipeline["stages"][number],
) {
    if (stage.key === "authorized") return `${stage.value.toLocaleString("pt-BR")} clientes · notas autorizadas`;
    if (stage.secondary_value === null || !stage.secondary_kind) {
        return stage.key === "paid_impressions"
            ? ""
            : stage.key === "paid_clicks"
              ? "cliques elegíveis"
                : stage.key === "tracked_whatsapp"
                  ? "clientes únicos identificados"
              : stage.key === "scheduled"
                ? "clientes únicos"
                : stage.key === "attended"
                  ? "clientes únicos"
                  : "";
    }

    const value =
        stage.secondary_kind === "currency"
            ? formatPipelineCurrency(stage.secondary_value, "BRL")
            : stage.secondary_value.toLocaleString("pt-BR");
    return `${value}${stage.secondary_label ? ` ${stage.secondary_label}` : ""}`;
}
function formatPipelineCurrency(value: number, currencyCode: string) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: currencyCode || "BRL",
        notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
        maximumFractionDigits: Math.abs(value) >= 100_000 ? 1 : 2,
    }).format(value);
}
function formatPipelineDate(value: string) {
    if (!value) return "—";
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value;
}
function buildPipelineSourceTooltip(pipeline: FullJourneyPipeline) {
    const stages = new Map(
        pipeline.stages.map((stage) => [stage.key, stage]),
    );
    const count = (key: PipelineStageKey) =>
        (stages.get(key)?.value ?? 0).toLocaleString("pt-BR");
    const money = (key: PipelineStageKey) =>
        formatPipelineCurrency(
            stages.get(key)?.secondary_value ?? 0,
            pipeline.currency_code,
        );
    const acquisition = new Map(
        (pipeline.acquisition_branches ?? []).map((branch) => [
            branch.platform,
            branch,
        ]),
    );
    const google = acquisition.get("google_ads");
    const meta = acquisition.get("meta_ads");

    return [
        `Meta Ads: ${(meta?.impressions ?? 0).toLocaleString("pt-BR")} impressões e ${(meta?.clicks ?? 0).toLocaleString("pt-BR")} cliques — dados da API Meta Ads.`,
        `Google Ads: ${(google?.impressions ?? 0).toLocaleString("pt-BR")} impressões e ${(google?.clicks ?? 0).toLocaleString("pt-BR")} cliques — dados da API Google Ads.`,
        `WhatsApp rastreado ${count("tracked_whatsapp")} — clientes únicos atribuídos por evidência da própria conversa. Primeiro usamos a Origem registrada; depois, a plataforma e a origem enviadas pelo TinTim para o mesmo cliente e a conversa mais próxima. Na ausência desses sinais, usamos somente UTM paga ou ID de clique salvo no cliente até 7 dias antes ou depois da conversa.`,
        `Agendamentos por procedimento — cada ramo conta os eventos deduplicados da agenda do Hub e do CliniSys após a entrada rastreada. ${count("scheduled")} clientes únicos da coorte rastreada tiveram ao menos um evento.`,
        `Presenças por procedimento — cada ramo conta os eventos com presença confirmada após a entrada rastreada. ${count("attended")} clientes únicos da coorte rastreada compareceram ao menos uma vez.`,
        "Impressões e cliques correspondem ao período de entrada. A origem dos pacientes pode ser recuperada de contatos anteriores; a relação clique → WhatsApp compara agregados, não cliques individuais.",
        "A coorte inclui clientes com conversa, agendamento, atendimento ou nota no período. O histórico anterior de WhatsApp recupera a origem; os desfechos são acompanhados até hoje. Consultas e procedimentos seguem as classificações do Hub, incluindo registros sem nome.",
        "Os três grupos são exclusivos: evidência paga (WhatsApp ou Instagram), WhatsApp sem origem identificada, e origens orgânicas confirmadas ou pacientes sem conversa vinculada. Vínculos entre Instagram, WhatsApp e consultas usam apenas IDs confirmados; nomes não são usados para inferir identidade.",
        pipeline.instagram?.clicks === null ? "Os cliques específicos de Instagram Direct ainda não foram sincronizados para este período." : "Os cliques para Instagram contam somente conjuntos exclusivos de Instagram Direct. Os chats podem incluir outras campanhas; por isso não calculamos uma taxa entre essas duas populações.",
        "A receita é atribuída ao último atendimento confirmado até a data da nota. Cada nota liberada entra uma única vez, pela consulta ou pelo procedimento. Os ramos contam clientes que geraram receita, não todos os pacientes presentes.",
        `Liberados ${count("authorized")} · ${money("authorized")} — notas dessa coorte com autorização fiscal confirmada no CliniSys.`,
    ].join("\n");
}


function procedureBottleneckDetail(
    branch: FullJourneyPipeline["procedure_branches"][number],
) {
    const loss =
        branch.lost_appointments > 0
            ? ` · ${branch.lost_appointments} agendamentos sem presença`
            : "";
    return `${branch.procedure_name} · Agenda → presença${loss}`;
}

function aggregateBottleneckDetail(
    transition: FullJourneyPipeline["transitions"][number],
) {
    const loss =
        transition.lost !== null
            ? ` · ${transition.lost} clientes não avançaram`
            : "";
    return `${transition.label}${loss}`;
}

export function TrackedWhatsappSourcesCard({
    pipeline,
}: {
    pipeline: FullJourneyPipeline;
}) {
    const sources = pipeline.audit.tracked_sources ?? [];
    const groupedSources = new Map<string, TrackedWhatsappChartSource>();

    for (const source of sources) {
        const evidence = trackedSourceEvidence(source.field);
        const key = [
            source.platform,
            evidence,
            source.source.trim().toLocaleLowerCase("pt-BR"),
        ].join(":");
        const current = groupedSources.get(key);
        if (current) {
            current.clients += source.clients;
            current.scheduled_clients += source.scheduled_clients ?? 0;
            current.attended_clients += source.attended_clients ?? 0;
            continue;
        }

        groupedSources.set(key, {
            platform: source.platform,
            source: source.source,
            evidence,
            clients: source.clients,
            percentage: 0,
            scheduled_clients: source.scheduled_clients ?? 0,
            attended_clients: source.attended_clients ?? 0,
            schedule_rate: null,
            attendance_rate: null,
            schedule_rate_label: "",
            key,
            label: trackedSourceAxisLabel(source.source, evidence),
        });
    }

    const totalClients = [...groupedSources.values()].reduce(
        (sum, source) => sum + source.clients,
        0,
    );
    const sortedSources = [...groupedSources.values()]
        .sort((first, second) => second.clients - first.clients ||
            first.source.localeCompare(second.source, "pt-BR"));
    const remaining = new Map<TrackedWhatsappChartSource["platform"], TrackedWhatsappChartSource>();
    for (const source of sortedSources.slice(12)) {
        const current = remaining.get(source.platform);
        if (current) {
            current.clients += source.clients;
            current.scheduled_clients += source.scheduled_clients;
            current.attended_clients += source.attended_clients;
        } else {
            remaining.set(source.platform, {
                ...source,
                source: "Outras fontes",
                label: source.platform === "meta_ads" ? "Outras fontes (Meta)" : "Outras fontes (Google)",
                key: `other:${source.platform}`,
            });
        }
    }
    const chartData = [...sortedSources.slice(0, 12), ...remaining.values()].map(source => {
        const rate = calculateRate(source.scheduled_clients, source.clients);
        return {
            ...source,
            percentage: calculateRate(source.clients, totalClients) ?? 0,
            schedule_rate: rate,
            attendance_rate: calculateRate(source.attended_clients, source.clients),
            schedule_rate_label: `${formatRate(rate)} agendaram`,
        };
    });
    const chartHeight = Math.max(280, chartData.length * 34 + 40);

    return (
        <Card className="min-w-0">
            <div className="mb-5">
                <h2 className="text-lg font-bold">
                    De onde vem o WhatsApp rastreado
                </h2>
                <p className="mt-1 text-xs text-slate-500">Clientes por origem e taxa de agendamento confirmado no CliniSys.</p>
                <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-500">
                    <LegendDot
                        color={TRACKED_WHATSAPP_PLATFORM_STYLE.google_ads.color}
                        label="Google Ads"
                    />
                    <LegendDot
                        color={TRACKED_WHATSAPP_PLATFORM_STYLE.meta_ads.color}
                        label="Meta Ads"
                    />
                </div>
            </div>

            {chartData.length === 0 ? (
                <EmptyCardMessage message="Nenhum cliente rastreado no período." />
            ) : (
                <div className="w-full" style={{ height: chartHeight }}>
                    <ResponsiveContainer width="100%" height="100%" debounce={200}>
                        <BarChart
                            data={chartData}
                            layout="vertical"
                            barCategoryGap="24%"
                            margin={{ left: 0, right: 130 }}
                        >
                            <CartesianGrid
                                strokeDasharray="4 4"
                                stroke="#e2e8f0"
                                horizontal={false}
                            />
                            <XAxis
                                type="number"
                                allowDecimals={false}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                            />
                            <YAxis
                                type="category"
                                dataKey="label"
                                width={220}
                                tick={{ fontSize: 11 }}
                                stroke="#94a3b8"
                                tickFormatter={(value: string) =>
                                    shortenChartLabel(value, 38)
                                }
                            />
                            <Tooltip
                                content={<TrackedWhatsappSourceTooltip />}
                                cursor={false}
                            />
                            <Bar
                                dataKey="clients"
                                name="Clientes únicos"
                                radius={[0, 7, 7, 0]}
                                isAnimationActive={false}
                            >
                                <LabelList dataKey="schedule_rate_label" position="right" fontSize={11} fill="#64748b" />
                                {chartData.map((source) => (
                                    <Cell
                                        key={source.key}
                                        fill={
                                            TRACKED_WHATSAPP_PLATFORM_STYLE[
                                                source.platform
                                            ].color
                                        }
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}

function TrackedWhatsappSourceTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: { payload?: TrackedWhatsappChartSource }[];
}) {
    const source = payload?.[0]?.payload;
    if (!active || !source) return null;

    const platform = TRACKED_WHATSAPP_PLATFORM_STYLE[source.platform];

    return (
        <div className="max-w-[340px] rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="font-semibold text-slate-800">{source.source}</div>
            <div className="mt-2 space-y-1.5 text-xs text-slate-500">
                <div className="flex items-center justify-between gap-6">
                    <span>Classificação</span>
                    <span
                        className="font-semibold"
                        style={{ color: platform.color }}
                    >
                        {platform.label}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-6">
                    <span>Clientes únicos</span>
                    <span className="font-semibold text-slate-700">
                        {source.clients.toLocaleString("pt-BR")} ·{" "}
                        {formatRate(source.percentage)}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-6">
                    <span>Agendaram</span>
                    <span className="font-semibold text-slate-700">{source.scheduled_clients.toLocaleString("pt-BR")} · {formatRate(source.schedule_rate)}</span>
                </div>
                <div className="flex items-center justify-between gap-6">
                    <span>Compareceram</span>
                    <span className="font-semibold text-slate-700">{source.attended_clients.toLocaleString("pt-BR")} · {formatRate(source.attendance_rate)}</span>
                </div>
            </div>
        </div>
    );
}

function trackedSourceEvidence(
    field: string,
): TrackedWhatsappSourceEvidence {
    if (field === "tintim_source") return "TinTim";
    if (field === "utm_source") return "UTM";
    if (field === "click_id") return "ID de clique";
    return "Origem";
}

function trackedSourceAxisLabel(
    source: string,
    evidence: TrackedWhatsappSourceEvidence,
) {
    if (evidence === "TinTim") return `${source} (TinTim)`;
    if (evidence === "UTM") return `${source} (UTM)`;
    if (evidence === "Origem") return `${source} (Origem)`;
    return source;
}

function shortenChartLabel(value: string, maximumLength: number) {
    if (value.length <= maximumLength) return value;
    return `${value.slice(0, maximumLength - 1)}…`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
    const resolvedColors: Record<string, string> = {
        "slate-500": "#64748b",
        "bg-slate-400": "#94a3b8",
        "bg-emerald-500": "#10b981",
        "bg-amber-500": "#f59e0b",
        "bg-violet-500": "#8b5cf6",
        "bg-teal-500": "#14b8a6",
    };
    const backgroundColor = color.startsWith("#")
        ? color
        : resolvedColors[color] ?? `var(--color-${color})`;

    return (
        <div className="flex items-center gap-2">
            <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor }}
            />
            <span>{label}</span>
        </div>
    );
}