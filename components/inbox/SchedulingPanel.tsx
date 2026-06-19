// components/inbox/SchedulingPanel.tsx
"use client";

import { useEffect, useState } from "react";
import {
    AlertCircle,
    ChevronRight,
    Info,
    LoaderCircle,
    MapPin,
    Send,
    Sparkles,
} from "lucide-react";
import { FaFacebookF, FaInstagram, FaWhatsapp } from "react-icons/fa6";

import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { DetailsSidePanel } from "@/components/ui/DetailsSidePanel";
import InfoTooltip from "@/components/ui/InfoTooltip";
import type { InboxChannel } from "@/types/inbox";
import type {
    SchedulingDataResponse,
    SchedulingForm,
    SchedulingFormat,
    SchedulingPersonFields,
} from "@/types/scheduling";

type SchedulingPanelProps = {
    open: boolean;
    threadId: string | null;
    clientId: string | null;
    onClose: () => void;
    onOpenClientProfile: (clientId: string) => void;
    client: {
        name: string;
        phone: string | null;
        city: string | null;
        channel: InboxChannel;
    } | null;
};

type ErrorMap = Record<string, string>;

const emptyPerson: SchedulingPersonFields = {
    fullName: "",
    cpf: "",
    birthDate: "",
    email: "",
    phone: "",
};

const initialForm: SchedulingForm = {
    schedulingDate: "",
    primary: { ...emptyPerson },
    spouse: { ...emptyPerson },
    address: "",
};

export default function SchedulingPanel({
                                            open,
                                            threadId,
                                            clientId,
                                            onClose,
                                            onOpenClientProfile,
                                            client,
                                        }: SchedulingPanelProps) {
    const [format, setFormat] =
        useState<SchedulingFormat>("congelamento");
    const [form, setForm] = useState<SchedulingForm>(initialForm);
    const [data, setData] = useState<SchedulingDataResponse | null>(null);
    const [errors, setErrors] = useState<ErrorMap>({});
    const [submitted, setSubmitted] = useState(false);
    const [loadingData, setLoadingData] = useState(false);
    const [autofilling, setAutofilling] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [autofillError, setAutofillError] = useState<string | null>(null);
    const [autofillSuccess, setAutofillSuccess] = useState(false);

    useEffect(() => {
        if (!open) return;

        if (!threadId) {
            setData(null);
            setForm(initialForm);
            setLoadError("Não foi possível identificar esta conversa.");
            return;
        }

        const controller = new AbortController();

        async function loadSchedulingData() {
            setLoadingData(true);
            setLoadError(null);
            setAutofillError(null);
            setAutofillSuccess(false);
            setSubmitted(false);
            setErrors({});

            try {
                const response = await fetch(
                    `/api/inbox/scheduling-data?thread_id=${encodeURIComponent(threadId!)}`,
                    {
                        cache: "no-store",
                        signal: controller.signal,
                    },
                );
                const json = await response.json();

                if (!response.ok) {
                    throw new Error(
                        json?.error ?? "Não foi possível carregar os dados.",
                    );
                }

                const nextData = json as SchedulingDataResponse;

                setData(nextData);
                setFormat(nextData.suggestedFormat);
                setForm(nextData.form);
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
                if (!controller.signal.aborted) {
                    setLoadingData(false);
                }
            }
        }

        void loadSchedulingData();

        return () => controller.abort();
    }, [open, threadId]);

    const clientName =
        data?.client.name ?? client?.name ?? "Cliente sem nome";
    const clientPhone =
        data?.client.phone ?? client?.phone ?? "Sem telefone";
    const clientCity =
        data?.client.state ?? client?.city ?? "Sem cidade";
    const profileClientId = data?.client.id ?? clientId;
    const disabled = loadingData || autofilling;

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
        setAutofillSuccess(false);
    }

    function clearError(field: string) {
        setErrors((current) => {
            if (!current[field]) return current;

            const next = { ...current };
            delete next[field];
            return next;
        });
        setSubmitted(false);
    }

    function selectFormat(nextFormat: SchedulingFormat) {
        setFormat(nextFormat);
        setErrors({});
        setSubmitted(false);
        setAutofillSuccess(false);
    }

    async function handleAutofill() {
        if (!threadId || autofilling || loadingData) return;

        setAutofilling(true);
        setAutofillError(null);
        setAutofillSuccess(false);
        setSubmitted(false);

        try {
            const response = await fetch(
                "/api/inbox/scheduling-autofill",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        threadId,
                        format,
                        form,
                    }),
                },
            );
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

    function handleSubmit() {
        const nextErrors = validateForm(form, format);
        setErrors(nextErrors);
        setSubmitted(Object.keys(nextErrors).length === 0);
    }

    return (
        <DetailsSidePanel
            open={open}
            title="Agendar"
            onClose={onClose}
            headerContent={
                <button
                    type="button"
                    disabled={!profileClientId}
                    onClick={() => {
                        if (profileClientId) {
                            onOpenClientProfile(profileClientId);
                        }
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
                                    <span className="truncate">{clientCity}</span>
                                </div>

                                {client?.channel && (
                                    <SchedulingChannelBadge
                                        channel={client.channel}
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    <ChevronRight
                        size={18}
                        className="shrink-0 text-slate-400"
                    />
                </button>
            }
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
                    {loadError && (
                        <ErrorMessage message={loadError} />
                    )}

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={!threadId || disabled}
                            onClick={handleAutofill}
                            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-selection disabled:cursor-not-allowed disabled:opacity-55"
                        >
                            {autofilling ? (
                                <LoaderCircle
                                    size={16}
                                    className="animate-spin text-brand"
                                />
                            ) : (
                                <Sparkles size={16} className="text-brand" />
                            )}
                            {autofilling ? "Preenchendo..." : "Autopreencher"}
                        </button>

                        <InfoTooltip text="Este botão preenche os dados automaticamente com base no Chat.">
                            <button
                                type="button"
                                className="flex h-9 w-9 cursor-help items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                                aria-label="Informações sobre o autopreenchimento"
                            >
                                <Info size={17} />
                            </button>
                        </InfoTooltip>
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


                    {autofillError && (
                        <ErrorMessage message={autofillError} />
                    )}

                    {autofillSuccess && (
                        <div className="rounded-xl border border-green/20 bg-soft-green px-4 py-3 text-sm font-semibold text-green">
                            Dados atualizados com base no cadastro e nas últimas mensagens.
                        </div>
                    )}

                    <FormField
                        label="Data do agendamento"
                        value={form.schedulingDate}
                        disabled={disabled}
                        onChange={(value) => {
                            setForm((current) => ({
                                ...current,
                                schedulingDate: formatDate(value),
                            }));
                            clearError("schedulingDate");
                            setAutofillSuccess(false);
                        }}
                        error={errors.schedulingDate}
                        placeholder="DD/MM/AAAA"
                        inputMode="numeric"
                    />

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

                    <FormField
                        label="Endereço completo com CEP"
                        value={form.address}
                        disabled={disabled}
                        onChange={(value) => {
                            setForm((current) => ({
                                ...current,
                                address: value,
                            }));
                            clearError("address");
                            setAutofillSuccess(false);
                        }}
                        error={errors.address}
                        placeholder="Rua, número, cidade, estado e CEP"
                        multiline
                    />

                    {submitted && (
                        <div className="rounded-xl border border-green/20 bg-soft-green px-4 py-3 text-sm font-semibold text-green">
                            Todos os campos foram validados.
                        </div>
                    )}

                    <button
                        type="button"
                        disabled={disabled}
                        onClick={handleSubmit}
                        className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                        <Send size={17} />
                        Enviar
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


function ErrorMessage({ message }: { message: string }) {
    return (
        <div className="flex items-start gap-2 rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-sm font-medium text-red">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
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
            {title && (
                <h3 className="text-sm font-bold text-slate-950">{title}</h3>
            )}

            <FormField
                label="Nome completo (sem abreviações)"
                value={values.fullName}
                disabled={disabled}
                onChange={(value) =>
                    onChange(person, "fullName", value)
                }
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
                onChange={(value) =>
                    onChange(person, "birthDate", value)
                }
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
}) {
    const controlClass = `w-full appearance-none rounded-xl border bg-white px-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:outline-none focus-visible:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${
        error
            ? "border-red"
            : "border-slate-200 focus:border-brand"
    }`;

    return (
        <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                {label}
            </span>

            {multiline ? (
                <textarea
                    value={value}
                    disabled={disabled}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                    rows={3}
                    className={`${controlClass} h-[72px] resize-none py-2.5 leading-relaxed`}
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

function SchedulingChannelBadge({
                                    channel,
                                }: {
    channel: InboxChannel;
}) {
    const config = {
        WhatsApp: {
            icon: <FaWhatsapp size={14} />,
            classes: "bg-green-soft text-green",
        },
        Instagram: {
            icon: <FaInstagram size={14} />,
            classes: "bg-pink-soft text-pink",
        },
        Facebook: {
            icon: <FaFacebookF size={13} />,
            classes: "bg-blue-soft text-blue",
        },
    }[channel];

    return (
        <span
            className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-bold ${config.classes}`}
        >
            {config.icon}
        </span>
    );
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

function validateForm(
    form: SchedulingForm,
    format: SchedulingFormat,
): ErrorMap {
    const errors: ErrorMap = {};

    if (!isValidDate(form.schedulingDate)) {
        errors.schedulingDate =
            "Use uma data válida no formato DD/MM/AAAA.";
    }

    validatePerson(form.primary, "primary", errors);

    if (format === "casal") {
        validatePerson(form.spouse, "spouse", errors);
    }

    if (!form.address.trim()) {
        errors.address = "Informe o endereço completo com CEP.";
    } else if (!hasCep(form.address)) {
        errors.address = "Inclua um CEP válido no endereço.";
    }

    return errors;
}

function validatePerson(
    person: SchedulingPersonFields,
    prefix: "primary" | "spouse",
    errors: ErrorMap,
) {
    if (person.fullName.trim().split(/\s+/).length < 2) {
        errors[`${prefix}.fullName`] =
            "Informe o nome completo, sem abreviações.";
    }

    if (!isValidCpf(person.cpf)) {
        errors[`${prefix}.cpf`] = "Informe um CPF válido.";
    }

    if (!isValidBirthDate(person.birthDate)) {
        errors[`${prefix}.birthDate`] =
            "Use uma data válida no formato DD/MM/AAAA.";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim())) {
        errors[`${prefix}.email`] = "Informe um e-mail válido.";
    }

    const phoneDigits = onlyDigits(person.phone);
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        errors[`${prefix}.phone`] = "Informe um telefone válido.";
    }
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

    if (digits.length <= 10) {
        return digits
            .replace(/^(\d{2})(\d)/, "($1) $2")
            .replace(/(\d{4})(\d)/, "$1-$2");
    }

    return digits
        .replace(/^(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{5})(\d)/, "$1-$2");
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
    return isValidDate(value, true);
}

function isValidDate(value: string, mustBePast = false) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) return false;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return false;
    }

    return !mustBePast || date <= new Date();
}

function hasCep(value: string) {
    return /\b\d{5}-?\d{3}\b/.test(value);
}

function onlyDigits(value: string) {
    return value.replace(/\D/g, "");
}
