"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
    ArrowRight,
    BadgeCheck,
    CalendarCheck2,
    CircleDollarSign,
    HelpCircle,
    MousePointerClick,
    ReceiptText,
    UserCheck,
} from "lucide-react";
import { FaGoogle, FaMeta } from "react-icons/fa6";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Card, InfoTooltip } from "@/components";

type PipelineStageKey =
    | "paid_impressions"
    | "paid_clicks"
    | "tracked_whatsapp"
    | "scheduled"
    | "attended"
    | "invoiced"
    | "authorized";

type FullJourneyPipeline = {
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
        }>;
        whatsapp_coverage: {
            total_conversations: number;
            tracked_conversations: number;
            tracking_rate: number | null;
            google_conversations: number;
            meta_conversations: number;
            other_conversations: number;
            untracked_conversations: number;
        };
        matured_through: string;
        error: string | null;
    };
};

type JourneyData = { full_pipeline: FullJourneyPipeline };

type Props = { widgetId: string; data: JourneyData };

const PIPELINE_STAGE_STYLE: Record<PipelineStageKey, { accent: string; soft: string; eyebrow: string }> = {
    paid_impressions: { accent: "#0866ff", soft: "#eaf2ff", eyebrow: "Aquisição" },
    paid_clicks: { accent: "#1683ff", soft: "#e5f1ff", eyebrow: "Aquisição" },
    tracked_whatsapp: { accent: "#0f9f94", soft: "#e6f8f6", eyebrow: "CRM" },
    scheduled: { accent: "#8b5cf6", soft: "#f1ebff", eyebrow: "Conversão" },
    attended: { accent: "#0f9f94", soft: "#e6f8f6", eyebrow: "Clínica" },
    invoiced: { accent: "#d98916", soft: "#fff3df", eyebrow: "Receita" },
    authorized: { accent: "#0f9f61", soft: "#e6f8ef", eyebrow: "Receita" },
};

const WHATSAPP_COVERAGE_STYLE = {
    meta_ads: { label: "Meta Ads", color: "#0866ff" },
    google_ads: { label: "Google Ads", color: "#d97706" },
    other: { label: "Outras origens", color: "#8b5cf6" },
    untracked: { label: "Não rastreadas", color: "#94a3b8" },
} as const;

export default function ExactJornadaDashboardGraphs({ widgetId, data }: Props) {
    if (widgetId === "jornada.jornada_completa") return <FullJourneyPipelineCard data={data} />;
    if (widgetId === "jornada.cobertura_whatsapp") return <WhatsappCoverageCard pipeline={data.full_pipeline} />;
    return null;
}

function FullJourneyPipelineCard({ data }: { data: JourneyData }) {
    const pipeline = data.full_pipeline;
    const clinicalTransitions = (pipeline.transitions ?? []).filter((transition) => !transition.estimated && transition.rate !== null);
    const aggregateBottleneck = clinicalTransitions.reduce<FullJourneyPipeline["transitions"][number] | null>(
        (current, transition) => !current || (transition.rate ?? Infinity) < (current.rate ?? Infinity) ? transition : current,
        null,
    );
    const procedureBottleneck = (pipeline.procedure_branches ?? [])
        .filter((branch) => branch.scheduled_appointments > 0 && branch.schedule_to_attendance_rate !== null)
        .reduce<FullJourneyPipeline["procedure_branches"][number] | null>(
            (current, branch) => !current || (branch.schedule_to_attendance_rate ?? Infinity) < (current.schedule_to_attendance_rate ?? Infinity) ? branch : current,
            null,
        );
    const trackedWhatsappStage = pipeline.stages.find((stage) => stage.key === "tracked_whatsapp");
    const authorizedStage = pipeline.stages.find((stage) => stage.key === "authorized");
    const endToEndRate = calculateRate(authorizedStage?.value ?? 0, trackedWhatsappStage?.value ?? 0);

    return (
        <Card className="min-w-0 overflow-hidden p-0">
            <div className="border-b border-slate-100 bg-white px-6 py-5">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-slate-900">Jornada completa</h2>
                        <InfoTooltip text={buildPipelineSourceTooltip(pipeline)} portal widthClassName="w-[560px]">
                            <HelpCircle size={16} className="text-slate-400" />
                        </InfoTooltip>
                    </div>
                    <p className="mt-1 max-w-3xl text-sm text-slate-500">Para precisão no comparecimento, selecione datas com ao 30+ dias de maturação.</p>
                </div>
            </div>
            {pipeline.audit.error ? <div className="border-b border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">A jornada completa não pôde ser carregada: {pipeline.audit.error}</div> : null}
            {!pipeline.ads_available ? <div className="border-b border-amber-100 bg-amber-50 px-6 py-3 text-sm text-amber-800">Sem dados de Meta ou Google Ads neste período. As etapas do WhatsApp em diante continuam válidas.</div> : null}
            {pipeline.filters_applied ? <div className="border-b border-blue-100 bg-blue-50 px-6 py-3 text-xs text-blue-800">A medição das plataformas permanece global; os filtros selecionados valem do WhatsApp rastreado em diante.</div> : null}
            <div className="px-6 py-6">
                {pipeline.stages.length === 0 ? <EmptyCardMessage message="Nenhum dado rastreável no período." /> : <JourneyPipelineTree pipeline={pipeline} />}
                <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 md:grid-cols-3">
                    <PipelineInsight
                        label="Maior gargalo clínico"
                        value={procedureBottleneck ? formatRate(procedureBottleneck.schedule_to_attendance_rate) : aggregateBottleneck ? formatRate(aggregateBottleneck.rate) : "—"}
                        detail={procedureBottleneck ? `${procedureBottleneck.procedure_name} · Agenda → presença${procedureBottleneck.lost_appointments > 0 ? ` · ${procedureBottleneck.lost_appointments} agendamentos sem presença` : ""}` : aggregateBottleneck ? `${aggregateBottleneck.label}${aggregateBottleneck.lost !== null ? ` · ${aggregateBottleneck.lost} clientes não avançaram` : ""}` : "Sem base suficiente"}
                    />
                    <PipelineInsight label="Conversão ponta a ponta" value={formatRate(endToEndRate)} detail="WhatsApp rastreado → liberado" />
                    <PipelineInsight
                        label="Receita liberada"
                        value={formatPipelineCurrency(authorizedStage?.secondary_value ?? 0, pipeline.currency_code)}
                        detail={`Desfechos observados até ${formatPipelineDate(pipeline.audit.matured_through)}`}
                    />
                </div>
            </div>
        </Card>
    );
}

function WhatsappCoverageCard({ pipeline }: { pipeline: FullJourneyPipeline }) {
    const coverage = pipeline.audit.whatsapp_coverage;
    const chartData = [
        { key: "meta_ads", ...WHATSAPP_COVERAGE_STYLE.meta_ads, value: coverage.meta_conversations, percentage: calculateRate(coverage.meta_conversations, coverage.total_conversations) },
        { key: "google_ads", ...WHATSAPP_COVERAGE_STYLE.google_ads, value: coverage.google_conversations, percentage: calculateRate(coverage.google_conversations, coverage.total_conversations) },
        { key: "other", ...WHATSAPP_COVERAGE_STYLE.other, value: coverage.other_conversations, percentage: calculateRate(coverage.other_conversations, coverage.total_conversations) },
        { key: "untracked", ...WHATSAPP_COVERAGE_STYLE.untracked, value: coverage.untracked_conversations, percentage: calculateRate(coverage.untracked_conversations, coverage.total_conversations) },
    ];
    return (
        <Card className="min-w-0">
            <h2 className="text-lg font-bold">Cobertura das conversas no WhatsApp</h2>
            {coverage.total_conversations === 0 ? <div className="mt-5"><EmptyCardMessage message="Nenhuma conversa no período." /></div> : (
                <div className="mt-4 grid grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(260px,0.9fr)_minmax(320px,1.1fr)] lg:gap-10">
                    <div className="relative h-[270px] min-w-0">
                        <ResponsiveContainer width="100%" height="100%" debounce={200}>
                            <PieChart>
                                <Pie data={chartData} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={68} outerRadius={98} paddingAngle={2} stroke="none" isAnimationActive={false}>
                                    {chartData.map((item) => <Cell key={item.key} fill={item.color} />)}
                                </Pie>
                                <Tooltip content={<WhatsappCoverageTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-bold text-slate-800">{coverage.total_conversations.toLocaleString("pt-BR")}</span>
                            <span className="mt-1 text-xs font-medium text-slate-500">total de conversas</span>
                        </div>
                    </div>
                    <div className="min-w-0">
                        <div className="mb-3 flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
                            <span className="text-sm font-medium text-slate-600">Conversas rastreadas</span>
                            <div className="text-right"><div className="font-bold text-slate-800">{coverage.tracked_conversations.toLocaleString("pt-BR")}</div><div className="text-xs text-slate-500">{formatRate(coverage.tracking_rate)} do total</div></div>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {chartData.map((item) => (
                                <div key={item.key} className="flex items-center justify-between gap-4 py-3">
                                    <div className="flex items-center gap-2.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} /><span className="text-sm font-medium text-slate-700">{item.label}</span></div>
                                    <div className="flex items-baseline gap-3"><span className="font-bold text-slate-800">{item.value.toLocaleString("pt-BR")}</span><span className="w-12 text-right text-xs text-slate-500">{formatRate(item.percentage)}</span></div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}

type WhatsappCoverageChartItem = { key: string; label: string; value: number; percentage: number | null; color: string };
function WhatsappCoverageTooltip({ active, payload }: { active?: boolean; payload?: { payload?: WhatsappCoverageChartItem }[] }) {
    const item = payload?.[0]?.payload;
    if (!active || !item) return null;
    return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} /><span className="font-semibold text-slate-800">{item.label}</span></div><div className="mt-2 text-sm text-slate-600">{item.value.toLocaleString("pt-BR")} · {formatRate(item.percentage)}</div></div>;
}

const PIPELINE_TREE_ROW_HEIGHT = 210;
const PIPELINE_TREE_ROW_GAP = 16;
function PipelineCanvas({ children }: { children: ReactNode }) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const offsetRef = useRef(offset);
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
    function updateOffset(next: { x: number; y: number }) { offsetRef.current = next; setOffset(next); }
    function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        const viewport = viewportRef.current; if (!viewport) return;
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: offsetRef.current.x, originY: offsetRef.current.y };
        viewport.setPointerCapture(event.pointerId); event.preventDefault();
    }
    function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return;
        updateOffset({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY });
    }
    function stopDragging(event: ReactPointerEvent<HTMLDivElement>) {
        const viewport = viewportRef.current; const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null; if (viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    }
    const gridSize = 28;
    return <div ref={viewportRef} className="relative h-[720px] max-h-[72vh] min-h-[520px] w-full cursor-move select-none overflow-hidden rounded-xl" style={{ backgroundImage: "linear-gradient(rgba(148,163,184,0.075) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.075) 1px, transparent 1px)", backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${offset.x % gridSize}px ${offset.y % gridSize}px` }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging} onDragStart={(event) => event.preventDefault()} title="Arraste com o botão esquerdo para mover a jornada"><div className="absolute left-0 top-0 w-max pb-4" style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`, willChange: "transform" }}>{children}</div></div>;
}

function JourneyPipelineTree({ pipeline }: { pipeline: FullJourneyPipeline }) {
    const stages = new Map(pipeline.stages.map((stage) => [stage.key, stage]));
    const tracked = stages.get("tracked_whatsapp"), scheduled = stages.get("scheduled"), attended = stages.get("attended"), invoiced = stages.get("invoiced"), authorized = stages.get("authorized");
    if (!tracked || !scheduled || !attended || !invoiced || !authorized) return <EmptyCardMessage message="A jornada clínica está incompleta neste período." />;
    const acquisitionBranches = pipeline.acquisition_branches ?? [];
    const whatsappToSchedule = pipeline.transitions.find((transition) => transition.key === "whatsapp_to_schedule");
    const attendanceToInvoice = pipeline.transitions.find((transition) => transition.key === "attendance_to_invoice");
    const invoiceTransition = pipeline.transitions.find((transition) => transition.key === "invoice_to_authorized");
    const acquisitionRowCount = Math.max(1, acquisitionBranches.length);
    const acquisitionHeight = acquisitionRowCount * PIPELINE_TREE_ROW_HEIGHT + (acquisitionRowCount - 1) * PIPELINE_TREE_ROW_GAP;
    const topOffset = Math.max(0, (acquisitionHeight - PIPELINE_TREE_ROW_HEIGHT) / 2);
    return (
        <PipelineCanvas>
            <div className="flex min-w-max items-start py-2">
                <div className="space-y-4">
                    {acquisitionBranches.map((branch) => (
                        <div key={branch.platform} className="flex items-stretch">
                            <PipelineStageCard stage={clientPipelineStage("paid_impressions", "Impressões pagas", branch.impressions)} eyebrow={branch.label} />
                            <PipelineTransitionCard transition={clientPipelineTransition({ key: `${branch.platform}_ctr`, label: "CTR pago", fromValue: branch.impressions, toValue: branch.clicks, rate: branch.click_through_rate })} />
                            <PipelineStageCard stage={clientPipelineStage("paid_clicks", "Cliques pagos", branch.clicks)} eyebrow={branch.label} detail="cliques elegíveis" />
                            <PipelineTransitionCard transition={clientPipelineTransition({ key: `${branch.platform}_click_to_tracked`, label: "Clique → WhatsApp", fromValue: branch.clicks, toValue: branch.tracked_clients, rate: branch.click_to_tracked_rate })} />
                        </div>
                    ))}
                </div>
                <PipelineTreeConnector direction="merge" rowCount={acquisitionRowCount} />
                <div style={{ marginTop: topOffset }}><PipelineStageCard stage={tracked} /></div>
                {whatsappToSchedule ? <div style={{ marginTop: topOffset }}><PipelineTransitionCard transition={whatsappToSchedule} /></div> : null}
                <ProcedurePipelineStages scheduled={scheduled} attended={attended} branches={pipeline.procedure_branches ?? []} topOffset={topOffset} />
                {attendanceToInvoice ? <div style={{ marginTop: topOffset }}><PipelineTransitionCard transition={attendanceToInvoice} /></div> : null}
                <div className="flex items-stretch" style={{ marginTop: topOffset }}><PipelineStageCard stage={invoiced} />{invoiceTransition ? <PipelineTransitionCard transition={invoiceTransition} /> : null}<PipelineStageCard stage={authorized} /></div>
            </div>
        </PipelineCanvas>
    );
}

function ProcedurePipelineStages({ scheduled, attended, branches, topOffset }: { scheduled: FullJourneyPipeline["stages"][number]; attended: FullJourneyPipeline["stages"][number]; branches: FullJourneyPipeline["procedure_branches"]; topOffset: number }) {
    const aggregateTransition = clientPipelineTransition({ key: "procedure_schedule_to_attendance", label: "Agenda → presença", fromValue: scheduled.value, toValue: attended.value, rate: calculateRate(attended.value, scheduled.value), lost: Math.max(0, scheduled.value - attended.value) });
    return <div className="shrink-0" style={{ paddingTop: topOffset }}><div className="flex items-stretch"><PipelineStageCard stage={scheduled} width={240} detail="clientes únicos vinculados ao WhatsApp rastreado" /><PipelineTransitionCard transition={aggregateTransition} /><PipelineStageCard stage={attended} width={240} detail="clientes únicos que compareceram" /></div>{branches.length > 0 ? <div className="mt-4 space-y-2">{branches.map((branch) => <div key={branch.key} className="flex items-stretch"><ProcedureMetricRow value={branch.scheduled_appointments} procedureName={branch.procedure_name} stageKey="scheduled" /><ProcedureTransitionRow branch={branch} /><ProcedureMetricRow value={branch.attended_appointments} procedureName={branch.procedure_name} stageKey="attended" /></div>)}</div> : <div className="mt-4 flex h-[86px] w-[598px] items-center justify-center rounded-2xl border border-dashed border-slate-200 px-6 text-center text-sm text-slate-400">Nenhum procedimento dessa coorte foi encontrado no CliniSys.</div>}</div>;
}

function ProcedureMetricRow({ value, procedureName, stageKey }: { value: number; procedureName: string; stageKey: "scheduled" | "attended" }) {
    const color = stageKey === "scheduled" ? "#8b5cf6" : "#0f9f94";
    return <div className="flex h-[78px] w-[240px] shrink-0 items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: color }}>{stageKey === "scheduled" ? <CalendarCheck2 size={18} /> : <UserCheck size={18} />}</span><span className="text-xl font-black text-slate-800">{value.toLocaleString("pt-BR")}</span><span className="line-clamp-3 text-[11px] font-semibold leading-4 text-slate-600">{procedureName}</span></div>;
}
function ProcedureTransitionRow({ branch }: { branch: FullJourneyPipeline["procedure_branches"][number] }) {
    return <div className="flex h-[78px] w-[118px] shrink-0 flex-col items-center justify-center px-2 text-center"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${branch.schedule_to_attendance_rate === null ? "border-slate-200 bg-slate-50 text-slate-400" : "border-blue-100 bg-blue-50 text-blue-700"}`}>{formatRate(branch.schedule_to_attendance_rate)}</span><div className="my-1.5 flex w-full items-center"><span className="h-px flex-1 bg-gradient-to-r from-slate-200 to-blue-300" /><ArrowRight size={15} className="shrink-0 text-blue-400" /></div><span className="h-3 text-[9px] text-slate-400">{branch.lost_appointments > 0 ? `−${branch.lost_appointments}` : ""}</span></div>;
}

function PipelineTreeConnector({ direction, rowCount }: { direction: "merge" | "split"; rowCount: number }) {
    const height = rowCount * PIPELINE_TREE_ROW_HEIGHT + (rowCount - 1) * PIPELINE_TREE_ROW_GAP;
    const firstCenter = PIPELINE_TREE_ROW_HEIGHT / 2, lastCenter = height - PIPELINE_TREE_ROW_HEIGHT / 2, midpoint = height / 2, trunkLeft = direction === "merge" ? 48 : 24;
    return <div className="relative w-[72px] shrink-0" style={{ height }} aria-hidden="true"><span className="absolute w-px bg-blue-300" style={{ left: trunkLeft, top: firstCenter, height: Math.max(1, lastCenter - firstCenter), transform: "translateY(-13px)" }} />{Array.from({ length: rowCount }).map((_, index) => { const top = index * (PIPELINE_TREE_ROW_HEIGHT + PIPELINE_TREE_ROW_GAP) + PIPELINE_TREE_ROW_HEIGHT / 2; return <span key={index} className="absolute h-px bg-blue-300" style={{ top, left: direction === "merge" ? -4 : trunkLeft, width: direction === "merge" ? trunkLeft + 4 : 72 - trunkLeft, transform: "translateY(-13px)" }}>{direction === "split" ? <ArrowRight size={15} className="absolute right-[-1px] top-1/2 -translate-y-1/2 text-blue-400" /> : null}</span>; })}<span className="absolute h-px bg-blue-300" style={{ top: midpoint, left: direction === "merge" ? trunkLeft : 0, width: direction === "merge" ? 72 - trunkLeft : trunkLeft }} /></div>;
}

function PipelineStageCard({ stage, eyebrow, detail, width = 168 }: { stage: FullJourneyPipeline["stages"][number]; eyebrow?: string; detail?: string; width?: number }) {
    const defaultStyle = PIPELINE_STAGE_STYLE[stage.key];
    const style = eyebrow === "Google Ads" && (stage.key === "paid_impressions" || stage.key === "paid_clicks") ? { accent: "#d97706", soft: "#fffbeb", eyebrow: defaultStyle.eyebrow } : defaultStyle;
    return <div className="relative flex h-[210px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]" style={{ width }} title={`${stage.label}: ${stage.value.toLocaleString("pt-BR")}${detail ? ` — ${detail}` : ""}`}><span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: style.accent }} /><div className="flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: style.soft, color: style.accent }}><PipelineStageIcon stageKey={stage.key} platformLabel={eyebrow} /></span><span className="shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.13em]" style={{ backgroundColor: style.soft, color: style.accent }}>{eyebrow ?? style.eyebrow}</span></div><div className="mt-5 text-xs font-semibold text-slate-500">{stage.label}</div><div className="mt-1 text-[28px] font-black tracking-tight text-slate-900">{formatPipelineStageValue(stage)}</div><div className="mt-3 line-clamp-3 min-h-12 text-[11px] font-medium leading-4 text-slate-500">{detail ?? formatPipelineSecondary(stage)}</div></div>;
}
function PipelineTransitionCard({ transition }: { transition: FullJourneyPipeline["transitions"][number] }) {
    return <div className="flex w-[118px] flex-col items-center justify-center px-2 text-center"><span className={`rounded-full border px-2.5 py-1 text-xs font-black ${transition.rate === null ? "border-slate-200 bg-slate-50 text-slate-400" : "border-blue-100 bg-blue-50 text-blue-700"}`}>{transition.estimated && transition.rate !== null ? "~" : ""}{formatRate(transition.rate)}</span><div className="my-3 -mx-2 flex w-[calc(100%+16px)] items-center"><span className="h-px flex-1 bg-gradient-to-r from-slate-200 to-blue-300" /><ArrowRight size={15} className="shrink-0 text-blue-400" /></div><span className="min-h-8 text-[10px] font-bold leading-4 text-slate-500">{transition.label}</span><span className="mt-1 h-4 text-[10px] text-slate-400">{transition.lost === null ? transition.estimated ? "bases distintas" : "" : `−${transition.lost} clientes`}</span></div>;
}
function PipelineStageIcon({ stageKey, platformLabel }: { stageKey: PipelineStageKey; platformLabel?: string }) {
    if (stageKey === "paid_impressions") { if (platformLabel === "Meta Ads") return <FaMeta size={20} />; if (platformLabel === "Google Ads") return <FaGoogle size={20} />; return <span className="flex items-center gap-1"><FaMeta size={14} /><FaGoogle size={14} /></span>; }
    if (stageKey === "paid_clicks") return <MousePointerClick size={20} />;
    if (stageKey === "tracked_whatsapp") return <UserCheck size={20} />;
    if (stageKey === "scheduled") return <CalendarCheck2 size={20} />;
    if (stageKey === "attended") return <UserCheck size={20} />;
    if (stageKey === "invoiced") return <ReceiptText size={20} />;
    if (stageKey === "authorized") return <BadgeCheck size={20} />;
    return <CircleDollarSign size={20} />;
}
function PipelineInsight({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-xl bg-slate-50 px-4 py-3"><div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</div><div className="mt-1 text-lg font-black text-slate-800">{value}</div><div className="mt-0.5 text-[11px] text-slate-500">{detail}</div></div>; }
function EmptyCardMessage({ message }: { message: string }) { return <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 text-center text-sm text-slate-400">{message}</div>; }
function clientPipelineStage(key: PipelineStageKey, label: string, value: number): FullJourneyPipeline["stages"][number] { return { key, label, value, secondary_value: null, secondary_kind: null, secondary_label: null }; }
function clientPipelineTransition({ key, label, fromValue, toValue, rate, lost = null }: { key: string; label: string; fromValue: number; toValue: number; rate: number | null; lost?: number | null }): FullJourneyPipeline["transitions"][number] { return { key, label, rate, from_value: fromValue, to_value: toValue, lost, estimated: false }; }
function calculateRate(value: number, total: number) { return total <= 0 ? null : Number(((value / total) * 100).toFixed(1)); }
function formatRate(value: number | null) { return value === null ? "—" : `${value}%`; }
function formatPipelineStageValue(stage: FullJourneyPipeline["stages"][number]) { return stage.key === "paid_impressions" && stage.value >= 1_000_000 ? `${Math.round(stage.value / 1_000_000).toLocaleString("pt-BR")}m` : stage.value.toLocaleString("pt-BR"); }
function formatPipelineSecondary(stage: FullJourneyPipeline["stages"][number]) { if (stage.secondary_value === null || !stage.secondary_kind) return stage.key === "paid_clicks" ? "cliques elegíveis" : stage.key === "tracked_whatsapp" ? "clientes únicos identificados" : stage.key === "scheduled" || stage.key === "attended" ? "clientes únicos" : ""; const value = stage.secondary_kind === "currency" ? formatPipelineCurrency(stage.secondary_value, "BRL") : stage.secondary_value.toLocaleString("pt-BR"); return `${value}${stage.secondary_label ? ` ${stage.secondary_label}` : ""}`; }
function formatPipelineCurrency(value: number, currencyCode: string) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currencyCode || "BRL", notation: Math.abs(value) >= 100_000 ? "compact" : "standard", maximumFractionDigits: Math.abs(value) >= 100_000 ? 1 : 2 }).format(value); }
function formatPipelineDate(value: string) { if (!value) return "—"; const [year, month, day] = value.split("-"); return year && month && day ? `${day}/${month}/${year}` : value; }
function buildPipelineSourceTooltip(pipeline: FullJourneyPipeline) { const stages = new Map(pipeline.stages.map((stage) => [stage.key, stage])); const count = (key: PipelineStageKey) => (stages.get(key)?.value ?? 0).toLocaleString("pt-BR"); return [`WhatsApp rastreado ${count("tracked_whatsapp")} — clientes únicos atribuídos por evidência da própria conversa.`, `Agendamentos ${count("scheduled")} — clientes únicos da coorte rastreada.`, `Presenças ${count("attended")} — clientes únicos com presença confirmada.`, `Faturados ${count("invoiced")} e liberados ${count("authorized")} — dados fiscais do CliniSys.`].join("\n"); }
