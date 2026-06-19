// components/inbox/SchedulingPanel.tsx
"use client";

import { useState, type ReactNode } from "react";
import { Info, MapPin, Send, Sparkles } from "lucide-react";
import { FaFacebookF, FaInstagram, FaWhatsapp } from "react-icons/fa6";

import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { DetailsSidePanel } from "@/components/ui/DetailsSidePanel";
import InfoTooltip from "@/components/ui/InfoTooltip";
import type { InboxChannel } from "@/types/inbox";

type SchedulingFormat = "congelamento" | "casal";

type PersonFields = {
    fullName: string;
    cpf: string;
    birthDate: string;
    email: string;
    phone: string;
};

type SchedulingForm = {
    schedulingDate: string;
    primary: PersonFields;
    spouse: PersonFields;
    address: string;
};

type SchedulingPanelProps = {
    open: boolean;
    onClose: () => void;
    client: {
        name: string;
        phone: string | null;
        city: string | null;
        channel: InboxChannel;
    } | null;
};

type ErrorMap = Record<string, string>;

const emptyPerson: PersonFields = {
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

export default function SchedulingPanel({ open, onClose, client }: SchedulingPanelProps) {
    const [format, setFormat] = useState<SchedulingFormat>("congelamento");
    const [form, setForm] = useState<SchedulingForm>(initialForm);
    const [errors, setErrors] = useState<ErrorMap>({});
    const [submitted, setSubmitted] = useState(false);

    const clientName = client?.name ?? "Cliente sem nome";

    function updatePerson(
        person: "primary" | "spouse",
        field: keyof PersonFields,
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
                <div className="flex min-w-0 items-center gap-4">
                    <InitialsAvatar name={clientName} />

                    <div className="min-w-0 flex-1">
                        <div
                            title={clientName}
                            className="truncate font-bold text-slate-950"
                        >
                            {clientName}
                        </div>
                        <div className={"flex gap-3 mt-1 items-center"}>
                            <div className="text-sm text-slate-500">
                                {client?.phone ?? "Sem telefone"}
                            </div>

                            <div className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
                                <MapPin size={13} className="shrink-0" />
                                <span className="truncate">{client?.city ?? "Sem cidade"}</span>
                            </div>

                            {client?.channel && (
                                <div className="">
                                    <SchedulingChannelBadge channel={client.channel} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            }
            bodyClassName="min-h-0 flex-1 overflow-y-auto px-6 py-6"
        >
            <div className="space-y-6">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => undefined}
                        className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-selection"
                    >
                        <Sparkles size={16} className="text-brand" />
                        Autopreencher
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

                <section className={"py-2"}>
                    <div className="mb-3 text-sm font-bold text-slate-950">
                        Formato do agendamento
                    </div>

                    <div className="flex flex-wrap gap-5">
                        <FormatOption
                            active={format === "congelamento"}
                            label="Congelamento"
                            onClick={() => selectFormat("congelamento")}
                        />

                        <FormatOption
                            active={format === "casal"}
                            label="Casal"
                            onClick={() => selectFormat("casal")}
                        />
                    </div>
                </section>


                <FormField
                    label="Data do agendamento"
                    value={form.schedulingDate}
                    onChange={(value) => {
                        setForm((current) => ({ ...current, schedulingDate: value }));
                        clearError("schedulingDate");
                    }}
                    error={errors.schedulingDate}
                    placeholder="DD/MM/AAAA"
                />

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

                <FormField
                    label="Endereço completo com CEP"
                    value={form.address}
                    onChange={(value) => {
                        setForm((current) => ({ ...current, address: value }));
                        clearError("address");
                    }}
                    error={errors.address}
                    placeholder="Rua, número, bairro, cidade, estado e CEP"
                    multiline
                />

                {submitted && (
                    <div className="rounded-xl border border-green/20 bg-soft-green px-4 py-3 text-sm font-semibold text-green">
                        Todos os campos foram validados.
                    </div>
                )}

                <button
                    type="button"
                    onClick={handleSubmit}
                    className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90"
                >
                    <Send size={17} />
                    Enviar
                </button>
            </div>
        </DetailsSidePanel>
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

function PersonSection({
    title,
    person,
    values,
    errors,
    onChange,
}: {
    title?: string;
    person: "primary" | "spouse";
    values: PersonFields;
    errors: ErrorMap;
    onChange: (
        person: "primary" | "spouse",
        field: keyof PersonFields,
        value: string,
    ) => void;
}) {
    return (
        <section className="space-y-4">
            {title && <h3 className="text-sm font-bold text-slate-950">{title}</h3>}

            <FormField
                label="Nome completo (sem abreviações)"
                value={values.fullName}
                onChange={(value) => onChange(person, "fullName", value)}
                error={errors[`${person}.fullName`]}
            />

            <FormField
                label="CPF"
                value={values.cpf}
                onChange={(value) => onChange(person, "cpf", value)}
                error={errors[`${person}.cpf`]}
                placeholder="000.000.000-00"
                inputMode="numeric"
            />

            <FormField
                label="Data de nascimento"
                value={values.birthDate}
                onChange={(value) => onChange(person, "birthDate", value)}
                error={errors[`${person}.birthDate`]}
                placeholder="DD/MM/AAAA"
                inputMode="numeric"
            />

            <FormField
                label="E-mail"
                value={values.email}
                onChange={(value) => onChange(person, "email", value)}
                error={errors[`${person}.email`]}
                placeholder="nome@exemplo.com"
                type="email"
            />

            <FormField
                label="Telefone"
                value={values.phone}
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
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    error?: string;
    placeholder?: string;
    inputMode?: "numeric" | "text" | "email";
    type?: string;
    multiline?: boolean;
    icon?: ReactNode;
}) {
    const controlClass = `w-full appearance-none rounded-xl border bg-white px-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:outline-none focus-visible:outline-none focus:ring-0 ${
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
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                    rows={3}
                    className={`${controlClass} h-[72px] resize-none py-2.5 leading-relaxed`}
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

function SchedulingChannelBadge({ channel }: { channel: InboxChannel }) {
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
            className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold ${config.classes}`}
        >
            {config.icon}
        </span>
    );
}

function formatFieldValue(field: keyof PersonFields, value: string) {
    if (field === "cpf") return formatCpf(value);
    if (field === "phone") return formatPhone(value);
    if (field === "birthDate") return formatDate(value);
    if (field === "email") return value.trimStart().toLowerCase();
    return value;
}

function validateForm(form: SchedulingForm, format: SchedulingFormat): ErrorMap {
    const errors: ErrorMap = {};

    if (!form.schedulingDate.trim()) {
        errors.schedulingDate = "Informe a data do agendamento.";
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
    person: PersonFields,
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

function formatCpf(value: string) {
    const digits = onlyDigits(value).slice(0, 11);

    return digits
        .replace(/^(\d{3})(\d)/, "$1.$2")
        .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
        .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function formatPhone(value: string) {
    const digits = onlyDigits(value).slice(0, 11);

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

    return calculateDigit(9) === Number(cpf[9]) && calculateDigit(10) === Number(cpf[10]);
}

function isValidBirthDate(value: string) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) return false;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);

    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day &&
        date <= new Date()
    );
}

function hasCep(value: string) {
    const match = value.match(/\b\d{5}-?\d{3}\b/);
    return Boolean(match);
}

function onlyDigits(value: string) {
    return value.replace(/\D/g, "");
}
