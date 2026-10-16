// components/scheduling/WeekCalendar.tsx
"use client";

import {
    useMemo,
    useState,
    type DragEvent,
    type MouseEvent,
    type PointerEvent,
} from "react";
import { ChevronRight, LoaderCircle, Plus, Trash2, X } from "lucide-react";

import Skeleton from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { AGENDA_COLORS, bookingTeamLabel } from "@/lib/scheduling/bookingOrigin";
import type { AgendaBlock, AgendaFreeSlot, OperationalAgendaReport } from "@/lib/scheduling/operationalAgenda";
import { formatDoctorName } from "@/lib/scheduling/formatDoctorName";
import { AGENDA_NOTE_COLOR, percent } from "./AgendaIndicators";
import type {
    AppointmentDayNote,
    CalendarAppointment,
} from "@/types/scheduling";

const START_HOUR = 7;
const END_HOUR = 20;
const HOUR_HEIGHT = 176;
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
    const [expandedGroup, setExpandedGroup] = useState<CalendarAppointment[] | null>(null);
    const [expandedFreeSlots, setExpandedFreeSlots] = useState<AgendaFreeSlot[] | null>(null);
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

    const groupedAppointmentsByDay = useMemo(() => {
        const result = new Map<string, ReturnType<typeof splitAppointmentGroups>>();
        appointmentsByDay.forEach((items, day) => result.set(day, splitAppointmentGroups(items)));
        return result;
    }, [appointmentsByDay]);

    const appointmentLanesByDay = useMemo(() => {
        const result = new Map<string, ReturnType<typeof layoutConcurrentEvents>>();
        groupedAppointmentsByDay.forEach(({ individual }, day) => result.set(day, layoutConcurrentEvents(
            individual.map(item => ({ id: item.id, start: Date.parse(item.starts_at), end: Date.parse(item.ends_at) })),
        )));
        return result;
    }, [groupedAppointmentsByDay]);

    const freeSlotGroupsByDay = useMemo(() => {
        const result = new Map<string, ReturnType<typeof groupFreeSlotStarts>>();
        freeSlotsByDay.forEach((items, day) => result.set(day, groupFreeSlotStarts(items)));
        return result;
    }, [freeSlotsByDay]);

    const blocksByDay = useMemo(() => groupAgendaBlocks(props.blocks ?? []), [props.blocks]);
    const displayedBlocksByDay = useMemo(() => {
        const result = new Map<string, ReturnType<typeof groupOverlappingAgendaBlocks>>();
        blocksByDay.forEach((blocks, day) => result.set(day, groupOverlappingAgendaBlocks(
            blocks.filter(block => dateKeyIso(block.endsAt) === day),
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
                                Notas
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
                                                            className="max-w-full cursor-pointer truncate rounded-lg px-2 py-1 pr-6 text-left text-[11px] font-semibold text-slate-900 shadow-sm"
                                                            style={{ backgroundColor: AGENDA_NOTE_COLOR }}
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
                                                            className="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-slate-900 opacity-0 hover:bg-black/15 group-hover/note:opacity-100"
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
                                const { individual: appointments, groups: appointmentGroups } =
                                    groupedAppointmentsByDay.get(dayKey) ?? { individual: [], groups: [] };

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
                                        {(displayedBlocksByDay.get(dayKey) ?? []).map(group => {
                                            const start = Math.max(START_HOUR * 60, minutes(group.startsAt));
                                            const end = Math.min(END_HOUR * 60, minutes(group.endsAt));
                                            if (end <= start) return null;
                                            const names = [...new Set(group.blocks.flatMap(block => block.doctorNames))];
                                            const label = group.blocks.length === 1
                                                ? `${group.blocks[0].reason} · ${names.length === 1 ? names[0] : `${names.length} médicos`}`
                                                : group.blocks.every(block => block.isLunch)
                                                    ? `Almoço · ${names.length} médicos`
                                                    : `${group.blocks.length} bloqueios`;
                                            return (
                                                <div key={group.id} className="absolute left-1 right-1 z-[1] overflow-hidden rounded-md border border-dashed border-red-300 bg-red-50/60 px-2 py-1 text-[10px] font-semibold text-red-700"
                                                    style={{
                                                        top: (start - START_HOUR * 60) / 60 * HOUR_HEIGHT,
                                                        height: (end - start) / 60 * HOUR_HEIGHT,
                                                    }}>
                                                    <div className="flex h-full min-h-0 flex-col gap-1">
                                                        <span className="shrink-0 leading-tight">{label}</span>
                                                        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                                                            {group.blocks.flatMap(block => block.doctorNames.map((doctor, index) => (
                                                                <div key={`${block.id}:${index}`} className="min-w-0 border-t border-red-200/60 pt-1 first:border-t-0 first:pt-0">
                                                                    <span className="block break-words leading-tight">{doctor}</span>
                                                                    <span className="block text-[9px] font-medium leading-tight opacity-80">
                                                                        {time(block.startsAt)}–{time(block.endsAt)}{!block.isLunch && group.blocks.length > 1 ? ` · ${block.reason}` : ""}
                                                                    </span>
                                                                </div>
                                                            )))}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {(freeSlotGroupsByDay.get(dayKey) ?? []).map(group => {
                                            const first = group.slots[0];
                                            const single = group.slots.length === 1;
                                            const load = loads.get(`${first.unitId}:${first.doctorId}`);
                                            const card = (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                if (single) props.onSelectFreeSlot?.(first);
                                                                else setExpandedFreeSlots(group.slots);
                                                            }}
                                                            aria-label={single
                                                                ? `Agendar ${time(first.startsAt)}–${time(first.endsAt)} · ${first.doctorName}`
                                                                : `Ver ${group.slots.length} horários livres com início entre ${minuteLabel(group.startMinutes)} e ${minuteLabel(group.startMinutes + 29)}`}
                                                            className="flex h-full w-full cursor-pointer flex-col items-start justify-center overflow-hidden rounded-lg border border-white/70 px-2 py-1.5 text-left text-white shadow-sm transition hover:shadow-md"
                                                            style={{ backgroundColor: AGENDA_COLORS.available }}
                                                        >
                                                            <span className="block text-[10px] font-bold leading-tight">
                                                                {single ? `${time(first.startsAt)}–${time(first.endsAt)}` : `Inícios ${minuteLabel(group.startMinutes)}–${minuteLabel(group.startMinutes + 29)}`}
                                                            </span>
                                                            {single ? (
                                                                <>
                                                                    <span className="mt-0.5 block whitespace-normal break-words text-[11px] font-bold leading-tight">
                                                                        {formatDoctorName(first.doctorName)}
                                                                    </span>
                                                                    {load ? <span className="mt-0.5 block text-[10px] font-semibold leading-tight">{percent(load.occupancy)} · {load.available}/{load.total} vagas</span> : null}
                                                                </>
                                                            ) : (
                                                                <span className="mt-0.5 flex w-full items-center justify-between gap-1 text-[11px] font-bold leading-tight">
                                                                    <span>{group.slots.length} horários livres</span>
                                                                    <ChevronRight size={14} className="shrink-0" />
                                                                </span>
                                                            )}
                                                        </button>
                                            );
                                            return (
                                                <div
                                                    key={group.id}
                                                    className="absolute left-1 right-1 z-10 [&>span]:flex [&>span]:h-full [&>span]:w-full [&>span>span]:flex [&>span>span]:h-full [&>span>span]:w-full"
                                                    style={{
                                                        top: (group.startMinutes - START_HOUR * 60) / 60 * HOUR_HEIGHT + 3,
                                                        height: HOUR_HEIGHT / 2 - 6,
                                                    }}
                                                >
                                                    {single ? card : (
                                                    <InfoTooltip
                                                        portal
                                                        widthClassName="w-[380px]"
                                                        text={
                                                            <span className="block max-h-72 overflow-y-auto">
                                                                <span className="mb-2 block font-bold text-slate-800">
                                                                    {group.slots.length} {group.slots.length === 1 ? "horário livre" : "horários livres"}
                                                                </span>
                                                                {group.slots.map(slot => {
                                                                    const capacity = loads.get(`${slot.unitId}:${slot.doctorId}`);
                                                                    return (
                                                                        <span key={slot.id} className="block border-t border-slate-100 py-1.5">
                                                                            <span className="block font-semibold">{time(slot.startsAt)}–{time(slot.endsAt)} · {formatDoctorName(slot.doctorName)}</span>
                                                                            {capacity ? <span className="block break-words">{percent(capacity.occupancy)} ocupação · {capacity.available}/{capacity.total} vagas</span> : null}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </span>
                                                        }
                                                    >
                                                        {card}
                                                    </InfoTooltip>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {appointmentGroups.map(group => {
                                            const start = minutes(group.startsAt);
                                            const end = minutes(group.endsAt);
                                            return (
                                                <div
                                                    key={group.id}
                                                    className="absolute z-10 [&>span]:flex [&>span]:h-full [&>span]:w-full [&>span>span]:flex [&>span>span]:h-full [&>span>span]:w-full"
                                                    style={{
                                                        top: Math.max(0, (start - START_HOUR * 60) / 60 * HOUR_HEIGHT + 3),
                                                        height: Math.max(1, (end - start) / 60 * HOUR_HEIGHT - 6),
                                                        left: 4,
                                                        right: 4,
                                                    }}
                                                >
                                                    <InfoTooltip
                                                        portal
                                                        widthClassName="w-[360px]"
                                                        text={
                                                            <span className="block max-h-72 overflow-y-auto">
                                                                <span className="mb-2 block font-bold text-slate-800">{group.appointments.length} agendamentos</span>
                                                                {group.appointments.map(appointment => (
                                                                    <span key={appointment.id} className="flex gap-2 border-t border-slate-100 py-1.5">
                                                                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: appointmentColor(appointment) }} />
                                                                        <span className="min-w-0">
                                                                            <span className="block font-semibold">{time(appointment.starts_at)}–{time(appointment.ends_at)} · {appointment.doctor?.name ?? "Sem médico"}</span>
                                                                            <span className="block break-words">{appointment.patient_name}</span>
                                                                        </span>
                                                                    </span>
                                                                ))}
                                                            </span>
                                                        }
                                                    >
                                                        <button
                                                            type="button"
                                                            aria-label={`${group.appointments.length} agendamentos entre ${time(group.startsAt)} e ${time(group.endsAt)}. Clique para ver todos.`}
                                                            onClick={() => setExpandedGroup(group.appointments)}
                                                            className="flex h-full w-full cursor-pointer flex-col items-start justify-center gap-0.5 overflow-hidden rounded-lg border border-white/70 bg-slate-600 px-2 py-1 text-left text-white shadow-sm transition hover:shadow-md"
                                                        >
                                                            <span className="text-[10px] font-bold">{time(group.startsAt)}–{time(group.endsAt)}</span>
                                                            <span className="flex w-full items-center justify-between gap-1 text-[11px] font-bold">
                                                                <span>{group.appointments.length} agendamentos</span>
                                                                <ChevronRight size={14} className="shrink-0" />
                                                            </span>
                                                        </button>
                                                    </InfoTooltip>
                                                </div>
                                            );
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
                                                1,
                                                ((endsAtMinutes - startsAtMinutes) / 60) * HOUR_HEIGHT - 6,
                                            );
                                            const compact = endsAtMinutes - startsAtMinutes <= 15;
                                            const lane = appointmentLanesByDay.get(dayKey)?.get(appointment.id) ?? { column: 0, columns: 1 };
                                            const isSelected =
                                                props.selectedAppointmentId ===
                                                appointment.id;
                                            const isHovered =
                                                hovered === appointment.id;

                                            return (
                                                <div
                                                    key={appointment.id}
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
                                                    className={`group absolute cursor-grab overflow-hidden rounded-lg border border-white/70 px-2 py-1 text-white shadow-sm transition hover:shadow-md active:cursor-grabbing ${
                                                        isSelected
                                                            ? "ring-2 ring-slate-950/20"
                                                            : ""
                                                    }`}
                                                    style={{
                                                        top: Math.max(0, top + 3),
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
                                                        <span className="relative block h-full w-full">
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

                                                    <span className="block pr-5 text-[10px] font-bold leading-tight opacity-90">
                                                        {time(
                                                            appointment.starts_at,
                                                        )}
                                                        –{time(endsAt)}
                                                    </span>
                                                    <span className="block mt-0.5 whitespace-normal break-words text-[11px] font-bold leading-tight">
                                                        {appointment.doctor
                                                            ?.name ??
                                                            "Sem médico"}
                                                    </span>
                                                    {!compact ? (
                                                        <span className="block mt-0.5 whitespace-normal break-words text-[11px] font-semibold leading-tight opacity-95">
                                                            {appointment.patient_name}
                                                        </span>
                                                    ) : null}
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
                                                        </span>

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
                open={expandedFreeSlots !== null}
                onClose={() => setExpandedFreeSlots(null)}
                width={540}
                height="auto"
                maxHeight="calc(100vh - 48px)"
                panelClassName="p-6"
                zIndexClassName="z-[120]"
            >
                <div className="pr-10">
                    <h2 className="text-lg font-bold text-slate-950">Horários livres</h2>
                    <p className="mt-1 text-sm text-slate-500">Selecione o médico e horário para agendar.</p>
                </div>
                <div className="mt-4 max-h-[65vh] space-y-2 overflow-y-auto">
                    {expandedFreeSlots?.map(slot => {
                        const capacity = loads.get(`${slot.unitId}:${slot.doctorId}`);
                        return (
                            <button
                                key={slot.id}
                                type="button"
                                onClick={() => {
                                    setExpandedFreeSlots(null);
                                    props.onSelectFreeSlot?.(slot);
                                }}
                                className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:bg-slate-50"
                            >
                                <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: AGENDA_COLORS.available }} />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-xs font-semibold text-slate-500">{time(slot.startsAt)}–{time(slot.endsAt)} · {slot.unitName}</span>
                                    <span className="mt-1 block break-words text-sm font-bold text-slate-900">{formatDoctorName(slot.doctorName)}</span>
                                    {capacity ? <span className="block text-xs text-slate-600">{percent(capacity.occupancy)} ocupação · {capacity.available}/{capacity.total} vagas</span> : null}
                                </span>
                                <ChevronRight size={16} className="mt-2 shrink-0 text-slate-400" />
                            </button>
                        );
                    })}
                </div>
            </Modal>

            <Modal
                open={expandedGroup !== null}
                onClose={() => setExpandedGroup(null)}
                width={540}
                height="auto"
                maxHeight="calc(100vh - 48px)"
                panelClassName="p-6"
                zIndexClassName="z-[120]"
            >
                <div className="pr-10">
                    <h2 className="text-lg font-bold text-slate-950">Agendamentos no período</h2>
                    <p className="mt-1 text-sm text-slate-500">Selecione um agendamento para abrir os detalhes.</p>
                </div>
                <div className="mt-4 max-h-[65vh] space-y-2 overflow-y-auto">
                    {expandedGroup?.map(appointment => (
                        <button
                            key={appointment.id}
                            type="button"
                            onClick={() => {
                                setExpandedGroup(null);
                                props.onSelectAppointment(appointment);
                            }}
                            className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:bg-slate-50"
                        >
                            <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: appointmentColor(appointment) }} />
                            <span className="min-w-0 flex-1">
                                <span className="block text-xs font-semibold text-slate-500">{time(appointment.starts_at)}–{time(appointment.ends_at)} · {bookingTeamLabel(appointment.booking_team)}</span>
                                <span className="mt-1 block break-words text-sm font-bold text-slate-900">{appointment.doctor?.name ?? "Sem médico"}</span>
                                <span className="block break-words text-sm text-slate-600">{appointment.patient_name}</span>
                            </span>
                            <ChevronRight size={16} className="mt-2 shrink-0 text-slate-400" />
                        </button>
                    ))}
                </div>
            </Modal>

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

function groupOverlappingAgendaBlocks(blocks: GroupedAgendaBlock[]) {
    const groups: Array<{ id: string; startsAt: string; endsAt: string; blocks: GroupedAgendaBlock[] }> = [];
    const sorted = [...blocks].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
    for (const block of sorted) {
        const last = groups[groups.length - 1];
        if (last && Date.parse(block.startsAt) < Date.parse(last.endsAt)) {
            last.blocks.push(block);
            if (Date.parse(block.endsAt) > Date.parse(last.endsAt)) last.endsAt = block.endsAt;
        } else {
            groups.push({ id: `blocked:${block.id}`, startsAt: block.startsAt, endsAt: block.endsAt, blocks: [block] });
        }
    }
    return groups;
}

function groupFreeSlotStarts(slots: AgendaFreeSlot[]) {
    const groups = new Map<number, { id: string; startMinutes: number; slots: AgendaFreeSlot[] }>();
    for (const slot of slots) {
        const startMinutes = Math.floor(minutes(slot.startsAt) / 30) * 30;
        const group = groups.get(startMinutes);
        if (group) group.slots.push(slot);
        else groups.set(startMinutes, { id: `free-start:${slot.date}:${startMinutes}`, startMinutes, slots: [slot] });
    }
    return [...groups.values()].sort((a, b) => a.startMinutes - b.startMinutes);
}

function appointmentColor(appointment: CalendarAppointment) {
    return appointment.status === "cancelled" ? "#94a3b8" : AGENDA_COLORS[appointment.booking_team ?? "unknown"];
}

type AppointmentGroup = {
    id: string;
    startsAt: string;
    endsAt: string;
    appointments: CalendarAppointment[];
};

function splitAppointmentGroups(appointments: CalendarAppointment[]) {
    const groups: AppointmentGroup[] = [];
    const individual: CalendarAppointment[] = [];
    let current: CalendarAppointment[] = [];
    let activeEnds: number[] = [];
    let currentEnd = -Infinity;
    let maximumConcurrent = 0;

    function finish() {
        if (!current.length) return;
        if (maximumConcurrent >= 3 || (maximumConcurrent === 2 && current.some(item => Date.parse(item.ends_at) - Date.parse(item.starts_at) <= 30 * 60_000))) {
            const endsAt = current.reduce(
                (latest, item) => Date.parse(item.ends_at) > Date.parse(latest) ? item.ends_at : latest,
                current[0].ends_at,
            );
            groups.push({
                id: `group:${current[0].id}`,
                startsAt: current[0].starts_at,
                endsAt,
                appointments: current,
            });
        } else {
            individual.push(...current);
        }
        current = [];
        activeEnds = [];
        currentEnd = -Infinity;
        maximumConcurrent = 0;
    }

    for (const appointment of appointments) {
        const startsAt = Date.parse(appointment.starts_at);
        const endsAt = Date.parse(appointment.ends_at);
        if (current.length && startsAt >= currentEnd) finish();
        activeEnds = activeEnds.filter(end => end > startsAt);
        activeEnds.push(endsAt);
        maximumConcurrent = Math.max(maximumConcurrent, activeEnds.length);
        currentEnd = Math.max(currentEnd, endsAt);
        current.push(appointment);
    }
    finish();
    return { groups, individual };
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
