// components/scheduling/WeekCalendar.tsx
"use client";

import { useMemo, useState, type DragEvent, type PointerEvent } from "react";
import { GripHorizontal, Plus, Trash2, X } from "lucide-react";

import type {
    AppointmentDayNote,
    CalendarAppointment,
} from "@/types/scheduling";

const START_HOUR = 7;
const END_HOUR = 20;
const SLOT_MINUTES = 30;
const HOUR_HEIGHT = 72;
const CALENDAR_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const MIN_EVENT_HEIGHT = 34;
const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

type WeekCalendarProps = {
    weekDays: Date[];
    appointments: CalendarAppointment[];
    notes: AppointmentDayNote[];
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

type ResizePreview = {
    appointmentId: string;
    endsAt: string;
};

export default function WeekCalendar({
    weekDays,
    appointments,
    notes,
    selectedAppointmentId,
    loading,
    onSelectAppointment,
    onMoveAppointment,
    onResizeAppointment,
    onDeleteAppointment,
    onAddNote,
    onEditNote,
    onDeleteNote,
}: WeekCalendarProps) {
    const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);

    const appointmentsByDay = useMemo(() => {
        const map = new Map<string, CalendarAppointment[]>();

        for (const appointment of appointments) {
            const key = getBrazilDateKey(appointment.starts_at);
            const current = map.get(key) ?? [];
            current.push(appointment);
            map.set(key, current);
        }

        for (const dayAppointments of map.values()) {
            dayAppointments.sort(
                (left, right) =>
                    new Date(left.starts_at).getTime() -
                    new Date(right.starts_at).getTime(),
            );
        }

        return map;
    }, [appointments]);

    const notesByDay = useMemo(() => {
        const map = new Map<string, AppointmentDayNote[]>();
        for (const note of notes) {
            const current = map.get(note.note_date) ?? [];
            current.push(note);
            map.set(note.note_date, current);
        }
        return map;
    }, [notes]);

    function beginResize(
        event: PointerEvent<HTMLButtonElement>,
        appointment: CalendarAppointment,
    ) {
        event.preventDefault();
        event.stopPropagation();

        const startY = event.clientY;
        const originalEnd = new Date(appointment.ends_at).getTime();
        let latestEnd = originalEnd;

        function handlePointerMove(pointerEvent: globalThis.PointerEvent) {
            const deltaMinutes = roundToStep(
                ((pointerEvent.clientY - startY) / HOUR_HEIGHT) * 60,
                15,
            );
            const minimumEnd = new Date(appointment.starts_at).getTime() + 15 * 60_000;
            latestEnd = Math.max(originalEnd + deltaMinutes * 60_000, minimumEnd);

            setResizePreview({
                appointmentId: appointment.id,
                endsAt: new Date(latestEnd).toISOString(),
            });
        }

        async function handlePointerUp() {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            setResizePreview(null);

            if (latestEnd === originalEnd) return;

            const confirmed = window.confirm(
                `Confirmar nova duração até ${formatBrazilTime(new Date(latestEnd).toISOString())}?`,
            );

            if (!confirmed) return;
            await onResizeAppointment(
                appointment,
                new Date(latestEnd).toISOString(),
            );
        }

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp, { once: true });
    }

    async function handleDrop(
        event: DragEvent<HTMLDivElement>,
        day: Date,
    ) {
        event.preventDefault();
        const appointmentId = event.dataTransfer.getData("appointment-id");
        const appointment = appointments.find((item) => item.id === appointmentId);
        if (!appointment) return;

        const rect = event.currentTarget.getBoundingClientRect();
        const rawMinutes =
            START_HOUR * 60 +
            ((event.clientY - rect.top) / HOUR_HEIGHT) * 60;
        const startMinutes = clamp(
            roundToStep(rawMinutes, 15),
            START_HOUR * 60,
            END_HOUR * 60 - 15,
        );
        const duration =
            new Date(appointment.ends_at).getTime() -
            new Date(appointment.starts_at).getTime();
        const startsAt = buildBrazilDateTime(day, startMinutes);
        const endsAt = new Date(new Date(startsAt).getTime() + duration).toISOString();

        const confirmed = window.confirm(
            `Mover ${appointment.patient_name} para ${formatDayLabel(day)} às ${formatBrazilTime(startsAt)}?`,
        );

        if (!confirmed) return;
        await onMoveAppointment(appointment, startsAt, endsAt);
    }

    return (
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="min-w-[1180px]">
                <div className="sticky top-0 z-40 grid grid-cols-[72px_repeat(7,minmax(150px,1fr))] border-b border-slate-200 bg-white">
                    <div className="border-r border-slate-200 bg-slate-50" />
                    {weekDays.map((day) => {
                        const key = formatLocalDateKey(day);
                        const isToday = key === formatLocalDateKey(new Date());
                        return (
                            <div
                                key={key}
                                className={`border-r border-slate-200 px-3 py-3 text-center last:border-r-0 ${
                                    isToday ? "bg-brand-soft/35" : "bg-white"
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
                                        isToday ? "text-brand" : "text-slate-800"
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

                <div className="grid grid-cols-[72px_repeat(7,minmax(150px,1fr))] border-b border-slate-200 bg-slate-50/60">
                    <div className="border-r border-slate-200 px-2 py-3 text-center text-[11px] font-bold uppercase text-slate-400">
                        Notas
                    </div>
                    {weekDays.map((day) => {
                        const key = formatLocalDateKey(day);
                        const dayNotes = notesByDay.get(key) ?? [];

                        return (
                            <div
                                key={key}
                                className="group/day min-h-16 border-r border-slate-200 p-2 last:border-r-0"
                            >
                                <div className="flex flex-wrap gap-1.5">
                                    {dayNotes.map((note) => (
                                        <div
                                            key={note.id}
                                            className="group/note relative max-w-full"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => void onEditNote(note)}
                                                className="max-w-full cursor-pointer truncate rounded-lg px-2 py-1 pr-6 text-left text-[11px] font-semibold text-white shadow-sm"
                                                style={{ backgroundColor: note.color }}
                                                title={note.text}
                                            >
                                                {note.text}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void onDeleteNote(note)}
                                                className="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-white opacity-0 transition group-hover/note:opacity-100 hover:bg-black/15"
                                                aria-label="Excluir nota"
                                            >
                                                <X size={11} />
                                            </button>
                                        </div>
                                    ))}

                                    <button
                                        type="button"
                                        onClick={() => void onAddNote(key)}
                                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 opacity-50 transition hover:border-brand hover:bg-brand-soft hover:text-brand group-hover/day:opacity-100"
                                        title="Adicionar nota ao dia"
                                    >
                                        <Plus size={13} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="relative grid grid-cols-[72px_repeat(7,minmax(150px,1fr))]">
                    <TimeAxis />
                    {weekDays.map((day) => {
                        const key = formatLocalDateKey(day);
                        const dayAppointments = appointmentsByDay.get(key) ?? [];

                        return (
                            <div
                                key={key}
                                className="relative border-r border-slate-200 last:border-r-0"
                                style={{
                                    height: CALENDAR_HEIGHT,
                                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_HEIGHT / 2 - 1}px, rgb(226 232 240 / 0.72) ${HOUR_HEIGHT / 2}px, transparent ${HOUR_HEIGHT / 2 + 1}px)`,
                                }}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => void handleDrop(event, day)}
                            >
                                {dayAppointments.map((appointment) => {
                                    const previewEnd =
                                        resizePreview?.appointmentId === appointment.id
                                            ? resizePreview.endsAt
                                            : appointment.ends_at;
                                    const startMinutes = getBrazilMinutes(
                                        appointment.starts_at,
                                    );
                                    const endMinutes = getBrazilMinutes(previewEnd);
                                    const top =
                                        ((startMinutes - START_HOUR * 60) / 60) *
                                        HOUR_HEIGHT;
                                    const height = Math.max(
                                        ((endMinutes - startMinutes) / 60) *
                                            HOUR_HEIGHT,
                                        MIN_EVENT_HEIGHT,
                                    );
                                    const overlapIndex = getOverlapIndex(
                                        appointment,
                                        dayAppointments,
                                    );
                                    const selected =
                                        selectedAppointmentId === appointment.id;
                                    const color = appointment.doctor?.color ?? "#7c3aed";

                                    return (
                                        <div
                                            key={appointment.id}
                                            draggable
                                            onDragStart={(event) => {
                                                event.dataTransfer.effectAllowed = "move";
                                                event.dataTransfer.setData(
                                                    "appointment-id",
                                                    appointment.id,
                                                );
                                            }}
                                            onClick={() => onSelectAppointment(appointment)}
                                            className={`group absolute cursor-grab overflow-hidden rounded-lg border border-white/70 px-2 py-1.5 text-white shadow-sm transition hover:brightness-95 active:cursor-grabbing ${
                                                selected
                                                    ? "ring-2 ring-slate-950/20"
                                                    : ""
                                            }`}
                                            style={{
                                                top: Math.max(0, top),
                                                height,
                                                left: 4 + overlapIndex * 9,
                                                right: 4,
                                                zIndex: selected ? 35 : 5 + overlapIndex,
                                                backgroundColor: color,
                                            }}
                                            title={`${formatBrazilTime(appointment.starts_at)} · ${appointment.doctor?.name ?? "Médico"} · ${appointment.patient_name}`}
                                        >
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    if (
                                                        window.confirm(
                                                            `Excluir o agendamento de ${appointment.patient_name}?`,
                                                        )
                                                    ) {
                                                        void onDeleteAppointment(appointment).catch(
                                                            (error: unknown) => {
                                                                window.alert(
                                                                    error instanceof Error
                                                                        ? error.message
                                                                        : "Não foi possível excluir o agendamento.",
                                                                );
                                                            },
                                                        );
                                                    }
                                                }}
                                                className="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded bg-black/10 opacity-0 transition hover:bg-black/20 group-hover:opacity-100"
                                                aria-label="Excluir agendamento"
                                            >
                                                <Trash2 size={12} />
                                            </button>

                                            <div className="pr-5 text-[10px] font-bold leading-tight opacity-90">
                                                {formatBrazilTime(appointment.starts_at)}–
                                                {formatBrazilTime(previewEnd)}
                                            </div>
                                            <div className="mt-0.5 truncate text-[11px] font-bold leading-tight">
                                                {appointment.doctor?.name ?? "Sem médico"}
                                            </div>
                                            <div className="mt-0.5 truncate text-[11px] font-semibold leading-tight opacity-95">
                                                {appointment.patient_name}
                                            </div>

                                            <button
                                                type="button"
                                                onPointerDown={(event) =>
                                                    beginResize(event, appointment)
                                                }
                                                className="absolute bottom-0 left-0 flex h-4 w-full cursor-ns-resize items-center justify-center bg-black/5 opacity-0 transition group-hover:opacity-100"
                                                title="Arrastar para alterar duração"
                                            >
                                                <GripHorizontal size={13} />
                                            </button>
                                        </div>
                                    );
                                })}

                                {loading && (
                                    <div className="absolute inset-0 z-30 animate-pulse bg-white/55" />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function TimeAxis() {
    const labels = Array.from(
        { length: END_HOUR - START_HOUR + 1 },
        (_, index) => START_HOUR + index,
    );

    return (
        <div
            className="relative border-r border-slate-200 bg-white"
            style={{ height: CALENDAR_HEIGHT }}
        >
            {labels.map((hour) => (
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

function getOverlapIndex(
    appointment: CalendarAppointment,
    appointments: CalendarAppointment[],
) {
    const start = new Date(appointment.starts_at).getTime();
    const overlappingBefore = appointments.filter((other) => {
        if (other.id === appointment.id) return false;
        const otherStart = new Date(other.starts_at).getTime();
        const otherEnd = new Date(other.ends_at).getTime();
        return otherStart <= start && otherEnd > start && otherStart <= start;
    });

    const ordered = [...overlappingBefore, appointment].sort((left, right) => {
        const dateDiff =
            new Date(left.starts_at).getTime() -
            new Date(right.starts_at).getTime();
        return dateDiff || left.id.localeCompare(right.id);
    });

    return Math.min(ordered.findIndex((item) => item.id === appointment.id), 5);
}

function getBrazilMinutes(value: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: BRAZIL_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(value));
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(
        parts.find((part) => part.type === "minute")?.value ?? 0,
    );
    return hour * 60 + minute;
}

function getBrazilDateKey(value: string) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: BRAZIL_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(value));
}

function formatBrazilTime(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: BRAZIL_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function buildBrazilDateTime(day: Date, minutes: number) {
    const dateKey = formatLocalDateKey(day);
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return new Date(
        `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`,
    ).toISOString();
}

function formatLocalDateKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(date: Date) {
    return new Intl.DateTimeFormat("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
    }).format(date);
}

function roundToStep(value: number, step: number) {
    return Math.round(value / step) * step;
}

function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(Math.max(value, minimum), maximum);
}

export { formatLocalDateKey };
