// components/inbox/SchedulingPanel.tsx
"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    AlertCircle,
    CalendarCheck,
    CheckCircle2,
    Clock,
    ChevronRight,
    Info,
    LoaderCircle,
    MapPin,
    Search,
    Sparkles,
} from "lucide-react";
import { FaFacebookF, FaInstagram, FaWhatsapp } from "react-icons/fa6";

import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { DetailsSidePanel } from "@/components/ui/DetailsSidePanel";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { CalendarDatePicker } from "@/components/ui/CalendarDatePicker";
import InfoTooltip from "@/components/ui/InfoTooltip";
import {
    getSchedulingProcedureOptions,
    SCHEDULING_DURATION_OPTIONS,
    SCHEDULING_TIME_OPTIONS,
} from "@/lib/scheduling/options";
import type { InboxChannel } from "@/types/inbox";
import type {
    SchedulingAddressFields,
    SchedulingDataResponse,
    SchedulingForm,
    SchedulingFormat,
    SchedulingPersonFields,
} from "@/types/scheduling";

type SchedulingPanelProps = {
    open: boolean;
    threadId?: string | null;
    clientId?: string | null;
    onClose: () => void;
    onOpenClientProfile?: (clientId: string) => void;
    onCreated?: () => void;
    selectClient?: boolean;
    client?: {
        name: string;
        phone: string | null;
        city: string | null;
        channel: InboxChannel;
    } | null;
};

type SchedulingPanelData = Omit<SchedulingDataResponse, "client"> & {
    client: SchedulingDataResponse["client"] | null;
};

type SchedulingClientOption = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
};

type ErrorMap = Record<string, string>;

const emptyPerson: SchedulingPersonFields = {
    fullName: "",
    cpf: "",
    birthDate: "",
    email: "",
    phone: "",
};

const emptyAddress: SchedulingAddressFields = {
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    cep: "",
    country: "",
};

const initialForm: SchedulingForm = {
    unitId: "",
    doctorId: "",
    schedulingDate: "",
    schedulingTime: "",
    durationMinutes: 45,
    procedureName: "Consulta",
    primary: { ...emptyPerson },
    spouse: { ...emptyPerson },
    address: { ...emptyAddress },
    notes: "",
};

export default function SchedulingPanel({
    open,
    threadId,
    clientId,
    onClose,
    onOpenClientProfile,
    onCreated,
    selectClient = false,
    client = null,
}: SchedulingPanelProps) {
    const [format, setFormat] = useState<SchedulingFormat>("congelamento");
    const [form, setForm] = useState<SchedulingForm>(initialForm);
    const [data, setData] = useState<SchedulingPanelData | null>(null);
    const [errors, setErrors] = useState<ErrorMap>({});
    const [loadingData, setLoadingData] = useState(false);
    const [autofilling, setAutofilling] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [autofillError, setAutofillError] = useState<string | null>(null);
    const [autofillSuccess, setAutofillSuccess] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
    const [clientOptions, setClientOptions] = useState<SchedulingClientOption[]>([]);
    const [selectedClientId, setSelectedClientId] = useState("");
    const [clientQuery, setClientQuery] = useState("");
    const [loadingClients, setLoadingClients] = useState(false);
    const clientRequestRef = useRef(0);

    useEffect(() => {
        if (!open || !selectClient) return;

        const controller = new AbortController();

        async function loadClients() {
            setLoadingClients(true);

            try {
                const response = await fetch("/api/clientes", {
                    cache: "no-store",
                    signal: controller.signal,
                });
                const json = await response.json();

                if (!response.ok) {
                    throw new Error(
                        json?.error ?? "Não foi possível carregar os clientes.",
                    );
                }

                setClientOptions(json.clients ?? []);
            } catch (error) {
                if (controller.signal.aborted) return;
                setClientOptions([]);
                setLoadError(
                    error instanceof Error
                        ? error.message
                        : "Não foi possível carregar os clientes.",
                );
            } finally {
                if (!controller.signal.aborted) setLoadingClients(false);
            }
        }

        void loadClients();
        return () => controller.abort();
    }, [open, selectClient]);

    useEffect(() => {
        if (!open) return;

        const controller = new AbortController();

        async function loadSchedulingData() {
            setLoadingData(true);
            setLoadError(null);
            setAutofillError(null);
            setAutofillSuccess(false);
            setSubmitError(null);
            setSubmitSuccess(null);
            setErrors({});

            try {
                const response = await fetch(
                    threadId
                        ? `/api/inbox/scheduling-data?thread_id=${encodeURIComponent(threadId)}`
                        : "/api/scheduling/options",
                    { cache: "no-store", signal: controller.signal },
                );
                const json = await response.json();

                if (!response.ok) {
                    throw new Error(
                        json?.error ?? "Não foi possível carregar os dados.",
                    );
                }

                if (threadId) {
                    const nextData = json as SchedulingDataResponse;
                    setData(nextData);
                    setFormat(nextData.suggestedFormat);
                    setForm(nextData.form);
                } else {
                    if (selectClient) {
                        setSelectedClientId("");
                        setClientQuery("");
                    }
                    setData({
                        client: null,
                        spouse: null,
                        units: json.units ?? [],
                        doctors: json.doctors ?? [],
                        suggestedFormat: "congelamento",
                        form: initialForm,
                    });
                    setFormat("congelamento");
                    setForm(initialForm);
                }
            } catch (error) {
                if (controller.signal.aborted) return;
                setData(null);
                setForm(initialForm);
                setLoadError(
                    error instanceof Error
                        ? error.message
                        : "Não foi possível carregar os dados.",
                );
            } finally {
                if (!controller.signal.aborted) setLoadingData(false);
            }
        }

        void loadSchedulingData();
        return () => controller.abort();
    }, [open, selectClient, threadId]);

    const clientName = data?.client?.name ?? client?.name ?? "Cliente sem nome";
    const clientPhone = data?.client?.phone ?? client?.phone ?? "Sem telefone";
    const clientUnitName = data?.client?.unit_name ?? "Sem unidade";
    const profileClientId = data?.client?.id ?? clientId;
    const disabled = loadingData || autofilling || submitting;

    const availableDoctors = useMemo(
        () =>
            (data?.doctors ?? []).filter(
                (doctor) => doctor.unit_id === form.unitId,
            ),
        [data?.doctors, form.unitId],
    );


    const visibleClientOptions = useMemo(() => {
        const query = normalizeClientSearchText(clientQuery);
        const phoneQuery = clientQuery.replace(/\D/g, "");

        return clientOptions
            .filter((option) => {
                if (!query && !phoneQuery) return true;

                const name = normalizeClientSearchText(option.name ?? "");
                const phone = normalizeClientSearchText(option.phone ?? "");
                const combined = normalizeClientSearchText(
                    formatClientOptionLabel(option),
                );
                const phoneDigits = (option.phone ?? "").replace(/\D/g, "");

                return (
                    name.includes(query) ||
                    phone.includes(query) ||
                    combined.includes(query) ||
                    Boolean(phoneQuery && phoneDigits.includes(phoneQuery))
                );
            })
            .slice(0, 10);
    }, [clientOptions, clientQuery]);

    function handleClientQueryChange(value: string) {
        setClientQuery(value);

        if (!selectedClientId) return;

        setSelectedClientId("");
        setData((current) =>
            current
                ? {
                      ...current,
                      client: null,
                      spouse: null,
                      suggestedFormat: "congelamento",
                      form: initialForm,
                  }
                : current,
        );
        setFormat("congelamento");
        setForm(initialForm);
        setSubmitError(null);
        setSubmitSuccess(null);
        setErrors({});
    }

    function selectClientOption(option: SchedulingClientOption) {
        setClientQuery(formatClientOptionLabel(option));
        void handleClientSelection(option.id);
    }

    async function handleClientSelection(nextClientId: string) {
        const requestId = ++clientRequestRef.current;
        setSelectedClientId(nextClientId);
        setErrors((current) => {
            if (!current.clientId) return current;
            const next = { ...current };
            delete next.clientId;
            return next;
        });
        setLoadError(null);
        setAutofillError(null);
        setAutofillSuccess(false);
        setSubmitError(null);
        setSubmitSuccess(null);

        if (!nextClientId) {
            setData((current) =>
                current
                    ? {
                          ...current,
                          client: null,
                          spouse: null,
                          suggestedFormat: "congelamento",
                          form: initialForm,
                      }
                    : current,
            );
            setFormat("congelamento");
            setForm(initialForm);
            return;
        }

        setLoadingData(true);

        try {
            const response = await fetch(
                `/api/inbox/scheduling-data?client_id=${encodeURIComponent(nextClientId)}`,
                { cache: "no-store" },
            );
            const json = await response.json();

            if (!response.ok) {
                throw new Error(
                    json?.error ?? "Não foi possível carregar o cliente.",
                );
            }

            if (requestId !== clientRequestRef.current) return;

            const nextData = json as SchedulingDataResponse;
            setData(nextData);
            setFormat(nextData.suggestedFormat);
            setForm(nextData.form);
        } catch (error) {
            if (requestId !== clientRequestRef.current) return;
            setLoadError(
                error instanceof Error
                    ? error.message
                    : "Não foi possível carregar o cliente.",
            );
        } finally {
            if (requestId === clientRequestRef.current) setLoadingData(false);
        }
    }

    function updatePerson(
        person: "primary" | "spouse",
        field: keyof SchedulingPersonFields,
        value: string,
    ) {
        const formattedValue = formatFieldValue(field, value);
        setForm((current) => ({
            ...current,
            [person]: {
                ...current[person],
                [field]: formattedValue,
            },
        }));
        clearError(`${person}.${field}`);
        clearSuccessStates();
    }

    function updateAddress(
        field: keyof SchedulingAddressFields,
        value: string,
    ) {
        const formattedValue = field === "cep" ? formatCep(value) : value;
        setForm((current) => ({
            ...current,
            address: {
                ...current.address,
                [field]: formattedValue,
            },
        }));
        clearError(`address.${field}`);
        clearSuccessStates();
    }

    function updateField<K extends keyof SchedulingForm>(
        field: K,
        value: SchedulingForm[K],
    ) {
        setForm((current) => ({ ...current, [field]: value }));
        clearError(field);
        clearSuccessStates();
    }

    function clearError(field: string) {
        setErrors((current) => {
            if (!current[field]) return current;
            const next = { ...current };
            delete next[field];
            return next;
        });
    }

    function clearSuccessStates() {
        setAutofillSuccess(false);
        setSubmitSuccess(null);
        setSubmitError(null);
    }

    function selectFormat(nextFormat: SchedulingFormat) {
        setFormat(nextFormat);
        setErrors({});
        clearSuccessStates();
    }

    function selectUnit(unitId: string) {
        setForm((current) => {
            const doctorStillAvailable = (data?.doctors ?? []).some(
                (doctor) =>
                    doctor.id === current.doctorId &&
                    doctor.unit_id === unitId,
            );

            const selectedUnit = (data?.units ?? []).find(
                (unit) => unit.id === unitId,
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
                    country:
                        current.address.country.trim() || "Brasil",
                },
            };
        });
        clearError("unitId");
        clearError("doctorId");
        clearSuccessStates();
    }

    async function handleAutofill() {
        if (!threadId || autofilling || loadingData) return;

        setAutofilling(true);
        setAutofillError(null);
        setAutofillSuccess(false);
        setSubmitError(null);
        setSubmitSuccess(null);

        try {
            const response = await fetch("/api/inbox/scheduling-autofill", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ threadId, format, form }),
            });
            const json = await response.json();

            if (!response.ok) {
                throw new Error(
                    json?.error ??
                        "Não foi possível preencher os dados automaticamente.",
                );
            }

            setForm(json.form as SchedulingForm);
            setErrors({});
            setAutofillSuccess(true);
        } catch (error) {
            setAutofillError(
                error instanceof Error
                    ? error.message
                    : "Não foi possível preencher os dados automaticamente.",
            );
        } finally {
            setAutofilling(false);
        }
    }

    async function handleSubmit() {
        if (submitting) return;

        if (selectClient && !profileClientId) {
            setErrors((current) => ({
                ...current,
                clientId: "Selecione um cliente.",
            }));
            return;
        }

        const nextErrors = validateForm(form, format);
        setErrors(nextErrors);
        setSubmitError(null);
        setSubmitSuccess(null);

        if (Object.keys(nextErrors).length > 0) return;

        const startsAt = toBrazilIso(
            form.schedulingDate,
            form.schedulingTime,
        );

        if (!startsAt) {
            setErrors((current) => ({
                ...current,
                schedulingDate: "Informe data e horário válidos.",
            }));
            return;
        }

        setSubmitting(true);

        try {
            const response = await fetch("/api/scheduling/appointments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    threadId,
                    clientId: profileClientId,
                    unitId: form.unitId,
                    doctorId: form.doctorId,
                    startsAt,
                    durationMinutes: form.durationMinutes,
                    status: "scheduled",
                    format,
                    procedureName: form.procedureName,
                    primary: form.primary,
                    spouse: form.spouse,
                    address: form.address,
                    notes: form.notes,
                }),
            });
            const json = await response.json();

            if (!response.ok) {
                const firstIssue = Array.isArray(json?.issues)
                    ? json.issues[0]?.message
                    : null;

                throw new Error(
                    firstIssue ??
                        json?.error ??
                        "Não foi possível criar o agendamento.",
                );
            }

            setSubmitSuccess("Agendamento criado com sucesso.");
            window.dispatchEvent(new Event("appointments:changed"));
            onCreated?.();
        } catch (error) {
            setSubmitError(
                error instanceof Error
                    ? error.message
                    : "Não foi possível criar o agendamento.",
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <DetailsSidePanel
            open={open}
            title="Agendar"
            onClose={onClose}
            headerContent={profileClientId || client ? (
                <button
                    type="button"
                    disabled={!profileClientId || !onOpenClientProfile}
                    onClick={() => {
                        if (profileClientId) onOpenClientProfile?.(profileClientId);
                    }}
                    className="flex w-full cursor-pointer items-center justify-between px-1 py-1 text-left transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-50"
                    aria-label="Abrir perfil do cliente"
                >
                    <div className="flex min-w-0 items-center gap-4">
                        <InitialsAvatar name={clientName} />
                        <div className="min-w-0 flex-1">
                            <div
                                title={clientName}
                                className="truncate font-bold text-slate-950"
                            >
                                {clientName}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                                {clientPhone}
                            </div>
                            <div className="mt-1 flex min-w-0 items-center gap-3">
                                <div className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
                                    <MapPin size={13} className="shrink-0" />
                                    <span className="truncate">{clientUnitName}</span>
                                </div>
                                {client?.channel && (
                                    <SchedulingChannelBadge channel={client.channel} />
                                )}
                            </div>
                        </div>
                    </div>
                    <ChevronRight size={18} className="shrink-0 text-slate-400" />
                </button>
            ) : undefined}
            bodyClassName="min-h-0 flex-1 overflow-y-auto px-6 py-6 pt-3"
        >
            <div className="relative">
                <div
                    className={`space-y-6 transition-opacity duration-200 ${
                        loadingData
                            ? "pointer-events-none select-none opacity-45"
                            : "opacity-100"
                    }`}
                    aria-busy={disabled}
                >
                    {selectClient && (
                        <ClientSearchField
                            query={clientQuery}
                            selectedClientId={selectedClientId}
                            options={visibleClientOptions}
                            loading={loadingClients}
                            disabled={submitting}
                            onQueryChange={handleClientQueryChange}
                            onSelect={selectClientOption}
                            error={errors.clientId}
                        />
                    )}

                    {loadError && <ErrorMessage message={loadError} />}

                    {!selectClient && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={!threadId || disabled}
                            onClick={handleAutofill}
                            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-selection disabled:cursor-not-allowed disabled:opacity-55"
                        >
                            {autofilling ? (
                                <LoaderCircle size={16} className="animate-spin text-brand" />
                            ) : (
                                <Sparkles size={16} className="text-brand" />
                            )}
                            {autofilling ? "Preenchendo..." : "Autopreencher"}
                        </button>
                        <InfoTooltip text="Preenche os dados e sugere a unidade mais compatível com o endereço informado no chat.">
                            <button
                                type="button"
                                className="flex h-9 w-9 cursor-help items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                                aria-label="Informações sobre o autopreenchimento"
                            >
                                <Info size={17} />
                            </button>
                        </InfoTooltip>
                    </div>
                    )}

                    <SelectField
                        label="Unidade"
                        value={form.unitId}
                        disabled={disabled}
                        placeholder="Selecione a unidade"
                        options={(data?.units ?? []).map((unit) => ({
                            value: unit.id,
                            label: unit.name,
                        }))}
                        onChange={selectUnit}
                        error={errors.unitId}
                    />

                    <SelectField
                        label="Médico"
                        value={form.doctorId}
                        disabled={disabled || !form.unitId || availableDoctors.length === 0}
                        placeholder={
                            !form.unitId
                                ? "Selecione uma unidade primeiro"
                                : availableDoctors.length === 0
                                    ? "Nenhum médico ativo nesta unidade"
                                    : "Selecione o médico"
                        }
                        options={availableDoctors.map((doctor) => ({
                            value: doctor.id,
                            label: doctor.specialty
                                ? `${doctor.name} · ${doctor.specialty}`
                                : doctor.name,
                        }))}
                        onChange={(value) => updateField("doctorId", value)}
                        error={errors.doctorId}
                    />

                    <div className="grid grid-cols-[0.75fr_1.25fr] gap-3">
                        <SelectField
                            label="Duração"
                            value={String(form.durationMinutes)}
                            disabled={disabled}
                            options={SCHEDULING_DURATION_OPTIONS}
                            onChange={(value) =>
                                updateField("durationMinutes", Number(value))
                            }
                        />
                        <SelectField
                            label="Procedimento"
                            value={form.procedureName}
                            disabled={disabled}
                            options={getSchedulingProcedureOptions(form.procedureName)}
                            onChange={(value) => updateField("procedureName", value)}
                            error={errors.procedureName}
                            placeholder="Selecione o procedimento"
                        />
                    </div>

                    <section className="py-2">
                        <div className="mb-3 text-sm font-bold text-slate-950">
                            Formato do agendamento
                        </div>
                        <div className="flex flex-wrap gap-5">
                            <FormatOption
                                active={format === "congelamento"}
                                label="Congelamento"
                                disabled={disabled}
                                onClick={() => selectFormat("congelamento")}
                            />
                            <FormatOption
                                active={format === "casal"}
                                label="Casal"
                                disabled={disabled}
                                onClick={() => selectFormat("casal")}
                            />
                        </div>
                    </section>

                    <div className="grid grid-cols-[1.2fr_0.8fr] gap-3">
                        <CalendarField
                            label="Data"
                            value={toDateInputValue(form.schedulingDate)}
                            disabled={disabled}
                            onChange={(value) =>
                                updateField(
                                    "schedulingDate",
                                    fromDateInputValue(value),
                                )
                            }
                            error={errors.schedulingDate}
                        />
                        <SelectField
                            label="Horário"
                            value={form.schedulingTime}
                            disabled={disabled}
                            placeholder="Selecione"
                            options={SCHEDULING_TIME_OPTIONS}
                            onChange={(value) =>
                                updateField("schedulingTime", value)
                            }
                            error={errors.schedulingTime}
                            icon={
                                <Clock
                                    size={16}
                                    className="shrink-0 cursor-pointer text-slate-400 transition-colors hover:text-slate-700"
                                />
                            }
                        />
                    </div>

                    <PersonSection
                        person="primary"
                        values={form.primary}
                        errors={errors}
                        disabled={disabled}
                        onChange={updatePerson}
                    />

                    {format === "casal" && (
                        <PersonSection
                            title="Cônjuge"
                            person="spouse"
                            values={form.spouse}
                            errors={errors}
                            disabled={disabled}
                            onChange={updatePerson}
                        />
                    )}

                    <AddressSection
                        values={form.address}
                        errors={errors}
                        disabled={disabled}
                        onChange={updateAddress}
                    />

                    <FormField
                        label="Observações"
                        value={form.notes}
                        disabled={disabled}
                        onChange={(value) => updateField("notes", value)}
                        placeholder="Informações importantes para o atendimento"
                        multiline
                    />

                    {submitError && <ErrorMessage message={submitError} />}
                    {submitSuccess && <SuccessMessage message={submitSuccess} />}

                    <button
                        type="button"
                        disabled={disabled || Boolean(loadError) || Boolean(submitSuccess)}
                        onClick={() => void handleSubmit()}
                        className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                        {submitting ? (
                            <LoaderCircle size={17} className="animate-spin" />
                        ) : (
                            <CalendarCheck size={17} />
                        )}
                        {submitting ? "Criando..." : "Criar agendamento"}
                    </button>
                </div>

                {loadingData && (
                    <div
                        className="absolute inset-0 z-20 cursor-wait rounded-2xl bg-white/35"
                        aria-hidden="true"
                    />
                )}
            </div>
        </DetailsSidePanel>
    );
}

function ClientSearchField({
    query,
    selectedClientId,
    options,
    loading,
    disabled,
    onQueryChange,
    onSelect,
    error,
}: {
    query: string;
    selectedClientId: string;
    options: SchedulingClientOption[];
    loading: boolean;
    disabled: boolean;
    onQueryChange: (value: string) => void;
    onSelect: (option: SchedulingClientOption) => void;
    error?: string;
}) {
    return (
        <div>
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Cliente
            </span>
            <DropdownSelect
                value={selectedClientId}
                onChange={(value) => {
                    const option = options.find((item) => item.id === value);
                    if (option) onSelect(option);
                }}
                options={options.map((option) => ({
                    value: option.id,
                    label: option.name?.trim() || "Cliente sem nome",
                    description: formatClientPhone(option.phone),
                }))}
                searchable
                searchValue={query}
                onSearchChange={onQueryChange}
                searchPlaceholder={
                    loading ? "Carregando clientes..." : "Digite nome ou telefone"
                }
                icon={<Search size={16} className="shrink-0 text-slate-400" />}
                disabled={disabled}
                loading={loading}
                loadingLabel="Carregando clientes..."
                emptyLabel="Nenhum cliente encontrado."
                invalid={Boolean(error)}
                widthClassName="w-full"
                dropdownWidthClassName="w-full"
            />
            {error && (
                <span className="mt-1.5 block text-xs font-medium text-red">
                    {error}
                </span>
            )}
        </div>
    );
}

function formatClientOptionLabel(client: SchedulingClientOption) {
    const name = client.name?.trim() || "Cliente sem nome";
    const phone = formatClientPhone(client.phone);
    return phone === "Sem telefone" ? name : `${name} · ${phone}`;
}

function formatClientPhone(phone: string | null) {
    const digits = (phone ?? "").replace(/\D/g, "").replace(/^55/, "");

    if (digits.length === 11) {
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }

    if (digits.length === 10) {
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }

    return phone?.trim() || "Sem telefone";
}

function normalizeClientSearchText(value: string) {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function ErrorMessage({ message }: { message: string }) {
    return (
        <div className="flex items-start gap-2 rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-sm font-medium text-red">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {message}
        </div>
    );
}

function SuccessMessage({ message }: { message: string }) {
    return (
        <div className="flex items-start gap-2 rounded-xl border border-green/20 bg-green-soft px-4 py-3 text-sm font-semibold text-green">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            {message}
        </div>
    );
}

function FormatOption({
    active,
    label,
    disabled,
    onClick,
}: {
    active: boolean;
    label: string;
    disabled: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-55"
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

function PersonSection({
    title,
    person,
    values,
    errors,
    disabled,
    onChange,
}: {
    title?: string;
    person: "primary" | "spouse";
    values: SchedulingPersonFields;
    errors: ErrorMap;
    disabled: boolean;
    onChange: (
        person: "primary" | "spouse",
        field: keyof SchedulingPersonFields,
        value: string,
    ) => void;
}) {
    return (
        <section className="space-y-4">
            {title && <h3 className="text-sm font-bold text-slate-950">{title}</h3>}
            <FormField
                label="Nome completo (sem abreviações)"
                value={values.fullName}
                disabled={disabled}
                onChange={(value) => onChange(person, "fullName", value)}
                error={errors[`${person}.fullName`]}
            />
            <FormField
                label="CPF"
                value={values.cpf}
                disabled={disabled}
                onChange={(value) => onChange(person, "cpf", value)}
                error={errors[`${person}.cpf`]}
                placeholder="000.000.000-00"
                inputMode="numeric"
            />
            <FormField
                label="Data de nascimento"
                value={values.birthDate}
                disabled={disabled}
                onChange={(value) => onChange(person, "birthDate", value)}
                error={errors[`${person}.birthDate`]}
                placeholder="DD/MM/AAAA"
                inputMode="numeric"
            />
            <FormField
                label="E-mail"
                value={values.email}
                disabled={disabled}
                onChange={(value) => onChange(person, "email", value)}
                error={errors[`${person}.email`]}
                placeholder="nome@exemplo.com"
                type="email"
            />
            <FormField
                label="Telefone"
                value={values.phone}
                disabled={disabled}
                onChange={(value) => onChange(person, "phone", value)}
                error={errors[`${person}.phone`]}
                placeholder="(00) 00000-0000"
                inputMode="numeric"
            />
        </section>
    );
}

function AddressSection({
    values,
    errors,
    disabled,
    onChange,
}: {
    values: SchedulingAddressFields;
    errors: ErrorMap;
    disabled: boolean;
    onChange: (field: keyof SchedulingAddressFields, value: string) => void;
}) {
    return (
        <section className="space-y-4">
            <h3 className="text-sm font-bold text-slate-950">
                Endereço completo com CEP
            </h3>
            <div className="grid grid-cols-[0.8fr_1.2fr] gap-3">
                <FormField
                    label="CEP"
                    value={values.cep}
                    disabled={disabled}
                    onChange={(value) => onChange("cep", value)}
                    error={errors["address.cep"]}
                    placeholder="00000-000"
                    inputMode="numeric"
                />
                <FormField
                    label="Rua"
                    value={values.street}
                    disabled={disabled}
                    onChange={(value) => onChange("street", value)}
                    error={errors["address.street"]}
                />
            </div>
            <div className="grid grid-cols-[0.7fr_1.3fr] gap-3">
                <FormField
                    label="Número"
                    value={values.number}
                    disabled={disabled}
                    onChange={(value) => onChange("number", value)}
                    error={errors["address.number"]}
                />
                <FormField
                    label="Complemento"
                    optional
                    value={values.complement}
                    disabled={disabled}
                    onChange={(value) => onChange("complement", value)}
                />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <FormField
                    label="Bairro"
                    optional
                    value={values.neighborhood}
                    disabled={disabled}
                    onChange={(value) => onChange("neighborhood", value)}
                />
                <FormField
                    label="Cidade"
                    value={values.city}
                    disabled={disabled}
                    onChange={(value) => onChange("city", value)}
                    error={errors["address.city"]}
                />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <FormField
                    label="Estado"
                    value={values.state}
                    disabled={disabled}
                    onChange={(value) => onChange("state", value)}
                    error={errors["address.state"]}
                />
                <FormField
                    label="País"
                    value={values.country}
                    disabled={disabled}
                    onChange={(value) => onChange("country", value)}
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
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    placeholder?: string;
    disabled?: boolean;
    error?: string;
    icon?: ReactNode;
}) {
    return (
        <div>
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                {label}
            </span>
            <DropdownSelect
                value={value}
                onChange={onChange}
                options={options}
                placeholder={placeholder}
                icon={icon}
                disabled={disabled}
                invalid={Boolean(error)}
                widthClassName="w-full"
                dropdownWidthClassName="w-full"
            />
            {error && (
                <span className="mt-1.5 block text-xs font-medium text-red">
                    {error}
                </span>
            )}
        </div>
    );
}

function CalendarField({
    label,
    value,
    onChange,
    error,
    disabled = false,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    error?: string;
    disabled?: boolean;
}) {
    return (
        <div>
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                {label}
            </span>
            <CalendarDatePicker
                value={value}
                onChange={onChange}
                disabled={disabled}
                invalid={Boolean(error)}
            />
            {error && (
                <span className="mt-1.5 block text-xs font-medium text-red">
                    {error}
                </span>
            )}
        </div>
    );
}

function FormField({
    label,
    value,
    onChange,
    error,
    placeholder,
    inputMode,
    type = "text",
    multiline = false,
    disabled = false,
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
    disabled?: boolean;
    optional?: boolean;
}) {
    const controlClass = `w-full appearance-none rounded-xl border bg-white px-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:ring-0 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${
        error ? "border-red" : "border-slate-200 focus:border-brand"
    }`;

    return (
        <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                {label}
                {optional ? (
                    <span className="ml-1 font-medium normal-case tracking-normal text-slate-400">
                        (opcional)
                    </span>
                ) : null}
            </span>
            {multiline ? (
                <textarea
                    value={value}
                    disabled={disabled}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                    rows={3}
                    className={`${controlClass} min-h-[72px] resize-none py-2.5 leading-relaxed`}
                />
            ) : (
                <input
                    value={value}
                    disabled={disabled}
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

function SchedulingChannelBadge({ channel }: { channel: InboxChannel }) {
    const config: Record<InboxChannel, { icon: ReactNode; classes: string }> = {
        WhatsApp: { icon: <FaWhatsapp size={14} />, classes: "bg-green-soft text-green" },
        Instagram: { icon: <FaInstagram size={14} />, classes: "bg-pink-soft text-pink" },
        Facebook: { icon: <FaFacebookF size={13} />, classes: "bg-blue-soft text-blue" },
    };
    const selectedConfig = config[channel];

    return (
        <span className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-bold ${selectedConfig.classes}`}>
            {selectedConfig.icon}
        </span>
    );
}

function validateForm(form: SchedulingForm, format: SchedulingFormat): ErrorMap {
    const errors: ErrorMap = {};

    if (!form.unitId) errors.unitId = "Selecione uma unidade.";
    if (!form.doctorId) errors.doctorId = "Selecione um médico.";
    if (!isValidDate(form.schedulingDate)) {
        errors.schedulingDate = "Use uma data válida no formato DD/MM/AAAA.";
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
    if (!hasCep(form.address.cep)) {
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
        errors[`${prefix}.fullName`] = "Informe o nome completo, sem abreviações.";
    }
    if (!isValidCpf(person.cpf)) {
        errors[`${prefix}.cpf`] = "Informe um CPF válido.";
    }
    if (!isValidBirthDate(person.birthDate)) {
        errors[`${prefix}.birthDate`] = "Use uma data válida no formato DD/MM/AAAA.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim())) {
        errors[`${prefix}.email`] = "Informe um e-mail válido.";
    }
    const phoneDigits = onlyDigits(person.phone);
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        errors[`${prefix}.phone`] = "Informe um telefone válido.";
    }
}

function formatFieldValue(
    field: keyof SchedulingPersonFields,
    value: string,
) {
    if (field === "cpf") return formatCpf(value);
    if (field === "phone") return formatPhone(value);
    if (field === "birthDate") return formatDate(value);
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
        ? digits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2")
        : digits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function formatCep(value: string) {
    return onlyDigits(value).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

function toDateInputValue(value: string) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function fromDateInputValue(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function formatDate(value: string) {
    const digits = onlyDigits(value).slice(0, 8);
    return digits
        .replace(/^(\d{2})(\d)/, "$1/$2")
        .replace(/^(\d{2})\/(\d{2})(\d)/, "$1/$2/$3");
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

function toBrazilIso(dateValue: string, timeValue: string) {
    if (!isValidDate(dateValue) || !isValidTime(timeValue)) return null;
    const [day, month, year] = dateValue.split("/");
    return new Date(`${year}-${month}-${day}T${timeValue}:00-03:00`).toISOString();
}

function hasCep(value: string) {
    return /\b\d{5}-?\d{3}\b/.test(value);
}

function onlyDigits(value: string) {
    return value.replace(/\D/g, "");
}
