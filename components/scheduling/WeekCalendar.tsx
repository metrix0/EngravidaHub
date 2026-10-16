// components/scheduling/WeekCalendar.tsx
"use client";

import {
    useMemo,
    useState,
    type DragEvent,
    type MouseEvent,
    type PointerEvent,
} from "react";
import { LoaderCircle, Plus, Trash2, X } from "lucide-react";

import Skeleton from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { AGENDA_COLORS, bookingTeamLabel } from "@/lib/scheduling/bookingOrigin";
import type { AgendaBlock, AgendaFreeSlot, OperationalAgendaReport } from "@/lib/scheduling/operationalAgenda";
import { formatDoctorName } from "@/lib/scheduling/formatDoctorName";
import { percent } from "./AgendaIndicators";
import type {
    AppointmentDayNote,
    CalendarAppointment,
} from "@/types/scheduling";

const START_HOUR = 7;
const END_HOUR = 20;
const HOUR_HEIGHT = 144;
const CALENDAR_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const TZ = "America/Sao_Paulo";

type Props = {
    weekDays: Date[];
    appointments: CalendarAppointment[];
    notes: AppointmentDayNote[];
    blocks?: AgendaBlock[];
    freeSlots?: AgendaFreeSlot[];
    doctorLoads?: OperationalAgendaReport["byDoctor"];
    onSelectFreeSlot?: (slot: AgendaFreeSlot) => void;
    selectedAppointmentId: string | null;
    loading: boolean;
    onSelectAppointment: (appointment: CalendarAppointment) => void;
    onMoveAppointment: (
        appointment: CalendarAppointment,
        startsAt: string,
        endsAt: string,
    ) => Promise<void>;
    onResizeAppointment: (
        appointment: CalendarAppointment,
        endsAt: string,
    ) => Promise<void>;
    onDeleteAppointment: (appointment: CalendarAppointment) => Promise<void>;
    onAddNote: (dateKey: string) => Promise<void>;
    onEditNote: (note: AppointmentDayNote) => Promise<void>;
    onDeleteNote: (note: AppointmentDayNote) => Promise<void>;
};

type Confirm = {
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    action: () => Promise<void>;
};

export default function WeekCalendar(props: Props) {
    const [resize, setResize] = useState<{ id: string; end: string } | null>(null);
    const [hovered, setHovered] = useState<string | null>(null);
    const [cursorGuide, setCursorGuide] = useState<{
        dayKey: string;
        minutes: number;
    } | null>(null);
    const [confirm, setConfirm] = useState<Confirm | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [confirmError, setConfirmError] = useState<string | null>(null);
    const freeOnly = props.freeSlots !== undefined;
    const loads = useMemo(() => new Map((props.doctorLoads ?? []).map(load => [`${load.unitId}:${load.doctorId}`, load])), [props.doctorLoads]);
    const freeSlotsByDay = useMemo(() => {
        const grouped = new Map<string, AgendaFreeSlot[]>();
        (props.freeSlots ?? []).forEach(slot => grouped.set(slot.date, [...(grouped.get(slot.date) ?? []), slot]));
        grouped.forEach(slots => slots.sort((a, b) =>
            (loads.get(`${a.unitId}:${a.doctorId}`)?.occupancy ?? 101) - (loads.get(`${b.unitId}:${b.doctorId}`)?.occupancy ?? 101)
            || a.startsAt.localeCompare(b.startsAt) || a.doctorName.localeCompare(b.doctorName)));
        return grouped;
    }, [props.freeSlots, loads]);

    const appointmentsByDay = useMemo(() => {
        const grouped = new Map<string, CalendarAppointment[]>();

        props.appointments.forEach((appointment) => {
            const dayKey = dateKeyIso(appointment.starts_at);
            const appointments = grouped.get(dayKey) ?? [];
            appointments.push(appointment);
            grouped.set(dayKey, appointments);
        });

        grouped.forEach((appointments) =>
            appointments.sort(
                (first, second) =>
                    +new Date(first.starts_at) - +new Date(second.starts_at),
            ),
        );

        return grouped;
    }, [props.appointments]);

    const appointmentLanesByDay = useMemo(() => {
        const result = new Map<string, ReturnType<typeof layoutConcurrentEvents>>();
        appointmentsByDay.forEach((items, day) => result.set(day, layoutConcurrentEvents(
            items.map(item => ({ id: item.id, start: Date.parse(item.starts_at), end: Date.parse(item.ends_at) })),
        )));
        return result;
    }, [appointmentsByDay]);

    const freeSlotLanesByDay = useMemo(() => {
        const result = new Map<string, ReturnType<typeof layoutConcurrentEvents>>();
        freeSlotsByDay.forEach((items, day) => result.set(day, layoutConcurrentEvents(
            items.map(item => ({ id: item.id, start: Date.parse(item.startsAt), end: Date.parse(item.endsAt) })),
        )));
        return result;
    }, [freeSlotsByDay]);

    const blocksByDay = useMemo(() => groupAgendaBlocks(props.blocks ?? []), [props.blocks]);
    const blockLanesByDay = useMemo(() => {
        const result = new Map<string, ReturnType<typeof layoutConcurrentEvents>>();
        blocksByDay.forEach((blocks, day) => result.set(day, layoutConcurrentEvents(
            blocks.filter(block => dateKeyIso(block.endsAt) === day).map(block => ({
                id: block.id, start: Date.parse(block.startsAt), end: Date.parse(block.endsAt),
            })),
        )));
        return result;
    }, [blocksByDay]);

    const notesByDay = useMemo(() => {
        const grouped = new Map<string, AppointmentDayNote[]>();

        props.notes.forEach((note) => {
            grouped.set(note.note_date, [
                ...(grouped.get(note.note_date) ?? []),
                note,
            ]);
        });

        return grouped;
    }, [props.notes]);

    function ask(nextConfirm: Confirm) {
        setConfirmError(null);
        setConfirm(nextConfirm);
    }

    async function runConfirm() {
        if (!confirm) return;

        setConfirming(true);
        setConfirmError(null);

        try {
            await confirm.action();
            setConfirm(null);
        } catch (error) {
            setConfirmError(
                error instanceof Error
                    ? error.message
                    : "Não foi possível concluir a ação.",
            );
        } finally {
            setConfirming(false);
        }
    }

    function beginResize(
        event: PointerEvent<HTMLButtonElement>,
        appointment: CalendarAppointment,
    ) {
        event.preventDefault();
        event.stopPropagation();

        const pointerY = event.clientY;
        const originalEnd = +new Date(appointment.ends_at);
        let latestEnd = originalEnd;

        function handlePointerMove(pointerEvent: globalThis.PointerEvent) {
            const deltaMinutes =
                Math.round(
                    (((pointerEvent.clientY - pointerY) / HOUR_HEIGHT) * 60) /
                        15,
                ) * 15;

            latestEnd = Math.max(
                originalEnd + deltaMinutes * 60_000,
                +new Date(appointment.starts_at) + 15 * 60_000,
            );

            setResize({
                id: appointment.id,
                end: new Date(latestEnd).toISOString(),
            });
        }

        function handlePointerUp() {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            setResize(null);

            if (latestEnd === originalEnd) return;

            const endsAt = new Date(latestEnd).toISOString();
            ask({
                title: "Alterar duração?",
                description: `Confirmar nova duração até ${time(endsAt)}?`,
                confirmLabel: "Confirmar",
                action: () => props.onResizeAppointment(appointment, endsAt),
            });
        }

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp, { once: true });
    }

    function handleDrop(event: DragEvent<HTMLDivElement>, day: Date) {
        event.preventDefault();

        const appointment = props.appointments.find(
            (item) =>
                item.id === event.dataTransfer.getData("appointment-id"),
        );
        if (!appointment) return;

        const bounds = event.currentTarget.getBoundingClientRect();
        const rawMinutes =
            START_HOUR * 60 +
            ((event.clientY - bounds.top) / HOUR_HEIGHT) * 60;
        const startsAtMinutes = Math.min(
            Math.max(Math.round(rawMinutes / 15) * 15, START_HOUR * 60),
            END_HOUR * 60 - 15,
        );
        const duration =
            +new Date(appointment.ends_at) -
            +new Date(appointment.starts_at);
        const startsAt = build(day, startsAtMinutes);
        const endsAt = new Date(+new Date(startsAt) + duration).toISOString();

        ask({
            title: "Mover agendamento?",
            description: `Mover ${appointment.patient_name} para ${dayLabel(day)} às ${time(startsAt)}?`,
            confirmLabel: "Mover",
            action: () =>
                props.onMoveAppointment(appointment, startsAt, endsAt),
        });
    }

    function updateCursorGuide(
        event: MouseEvent<HTMLDivElement>,
        dayKey: string,
    ) {
        const bounds = event.currentTarget.getBoundingClientRect();
        const rawMinutes =
            START_HOUR * 60 +
            ((event.clientY - bounds.top) / HOUR_HEIGHT) * 60;
        const snappedMinutes = Math.min(
            Math.max(Math.round(rawMinutes / 15) * 15, START_HOUR * 60),
            END_HOUR * 60,
        );

        setCursorGuide({ dayKey, minutes: snappedMinutes });
    }

    return (
        <>
            <div className="min-h-0 w-full flex-1 touch-pan-x touch-pan-y overflow-auto border-t border-slate-200 bg-white">
                {props.loading ? (
                    <WeekCalendarSkeleton freeOnly={freeOnly} />
                ) : (
                    <div className="min-w-[1180px]">
                        <div className="sticky top-0 z-40 grid grid-cols-[72px_repeat(7,minmax(150px,1fr))] border-b border-slate-200 bg-white">
                            <div className="border-r border-slate-200 bg-slate-50" />

                            {props.weekDays.map((day) => {
                                const dayKey = formatLocalDateKey(day);
                                const isToday =
                                    dayKey === formatLocalDateKey(new Date());

                                return (
                                    <div
                                        key={dayKey}
                                        className={`border-r border-slate-200 px-3 py-3 text-center last:border-r-0 ${
                                            isToday ? "bg-brand-soft/35" : ""
                                        }`}
                                    >
                                        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
                                            {new Intl.DateTimeFormat("pt-BR", {
                                                weekday: "short",
                                            })
                                                .format(day)
                                                .replace(".", "")}
                                        </div>
                                        <div
                                            className={`mt-1 text-sm font-bold ${
                                                isToday
                                                    ? "text-brand"
                                                    : "text-slate-800"
                                            }`}
                                        >
                                            {new Intl.DateTimeFormat("pt-BR", {
                                                day: "2-digit",
                                                month: "2-digit",
                                            }).format(day)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {!freeOnly ? <div className="grid grid-cols-[72px_repeat(7,minmax(150px,1fr))] border-b border-slate-200 bg-slate-50/60">
                            <div className="border-r border-slate-200 px-2 py-3 text-center text-[11px] font-bold uppercase text-slate-400">
                                Notas / bloqueios
                            </div>

                            {props.weekDays.map((day) => {
                                const dayKey = formatLocalDateKey(day);

                                return (
                                    <div
                                        key={dayKey}
                                        className="group/day min-h-16 border-r border-slate-200 p-2 last:border-r-0"
                                    >
                                        <div className="flex flex-wrap gap-1.5">
                                            <div className="max-h-24 w-full space-y-1 overflow-y-auto">
                                                {(blocksByDay.get(dayKey) ?? []).filter(block => !block.isLunch).map(block => (
                                                    <div key={block.id} className="rounded-md border-l-2 border-red-400 bg-red-50 px-2 py-1 text-[10px] text-red-700" title={`${block.doctorNames.join(", ")}: ${block.reason}`}>
                                                        <span className="block truncate font-semibold">{block.doctorNames.length === 1 ? block.doctorNames[0] : `${block.doctorNames.length} médicos`}</span>
                                                        <span className="block truncate">{time(block.startsAt)} – {dateKeyIso(block.endsAt) !== dayKey ? "24:00" : time(block.endsAt)} · {block.reason}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            {(notesByDay.get(dayKey) ?? []).map(
                                                (note) => (
                                                    <div
                                                        key={note.id}
                                                        className="group/note relative max-w-full"
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                void props.onEditNote(
                                                                    note,
                                                                )
                                                            }
                                                            className="max-w-full cursor-pointer truncate rounded-lg px-2 py-1 pr-6 text-left text-[11px] font-semibold text-white shadow-sm"
                                                            style={{
                                                                backgroundColor:
                                                                    note.color,
                                                            }}
                                                        >
                                                            {note.text}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                void props.onDeleteNote(
                                                                    note,
                                                                )
                                                            }
                                                            className="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-white opacity-0 hover:bg-black/15 group-hover/note:opacity-100"
                                                        >
                                                            <X size={11} />
                                                        </button>
                                                    </div>
                                                ),
                                            )}

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void props.onAddNote(dayKey)
                                                }
                                                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 opacity-50 hover:border-brand hover:bg-brand-soft hover:text-brand group-hover/day:opacity-100"
                                            >
                                                <Plus size={13} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div> : null}

                        <div className="relative isolate z-0 grid grid-cols-[72px_repeat(7,minmax(150px,1fr))]">
                            {cursorGuide && (
                                <div
                                    className="pointer-events-none absolute left-0 right-0 z-[95] border-t border-dashed border-slate-500/30"
                                    style={{
                                        top:
                                            ((cursorGuide.minutes -
                                                START_HOUR * 60) /
                                                60) *
                                            HOUR_HEIGHT,
                                    }}
                                >
                                    <span className="absolute left-2 top-0 flex w-14 -translate-y-1/2 items-center justify-center rounded-md border border-slate-200 bg-white/95 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500 shadow-sm">
                                        {minuteLabel(cursorGuide.minutes)}
                                    </span>
                                </div>
                            )}

                            <TimeAxis />

                            {props.weekDays.map((day) => {
                                const dayKey = formatLocalDateKey(day);
                                const appointments =
                                    appointmentsByDay.get(dayKey) ?? [];

                                return (
                                    <div
                                        key={dayKey}
                                        className="relative border-r border-slate-200 last:border-r-0"
                                        style={{
                                            height: CALENDAR_HEIGHT,
                                            backgroundImage: `repeating-linear-gradient(to bottom,transparent 0,transparent ${
                                                HOUR_HEIGHT / 2 - 1
                                            }px,rgb(226 232 240 / .72) ${
                                                HOUR_HEIGHT / 2
                                            }px,transparent ${
                                                HOUR_HEIGHT / 2 + 1
                                            }px)`,
                                        }}
                                        onMouseMove={(event) =>
                                            updateCursorGuide(event, dayKey)
                                        }
                                        onMouseLeave={() =>
                                            setCursorGuide((current) =>
                                                current?.dayKey === dayKey
                                                    ? null
                                                    : current,
                                            )
                                        }
                                        onDragOver={(event) =>
                                            event.preventDefault()
                                        }
                                        onDrop={(event) =>
                                            handleDrop(event, day)
                                        }
                                    >
                                        {(blocksByDay.get(dayKey) ?? []).map(block => {
                                            if (dateKeyIso(block.endsAt) !== dayKey) return null;
                                            const start = Math.max(START_HOUR * 60, minutes(block.startsAt));
                                            const end = Math.min(END_HOUR * 60, minutes(block.endsAt));
                                            if (end <= start) return null;
                                            const doctors = block.doctorNames.length === 1 ? block.doctorNames[0] : `${block.doctorNames.length} médicos`;
                                            const lane = blockLanesByDay.get(dayKey)?.get(block.id) ?? { column: 0, columns: 1 };
                                            return (
                                                <div key={block.id} title={`${block.doctorNames.join(", ")}: ${block.reason}`} className="absolute z-[1] overflow-hidden rounded-md border border-dashed border-red-300 bg-red-50/60 px-1 text-[10px] font-semibold text-red-700"
                                                    style={{
                                                        top: (start - START_HOUR * 60) / 60 * HOUR_HEIGHT,
                                                        height: (end - start) / 60 * HOUR_HEIGHT,
                                                        left: `calc(${lane.column / lane.columns * 100}% + 4px)`,
                                                        right: `calc(${(lane.columns - lane.column - 1) / lane.columns * 100}% + 4px)`,
                                                    }}>
                                                    <span className="block whitespace-normal break-words leading-tight">{block.reason} · {doctors}</span>
                                                </div>
                                            );
                                        })}
                                        {(freeSlotsByDay.get(dayKey) ?? []).map(slot => {
                                            const lane = freeSlotLanesByDay.get(dayKey)?.get(slot.id) ?? { column: 0, columns: 1 };
                                            const load = loads.get(`${slot.unitId}:${slot.doctorId}`);
                                            const loadLabel = load ? `${load.total} vagas brutas · ${load.available} livres · ${percent(load.occupancy)} ocupação` : "";
                                            const label = `${time(slot.startsAt)}–${time(slot.endsAt)} · ${formatDoctorName(slot.doctorName)} · ${slot.unitName}${loadLabel ? ` · ${loadLabel}` : ""}`;
                                            return <button key={slot.id} type="button" onClick={() => props.onSelectFreeSlot?.(slot)}
                                                aria-label={`Agendar ${label}`} title={label}
                                                onMouseEnter={() => setHovered(slot.id)} onMouseLeave={() => setHovered(current => current === slot.id ? null : current)}
                                                className="group absolute cursor-pointer overflow-hidden rounded-lg border border-white/70 px-2 py-1.5 text-left text-white shadow-sm transition hover:shadow-md focus-visible:z-[90] focus-visible:outline-2 focus-visible:outline-slate-900"
                                                style={{ top: Math.max(0, (minutes(slot.startsAt) - START_HOUR * 60) / 60 * HOUR_HEIGHT), height: Math.max(1, slot.durationMinutes / 60 * HOUR_HEIGHT - 2), left: `calc(${lane.column / lane.columns * 100}% + 4px)`, right: `calc(${(lane.columns - lane.column - 1) / lane.columns * 100}% + 4px)`, zIndex: hovered === slot.id ? 20 : 5 + lane.column, backgroundColor: AGENDA_COLORS.available }}>
                                                <div className="text-[10px] font-bold leading-tight opacity-90">{time(slot.startsAt)}–{time(slot.endsAt)}</div>
                                                <div className="mt-0.5 truncate text-[11px] font-bold leading-tight">{formatDoctorName(slot.doctorName)}</div>
                                                <div className="mt-0.5 truncate text-[11px] font-semibold leading-tight opacity-95">{load ? `${percent(load.occupancy)} ocupação · ${load.total} vagas brutas` : slot.unitName}</div>
                                            </button>;
                                        })}
                                        {appointments.map((appointment) => {
                                            const endsAt =
                                                resize?.id === appointment.id
                                                    ? resize.end
                                                    : appointment.ends_at;
                                            const startsAtMinutes = minutes(
                                                appointment.starts_at,
                                            );
                                            const endsAtMinutes =
                                                minutes(endsAt);
                                            const top =
                                                ((startsAtMinutes -
                                                    START_HOUR * 60) /
                                                    60) *
                                                HOUR_HEIGHT;
                                            const height = Math.max(
                                                ((endsAtMinutes -
                                                    startsAtMinutes) /
                                                    60) *
                                                    HOUR_HEIGHT,
                                                1,
                                            ) - 2;
                                            const lane = appointmentLanesByDay.get(dayKey)?.get(appointment.id) ?? { column: 0, columns: 1 };
                                            const isSelected =
                                                props.selectedAppointmentId ===
                                                appointment.id;
                                            const isHovered =
                                                hovered === appointment.id;

                                            return (
                                                <div
                                                    key={appointment.id}
                                                    title={`${bookingTeamLabel(appointment.booking_team)} · ${appointment.patient_name}`}
                                                    draggable
                                                    onDragStart={(event) => {
                                                        event.dataTransfer.effectAllowed =
                                                            "move";
                                                        event.dataTransfer.setData(
                                                            "appointment-id",
                                                            appointment.id,
                                                        );
                                                    }}
                                                    onMouseEnter={() =>
                                                        setHovered(
                                                            appointment.id,
                                                        )
                                                    }
                                                    onMouseLeave={() =>
                                                        setHovered((current) =>
                                                            current ===
                                                            appointment.id
                                                                ? null
                                                                : current,
                                                        )
                                                    }
                                                    onClick={() =>
                                                        props.onSelectAppointment(
                                                            appointment,
                                                        )
                                                    }
                                                    className={`group absolute cursor-grab overflow-hidden rounded-lg border border-white/70 px-2 py-1.5 text-white shadow-sm transition hover:shadow-md active:cursor-grabbing ${
                                                        isSelected
                                                            ? "ring-2 ring-slate-950/20"
                                                            : ""
                                                    }`}
                                                    style={{
                                                        top: Math.max(0, top),
                                                        height,
                                                        left: `calc(${lane.column / lane.columns * 100}% + 4px)`,
                                                        right: `calc(${(lane.columns - lane.column - 1) / lane.columns * 100}% + 4px)`,
                                                        zIndex: isHovered
                                                            ? 20
                                                            : isSelected
                                                              ? 35
                                                              : 5 + lane.column,
                                                        backgroundColor:
                                                            appointment.status === "cancelled" ? "#94a3b8" : AGENDA_COLORS[appointment.booking_team ?? "unknown"],
                                                    }}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            ask({
                                                                title: "Excluir agendamento?",
                                                                description: `O agendamento de ${appointment.patient_name} será removido permanentemente.`,
                                                                confirmLabel:
                                                                    "Excluir",
                                                                danger: true,
                                                                action: () =>
                                                                    props.onDeleteAppointment(
                                                                        appointment,
                                                                    ),
                                                            });
                                                        }}
                                                        className="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded opacity-0 hover:bg-white/20 group-hover:opacity-100"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>

                                                    <div className="pr-5 text-[10px] font-bold leading-tight opacity-90">
                                                        {time(
                                                            appointment.starts_at,
                                                        )}
                                                        –{time(endsAt)}
                                                    </div>
                                                    <div className="mt-0.5 whitespace-normal break-words text-[11px] font-bold leading-tight">
                                                        {appointment.doctor
                                                            ?.name ??
                                                            "Sem médico"}
                                                    </div>
                                                    <div className="mt-0.5 whitespace-normal break-words text-[11px] font-semibold leading-tight opacity-95">
                                                        {
                                                            appointment.patient_name
                                                        }
                                                    </div>
                                                    <button
                                                        type="button"
                                                        aria-label="Redimensionar agendamento"
                                                        title="Arraste para alterar a duração"
                                                        onPointerDown={(event) =>
                                                            beginResize(
                                                                event,
                                                                appointment,
                                                            )
                                                        }
                                                        className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize bg-transparent"
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            <Modal
                open={!!confirm}
                onClose={() => !confirming && setConfirm(null)}
                width={440}
                height="auto"
                maxHeight="calc(100vh - 48px)"
                closeOnOverlayClick={!confirming}
                showCloseButton={!confirming}
                panelClassName="p-6"
                zIndexClassName="z-[120]"
            >
                <div className="pr-10">
                    <div className="text-lg font-bold text-slate-950">
                        {confirm?.title}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500">
                        {confirm?.description}
                    </p>
                    {confirmError && (
                        <div className="mt-4 rounded-xl border border-red/20 bg-red-soft px-3 py-2 text-sm font-semibold text-red">
                            {confirmError}
                        </div>
                    )}
                </div>

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        type="button"
                        disabled={confirming}
                        onClick={() => setConfirm(null)}
                        className="h-10 cursor-pointer rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        disabled={confirming}
                        onClick={runConfirm}
                        className={`flex h-10 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-60 ${
                            confirm?.danger ? "bg-red" : "bg-brand"
                        }`}
                    >
                        {confirming && (
                            <LoaderCircle size={15} className="animate-spin" />
                        )}
                        {confirm?.confirmLabel}
                    </button>
                </div>
            </Modal>
        </>
    );
}

const SKELETON_EVENT_LAYOUTS = [
    [
        { top: 34, height: 78 },
        { top: 226, height: 104 },
        { top: 520, height: 72 },
    ],
    [
        { top: 104, height: 96 },
        { top: 356, height: 70 },
        { top: 674, height: 112 },
    ],
    [
        { top: 50, height: 120 },
        { top: 286, height: 84 },
        { top: 616, height: 78 },
    ],
    [
        { top: 160, height: 72 },
        { top: 410, height: 108 },
        { top: 742, height: 74 },
    ],
    [
        { top: 76, height: 90 },
        { top: 332, height: 120 },
        { top: 602, height: 84 },
    ],
    [
        { top: 198, height: 98 },
        { top: 486, height: 76 },
        { top: 770, height: 104 },
    ],
    [
        { top: 124, height: 76 },
        { top: 390, height: 96 },
        { top: 648, height: 116 },
    ],
] as const;

function WeekCalendarSkeleton({ freeOnly }: { freeOnly: boolean }) {
    return (
        <div
            className="min-w-[1180px]"
            aria-label="Carregando calendário de agendamentos"
            aria-busy="true"
        >
            <div className="sticky top-0 z-40 grid grid-cols-[72px_repeat(7,minmax(150px,1fr))] border-b border-slate-200 bg-white">
                <div className="border-r border-slate-200 bg-slate-50" />

                {Array.from({ length: 7 }).map((_, index) => (
                    <div
                        key={index}
                        className="flex flex-col items-center border-r border-slate-200 px-3 py-3 last:border-r-0"
                    >
                        <Skeleton className="h-3 w-12 rounded-md" />
                        <Skeleton className="mt-2 h-4 w-14 rounded-md" />
                    </div>
                ))}
            </div>

            {!freeOnly ? <div className="grid grid-cols-[72px_repeat(7,minmax(150px,1fr))] border-b border-slate-200 bg-slate-50/60">
                <div className="flex min-h-16 items-center justify-center border-r border-slate-200">
                    <Skeleton className="h-3 w-10 rounded-md" />
                </div>

                {Array.from({ length: 7 }).map((_, index) => (
                    <div
                        key={index}
                        className="min-h-16 border-r border-slate-200 p-2 last:border-r-0"
                    >
                        <div className="flex flex-wrap gap-1.5">
                            <Skeleton
                                className={`h-6 rounded-lg ${
                                    index % 3 === 0
                                        ? "w-24"
                                        : index % 3 === 1
                                          ? "w-16"
                                          : "w-20"
                                }`}
                            />
                            {index % 2 === 0 && (
                                <Skeleton className="h-6 w-10 rounded-lg" />
                            )}
                        </div>
                    </div>
                ))}
            </div> : null}

            <div className="grid grid-cols-[72px_repeat(7,minmax(150px,1fr))]">
                <div
                    className="relative border-r border-slate-200 bg-white"
                    style={{ height: CALENDAR_HEIGHT }}
                >
                    {Array.from(
                        { length: END_HOUR - START_HOUR + 1 },
                        (_, index) => (
                            <div
                                key={index}
                                className="absolute right-3 w-10 -translate-y-1/2"
                                style={{ top: index * HOUR_HEIGHT }}
                            >
                                <Skeleton className="h-3 w-full rounded-md" />
                            </div>
                        ),
                    )}
                </div>

                {SKELETON_EVENT_LAYOUTS.map((events, dayIndex) => (
                    <div
                        key={dayIndex}
                        className="relative border-r border-slate-200 last:border-r-0"
                        style={{
                            height: CALENDAR_HEIGHT,
                            backgroundImage: `repeating-linear-gradient(to bottom,transparent 0,transparent ${
                                HOUR_HEIGHT / 2 - 1
                            }px,rgb(226 232 240 / .72) ${
                                HOUR_HEIGHT / 2
                            }px,transparent ${HOUR_HEIGHT / 2 + 1}px)`,
                        }}
                    >
                        {events.map((event, eventIndex) => (
                            <div
                                key={eventIndex}
                                className="absolute left-2 right-2"
                                style={{
                                    top: event.top,
                                    height: event.height,
                                }}
                            >
                                <Skeleton className="h-full w-full rounded-lg" />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function TimeAxis() {
    return (
        <div
            className="relative border-r border-slate-200 bg-white"
            style={{ height: CALENDAR_HEIGHT }}
        >
            {Array.from(
                { length: END_HOUR - START_HOUR + 1 },
                (_, index) => START_HOUR + index,
            ).map((hour) => (
                <div
                    key={hour}
                    className="absolute right-3 -translate-y-1/2 text-[11px] font-semibold text-slate-400"
                    style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
                >
                    {String(hour).padStart(2, "0")}:00
                </div>
            ))}
        </div>
    );
}

type GroupedAgendaBlock = AgendaBlock & { doctorNames: string[]; isLunch: boolean };

function groupAgendaBlocks(blocks: AgendaBlock[]) {
    const byDay = new Map<string, GroupedAgendaBlock[]>();
    const groups = new Map<string, { block: GroupedAgendaBlock; doctors: Set<string> }>();
    for (const block of blocks) {
        const isLunch = block.reason.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("almoco");
        const key = [block.date, block.startsAt, block.endsAt, isLunch ? "almoco" : block.reason].join("|");
        let group = groups.get(key);
        if (!group) {
            const groupedBlock = { ...block, reason: isLunch ? "Almoço" : block.reason, doctorNames: [], isLunch };
            group = { block: groupedBlock, doctors: new Set<string>() };
            groups.set(key, group);
            byDay.set(block.date, [...(byDay.get(block.date) ?? []), groupedBlock]);
        }
        const doctorKey = `${block.unitId}:${block.doctorId}`;
        if (!group.doctors.has(doctorKey)) {
            group.doctors.add(doctorKey);
            group.block.doctorNames.push(block.doctorName);
        }
    }
    return byDay;
}

function layoutConcurrentEvents(events: Array<{ id: string; start: number; end: number }>) {
    const layout = new Map<string, { column: number; columns: number }>();
    const sorted = [...events].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    let group: Array<{ id: string; column: number }> = [];
    let laneEnds: number[] = [];
    let groupEnd = -Infinity;
    const finish = () => {
        for (const item of group) layout.set(item.id, { column: item.column, columns: laneEnds.length });
        group = [];
        laneEnds = [];
    };
    for (const event of sorted) {
        if (group.length && event.start >= groupEnd) finish();
        let column = laneEnds.findIndex(end => end <= event.start);
        if (column === -1) column = laneEnds.length;
        laneEnds[column] = event.end;
        group.push({ id: event.id, column });
        groupEnd = Math.max(groupEnd, event.end);
    }
    finish();
    return layout;
}

function parts(value: string) {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(value));
}

function minutes(value: string) {
    const dateParts = parts(value);
    return (
        +(dateParts.find((part) => part.type === "hour")?.value ?? 0) * 60 +
        +(dateParts.find((part) => part.type === "minute")?.value ?? 0)
    );
}

function time(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function dateKeyIso(value: string) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(value));
}

function minuteLabel(minutesValue: number) {
    return `${String(Math.floor(minutesValue / 60)).padStart(2, "0")}:${String(
        minutesValue % 60,
    ).padStart(2, "0")}`;
}

function build(day: Date, minutesValue: number) {
    return new Date(
        `${formatLocalDateKey(day)}T${String(
            Math.floor(minutesValue / 60),
        ).padStart(2, "0")}:${String(minutesValue % 60).padStart(
            2,
            "0",
        )}:00-03:00`,
    ).toISOString();
}

function dayLabel(day: Date) {
    return new Intl.DateTimeFormat("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
    }).format(day);
}

export function formatLocalDateKey(day: Date) {
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(
        2,
        "0",
    )}-${String(day.getDate()).padStart(2, "0")}`;
}
