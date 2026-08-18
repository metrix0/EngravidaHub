// components/clientes/ClientCallModal.tsx
"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, PhoneCall } from "lucide-react";

import {
    ClientProfileSummary,
    type ClientProfileSummaryData,
} from "@/components/clientes/ClientPanel";
import { openClientProfile } from "@/components/clientes/PermanentClientProfilePanel";
import {
    DropdownSelect,
    type DropdownSelectOption,
} from "@/components/ui/DropdownSelect";
import { Modal } from "@/components/ui/Modal";
import {
    CLIENT_CALL_CLOSURE_OPTIONS,
    DEFAULT_CLIENT_CALL_CLOSURE_TAG,
    type ClientCallClosureTag,
} from "@/lib/clients/callTracking";

type ClientResponse = {
    client: ClientProfileSummaryData;
};

type SavedCall = {
    last_called_at: string;
    last_call_closure_tag: string;
};

const CALL_CLOSURE_DROPDOWN_OPTIONS: DropdownSelectOption[] = (() => {
    const groups = ["Sem contato", "Não avançou", "Avançou", "Outro"] as const;

    return groups.flatMap((group) => {
        const options = CLIENT_CALL_CLOSURE_OPTIONS.filter(
            (option) => option.group === group,
        ).map((option) => ({
            value: option.value,
            label: option.label,
        }));

        if (group === "Outro") return options;

        return [
            {
                value: `__group_${group}`,
                label: `${group.toLocaleUpperCase("pt-BR")}:`,
                disabled: true,
            },
            ...options,
        ];
    });
})();

export default function ClientCallModal({
    clientId,
    open,
    onClose,
    onCallSaved,
}: {
    clientId: string | null;
    open: boolean;
    onClose: () => void;
    onCallSaved: (clientId: string, call: SavedCall) => void;
}) {
    const [data, setData] = useState<ClientResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [closureTag, setClosureTag] = useState<ClientCallClosureTag>(
        DEFAULT_CLIENT_CALL_CLOSURE_TAG,
    );
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !clientId) return;

        let cancelled = false;
        setLoading(true);
        setData(null);
        setError(null);
        setClosureTag(DEFAULT_CLIENT_CALL_CLOSURE_TAG);

        void (async () => {
            try {
                const response = await fetch(`/api/clientes/${clientId}`, {
                    cache: "no-store",
                });
                const json = await response.json();

                if (!response.ok) {
                    throw new Error(
                        json?.error ?? "Não foi possível carregar o cliente.",
                    );
                }

                if (!cancelled) setData(json as ClientResponse);
            } catch (loadError) {
                if (!cancelled) {
                    setError(
                        loadError instanceof Error
                            ? loadError.message
                            : "Não foi possível carregar o cliente.",
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [clientId, open]);

    async function saveCall() {
        if (!clientId || saving) return;

        setSaving(true);
        setError(null);

        try {
            const response = await fetch(`/api/clientes/${clientId}/calls`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ closure_tag: closureTag }),
            });
            const json = await response.json();

            if (!response.ok) {
                throw new Error(
                    json?.error ?? "Não foi possível registrar a ligação.",
                );
            }

            onCallSaved(clientId, {
                last_called_at: json.last_called_at,
                last_call_closure_tag: json.last_call_closure_tag,
            });
            onClose();
        } catch (saveError) {
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : "Não foi possível registrar a ligação.",
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={() => !saving && onClose()}
            width={760}
            maxWidth="calc(100vw - 48px)"
            height="82vh"
            maxHeight="82vh"
            closeOnOverlayClick={!saving}
            closeOnEscape={!saving}
            showCloseButton={!saving}
            zIndexClassName="z-[60]"
        >
            <div className="shrink-0 border-b border-border px-6 py-5 pr-16">
                <div className="flex items-center gap-2 text-xl font-bold text-text">
                    <PhoneCall size={20} className="text-green" />
                    Registrar ligação
                </div>
                <p className="mt-1 text-sm text-muted">
                    Confira o cliente e selecione o resultado da ligação.
                </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {loading ? (
                    <div className="flex h-full items-center justify-center text-sm font-medium text-muted">
                        <LoaderCircle size={18} className="mr-2 animate-spin" />
                        Carregando cliente...
                    </div>
                ) : data ? (
                    <div className="space-y-4">
                        <button
                            type="button"
                            onClick={() => {
                                if (!clientId) return;
                                onClose();
                                openClientProfile(clientId);
                            }}
                            className="w-full cursor-pointer rounded-2xl border border-border bg-white p-5 text-left shadow-sm transition hover:bg-slate-50"
                            title={`Abrir perfil de ${data.client.name ?? "cliente"}`}
                        >
                            <ClientProfileSummary client={data.client} />
                        </button>

                        <div className="pt-1">
                            <DropdownSelect
                                value={closureTag}
                                onChange={(value) =>
                                    setClosureTag(value as ClientCallClosureTag)
                                }
                                options={CALL_CLOSURE_DROPDOWN_OPTIONS}
                                widthClassName="w-full"
                                dropdownWidthClassName="w-full"
                            />
                        </div>
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-medium text-slate-400">
                        Não foi possível carregar este cliente.
                    </div>
                )}

                {error ? (
                    <div className="mt-4 rounded-xl border border-red/20 bg-red-soft px-3 py-2 text-sm font-semibold text-red">
                        {error}
                    </div>
                ) : null}
            </div>

            <div className="flex shrink-0 justify-end gap-3 border-t border-border bg-white px-6 py-4">
                <button
                    type="button"
                    disabled={saving}
                    onClick={onClose}
                    className="h-10 cursor-pointer rounded-xl border border-border bg-white px-5 text-sm font-semibold text-text shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Cancelar
                </button>
                <button
                    type="button"
                    disabled={!data || saving}
                    onClick={() => void saveCall()}
                    className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving ? <LoaderCircle size={15} className="animate-spin" /> : null}
                    Salvar ligação
                </button>
            </div>
        </Modal>
    );
}