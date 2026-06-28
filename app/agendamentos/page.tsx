// app/agendamentos/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    CalendarCheck,
    ChevronLeft,
    ChevronRight,
    MapPin,
    RefreshCw,
    Search,
    Stethoscope,
} from "lucide-react";

import {
    AdvancedFilterButton,
    SidePanel,
    Skeleton,
} from "@/components";
import FilterButton from "@/components/ui/FilterButton";
import SchedulingPanel from "@/components/inbox/SchedulingPanel";
import AppointmentDetailsPanel from "@/components/scheduling/AppointmentDetailsPanel";
import WeekCalendar, {
    formatLocalDateKey,
} from "@/components/scheduling/WeekCalendar";
import type {
    AppointmentDayNote,
    AppointmentStatus,
    CalendarAppointment,
    SchedulingDoctorOption,
    SchedulingUnitOption,
} from "@/types/scheduling";

const STATUS_OPTIONS = [
    { label: "Agendado", value: "scheduled" },
    { label: "Confirmado", value: "confirmed" },
    { label: "Concluído", value: "completed" },
    { label: "Cancelado", value: "cancelled" },
    { label: "Não compareceu", value: "no_show" },
];

const FORMAT_OPTIONS = [
    { label: "Congelamento", value: "congelamento" },
    { label: "Casal", value: "casal" },
];

export default function AppointmentsPage() {
    const [weekStart, setWeekStart] = useState(() => startOfWeekSunday(new Date()));
    const [units, setUnits] = useState<SchedulingUnitOption[]>([]);
    const [doctors, setDoctors] = useState<SchedulingDoctorOption[]>([]);
    const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
    const [notes, setNotes] = useState<AppointmentDayNote[]>([]);
    const [selectedAppointmentId, setSelectedAppointmentId] =
        useState<string | null>(null);
    const [schedulingPanelOpen, setSchedulingPanelOpen] = useState(false);

    const [unitValues, setUnitValues] = useState<string[]>([]);
    const [doctorValues, setDoctorValues] = useState<string[]>([]);
    const [statusValues, setStatusValues] = useState<string[]>([]);
    const [formatValues, setFormatValues] = useState<string[]>([]);
    const [search, setSearch] = useState("");

    const [loadingOptions, setLoadingOptions] = useState(true);
    const [loadingCalendar, setLoadingCalendar] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    const weekDays = useMemo(
        () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
        [weekStart],
    );
    const rangeStart = formatLocalDateKey(weekStart);
    const rangeEnd = formatLocalDateKey(addDays(weekStart, 7));

    const visibleDoctors = useMemo(() => {
        const filtered = unitValues.length === 0
            ? doctors
            : doctors.filter((doctor) => unitValues.includes(doctor.unit_id));

        return Array.from(
            new Map(filtered.map((doctor) => [doctor.id, doctor])).values(),
        );
    }, [doctors, unitValues]);

    const selectedAppointment = useMemo(
        () =>
            appointments.find(
                (appointment) => appointment.id === selectedAppointmentId,
            ) ?? null,
        [appointments, selectedAppointmentId],
    );

    const visibleNotes = useMemo(
        () =>
            notes.filter((note) => {
                const unitMatches =
                    !note.unit_id ||
                    unitValues.length === 0 ||
                    unitValues.includes(note.unit_id);
                const doctorMatches =
                    !note.doctor_id ||
                    doctorValues.length === 0 ||
                    doctorValues.includes(note.doctor_id);
                return unitMatches && doctorMatches;
            }),
        [notes, unitValues, doctorValues],
    );

    const advancedFilterSections = useMemo(
        () => [
            {
                id: "status",
                title: "Status",
                options: STATUS_OPTIONS,
                values: statusValues,
                onChange: setStatusValues,
            },
            {
                id: "format",
                title: "Formato",
                options: FORMAT_OPTIONS,
                values: formatValues,
                onChange: setFormatValues,
            },
        ],
        [statusValues, formatValues],
    );

    useEffect(() => {
        let active = true;

        async function loadOptions() {
            setLoadingOptions(true);
            try {
                const response = await fetch("/api/scheduling/options", {
                    cache: "no-store",
                });
                const json = await response.json();
                if (!response.ok) {
                    throw new Error(
                        json?.error ?? "Não foi possível carregar os filtros.",
                    );
                }
                if (!active) return;
                setUnits(json.units ?? []);
                setDoctors(json.doctors ?? []);
            } catch (loadError) {
                if (!active) return;
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Não foi possível carregar os filtros.",
                );
            } finally {
                if (active) setLoadingOptions(false);
            }
        }

        void loadOptions();
        return () => {
            active = false;
        };
    }, []);

    const loadCalendar = useCallback(async (signal?: AbortSignal) => {
        setLoadingCalendar(true);
        setError(null);

        try {
            const params = new URLSearchParams({
                start: rangeStart,
                end: rangeEnd,
            });

            for (const value of unitValues) params.append("unit_ids", value);
            for (const value of doctorValues) params.append("doctor_ids", value);
            for (const value of statusValues) params.append("statuses", value);
            for (const value of formatValues) params.append("formats", value);
            if (search.trim()) params.set("search", search.trim());

            const [appointmentsResponse, notesResponse] = await Promise.all([
                fetch(`/api/scheduling/appointments?${params.toString()}`, {
                    cache: "no-store",
                    signal,
                }),
                fetch(
                    `/api/scheduling/day-notes?start=${rangeStart}&end=${rangeEnd}`,
                    { cache: "no-store", signal },
                ),
            ]);

            const [appointmentsJson, notesJson] = await Promise.all([
                appointmentsResponse.json(),
                notesResponse.json(),
            ]);

            if (!appointmentsResponse.ok) {
                throw new Error(
                    appointmentsJson?.error ??
                        "Não foi possível carregar os agendamentos.",
                );
            }
            if (!notesResponse.ok) {
                throw new Error(
                    notesJson?.error ?? "Não foi possível carregar as notas.",
                );
            }

            setAppointments(appointmentsJson.appointments ?? []);
            setNotes(notesJson.notes ?? []);
        } catch (loadError) {
            if (signal?.aborted) return;
            setError(
                loadError instanceof Error
                    ? loadError.message
                    : "Não foi possível carregar o calendário.",
            );
        } finally {
            if (!signal?.aborted) setLoadingCalendar(false);
        }
    }, [
        rangeStart,
        rangeEnd,
        unitValues,
        doctorValues,
        statusValues,
        formatValues,
        search,
    ]);

    useEffect(() => {
        const controller = new AbortController();
        void loadCalendar(controller.signal);
        return () => controller.abort();
    }, [loadCalendar, reloadKey]);

    useEffect(() => {
        function handleAppointmentChanged() {
            setReloadKey((current) => current + 1);
        }

        window.addEventListener("appointments:changed", handleAppointmentChanged);
        return () =>
            window.removeEventListener(
                "appointments:changed",
                handleAppointmentChanged,
            );
    }, []);

    function handleUnitFilterChange(values: string[]) {
        setUnitValues(values);
        if (values.length === 0) return;
        setDoctorValues((current) =>
            current.filter((doctorId) =>
                doctors.some(
                    (doctor) =>
                        doctor.id === doctorId &&
                        values.includes(doctor.unit_id),
                ),
            ),
        );
    }

    async function updateAppointment(
        appointment: CalendarAppointment,
        payload: Record<string, unknown>,
        optimisticPatch?: Partial<CalendarAppointment>,
    ) {
        const previous = appointment;

        if (optimisticPatch) {
            setAppointments((current) =>
                current.map((item) =>
                    item.id === appointment.id
                        ? { ...item, ...optimisticPatch }
                        : item,
                ),
            );
        }

        try {
            const response = await fetch(
                `/api/scheduling/appointments/${appointment.id}`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                },
            );
            const json = await response.json();

            if (!response.ok) {
                throw new Error(
                    json?.error ?? "Não foi possível atualizar o agendamento.",
                );
            }

            const saved = json.appointment as CalendarAppointment;
            setAppointments((current) =>
                current.map((item) => (item.id === saved.id ? saved : item)),
            );
            return saved;
        } catch (updateError) {
            if (optimisticPatch) {
                setAppointments((current) =>
                    current.map((item) =>
                        item.id === previous.id ? previous : item,
                    ),
                );
            }
            throw updateError;
        }
    }

    async function handleMoveAppointment(
        appointment: CalendarAppointment,
        startsAt: string,
        endsAt: string,
    ) {
        try {
            await updateAppointment(
                appointment,
                { startsAt, endsAt },
                { starts_at: startsAt, ends_at: endsAt },
            );
        } catch (moveError) {
            window.alert(
                moveError instanceof Error
                    ? moveError.message
                    : "Não foi possível mover o agendamento.",
            );
        }
    }

    async function handleResizeAppointment(
        appointment: CalendarAppointment,
        endsAt: string,
    ) {
        try {
            await updateAppointment(
                appointment,
                { endsAt },
                { ends_at: endsAt },
            );
        } catch (resizeError) {
            window.alert(
                resizeError instanceof Error
                    ? resizeError.message
                    : "Não foi possível alterar a duração.",
            );
        }
    }

    async function handleSaveAppointment(
        appointment: CalendarAppointment,
        input: {
            startsAt: string;
            endsAt: string;
            unitId: string;
            doctorId: string;
            status: AppointmentStatus;
            procedureName: string;
            notes: string;
        },
    ) {
        const saved = await updateAppointment(appointment, input);
        setSelectedAppointmentId(saved.id);
    }

    async function handleDeleteAppointment(appointment: CalendarAppointment) {
        const previous = appointments;
        setAppointments((current) =>
            current.filter((item) => item.id !== appointment.id),
        );

        try {
            const response = await fetch(
                `/api/scheduling/appointments/${appointment.id}`,
                { method: "DELETE" },
            );
            const json = await response.json();
            if (!response.ok) {
                throw new Error(
                    json?.error ?? "Não foi possível excluir o agendamento.",
                );
            }
            setSelectedAppointmentId((current) =>
                current === appointment.id ? null : current,
            );
        } catch (deleteError) {
            setAppointments(previous);
            throw deleteError;
        }
    }

    async function handleAddNote(dateKey: string) {
        const text = window.prompt("Nota para este dia:");
        if (!text?.trim()) return;

        try {
            const response = await fetch("/api/scheduling/day-notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    noteDate: dateKey,
                    unitId: unitValues.length === 1 ? unitValues[0] : null,
                    doctorId:
                        doctorValues.length === 1 ? doctorValues[0] : null,
                    text: text.trim(),
                    color: "#f59e0b",
                }),
            });
            const json = await response.json();
            if (!response.ok) {
                throw new Error(json?.error ?? "Não foi possível criar a nota.");
            }
            setNotes((current) => [...current, json.note]);
        } catch (noteError) {
            window.alert(
                noteError instanceof Error
                    ? noteError.message
                    : "Não foi possível criar a nota.",
            );
        }
    }

    async function handleEditNote(note: AppointmentDayNote) {
        const text = window.prompt("Editar nota:", note.text);
        if (!text?.trim() || text.trim() === note.text) return;

        try {
            const response = await fetch(
                `/api/scheduling/day-notes/${note.id}`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: text.trim() }),
                },
            );
            const json = await response.json();
            if (!response.ok) {
                throw new Error(json?.error ?? "Não foi possível editar a nota.");
            }
            setNotes((current) =>
                current.map((item) =>
                    item.id === note.id ? json.note : item,
                ),
            );
        } catch (noteError) {
            window.alert(
                noteError instanceof Error
                    ? noteError.message
                    : "Não foi possível editar a nota.",
            );
        }
    }

    async function handleDeleteNote(note: AppointmentDayNote) {
        if (!window.confirm("Excluir esta nota?")) return;

        const previous = notes;
        setNotes((current) => current.filter((item) => item.id !== note.id));

        try {
            const response = await fetch(
                `/api/scheduling/day-notes/${note.id}`,
                { method: "DELETE" },
            );
            const json = await response.json();
            if (!response.ok) {
                throw new Error(json?.error ?? "Não foi possível excluir a nota.");
            }
        } catch (noteError) {
            setNotes(previous);
            window.alert(
                noteError instanceof Error
                    ? noteError.message
                    : "Não foi possível excluir a nota.",
            );
        }
    }

    const unitOptions = units.map((unit) => ({
        label: unit.name,
        value: unit.id,
    }));
    const doctorOptions = visibleDoctors.map((doctor) => ({
        label: doctor.name,
        value: doctor.id,
    }));

    return (
        <main className="flex h-screen w-full overflow-hidden bg-white text-slate-900">
            <SidePanel />

            <section className="flex min-w-0 flex-1 flex-col px-7 py-7">
                <header className="mb-5 flex shrink-0 items-start justify-between gap-6">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                            Agendamentos
                        </h1>
                        <p className="mt-1 text-sm text-slate-500">
                            Agenda semanal por unidade e médico
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setSchedulingPanelOpen(true)}
                            className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90"
                        >
                            <CalendarCheck size={17} />
                            Agendar
                        </button>
                        <button
                            type="button"
                            onClick={() => setWeekStart(startOfWeekSunday(new Date()))}
                            className="h-10 cursor-pointer rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-selection"
                        >
                            Hoje
                        </button>
                        <button
                            type="button"
                            onClick={() => setWeekStart((current) => addDays(current, -7))}
                            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-selection"
                            aria-label="Semana anterior"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <div className="min-w-52 text-center text-sm font-bold text-slate-700">
                            {formatWeekRange(weekDays)}
                        </div>
                        <button
                            type="button"
                            onClick={() => setWeekStart((current) => addDays(current, 7))}
                            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-selection"
                            aria-label="Próxima semana"
                        >
                            <ChevronRight size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setReloadKey((current) => current + 1)}
                            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-selection hover:text-slate-900"
                            title="Atualizar"
                        >
                            <RefreshCw
                                size={17}
                                className={loadingCalendar ? "animate-spin" : ""}
                            />
                        </button>
                    </div>
                </header>

                <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
                    <div className="flex h-11 min-w-[230px] flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-sm">
                        <Search size={17} className="shrink-0 text-slate-400" />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Buscar paciente ou procedimento..."
                            className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                        />
                    </div>

                    {loadingOptions ? (
                        <>
                            <Skeleton className="h-11 w-[220px] rounded-xl" />
                            <Skeleton className="h-11 w-[220px] rounded-xl" />
                        </>
                    ) : (
                        <>
                            <FilterButton
                                icon={<MapPin size={16} />}
                                label="Todas as unidades"
                                options={unitOptions}
                                values={unitValues}
                                onChange={handleUnitFilterChange}
                                widthClassName="w-[220px]"
                            />
                            <FilterButton
                                icon={<Stethoscope size={16} />}
                                label="Todos os médicos"
                                options={doctorOptions}
                                values={doctorValues}
                                onChange={setDoctorValues}
                                widthClassName="w-[220px]"
                            />
                        </>
                    )}

                    <AdvancedFilterButton
                        sections={advancedFilterSections}
                    />
                </div>

                {error && (
                    <div className="mb-4 shrink-0 rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-sm font-semibold text-red">
                        {error}
                    </div>
                )}

                <WeekCalendar
                    weekDays={weekDays}
                    appointments={appointments}
                    notes={visibleNotes}
                    selectedAppointmentId={selectedAppointmentId}
                    loading={loadingCalendar}
                    onSelectAppointment={(appointment) =>
                        setSelectedAppointmentId(appointment.id)
                    }
                    onMoveAppointment={handleMoveAppointment}
                    onResizeAppointment={handleResizeAppointment}
                    onDeleteAppointment={handleDeleteAppointment}
                    onAddNote={handleAddNote}
                    onEditNote={handleEditNote}
                    onDeleteNote={handleDeleteNote}
                />
            </section>

            <SchedulingPanel
                open={schedulingPanelOpen}
                selectClient
                onClose={() => setSchedulingPanelOpen(false)}
                onCreated={() => setSchedulingPanelOpen(false)}
            />

            <AppointmentDetailsPanel
                appointment={selectedAppointment}
                units={units}
                doctors={doctors}
                onClose={() => setSelectedAppointmentId(null)}
                onSave={handleSaveAppointment}
                onDelete={handleDeleteAppointment}
            />
        </main>
    );
}

function startOfWeekSunday(value: Date) {
    const date = new Date(value);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - date.getDay());
    return date;
}

function addDays(value: Date, amount: number) {
    const date = new Date(value);
    date.setDate(date.getDate() + amount);
    return date;
}

function formatWeekRange(days: Date[]) {
    const first = days[0];
    const last = days[days.length - 1];
    if (!first || !last) return "";

    const formatter = new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
    });

    return `${formatter.format(first)} – ${formatter.format(last)} ${last.getFullYear()}`;
}
