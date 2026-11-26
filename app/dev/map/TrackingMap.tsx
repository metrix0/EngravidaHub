// app/dev/map/TrackingMap.tsx
"use client";

import {
    ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, Clock, ExternalLink, Grip,
    Maximize, Minus, Plus, RotateCcw, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { connections, sections, stepNotes, type NodeId } from "./trackingMapData";

const sourceRoot = "https://github.com/metrix0/engravidahub/blob/preview/";
const columns = ["Fontes", "Captura e vínculo", "Perfil e processamento", "Regras e envio", "Destinos e consolidação", "Relatórios"];
const nodeWidth = 190;
const nodeHeight = 80;
const columnWidth = 236;
const rowHeight = 109;
const mapWidth = columnWidth * columns.length;
const mapHeight = 820;

const sectionStyles = {
    entrada: { dot: "bg-blue", selected: "border-blue ring-blue/20" },
    utm: { dot: "bg-blue", selected: "border-blue ring-blue/20" },
    perfil: { dot: "bg-blue", selected: "border-blue ring-blue/20" },
    tunel: { dot: "bg-purple", selected: "border-purple ring-purple/20" },
    analise: { dot: "bg-purple", selected: "border-purple ring-purple/20" },
    conversoes: { dot: "bg-orange", selected: "border-orange ring-orange/20" },
    clinica: { dot: "bg-green", selected: "border-green ring-green/20" },
    fontes: { dot: "bg-blue", selected: "border-blue ring-blue/20" },
    destinos: { dot: "bg-green", selected: "border-green ring-green/20" },
};
const nodes = sections.flatMap(section => [...section.nodes].map(node => ({
    ...node,
    section: section.title,
    style: sectionStyles[section.id],
    position: { x: 22 + node.col * columnWidth, y: 62 + node.row * rowHeight },
})));
const nodesById = new Map(nodes.map(node => [node.id, node]));
const edges = connections.map(([from, to, , showInOverview], index) => ({
    from, to, showInOverview, profileFlow: showInOverview === "profileFlow",
    lane: showInOverview === "profileFlow" ? 0 : (index % 5 - 2) * 3,
}));
const profileFlowNodes = new Set(edges.filter(edge => edge.profileFlow).flatMap(({ from, to }) => [from, to]));
const panKeys: Record<string, Point> = {
    ArrowLeft: { x: -48, y: 0 },
    ArrowRight: { x: 48, y: 0 },
    ArrowUp: { x: 0, y: -48 },
    ArrowDown: { x: 0, y: 48 },
};

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Camera = Point & { zoom: number };
type Positions = Partial<Record<NodeId, Point>>;
type Step = (typeof nodes)[number];
type Drag = {
    pointerId: number;
    start: Point;
    origin: Point;
    node: NodeId | null;
    moved: boolean;
};

function positionOf(id: NodeId, positions: Positions) {
    return positions[id] ?? nodesById.get(id)!.position;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function constrainCamera(camera: Camera, { width, height }: Size): Camera {
    const scaledWidth = mapWidth * camera.zoom;
    const scaledHeight = mapHeight * camera.zoom;
    const padding = 28;
    return {
        zoom: camera.zoom,
        x: clamp(camera.x, Math.min(padding, width - scaledWidth - padding), Math.max(padding, width - scaledWidth - padding)),
        y: clamp(camera.y, Math.min(padding, height - scaledHeight - padding), Math.max(padding, height - scaledHeight - padding)),
    };
}

function centerCamera(camera: Camera, size: Size, point: Point): Camera {
    return {
        ...camera,
        x: size.width / 2 - (point.x + nodeWidth / 2) * camera.zoom,
        y: size.height / 2 - (point.y + nodeHeight / 2) * camera.zoom,
    };
}

function fitCamera({ width, height }: Size): Camera {
    const availableHeight = height - 48;
    const zoom = clamp(Math.min((width - 24) / mapWidth, (availableHeight - 24) / mapHeight), 0.15, 1);
    return { x: (width - mapWidth * zoom) / 2, y: (availableHeight - mapHeight * zoom) / 2, zoom };
}

function initialCamera(size: Size): Camera {
    const overview = fitCamera(size);
    if (overview.zoom >= 0.6) return overview;
    return centerCamera({ x: 0, y: 0, zoom: 0.78 }, size, nodesById.get("clientProfile")!.position);
}

function edgePath(from: Point, to: Point, lane: number) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) < nodeWidth && Math.abs(dy) > nodeHeight) {
        const upper = dy > 0;
        const x1 = from.x + nodeWidth / 2 + lane;
        const x2 = to.x + nodeWidth / 2 + lane;
        const y1 = from.y + (upper ? nodeHeight : 0);
        const y2 = to.y + (upper ? -5 : nodeHeight + 5);
        if (Math.abs(dy) < rowHeight * 1.35) {
            const mid = (y1 + y2) / 2;
            return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
        }
        const side = Math.max(from.x, to.x) + nodeWidth + 17 + lane;
        const approach = y2 + (upper ? -7 : 7);
        return `M ${from.x + nodeWidth} ${from.y + nodeHeight / 2 + lane} H ${side} V ${approach} H ${x2} V ${y2}`;
    }
    const right = dx >= 0;
    const x1 = from.x + (right ? nodeWidth : 0);
    const x2 = to.x + (right ? -5 : nodeWidth + 5);
    const y1 = from.y + nodeHeight / 2 + lane;
    const y2 = to.y + nodeHeight / 2 + lane;
    if (Math.abs(dx) <= columnWidth * 1.4 && Math.abs(dy) <= rowHeight * 1.4) {
        const mid = (x1 + x2) / 2;
        return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
    }
    const direction = right ? 1 : -1;
    const start = x1 + direction * (19 + lane);
    const end = x2 - direction * (14 - lane);
    const aisle = from.y + (dy < 0 ? -14 : nodeHeight + 14) + lane / 2;
    return `M ${x1} ${y1} H ${start} V ${aisle} H ${end} V ${y2} H ${x2}`;
}

function StepDetails({
    node, onClose, onSelect,
}: {
    node: Step; onClose: () => void; onSelect: (id: NodeId) => void;
}) {
    const incoming = connections.filter(([, to]) => to === node.id);
    const outgoing = connections.filter(([from]) => from === node.id);
    const notes = stepNotes[node.id];
    return (
        <aside aria-label="Detalhes da etapa" className="max-h-[38dvh] min-h-0 w-full shrink-0 overflow-y-auto overscroll-contain border-t border-border bg-white p-4 sm:p-5 md:max-h-none md:w-[320px] md:border-l md:border-t-0">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <span aria-hidden="true" className={`size-2 rounded-full ${node.style.dot}`} />
                        {node.section}
                    </div>
                    <h2 className="mt-1.5 text-lg font-bold leading-tight">{node.title}</h2>
                    <p className="mt-1 text-sm text-slate-600">{node.caption}</p>
                </div>
                <button type="button" aria-label="Fechar detalhes" onClick={onClose} className="cursor-pointer rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                    <X size={17} aria-hidden="true" />
                </button>
            </div>
            {notes?.automation && (
                <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <h3 className="mb-1 flex items-center gap-1.5 text-xs font-bold"><Clock size={14} aria-hidden="true" />Tarefa agendada</h3>
                    <p>{notes.automation}</p>
                </div>
            )}
            {notes?.check && (
                <div className="mt-4 rounded-lg border border-border px-3 py-2 text-sm text-slate-700">
                    <h3 className="mb-1 text-xs font-bold">{notes.check[0]}</h3>
                    <p className="break-words">{notes.check[1]}</p>
                </div>
            )}
            {([["Vem de", incoming, ArrowDownLeft], ["Segue para", outgoing, ArrowUpRight]] as const)
                .filter(([, links]) => links.length > 0)
                .map(([title, links, Icon]) => (
                    <section key={title} className="mt-5">
                        <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600"><Icon size={14} aria-hidden="true" />{title}</h3>
                        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                            {links.map(([from, to, detail]) => {
                                const related = nodesById.get(to === node.id ? from : to)!;
                                return (
                                    <li key={related.id}>
                                        <button type="button" onClick={() => onSelect(related.id)} className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left hover:bg-slate-50">
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-xs font-semibold">{related.title}</span>
                                                <span className="mt-0.5 block text-xs leading-snug text-slate-500">{detail}</span>
                                            </span>
                                            <ChevronRight size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}
            <details className="group mt-5 border-t border-slate-100 pt-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-brand">
                    Detalhes técnicos
                    <ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" />
                </summary>
                <dl className="my-3 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <div><dt className="text-xs font-semibold text-slate-500">O que recebe</dt><dd className="break-words text-sm">{node.input}</dd></div>
                    <div><dt className="text-xs font-semibold text-slate-500">O que produz</dt><dd className="break-words text-sm">{node.output}</dd></div>
                </dl>
                <ul className="mb-4 list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-slate-700">
                    {node.rules.map(rule => <li key={rule}>{rule}</li>)}
                </ul>
                <h3 className="text-xs font-bold text-slate-600">Código-fonte</h3>
                {"rpc" in node && <p className="mt-2 break-all rounded-md bg-slate-50 p-2 font-mono text-xs text-slate-600">{node.rpc}</p>}
                <ul className="mt-2 space-y-2">
                    {node.sources.map(path => <li key={path}>
                        <a title={path} href={sourceRoot + path} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-brand hover:underline">
                            <span className="break-all">{path}</span>
                            <ExternalLink size={12} className="shrink-0" aria-hidden="true" />
                        </a>
                    </li>)}
                </ul>
            </details>
        </aside>
    );
}

export default function TrackingMap() {
    const viewportRef = useRef<HTMLDivElement>(null);
    const sizeRef = useRef<Size | null>(null);
    const dragRef = useRef<Drag | null>(null);
    const focusedPosition = useRef<Point | null>(null);
    const suppressClick = useRef(false);
    const [selected, setSelected] = useState<NodeId | null>(null);
    const [camera, setCamera] = useState<Camera>({ x: 4, y: 4, zoom: 0.9 });
    const [positions, setPositions] = useState<Positions>({});
    const [dragging, setDragging] = useState(false);
    const step = selected ? nodesById.get(selected)! : null;

    const updateCamera = useCallback((update: (current: Camera, size: Size) => Camera) => {
        const size = sizeRef.current;
        if (size) setCamera(current => constrainCamera(update(current, size), size));
    }, []);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const observer = new ResizeObserver(([entry]) => {
            const size = { width: entry.contentRect.width, height: entry.contentRect.height };
            const previous = sizeRef.current;
            const focus = focusedPosition.current;
            sizeRef.current = size;
            setCamera(current => {
                const next = previous ? current : initialCamera(size);
                const focusClipped = focus && (
                    !previous ||
                    (size.width < previous.width && next.x + (focus.x + nodeWidth) * next.zoom > size.width - 8) ||
                    (size.height < previous.height && next.y + (focus.y + nodeHeight) * next.zoom > size.height - 8)
                );
                return constrainCamera(focusClipped ? centerCamera(next, size, focus) : next, size);
            });
        });
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);

    const centerStep = useCallback((point: Point) => {
        updateCamera((current, size) => centerCamera(current, size, point));
    }, [updateCamera]);

    function selectStep(id: NodeId, center = true) {
        const point = positionOf(id, positions);
        focusedPosition.current = point;
        setSelected(id);
        if (center) centerStep(point);
    }

    function clearSelection(restoreFocus = false) {
        focusedPosition.current = null;
        setSelected(null);
        if (restoreFocus) viewportRef.current?.focus({ preventScroll: true });
        if (window.location.hash.startsWith("#etapa-")) {
            window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
        }
    }

    useEffect(() => {
        function openHash() {
            const hash = window.location.hash.slice(1);
            const id = hash.startsWith("etapa-")
                ? nodes.find(node => node.id === hash.slice(6))?.id
                : sections.find(section => section.id === hash)?.nodes[0].id;
            if (!id) return;
            const point = nodesById.get(id)!.position;
            focusedPosition.current = point;
            setSelected(id);
            centerStep(point);
        }
        window.addEventListener("hashchange", openHash);
        const frame = window.requestAnimationFrame(openHash);
        return () => {
            window.removeEventListener("hashchange", openHash);
            window.cancelAnimationFrame(frame);
        };
    }, [centerStep]);

    const zoomAt = useCallback((factor: number, at?: Point) => {
        updateCamera((current, size) => {
            const zoom = clamp(current.zoom * factor, 0.15, 1.8);
            const anchor = at ?? { x: size.width / 2, y: size.height / 2 };
            const ratio = zoom / current.zoom;
            return { zoom, x: anchor.x - (anchor.x - current.x) * ratio, y: anchor.y - (anchor.y - current.y) * ratio };
        });
    }, [updateCamera]);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const onWheel = (event: WheelEvent) => {
            const mode = event.deltaMode;
            if (event.deltaY === 0) return;
            event.preventDefault();
            if (dragRef.current?.moved) return;

            const rect = viewport.getBoundingClientRect();
            const unit = mode === WheelEvent.DOM_DELTA_LINE ? 16
                : mode === WheelEvent.DOM_DELTA_PAGE ? rect.height : 1;
            const delta = clamp(event.deltaY * unit, -180, 180);
            zoomAt(Math.exp(-delta * 0.002), {
                x: event.clientX - rect.left, y: event.clientY - rect.top,
            });
        };
        viewport.addEventListener("wheel", onWheel, { passive: false });
        return () => viewport.removeEventListener("wheel", onWheel);
    }, [zoomAt]);

    function fitMap() {
        updateCamera((_, size) => fitCamera(size));
    }

    function moveNode(id: NodeId, point: Point) {
        const next = {
            x: clamp(point.x, 8, mapWidth - nodeWidth - 8),
            y: clamp(point.y, 45, mapHeight - nodeHeight - 8),
        };
        if (selected === id) focusedPosition.current = next;
        setPositions(current => ({ ...current, [id]: next }));
    }

    function pointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return;
        const node = event.target.closest<HTMLElement>("[data-move-node]")?.dataset.moveNode as NodeId | undefined;
        suppressClick.current = false;
        dragRef.current = {
            pointerId: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            origin: node ? positionOf(node, positions) : camera,
            node: node ?? null,
            moved: false,
        };
    }

    function pointerMove(event: PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.start.x;
        const dy = event.clientY - drag.start.y;
        if (!drag.moved) {
            if (Math.hypot(dx, dy) < 5) return;
            drag.moved = true;
            suppressClick.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
        }
        if (drag.node) {
            moveNode(drag.node, { x: drag.origin.x + dx / camera.zoom, y: drag.origin.y + dy / camera.zoom });
        } else {
            updateCamera(current => ({ ...current, x: drag.origin.x + dx, y: drag.origin.y + dy }));
        }
    }

    function endDrag(event: PointerEvent<HTMLDivElement>) {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setDragging(false);
    }

    function onMapKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.target !== event.currentTarget) return;
        const delta = panKeys[event.key];
        if (!delta) return;
        event.preventDefault();
        updateCamera(current => ({ ...current, x: current.x - delta.x, y: current.y - delta.y }));
    }

    const showingProfileFlow = selected !== null && profileFlowNodes.has(selected);
    const selectedPlatform = selected === "meta" || selected === "google" ? selected : null;
    const visibleEdges = edges.filter(({ from, to, showInOverview, profileFlow }) => {
        if (!selected) return showInOverview;
        if (from === selected || to === selected) return true;
        return showingProfileFlow && profileFlow && (from !== "delivery" || !selectedPlatform || to === selectedPlatform);
    });
    const relatedIds = new Set(visibleEdges.flatMap(({ from, to }) => [from, to]));
    const gridSize = Math.max(14, 24 * camera.zoom);

    const controlClass = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand";

    return (
        <section aria-labelledby="map-title" className="flex h-full flex-col overflow-hidden bg-white" onKeyDown={event => {
            if (event.key === "Escape" && selected && !(event.target instanceof HTMLSelectElement)) clearSelection(true);
        }}>
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
                <div>
                    <h1 id="map-title" className="text-base font-bold tracking-tight sm:text-lg">Mapa de rastreamento</h1>
                    <p id="map-instructions" className="text-xs text-slate-500">
                        Selecione uma etapa para seguir o fluxo. <span className="hidden sm:inline">Arraste para mover o mapa e role para ajustar o zoom.</span>
                    </p>
                </div>
                <label className="min-w-0 max-w-full">
                    <span className="sr-only">Ir para uma etapa</span>
                    <select value={selected ?? ""} onChange={event => {
                        if (event.target.value) selectStep(event.target.value as NodeId);
                        else clearSelection();
                    }} className="h-9 max-w-full cursor-pointer rounded-lg border border-border bg-white px-2 text-sm font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-brand sm:max-w-[280px]">
                        <option value="">Ir para uma etapa</option>
                        {sections.map(section => <optgroup key={section.id} label={section.title}>
                            {section.nodes.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
                        </optgroup>)}
                    </select>
                </label>
            </header>
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                <div className="relative min-h-0 min-w-0 flex-1">
                    <div
                        ref={viewportRef}
                        tabIndex={0}
                        role="group"
                        aria-label="Mapa interativo. Use as setas para navegar."
                        aria-describedby="map-instructions"
                        className={`relative h-full touch-none select-none overflow-clip bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
                        style={{
                            backgroundImage: "radial-gradient(circle, #cbd5e1 0.8px, transparent 0.95px)",
                            backgroundSize: `${gridSize}px ${gridSize}px`,
                            backgroundPosition: `${camera.x}px ${camera.y}px`,
                        }}
                        onPointerDown={pointerDown}
                        onPointerMove={pointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onLostPointerCapture={endDrag}
                        onKeyDown={onMapKeyDown}
                        onClickCapture={event => {
                            if (suppressClick.current && event.detail > 0) {
                                event.stopPropagation();
                                suppressClick.current = false;
                            }
                        }}
                        onClick={event => {
                            if (selected && event.target instanceof Element && !event.target.closest("button")) clearSelection();
                        }}
                    >
                        <div className="absolute left-0 top-0 origin-top-left" style={{
                            width: mapWidth, height: mapHeight,
                            transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`,
                        }}>
                            {columns.map((column, index) => (
                                <div key={column} className="pointer-events-none absolute top-[18px] border-b border-slate-300/70 pb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-slate-600"
                                    style={{ left: 22 + index * columnWidth, width: nodeWidth }}>{column}</div>
                            ))}
                            <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={mapWidth} height={mapHeight} fill="none">
                                <defs>
                                    <marker id="map-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse">
                                        <path d="M1 1 7 4 1 7" stroke="#64748b" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                    </marker>
                                    <marker id="map-arrow-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse">
                                        <path d="M1 1 7 4 1 7" stroke="var(--color-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </marker>
                                    <marker id="map-arrow-profile" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse">
                                        <path d="M1 1 7 4 1 7" stroke="var(--color-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </marker>
                                </defs>
                                {visibleEdges.map(({ from, to, lane, profileFlow }) => {
                                    const active = from === selected || to === selected;
                                    const color = active ? "var(--color-brand)" : profileFlow ? "var(--color-blue)" : "#64748b";
                                    const marker = active ? "map-arrow-active" : profileFlow ? "map-arrow-profile" : "map-arrow";
                                    return (
                                        <path key={`${from}-${to}`} d={edgePath(positionOf(from, positions), positionOf(to, positions), lane)}
                                            stroke={color} strokeWidth={active || profileFlow ? 2 : 1.3}
                                            opacity={active || profileFlow ? 1 : 0.65}
                                            strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#${marker})`} />
                                    );
                                })}
                            </svg>
                            {nodes.map(node => {
                                const point = positionOf(node.id, positions);
                                const active = selected === node.id;
                                const dimmed = selected && !active && !relatedIds.has(node.id);
                                const isClientProfile = node.id === "clientProfile";
                                const cardBorder = active ? `z-10 ring-2 ${node.style.selected}`
                                    : isClientProfile ? "border-blue hover:z-10" : "border-border hover:z-10 hover:border-slate-400";
                                const scheduled = Boolean(stepNotes[node.id]?.automation);
                                return (
                                    <div key={node.id} className={`group absolute rounded-xl border shadow-sm ${isClientProfile ? "bg-blue-soft" : "bg-white"} ${cardBorder} ${dimmed ? "opacity-45 hover:opacity-100 focus-within:opacity-100" : ""}`}
                                        style={{ left: point.x, top: point.y, width: nodeWidth, height: nodeHeight }}>
                                        <button type="button" aria-pressed={active} aria-label={node.title} aria-describedby={`map-caption-${node.id}`} onClick={event => selectStep(node.id, event.detail === 0)}
                                            className="flex h-full w-full cursor-pointer flex-col justify-center rounded-xl px-3 pr-7 text-left focus-visible:outline-2 focus-visible:outline-brand">
                                            <span className="mb-1 flex items-start gap-1.5">
                                                <span className={`mt-[5px] size-1.5 shrink-0 rounded-full ${node.style.dot}`} aria-hidden="true" />
                                                <span className="text-[13px] font-bold leading-[16px] text-slate-900">{node.title}</span>
                                            </span>
                                            <span id={`map-caption-${node.id}`} className="line-clamp-2 pl-3 text-xs leading-[14px] text-slate-600">
                                                {node.caption}
                                                {scheduled && <span className="sr-only">. Tarefa agendada.</span>}
                                            </span>
                                            {scheduled && (
                                                <span title="Tarefa agendada" className="absolute bottom-2 right-2 text-slate-500" aria-hidden="true">
                                                    <Clock size={13} />
                                                </span>
                                            )}
                                        </button>
                                        <button type="button" data-move-node={node.id} aria-label={`Mover etapa: ${node.title}`} title="Arraste para mover a etapa"
                                            className="absolute right-1 top-1 cursor-grab rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-brand pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
                                            onKeyDown={event => {
                                                const delta = panKeys[event.key];
                                                if (!delta) return;
                                                event.preventDefault();
                                                moveNode(node.id, { x: point.x + delta.x / 3, y: point.y + delta.y / 3 });
                                            }}>
                                            <Grip size={13} aria-hidden="true" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div role="group" aria-label="Controles do mapa" className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-xl border border-border bg-white p-1 shadow-sm">
                        <button type="button" aria-label="Diminuir zoom" title="Diminuir zoom" className={controlClass} onClick={() => zoomAt(1 / 1.2)}><Minus size={16} aria-hidden="true" /></button>
                        <span className="w-10 text-center text-xs font-semibold tabular-nums text-slate-500">{Math.round(camera.zoom * 100)}%</span>
                        <button type="button" aria-label="Aumentar zoom" title="Aumentar zoom" className={controlClass} onClick={() => zoomAt(1.2)}><Plus size={16} aria-hidden="true" /></button>
                        <span aria-hidden="true" className="mx-1 h-4 border-l border-border" />
                        <button type="button" className={controlClass} onClick={fitMap}><Maximize size={15} aria-hidden="true" /><span className="text-xs font-semibold">Ver tudo</span></button>
                        {Object.keys(positions).length > 0 && (
                            <button type="button" aria-label="Restaurar posição das etapas" title="Restaurar posição das etapas" className={controlClass} onClick={() => {
                                setPositions({});
                                clearSelection();
                                updateCamera((_, size) => initialCamera(size));
                            }}><RotateCcw size={15} aria-hidden="true" /></button>
                        )}
                    </div>
                </div>
                {step && <StepDetails key={step.id} node={step} onClose={() => clearSelection(true)} onSelect={selectStep} />}
            </div>
        </section>
    );
}
