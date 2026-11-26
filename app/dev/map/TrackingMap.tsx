// app/dev/map/TrackingMap.tsx
"use client";

import {
    ArrowDownLeft, ArrowUpRight, ChevronRight, ExternalLink, Grip,
    Maximize, Minus, Plus, RotateCcw, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { connections, sections, type NodeId } from "./trackingMapData";

const sourceRoot = "https://github.com/metrix0/engravidahub/blob/preview/";
const columns = ["Fontes", "Registros e sinais", "Processamento", "Regras", "Entrega e coortes", "Destinos e relatórios"];
const nodeWidth = 190;
const nodeHeight = 80;
const columnWidth = 236;
const rowHeight = 109;
const mapWidth = columnWidth * columns.length;
const mapHeight = 820;

const sectionStyles = {
    entrada: { dot: "bg-blue", selected: "border-blue ring-blue/20" },
    utm: { dot: "bg-blue", selected: "border-blue ring-blue/20" },
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

function initialCamera({ width, height }: Size): Camera {
    const zoom = clamp(Math.min((width - 24) / mapWidth, (height - 24) / mapHeight), 0.78, 1);
    return { x: Math.max(4, (width - mapWidth * zoom) / 2), y: Math.max(4, (height - mapHeight * zoom) / 2), zoom };
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
        return `M ${from.x + nodeWidth} ${from.y + nodeHeight / 2 + lane} H ${side} V ${to.y + nodeHeight / 2 + lane} H ${to.x + nodeWidth + 5}`;
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
    return (
        <aside aria-label="Detalhes da etapa" className="min-h-0 w-full overflow-y-auto border-t border-border bg-white p-4 sm:p-5 xl:w-[320px] xl:shrink-0 xl:border-l xl:border-t-0">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <span aria-hidden="true" className={`size-2 rounded-full ${node.style.dot}`} />
                        {node.section}
                    </div>
                    <h2 className="mt-1.5 text-lg font-bold leading-tight">{node.title}</h2>
                </div>
                <button type="button" aria-label="Fechar detalhes" onClick={onClose} className="cursor-pointer rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                    <X size={17} aria-hidden="true" />
                </button>
            </div>
            <dl className="my-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div><dt className="text-xs font-semibold text-slate-500">Entrada</dt><dd className="break-words text-sm">{node.input}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">Saída</dt><dd className="break-words text-sm">{node.output}</dd></div>
            </dl>
            <ul className="list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-slate-700">
                {node.rules.map(rule => <li key={rule}>{rule}</li>)}
            </ul>
            {([["Entradas conectadas", incoming, ArrowDownLeft], ["Saídas conectadas", outgoing, ArrowUpRight]] as const)
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
            <section className="mt-5 border-t border-slate-100 pt-3">
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
            </section>
        </aside>
    );
}

export default function TrackingMap() {
    const sectionRef = useRef<HTMLElement>(null);
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
                const focusClipped = focus && (!previous || (
                    size.width < previous.width &&
                    next.x + (focus.x + nodeWidth) * next.zoom > size.width - 8
                ));
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

    function clearSelection() {
        focusedPosition.current = null;
        setSelected(null);
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
            sectionRef.current?.scrollIntoView({ block: "start" });
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
        function onWheel(event: WheelEvent) {
            if (!viewport || (!event.ctrlKey && !event.metaKey)) return;
            event.preventDefault();
            const rect = viewport.getBoundingClientRect();
            zoomAt(event.deltaY < 0 ? 1.08 : 1 / 1.08, {
                x: event.clientX - rect.left, y: event.clientY - rect.top,
            });
        }
        viewport.addEventListener("wheel", onWheel, { passive: false });
        return () => viewport.removeEventListener("wheel", onWheel);
    }, [zoomAt]);

    function fitMap() {
        updateCamera((_, size) => {
            const zoom = clamp(Math.min((size.width - 24) / mapWidth, (size.height - 24) / mapHeight), 0.15, 1);
            return { zoom, x: (size.width - mapWidth * zoom) / 2, y: (size.height - mapHeight * zoom) / 2 };
        });
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

    const relatedIds = new Set<NodeId>();
    if (selected) {
        relatedIds.add(selected);
        for (const [from, to] of connections) {
            if (from === selected) relatedIds.add(to);
            if (to === selected) relatedIds.add(from);
        }
    }
    const edgeList = connections.map(([from, to], index) => ({
        from, to,
        lane: (index % 5 - 2) * 3,
        active: from === selected || to === selected,
    })).sort((a, b) => Number(a.active) - Number(b.active));

    const controlClass = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand";

    return (
        <section ref={sectionRef} aria-label="Fluxo de rastreamento" className="scroll-mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-3 py-2.5 sm:px-4">
                <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-600">
                    <span className="shrink-0">Etapa</span>
                    <select value={selected ?? ""} onChange={event => {
                        if (event.target.value) selectStep(event.target.value as NodeId);
                        else clearSelection();
                    }} className="h-9 min-w-0 max-w-[75vw] cursor-pointer rounded-lg border border-border bg-white px-2 text-sm font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-brand sm:max-w-[280px]">
                        <option value="">Todas as etapas</option>
                        {sections.map(section => <optgroup key={section.id} label={section.title}>
                            {section.nodes.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
                        </optgroup>)}
                    </select>
                </label>
                <div className="flex items-center gap-0.5">
                    <button type="button" aria-label="Diminuir zoom" title="Diminuir zoom" className={controlClass} onClick={() => zoomAt(1 / 1.2)}><Minus size={16} aria-hidden="true" /></button>
                    <span className="w-11 text-center text-xs font-semibold tabular-nums text-slate-500">{Math.round(camera.zoom * 100)}%</span>
                    <button type="button" aria-label="Aumentar zoom" title="Aumentar zoom" className={controlClass} onClick={() => zoomAt(1.2)}><Plus size={16} aria-hidden="true" /></button>
                    <span aria-hidden="true" className="mx-1 h-4 border-l border-border" />
                    <button type="button" aria-label="Enquadrar mapa" title="Enquadrar mapa" className={controlClass} onClick={fitMap}><Maximize size={15} aria-hidden="true" /><span className="hidden text-xs font-semibold sm:inline">Enquadrar</span></button>
                    <button type="button" aria-label="Restaurar layout" title="Restaurar layout" className={controlClass} onClick={() => {
                        setPositions({});
                        clearSelection();
                        updateCamera((_, size) => initialCamera(size));
                    }}><RotateCcw size={15} aria-hidden="true" /></button>
                </div>
            </div>
            <div className="flex flex-col xl:h-[min(76vh,840px)] xl:min-h-[510px] xl:flex-row">
                <div
                    ref={viewportRef}
                    tabIndex={0}
                    aria-label="Mapa interativo. Use as setas para navegar."
                    aria-describedby="map-instructions"
                    className={`relative h-[min(66dvh,620px)] min-h-[350px] min-w-0 touch-none select-none overflow-clip bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand xl:h-full xl:flex-1 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
                    style={{
                        backgroundImage: "radial-gradient(circle, #cbd5e1 0.8px, transparent 0.95px)",
                        backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
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
                            </defs>
                            {edgeList.map(({ from, to, lane, active }) => (
                                <path key={`${from}-${to}`} d={edgePath(positionOf(from, positions), positionOf(to, positions), lane)}
                                    stroke={active ? "var(--color-brand)" : "#64748b"} strokeWidth={active ? 2.2 : 1.2}
                                    opacity={active || !selected ? (active ? 1 : 0.59) : 0.15}
                                    strokeLinecap="round" strokeLinejoin="round"
                                    markerEnd={active ? "url(#map-arrow-active)" : "url(#map-arrow)"} />
                            ))}
                        </svg>
                        {nodes.map(node => {
                            const point = positionOf(node.id, positions);
                            const active = selected === node.id;
                            const dimmed = selected && !relatedIds.has(node.id);
                            return (
                                <div key={node.id} className={`group absolute rounded-xl border bg-white shadow-sm ${active ? `z-10 ring-2 ${node.style.selected}` : "border-border hover:z-10 hover:border-slate-400"} ${dimmed ? "opacity-45 hover:opacity-100 focus-within:opacity-100" : ""}`}
                                    style={{ left: point.x, top: point.y, width: nodeWidth, height: nodeHeight }}>
                                    <button type="button" aria-pressed={active} aria-label={node.title} onClick={event => selectStep(node.id, event.detail === 0)}
                                        className="flex h-full w-full cursor-pointer flex-col justify-center rounded-xl px-3 pr-7 text-left focus-visible:outline-2 focus-visible:outline-brand">
                                        <span className="mb-1 flex items-start gap-1.5">
                                            <span className={`mt-[5px] size-1.5 shrink-0 rounded-full ${node.style.dot}`} aria-hidden="true" />
                                            <span className="text-[13px] font-bold leading-[16px] text-slate-900">{node.title}</span>
                                        </span>
                                        <span className="line-clamp-2 pl-3 text-[11px] leading-[13px] text-slate-600">{"caption" in node ? node.caption : node.output}</span>
                                    </button>
                                    <button type="button" data-move-node={node.id} aria-label={`Mover etapa: ${node.title}`} title="Arraste para mover a etapa"
                                        className="absolute right-1 top-1 cursor-grab rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-brand"
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
                {step && <StepDetails key={step.id} node={step} onClose={clearSelection} onSelect={selectStep} />}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 text-xs text-slate-500">
                <p id="map-instructions">Arraste o mapa para navegar. Use a alça <Grip size={12} className="inline" aria-hidden="true" /> para mover uma etapa.</p>
                <p>{nodes.length} etapas · {connections.length} conexões</p>
            </div>
        </section>
    );
}
