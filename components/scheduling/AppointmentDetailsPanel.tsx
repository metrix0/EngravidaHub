// components/scheduling/AppointmentDetailsPanel.tsx
"use client";

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    AlertCircle,
    CheckCircle2,
    Clock,
    LoaderCircle,
    Trash2,
} from "lucide-react";

import ClientPanel from "@/components/clientes/ClientPanel";
import SchedulingClientSummary from "@/components/scheduling/SchedulingClientSummary";
import { CalendarDatePicker } from "@/components/ui/CalendarDatePicker";
import { DetailsSidePanel } from "@/components/ui/DetailsSidePanel";
import {
    DropdownSelect,
    type DropdownSelectOption,
} from "@/components/ui/DropdownSelect";
import { Modal } from "@/components/ui/Modal";
import {
    getSchedulingProcedureOptions,
    SCHEDULING_DURATION_OPTIONS,
    SCHEDULING_TIME_OPTIONS,
} from "@/lib/scheduling/options";
import type {
    AppointmentStatus,
    CalendarAppointment,
    SchedulingAddressFields,
    SchedulingDoctorOption,
    SchedulingForm,
    SchedulingFormat,
    SchedulingPersonFields,
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

type SaveInput = Parameters<AppointmentDetailsPanelProps["onSave"]>[1];
type ErrorMap = Record<string, string>;
type SaveState = "idle" | "invalid" | "saving" | "saved" | "error";

const EMPTY_PERSON: SchedulingPersonFields = {
    fullName: "",
    cpf: "",
    birthDate: "",
    email: "",
    phone: "",
};

const EMPTY_ADDRESS: SchedulingAddressFields = {
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    cep: "",
    country: "Brasil",
};

export default function AppointmentDetailsPanel({
    appointment,
    units,
    doctors,
    onClose,
    onSave,
    onDelete,
}: AppointmentDetailsPanelProps) {
    const [form, setForm] = useState<SchedulingForm | null>(null);
    const [format, setFormat] = useState<SchedulingFormat>("congelamento");
    const [errors, setErrors] = useState<ErrorMap>({});
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [saveError, setSaveError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [profileClientId, setProfileClientId] = useState<string | null>(null);
    const [busyAppointments, setBusyAppointments] = useState<CalendarAppointment[]>([]);
    const [loadingBusy, setLoadingBusy] = useState(false);

    const lastSavedSnapshotRef = useRef("");
    const saveRequestRef = useRef(0);
    const appointmentRef = useRef(appointment);
    const onSaveRef = useRef(onSave);

    useEffect(() => {
        appointmentRef.current = appointment;
    }, [appointment]);

    useEffect(() => {
        onSaveRef.current = onSave;
    }, [onSave]);

    useEffect(() => {
        if (!appointment) {
            setForm(null);
            setErrors({});
            setSaveState("idle");
            setSaveError(null);
            setConfirmOpen(false);
            return;
        }

        const nextForm = appointmentToForm(appointment);
        setForm(nextForm);
        setFormat(appointment.format);
        setErrors({});
        setSaveState("idle");
        setSaveError(null);
        setConfirmOpen(false);
        lastSavedSnapshotRef.current = serializeForm(nextForm, appointment.format);
    }, [appointment?.id]);

    const availableDoctors = useMemo(
        () => doctors.filter((doctor) => doctor.unit_id === form?.unitId),
        [doctors, form?.unitId],
    );

    useEffect(() => {
        if (!appointment || !form) return;

        const date = toDateInputValue(form.schedulingDate);
        if (!date || !form.doctorId) {
            setBusyAppointments([]);
            return;
        }

        const controller = new AbortController();
        const end = addOneDay(date);
        setLoadingBusy(true);

        void (async () => {
            try {
                const params = new URLSearchParams({ start: date, end });
                params.append("doctor_ids", form.doctorId);
                params.append("statuses", "scheduled");
                params.append("statuses", "confirmed");

                const response = await fetch(
                    `/api/scheduling/appointments?${params.toString()}`,
                    { cache: "no-store", signal: controller.signal },
                );
                const json = await response.json();

                if (!response.ok) {
                    throw new Error(
                        json?.error ?? "Não foi possível verificar os horários.",
                    );
                }

                setBusyAppointments(
                    (json.appointments ?? []).filter(
                        (item: CalendarAppointment) => item.id !== appointment.id,
                    ),
                );
            } catch {
                if (!controller.signal.aborted) setBusyAppointments([]);
            } finally {
                if (!controller.signal.aborted) setLoadingBusy(false);
            }
        })();

        return () => controller.abort();
    }, [appointment?.id, form?.doctorId, form?.schedulingDate]);

    const timeOptions = useMemo<DropdownSelectOption[]>(() => {
        if (!form) return SCHEDULING_TIME_OPTIONS;

        return SCHEDULING_TIME_OPTIONS.map((option) => {
            const occupied = isBusyTime(
                option.value,
                form.schedulingDate,
                form.durationMinutes,
                busyAppointments,
            );

            return {
                ...option,
                disabled: occupied,
                strikethrough: occupied,
                description: occupied ? "Ocupado" : undefined,
            };
        });
    }, [busyAppointments, form]);

    const snapshot = useMemo(
        () => (form ? serializeForm(form, format) : ""),
        [form, format],
    );

    useEffect(() => {
        if (!appointment || !form || deleting) return;
        if (!snapshot || snapshot === lastSavedSnapshotRef.current) return;

        const nextErrors = validateForm(form, format);
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            setSaveState("invalid");
            setSaveError(null);
            return;
        }

        setErrors({});
        setSaveState("idle");
        setSaveError(null);

        const timer = window.setTimeout(() => {
            const appointmentForSave = appointmentRef.current;
            if (!appointmentForSave) return;

            const requestId = ++saveRequestRef.current;
            const startsAt = toBrazilIso(
                form.schedulingDate,
                form.schedulingTime,
            );

            if (!startsAt) return;

            const endsAt = new Date(
                new Date(startsAt).getTime() + form.durationMinutes * 60_000,
            ).toISOString();

            setSaveState("saving");

            const extendedPayload = {
                startsAt,
                endsAt,
                unitId: form.unitId,
                doctorId: form.doctorId,
                status: appointmentForSave.status,
                procedureName: form.procedureName.trim(),
                notes: form.notes.trim(),
                format,
                primary: form.primary,
                spouse: form.spouse,
                address: form.address,
            };

            void onSaveRef.current(
                appointmentForSave,
                extendedPayload as unknown as SaveInput,
            )
                .then(() => {
                    if (requestId !== saveRequestRef.current) return;
                    lastSavedSnapshotRef.current = snapshot;
                    setSaveState("saved");
                    setSaveError(null);
                })
                .catch((error: unknown) => {
                    if (requestId !== saveRequestRef.current) return;
                    setSaveState("error");
                    setSaveError(
                        error instanceof Error
                            ? error.message
                            : "Não foi possível salvar as alterações.",
                    );
                });
        }, 650);

        return () => window.clearTimeout(timer);
    }, [appointment?.id, deleting, form, format, snapshot]);

    if (!appointment || !form) {
        return (
            <>
                <DetailsSidePanel
                    open={false}
                    title="Detalhes do agendamento"
                    onClose={onClose}
                >
                    <div />
                </DetailsSidePanel>
                <ClientPanel
                    clientId={profileClientId}
                    onClose={() => setProfileClientId(null)}
                />
            </>
        );
    }

    function updatePerson(
        person: "primary" | "spouse",
        field: keyof SchedulingPersonFields,
        value: string,
    ) {
        setForm((current) =>
            current
                ? {
                      ...current,
                      [person]: {
                          ...current[person],
                          [field]: formatPersonValue(field, value),
                      },
                  }
                : current,
        );
    }

    function updateAddress(
        field: keyof SchedulingAddressFields,
        value: string,
    ) {
        setForm((current) =>
            current
                ? {
                      ...current,
                      address: {
                          ...current.address,
                          [field]: field === "cep" ? formatCep(value) : value,
                      },
                  }
                : current,
        );
    }

    function updateField<K extends keyof SchedulingForm>(
        field: K,
        value: SchedulingForm[K],
    ) {
        setForm((current) =>
            current ? { ...current, [field]: value } : current,
        );
    }

    function selectUnit(unitId: string) {
        setForm((current) => {
            if (!current) return current;

            const selectedUnit = units.find((unit) => unit.id === unitId);
            const doctorStillAvailable = doctors.some(
                (doctor) =>
                    doctor.id === current.doctorId &&
                    doctor.unit_id === unitId,
            );

            return {
                ...current,
                unitId,
                doctorId: doctorStillAvailable ? current.doctorId : "",
                address: {
                    ...current.address,
                    state:
                        current.address.state.trim() ||
                        selectedUnit?.state?.trim() ||
                        "",
                    country: current.address.country.trim() || "Brasil",
                },
            };
        });
    }

    async function handleDelete() {
        if (deleting) return;

        setDeleting(true);
        setSaveError(null);

        try {
            await onDelete(appointment);
            setConfirmOpen(false);
            onClose();
        } catch (error) {
            setSaveError(
                error instanceof Error
                    ? error.message
                    : "Não foi possível excluir o agendamento.",
            );
            setConfirmOpen(false);
        } finally {
            setDeleting(false);
        }
    }

    return (
        <>
            <DetailsSidePanel
                open={Boolean(appointment)}
                title="Detalhes do agendamento"
                onClose={onClose}
                headerContent={
                    <SchedulingClientSummary
                        name={form.primary.fullName || "Cliente sem nome"}
                        phone={form.primary.phone}
                        city={form.address.city}
                        onClick={
                            appointment.client_id
                                ? () => setProfileClientId(appointment.client_id)
                                : undefined
                        }
                    />
                }
                bodyClassName="min-h-0 flex-1 overflow-y-auto px-6 py-6 pt-3"
            >
                <div className="space-y-6">
                    <div className="grid grid-cols-[0.75fr_1.25fr] gap-3">
                        <SelectField
                            label="Unidade"
                            value={form.unitId}
                            onChange={selectUnit}
                            options={units.map((unit) => ({
                                value: unit.id,
                                label: unit.name,
                            }))}
                            error={errors.unitId}
                        />
                        <SelectField
                            label="Médico"
                            value={form.doctorId}
                            onChange={(value) => updateField("doctorId", value)}
                            options={availableDoctors.map((doctor) => ({
                                value: doctor.id,
                                label: doctor.name,
                            }))}
                            disabled={!form.unitId || availableDoctors.length === 0}
                            placeholder={
                                !form.unitId
                                    ? "Selecione a unidade"
                                    : availableDoctors.length === 0
                                      ? "Nenhum médico"
                                      : "Selecione o médico"
                            }
                            error={errors.doctorId}
                        />
                    </div>

                    <div className="grid grid-cols-[0.75fr_1.25fr] gap-3">
                        <SelectField
                            label="Duração"
                            value={String(form.durationMinutes)}
                            onChange={(value) =>
                                updateField("durationMinutes", Number(value))
                            }
                            options={SCHEDULING_DURATION_OPTIONS}
                        />
                        <SelectField
                            label="Procedimento"
                            value={form.procedureName}
                            onChange={(value) =>
                                updateField("procedureName", value)
                            }
                            options={getSchedulingProcedureOptions(
                                form.procedureName,
                            )}
                            error={errors.procedureName}
                            placeholder="Selecione o procedimento"
                        />
                    </div>

                    <section className="py-2">
                        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                            Formato do agendamento
                        </div>
                        <div className="flex flex-wrap gap-5">
                            <FormatOption
                                active={format === "congelamento"}
                                label="Congelamento"
                                onClick={() => setFormat("congelamento")}
                            />
                            <FormatOption
                                active={format === "casal"}
                                label="Casal"
                                onClick={() => setFormat("casal")}
                            />
                        </div>
                    </section>

                    <div className="grid grid-cols-[1.2fr_0.8fr] gap-3">
                        <Field label="Data" error={errors.schedulingDate}>
                            <CalendarDatePicker
                                value={toDateInputValue(form.schedulingDate)}
                                onChange={(value) =>
                                    updateField(
                                        "schedulingDate",
                                        fromDateInputValue(value),
                                    )
                                }
                                invalid={Boolean(errors.schedulingDate)}
                            />
                        </Field>
                        <SelectField
                            label="Horário"
                            value={form.schedulingTime}
                            onChange={(value) =>
                                updateField("schedulingTime", value)
                            }
                            options={timeOptions}
                            error={errors.schedulingTime}
                            loading={loadingBusy}
                            icon={
                                <Clock
                                    size={16}
                                    className="shrink-0 cursor-pointer text-slate-400 transition-colors hover:text-slate-700"
                                />
                            }
                        />
                    </div>

                    <h3 className="pt-1 text-sm font-bold uppercase tracking-wide text-slate-950">
                        Detalhes do cliente
                    </h3>

                    <PersonSection
                        person="primary"
                        values={form.primary}
                        errors={errors}
                        onChange={updatePerson}
                    />

                    {format === "casal" && (
                        <PersonSection
                            title="Cônjuge"
                            person="spouse"
                            values={form.spouse}
                            errors={errors}
                            onChange={updatePerson}
                        />
                    )}

                    <AddressSection
                        values={form.address}
                        errors={errors}
                        onChange={updateAddress}
                    />

                    <TextField
                        label="Observações"
                        value={form.notes}
                        onChange={(value) => updateField("notes", value)}
                        placeholder="Informações importantes para o atendimento"
                        multiline
                    />

                    <SaveIndicator state={saveState} error={saveError} />

                    <button
                        type="button"
                        disabled={deleting}
                        onClick={() => setConfirmOpen(true)}
                        className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-red/20 bg-red-soft px-4 text-sm font-bold text-red transition hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {deleting ? (
                            <LoaderCircle size={17} className="animate-spin" />
                        ) : (
                            <Trash2 size={17} />
                        )}
                        Excluir agendamento
                    </button>
                </div>
            </DetailsSidePanel>

            <Modal
                open={confirmOpen}
                onClose={() => !deleting && setConfirmOpen(false)}
                width={430}
                height="auto"
                maxHeight="calc(100vh - 48px)"
                closeOnOverlayClick={!deleting}
                showCloseButton={!deleting}
                panelClassName="p-6"
            >
                <div className="pr-10">
                    <div className="text-lg font-bold text-slate-950">
                        Excluir agendamento?
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500">
                        O agendamento de{" "}
                        <strong className="text-slate-700">
                            {form.primary.fullName || appointment.patient_name}
                        </strong>{" "}
                        será removido permanentemente.
                    </p>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={() => setConfirmOpen(false)}
                        disabled={deleting}
                        className="h-10 cursor-pointer rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleDelete()}
                        disabled={deleting}
                        className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-red px-4 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                    >
                        {deleting && (
                            <LoaderCircle size={15} className="animate-spin" />
                        )}
                        Excluir
                    </button>
                </div>
            </Modal>
            <ClientPanel
                clientId={profileClientId}
                onClose={() => setProfileClientId(null)}
            />
        </>
    );
}

function SaveIndicator({
    state,
    error,
}: {
    state: SaveState;
    error: string | null;
}) {
    if (state === "idle") return null;

    if (state === "saving") {
        return (
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <LoaderCircle size={14} className="animate-spin" />
                Salvando automaticamente...
            </div>
        );
    }

    if (state === "saved") {
        return (
            <div className="flex items-center gap-2 text-xs font-semibold text-green">
                <CheckCircle2 size={14} />
                Alterações salvas
            </div>
        );
    }

    if (state === "invalid") {
        return (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                Corrija os campos indicados para salvar automaticamente.
            </div>
        );
    }

    return (
        <div className="flex items-start gap-2 rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-sm font-semibold text-red">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error ?? "Não foi possível salvar as alterações."}
        </div>
    );
}

function PersonSection({
    title,
    person,
    values,
    errors,
    onChange,
}: {
    title?: string;
    person: "primary" | "spouse";
    values: SchedulingPersonFields;
    errors: ErrorMap;
    onChange: (
        person: "primary" | "spouse",
        field: keyof SchedulingPersonFields,
        value: string,
    ) => void;
}) {
    return (
        <section className="space-y-4">
            {title && (
                <h3 className="text-sm font-bold text-slate-950">{title}</h3>
            )}
            <TextField
                label="Nome completo (sem abreviações)"
                value={values.fullName}
                onChange={(value) => onChange(person, "fullName", value)}
                error={errors[`${person}.fullName`]}
                placeholder="Nome e sobrenome"
            />
            <div className="grid grid-cols-2 gap-3">
                <TextField
                    label="CPF"
                    value={values.cpf}
                    onChange={(value) => onChange(person, "cpf", value)}
                    error={errors[`${person}.cpf`]}
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                />
                <TextField
                    label="Data de nascimento"
                    value={values.birthDate}
                    onChange={(value) => onChange(person, "birthDate", value)}
                    error={errors[`${person}.birthDate`]}
                    placeholder="DD/MM/AAAA"
                    inputMode="numeric"
                />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <TextField
                    label="E-mail"
                    value={values.email}
                    onChange={(value) => onChange(person, "email", value)}
                    error={errors[`${person}.email`]}
                    placeholder="nome@exemplo.com"
                    type="email"
                />
                <TextField
                    label="Telefone"
                    value={values.phone}
                    onChange={(value) => onChange(person, "phone", value)}
                    error={errors[`${person}.phone`]}
                    placeholder="(00) 00000-0000"
                    inputMode="numeric"
                />
            </div>
        </section>
    );
}

function AddressSection({
    values,
    errors,
    onChange,
}: {
    values: SchedulingAddressFields;
    errors: ErrorMap;
    onChange: (field: keyof SchedulingAddressFields, value: string) => void;
}) {
    return (
        <section className="space-y-4">
            <div className="grid grid-cols-[0.8fr_1.2fr] gap-3">
                <TextField
                    label="CEP"
                    value={values.cep}
                    onChange={(value) => onChange("cep", value)}
                    error={errors["address.cep"]}
                    placeholder="00000-000"
                    inputMode="numeric"
                />
                <TextField
                    label="Rua"
                    value={values.street}
                    onChange={(value) => onChange("street", value)}
                    error={errors["address.street"]}
                    placeholder="Nome da rua"
                />
            </div>
            <div className="grid grid-cols-[0.7fr_1.3fr] gap-3">
                <TextField
                    label="Número"
                    value={values.number}
                    onChange={(value) => onChange("number", value)}
                    error={errors["address.number"]}
                    placeholder="Número"
                />
                <TextField
                    label="Complemento"
                    optional
                    value={values.complement}
                    onChange={(value) => onChange("complement", value)}
                    placeholder="Apto, bloco..."
                />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <TextField
                    label="Bairro"
                    optional
                    value={values.neighborhood}
                    onChange={(value) => onChange("neighborhood", value)}
                    placeholder="Bairro"
                />
                <TextField
                    label="Cidade"
                    value={values.city}
                    onChange={(value) => onChange("city", value)}
                    error={errors["address.city"]}
                    placeholder="Cidade"
                />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <TextField
                    label="Estado"
                    value={values.state}
                    onChange={(value) => onChange("state", value)}
                    error={errors["address.state"]}
                    placeholder="UF"
                />
                <TextField
                    label="País"
                    value={values.country}
                    onChange={(value) => onChange("country", value)}
                    placeholder="Brasil"
                />
            </div>
        </section>
    );
}

function SelectField({
    label,
    value,
    onChange,
    options,
    placeholder = "Selecione",
    disabled = false,
    error,
    icon,
    loading = false,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: DropdownSelectOption[];
    placeholder?: string;
    disabled?: boolean;
    error?: string;
    icon?: ReactNode;
    loading?: boolean;
}) {
    return (
        <Field label={label} error={error}>
            <DropdownSelect
                value={value}
                onChange={onChange}
                options={options}
                placeholder={placeholder}
                disabled={disabled}
                invalid={Boolean(error)}
                icon={icon}
                loading={loading}
                loadingLabel="Verificando horários..."
                widthClassName="w-full"
                dropdownWidthClassName="w-full"
            />
        </Field>
    );
}

function Field({
    label,
    error,
    children,
}: {
    label: string;
    error?: string;
    children: ReactNode;
}) {
    return (
        <div>
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                {label}
            </span>
            {children}
            {error && (
                <span className="mt-1.5 block text-xs font-medium text-red">
                    {error}
                </span>
            )}
        </div>
    );
}

function TextField({
    label,
    value,
    onChange,
    error,
    placeholder,
    inputMode,
    type = "text",
    multiline = false,
    optional = false,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    error?: string;
    placeholder?: string;
    inputMode?: "numeric" | "text" | "email";
    type?: string;
    multiline?: boolean;
    optional?: boolean;
}) {
    const controlClass = `w-full appearance-none rounded-xl border bg-white px-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:ring-0 ${
        error ? "border-red" : "border-slate-200 focus:border-brand"
    }`;

    return (
        <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                {label}
                {optional && (
                    <span className="ml-1 font-medium normal-case tracking-normal text-slate-400">
                        (opcional)
                    </span>
                )}
            </span>
            {multiline ? (
                <textarea
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                    rows={3}
                    className={`${controlClass} min-h-[72px] resize-none py-2.5 leading-relaxed`}
                />
            ) : (
                <input
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                    inputMode={inputMode}
                    type={type}
                    className={`${controlClass} h-11`}
                />
            )}
            {error && (
                <span className="mt-1.5 block text-xs font-medium text-red">
                    {error}
                </span>
            )}
        </label>
    );
}

function FormatOption({
    active,
    label,
    onClick,
}: {
    active: boolean;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700"
        >
            <span
                className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                    active ? "border-brand" : "border-slate-300"
                }`}
            >
                <span
                    className={`h-2.5 w-2.5 rounded-full bg-brand transition-transform duration-150 ${
                        active ? "scale-100" : "scale-0"
                    }`}
                />
            </span>
            {label}
        </button>
    );
}

function appointmentToForm(appointment: CalendarAppointment): SchedulingForm {
    return {
        unitId: appointment.unit_id,
        doctorId: appointment.doctor_id,
        schedulingDate: formatBrazilDate(appointment.starts_at),
        schedulingTime: formatBrazilTime(appointment.starts_at),
        durationMinutes: Math.max(
            15,
            Math.round(
                (new Date(appointment.ends_at).getTime() -
                    new Date(appointment.starts_at).getTime()) /
                    60_000,
            ),
        ),
        procedureName: appointment.procedure_name,
        primary: {
            fullName: appointment.patient_name ?? "",
            cpf: appointment.patient_cpf ?? "",
            birthDate: formatStoredDate(appointment.patient_birth_date),
            email: appointment.patient_email ?? "",
            phone: appointment.patient_phone ?? "",
        },
        spouse: appointment.spouse_name
            ? {
                  fullName: appointment.spouse_name,
                  cpf: appointment.spouse_cpf ?? "",
                  birthDate: formatStoredDate(appointment.spouse_birth_date),
                  email: appointment.spouse_email ?? "",
                  phone: appointment.spouse_phone ?? "",
              }
            : { ...EMPTY_PERSON },
        address: appointment.address
            ? {
                  street: appointment.address.street ?? "",
                  number: appointment.address.number ?? "",
                  complement: appointment.address.complement ?? "",
                  neighborhood: appointment.address.neighborhood ?? "",
                  city: appointment.address.city ?? "",
                  state: appointment.address.state ?? "",
                  cep: formatCep(appointment.address.cep ?? ""),
                  country: appointment.address.country ?? "Brasil",
              }
            : { ...EMPTY_ADDRESS },
        notes: appointment.notes ?? "",
    };
}

function validateForm(form: SchedulingForm, format: SchedulingFormat): ErrorMap {
    const errors: ErrorMap = {};

    if (!form.unitId) errors.unitId = "Selecione uma unidade.";
    if (!form.doctorId) errors.doctorId = "Selecione um médico.";
    if (!isValidDate(form.schedulingDate)) {
        errors.schedulingDate = "Informe uma data válida.";
    }
    if (!isValidTime(form.schedulingTime)) {
        errors.schedulingTime = "Selecione um horário em intervalos de 15 minutos.";
    }
    if (!form.procedureName.trim()) {
        errors.procedureName = "Informe o procedimento.";
    }

    validatePerson(form.primary, "primary", errors);
    if (format === "casal") validatePerson(form.spouse, "spouse", errors);

    if (!form.address.street.trim()) {
        errors["address.street"] = "Informe a rua.";
    }
    if (!form.address.number.trim()) {
        errors["address.number"] = "Informe o número.";
    }
    if (!form.address.city.trim()) {
        errors["address.city"] = "Informe a cidade.";
    }
    if (!form.address.state.trim()) {
        errors["address.state"] = "Informe o estado.";
    }
    if (onlyDigits(form.address.cep).length !== 8) {
        errors["address.cep"] = "Informe um CEP válido.";
    }

    return errors;
}

function validatePerson(
    person: SchedulingPersonFields,
    prefix: "primary" | "spouse",
    errors: ErrorMap,
) {
    if (person.fullName.trim().split(/\s+/).length < 2) {
        errors[`${prefix}.fullName`] = "Informe o nome completo.";
    }
    if (!isValidCpf(person.cpf)) {
        errors[`${prefix}.cpf`] = "Informe um CPF válido.";
    }
    if (!isValidBirthDate(person.birthDate)) {
        errors[`${prefix}.birthDate`] = "Informe uma data válida.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim())) {
        errors[`${prefix}.email`] = "Informe um e-mail válido.";
    }
    const phoneDigits = onlyDigits(person.phone);
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        errors[`${prefix}.phone`] = "Informe um telefone válido.";
    }
}

function serializeForm(form: SchedulingForm, format: SchedulingFormat) {
    return JSON.stringify({ form, format });
}

function formatPersonValue(
    field: keyof SchedulingPersonFields,
    value: string,
) {
    if (field === "cpf") return formatCpf(value);
    if (field === "phone") return formatPhone(value);
    if (field === "birthDate") return formatDateInput(value);
    if (field === "email") return value.trimStart().toLowerCase();
    return value;
}

function formatCpf(value: string) {
    const digits = onlyDigits(value).slice(0, 11);
    return digits
        .replace(/^(\d{3})(\d)/, "$1.$2")
        .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
        .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function formatPhone(value: string) {
    let digits = onlyDigits(value);
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
        digits = digits.slice(2);
    }
    digits = digits.slice(0, 11);

    return digits.length <= 10
        ? digits
              .replace(/^(\d{2})(\d)/, "($1) $2")
              .replace(/(\d{4})(\d)/, "$1-$2")
        : digits
              .replace(/^(\d{2})(\d)/, "($1) $2")
              .replace(/(\d{5})(\d)/, "$1-$2");
}

function formatCep(value: string) {
    return onlyDigits(value)
        .slice(0, 8)
        .replace(/^(\d{5})(\d)/, "$1-$2");
}

function formatDateInput(value: string) {
    const digits = onlyDigits(value).slice(0, 8);
    return digits
        .replace(/^(\d{2})(\d)/, "$1/$2")
        .replace(/^(\d{2})\/(\d{2})(\d)/, "$1/$2/$3");
}

function formatBrazilDate(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(new Date(value));
}

function formatBrazilTime(value: string) {
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

function formatStoredDate(value: string | null | undefined) {
    if (!value) return "";
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function toDateInputValue(value: string) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function fromDateInputValue(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function addOneDay(value: string) {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toBrazilIso(dateValue: string, timeValue: string) {
    const date = toDateInputValue(dateValue);
    if (!date || !isValidTime(timeValue)) return null;
    return new Date(`${date}T${timeValue}:00-03:00`).toISOString();
}

function isBusyTime(
    time: string,
    dateValue: string,
    durationMinutes: number,
    appointments: CalendarAppointment[],
) {
    const date = toDateInputValue(dateValue);
    if (!date) return false;

    const start = new Date(`${date}T${time}:00-03:00`).getTime();
    const end = start + durationMinutes * 60_000;

    return appointments.some(
        (appointment) =>
            start < new Date(appointment.ends_at).getTime() &&
            end > new Date(appointment.starts_at).getTime(),
    );
}

function isValidCpf(value: string) {
    const cpf = onlyDigits(value);
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

    const calculateDigit = (length: number) => {
        let total = 0;
        for (let index = 0; index < length; index += 1) {
            total += Number(cpf[index]) * (length + 1 - index);
        }
        const remainder = (total * 10) % 11;
        return remainder === 10 ? 0 : remainder;
    };

    return (
        calculateDigit(9) === Number(cpf[9]) &&
        calculateDigit(10) === Number(cpf[10])
    );
}

function isValidBirthDate(value: string) {
    if (!isValidDate(value)) return false;
    const [day, month, year] = value.split("/").map(Number);
    return new Date(year, month - 1, day) <= new Date();
}

function isValidDate(value: string) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) return false;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);

    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
}

function isValidTime(value: string) {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return false;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours <= 23 && minutes <= 59 && minutes % 15 === 0;
}

function onlyDigits(value: string) {
    return value.replace(/\D/g, "");
}
