// components/clientes/ClientInformationCard.tsx
"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, Pencil, X } from "lucide-react";

export type ClientUnitOption = {
    id: string;
    name: string;
};

export type EditableClientDetail = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    cpf: string | null;
    birth_date: string | null;
    unit_id: string | null;
    street: string | null;
    number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    cep: string | null;
    unit: ClientUnitOption | null;
};

type FormState = {
    name: string;
    cpf: string;
    birthDate: string;
    email: string;
    phone: string;
    unitId: string;
    cep: string;
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    country: string;
};

export default function ClientInformationCard({
    client,
    units,
    onSaved,
}: {
    client: EditableClientDetail;
    units: ClientUnitOption[];
    onSaved: (client: EditableClientDetail) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(() => toForm(client));

    useEffect(() => {
        if (!editing) setForm(toForm(client));
    }, [client, editing]);

    function update<K extends keyof FormState>(key: K, value: FormState[K]) {
        setError(null);
        setForm((current) => ({ ...current, [key]: value }));
    }

    function cancel() {
        setForm(toForm(client));
        setError(null);
        setEditing(false);
    }

    async function save() {
        if (saving) return;
        if (!form.name.trim()) {
            setError("Informe o nome do cliente.");
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const response = await fetch(`/api/clientes/${client.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: form.name,
                    cpf: form.cpf,
                    birthDate: form.birthDate,
                    email: form.email,
                    phone: form.phone,
                    unitId: form.unitId,
                    address: {
                        cep: form.cep,
                        street: form.street,
                        number: form.number,
                        complement: form.complement,
                        neighborhood: form.neighborhood,
                        city: form.city,
                        state: form.state,
                        country: form.country,
                    },
                }),
            });
            const json = await response.json();

            if (!response.ok) {
                throw new Error(json?.error ?? "Não foi possível atualizar o cliente.");
            }

            onSaved(json.client as EditableClientDetail);
            setEditing(false);
        } catch (saveError) {
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : "Não foi possível atualizar o cliente.",
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-lg font-bold text-text">Informações do cliente</h3>
                    <p className="mt-1 text-xs text-muted">Dados pessoais, contato e endereço</p>
                </div>

                {editing ? (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={cancel}
                            disabled={saving}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                            aria-label="Cancelar edição"
                        >
                            <X size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving}
                            className="flex h-9 cursor-pointer items-center gap-2 rounded-xl bg-brand px-3 text-sm font-bold text-white transition hover:bg-brand/90 disabled:opacity-50"
                        >
                            {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}
                            Salvar
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                    >
                        <Pencil size={15} />
                        Editar
                    </button>
                )}
            </div>

            {editing ? (
                <div className="space-y-4">
                    <Input label="Nome completo" value={form.name} onChange={(value) => update("name", value)} />
                    <div className="grid grid-cols-2 gap-3">
                        <Input label="CPF" value={form.cpf} onChange={(value) => update("cpf", formatCpf(value))} placeholder="000.000.000-00" />
                        <Input label="Data de nascimento" type="date" value={form.birthDate} onChange={(value) => update("birthDate", value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Input label="E-mail" type="email" value={form.email} onChange={(value) => update("email", value)} placeholder="nome@exemplo.com" />
                        <Input label="Telefone" value={form.phone} onChange={(value) => update("phone", formatPhoneInput(value))} placeholder="(00) 00000-0000" />
                    </div>
                    <label className="block">
                        <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Unidade</span>
                        <select
                            value={form.unitId}
                            onChange={(event) => update("unitId", event.target.value)}
                            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-brand"
                        >
                            <option value="">Sem unidade</option>
                            {units.map((unit) => (
                                <option key={unit.id} value={unit.id}>{unit.name}</option>
                            ))}
                        </select>
                    </label>
                    <div className="grid grid-cols-[.8fr_1.2fr] gap-3">
                        <Input label="CEP" value={form.cep} onChange={(value) => update("cep", formatCep(value))} placeholder="00000-000" />
                        <Input label="Rua" value={form.street} onChange={(value) => update("street", value)} />
                    </div>
                    <div className="grid grid-cols-[.7fr_1.3fr] gap-3">
                        <Input label="Número" value={form.number} onChange={(value) => update("number", value)} />
                        <Input label="Complemento" value={form.complement} onChange={(value) => update("complement", value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Input label="Bairro" value={form.neighborhood} onChange={(value) => update("neighborhood", value)} />
                        <Input label="Cidade" value={form.city} onChange={(value) => update("city", value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Input label="Estado" value={form.state} onChange={(value) => update("state", value)} />
                        <Input label="País" value={form.country} onChange={(value) => update("country", value)} />
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                    <Value label="Nome completo" value={client.name} full />
                    <Value label="CPF" value={formatCpf(client.cpf ?? "")} />
                    <Value label="Data de nascimento" value={formatBirthDate(client.birth_date)} />
                    <Value label="E-mail" value={client.email} />
                    <Value label="Telefone" value={formatPhoneDisplay(client.phone)} />
                    <Value label="Unidade" value={client.unit?.name} />
                    <Value label="Endereço" value={formatAddress(client)} full />
                </div>
            )}

            {error && (
                <div className="mt-4 rounded-xl border border-red/20 bg-red-soft px-3 py-2 text-sm font-semibold text-red">
                    {error}
                </div>
            )}
        </section>
    );
}

function Input({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
    return (
        <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
            <input
                type={type}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-brand"
            />
        </label>
    );
}

function Value({ label, value, full = false }: { label: string; value: string | null | undefined; full?: boolean }) {
    return (
        <div className={full ? "col-span-2" : ""}>
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-1 break-words font-semibold text-slate-700">{value?.trim() || "—"}</div>
        </div>
    );
}

function toForm(client: EditableClientDetail): FormState {
    return {
        name: client.name ?? "",
        cpf: formatCpf(client.cpf ?? ""),
        birthDate: client.birth_date?.slice(0, 10) ?? "",
        email: client.email ?? "",
        phone: formatPhoneInput(client.phone ?? ""),
        unitId: client.unit_id ?? "",
        cep: formatCep(client.cep ?? ""),
        street: client.street ?? "",
        number: client.number ?? "",
        complement: client.complement ?? "",
        neighborhood: client.neighborhood ?? "",
        city: client.city ?? "",
        state: client.state ?? "",
        country: client.country ?? "",
    };
}

function formatAddress(client: EditableClientDetail) {
    const firstLine = [client.street, client.number].filter(Boolean).join(", ");
    const secondLine = [client.complement, client.neighborhood, client.city, client.state, formatCep(client.cep ?? "")].filter(Boolean).join(" • ");
    return [firstLine, secondLine, client.country].filter(Boolean).join(" — ") || "—";
}

function formatBirthDate(value: string | null) {
    if (!value) return "—";
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatPhoneDisplay(value: string | null) {
    const formatted = formatPhoneInput(value ?? "");
    return formatted || "—";
}

function formatCpf(value: string) {
    return value.replace(/\D/g, "").slice(0, 11)
        .replace(/^(\d{3})(\d)/, "$1.$2")
        .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
        .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function formatPhoneInput(value: string) {
    let digits = value.replace(/\D/g, "");
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);
    return digits.slice(0, 11)
        .replace(/^(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{5})(\d)/, "$1-$2");
}

function formatCep(value: string) {
    return value.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}
