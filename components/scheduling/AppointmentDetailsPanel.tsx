// components/scheduling/AppointmentDetailsPanel.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    CalendarClock,
    LoaderCircle,
    Mail,
    MapPin,
    Phone,
    Stethoscope,
    Trash2,
    UserRound,
} from "lucide-react";

import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { DetailsSidePanel } from "@/components/ui/DetailsSidePanel";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import {
    getSchedulingProcedureOptions,
    SCHEDULING_DURATION_OPTIONS,
} from "@/lib/scheduling/options";
import type {
    AppointmentStatus,
    CalendarAppointment,
    SchedulingDoctorOption,
    SchedulingUnitOption,
} from "@/types/scheduling";

type AppointmentDetailsPanelProps = {
    appointment: CalendarAppointment | null;
    units: SchedulingUnitOption[];
    doctors: SchedulingDoctorOption[];
    onClose: () => void;
    onSave: (
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
    ) => Promise<void>;
    onDelete: (appointment: CalendarAppointment) => Promise<void>;
};

type EditForm = {
    date: string;
    time: string;
    durationMinutes: number;
    unitId: string;
    doctorId: string;
    status: AppointmentStatus;
    procedureName: string;
    notes: string;
};

export default function AppointmentDetailsPanel({
    appointment,
    units,
    doctors,
    onClose,
    onSave,
    onDelete,
}: AppointmentDetailsPanelProps) {
    const [form, setForm] = useState<EditForm | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!appointment) {
            setForm(null);
            return;
        }

        setForm(toEditForm(appointment));
        setError(null);
    }, [appointment]);

    const availableDoctors = useMemo(
        () => doctors.filter((doctor) => doctor.unit_id === form?.unitId),
        [doctors, form?.unitId],
    );

    if (!appointment || !form) {
        return (
            <DetailsSidePanel open={false} title="Agendamento" onClose={onClose}>
                <div />
            </DetailsSidePanel>
        );
    }

    async function handleSave() {
        if (!appointment || !form || saving) return;

        const startsAt = toBrazilIso(form.date, form.time);
        if (!startsAt) {
            setError("Informe uma data e um horário válidos.");
            return;
        }
        if (!form.unitId || !form.doctorId) {
            setError("Selecione unidade e médico.");
            return;
        }
        if (!form.procedureName.trim()) {
            setError("Informe o procedimento.");
            return;
        }

        const endsAt = new Date(
            new Date(startsAt).getTime() + form.durationMinutes * 60_000,
        ).toISOString();

        setSaving(true);
        setError(null);

        try {
            await onSave(appointment, {
                startsAt,
                endsAt,
                unitId: form.unitId,
                doctorId: form.doctorId,
                status: form.status,
                procedureName: form.procedureName.trim(),
                notes: form.notes.trim(),
            });
        } catch (saveError) {
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : "Não foi possível salvar o agendamento.",
            );
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!appointment || deleting) return;
        if (!window.confirm(`Excluir o agendamento de ${appointment.patient_name}?`)) {
            return;
        }

        setDeleting(true);
        setError(null);

        try {
            await onDelete(appointment);
            onClose();
        } catch (deleteError) {
            setError(
                deleteError instanceof Error
                    ? deleteError.message
                    : "Não foi possível excluir o agendamento.",
            );
        } finally {
            setDeleting(false);
        }
    }

    return (
        <DetailsSidePanel
            open={Boolean(appointment)}
            title="Detalhes do agendamento"
            onClose={onClose}
            width={500}
            headerContent={
                <div className="flex items-center gap-3">
                    <InitialsAvatar name={appointment.patient_name} />
                    <div className="min-w-0">
                        <div className="truncate font-bold text-slate-950">
                            {appointment.patient_name}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                            {appointment.procedure_name}
                        </div>
                    </div>
                </div>
            }
        >
            <div className="space-y-6">
                <InfoBlock title="Paciente" icon={<UserRound size={17} />}>
                    <InfoLine label="Nome" value={appointment.patient_name} />
                    <InfoLine
                        label="Telefone"
                        value={appointment.patient_phone}
                        icon={<Phone size={14} />}
                    />
                    <InfoLine
                        label="E-mail"
                        value={appointment.patient_email}
                        icon={<Mail size={14} />}
                    />
                    <InfoLine label="CPF" value={appointment.patient_cpf} />
                    <InfoLine
                        label="Nascimento"
                        value={formatStoredDate(appointment.patient_birth_date)}
                    />
                    <InfoLine
                        label="Endereço"
                        value={appointment.address}
                        icon={<MapPin size={14} />}
                    />
                </InfoBlock>

                {appointment.format === "casal" && appointment.spouse_name && (
                    <InfoBlock title="Cônjuge" icon={<UserRound size={17} />}>
                        <InfoLine label="Nome" value={appointment.spouse_name} />
                        <InfoLine label="Telefone" value={appointment.spouse_phone} />
                        <InfoLine label="E-mail" value={appointment.spouse_email} />
                        <InfoLine label="CPF" value={appointment.spouse_cpf} />
                        <InfoLine
                            label="Nascimento"
                            value={formatStoredDate(appointment.spouse_birth_date)}
                        />
                    </InfoBlock>
                )}

                <InfoBlock title="Médico" icon={<Stethoscope size={17} />}>
                    <InfoLine label="Nome" value={appointment.doctor?.name} />
                    <InfoLine
                        label="Especialidade"
                        value={appointment.doctor?.specialty}
                    />
                    <InfoLine label="CRM" value={appointment.doctor?.crm} />
                    <InfoLine label="Unidade" value={appointment.unit?.name} />
                </InfoBlock>

                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
                        <CalendarClock size={17} className="text-brand" />
                        Editar agendamento
                    </div>

                    <div className="grid grid-cols-[1.2fr_0.8fr] gap-3">
                        <Field label="Data">
                            <input
                                type="date"
                                value={form.date}
                                onChange={(event) =>
                                    setForm((current) =>
                                        current
                                            ? { ...current, date: event.target.value }
                                            : current,
                                    )
                                }
                                className={controlClass}
                            />
                        </Field>
                        <Field label="Horário">
                            <input
                                type="time"
                                step={900}
                                value={form.time}
                                onChange={(event) =>
                                    setForm((current) =>
                                        current
                                            ? { ...current, time: event.target.value }
                                            : current,
                                    )
                                }
                                className={controlClass}
                            />
                        </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Duração">
                            <DropdownSelect
                                value={String(form.durationMinutes)}
                                onChange={(value) =>
                                    setForm((current) =>
                                        current
                                            ? {
                                                  ...current,
                                                  durationMinutes: Number(value),
                                              }
                                            : current,
                                    )
                                }
                                options={SCHEDULING_DURATION_OPTIONS}
                                widthClassName="w-full"
                                dropdownWidthClassName="w-full"
                            />
                        </Field>
                        <Field label="Status">
                            <DropdownSelect
                                value={form.status}
                                onChange={(value) =>
                                    setForm((current) =>
                                        current
                                            ? {
                                                  ...current,
                                                  status: value as AppointmentStatus,
                                              }
                                            : current,
                                    )
                                }
                                options={[
                                    { value: "scheduled", label: "Agendado" },
                                    { value: "confirmed", label: "Confirmado" },
                                    { value: "completed", label: "Concluído" },
                                    { value: "cancelled", label: "Cancelado" },
                                    { value: "no_show", label: "Não compareceu" },
                                ]}
                                widthClassName="w-full"
                                dropdownWidthClassName="w-full"
                            />
                        </Field>
                    </div>

                    <Field label="Unidade">
                        <DropdownSelect
                            value={form.unitId}
                            onChange={(unitId) => {
                                setForm((current) =>
                                    current
                                        ? {
                                              ...current,
                                              unitId,
                                              doctorId: doctors.some(
                                                  (doctor) =>
                                                      doctor.id === current.doctorId &&
                                                      doctor.unit_id === unitId,
                                              )
                                                  ? current.doctorId
                                                  : "",
                                          }
                                        : current,
                                );
                            }}
                            options={units.map((unit) => ({
                                value: unit.id,
                                label: unit.name,
                            }))}
                            placeholder="Selecione"
                            widthClassName="w-full"
                            dropdownWidthClassName="w-full"
                        />
                    </Field>

                    <Field label="Médico">
                        <DropdownSelect
                            value={form.doctorId}
                            onChange={(doctorId) =>
                                setForm((current) =>
                                    current ? { ...current, doctorId } : current,
                                )
                            }
                            options={availableDoctors.map((doctor) => ({
                                value: doctor.id,
                                label: doctor.name,
                            }))}
                            placeholder="Selecione"
                            disabled={!form.unitId || availableDoctors.length === 0}
                            widthClassName="w-full"
                            dropdownWidthClassName="w-full"
                        />
                    </Field>

                    <Field label="Procedimento">
                        <DropdownSelect
                            value={form.procedureName}
                            onChange={(procedureName) =>
                                setForm((current) =>
                                    current ? { ...current, procedureName } : current,
                                )
                            }
                            options={getSchedulingProcedureOptions(form.procedureName)}
                            placeholder="Selecione o procedimento"
                            widthClassName="w-full"
                            dropdownWidthClassName="w-full"
                        />
                    </Field>

                    <Field label="Observações">
                        <textarea
                            rows={4}
                            value={form.notes}
                            onChange={(event) =>
                                setForm((current) =>
                                    current
                                        ? { ...current, notes: event.target.value }
                                        : current,
                                )
                            }
                            className={`${controlClass} min-h-24 resize-none py-2.5`}
                        />
                    </Field>

                    {error && (
                        <div className="rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-sm font-semibold text-red">
                            {error}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            type="button"
                            disabled={saving || deleting}
                            onClick={() => void handleSave()}
                            className="flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving && <LoaderCircle size={16} className="animate-spin" />}
                            {saving ? "Salvando..." : "Salvar alterações"}
                        </button>
                        <button
                            type="button"
                            disabled={saving || deleting}
                            onClick={() => void handleDelete()}
                            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-red/20 bg-red-soft text-red transition hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Excluir agendamento"
                        >
                            {deleting ? (
                                <LoaderCircle size={17} className="animate-spin" />
                            ) : (
                                <Trash2 size={17} />
                            )}
                        </button>
                    </div>
                </section>
            </div>
        </DetailsSidePanel>
    );
}

const controlClass =
    "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-0";

function InfoBlock({
    title,
    icon,
    children,
}: {
    title: string;
    icon: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-950">
                <span className="text-brand">{icon}</span>
                {title}
            </div>
            <div className="space-y-2">{children}</div>
        </section>
    );
}

function InfoLine({
    label,
    value,
    icon,
}: {
    label: string;
    value: string | null | undefined;
    icon?: ReactNode;
}) {
    return (
        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 text-sm">
            <div className="font-semibold text-slate-400">{label}</div>
            <div className="flex min-w-0 items-center gap-1.5 text-slate-700">
                {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
                <span className="break-words">{value || "—"}</span>
            </div>
        </div>
    );
}

function Field({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                {label}
            </span>
            {children}
        </label>
    );
}

function toEditForm(appointment: CalendarAppointment): EditForm {
    const startsAt = new Date(appointment.starts_at);
    const endsAt = new Date(appointment.ends_at);

    return {
        date: formatBrazilDateInput(appointment.starts_at),
        time: formatBrazilTimeInput(appointment.starts_at),
        durationMinutes: Math.max(
            15,
            Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
        ),
        unitId: appointment.unit_id,
        doctorId: appointment.doctor_id,
        status: appointment.status,
        procedureName: appointment.procedure_name,
        notes: appointment.notes ?? "",
    };
}

function formatBrazilDateInput(value: string) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(value));
}

function formatBrazilTimeInput(value: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(value));

    const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
    return `${hour}:${minute}`;
}

function toBrazilIso(dateValue: string, timeValue: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
    if (!/^\d{2}:\d{2}$/.test(timeValue)) return null;
    const date = new Date(`${dateValue}T${timeValue}:00-03:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatStoredDate(value: string | null | undefined) {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
