"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";

import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { Modal } from "@/components/ui/Modal";

type Destination = { id: string; name: string; is_online?: boolean };
type TransferMode = "queue" | "attendant";

export default function TransferConversationModal({
    open, threadId, currentAttendantId, onClose, onTransferred,
}: {
    open: boolean;
    threadId: string | null;
    currentAttendantId: string | null;
    onClose: () => void;
    onTransferred: () => Promise<void>;
}) {
    const [mode, setMode] = useState<TransferMode>("queue");
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [queues, setQueues] = useState<Destination[]>([]);
    const [attendants, setAttendants] = useState<Destination[]>([]);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        setMode("queue");
        setSearch("");
        setSelectedId("");
        setQueues([]);
        setAttendants([]);
        setError(null);
        setLoading(true);
        (async () => {
            try {
                const response = await fetch("/api/inbox/transfer", { cache: "no-store", signal: controller.signal });
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.error ?? "Não foi possível carregar os destinos.");
                if (!controller.signal.aborted) {
                    setQueues(result.queues ?? []);
                    setAttendants(result.attendants ?? []);
                }
            } catch (caught) {
                if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Não foi possível carregar os destinos.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        })();
        return () => controller.abort();
    }, [open]);

    const options = useMemo(() => {
        const source = mode === "queue" ? queues : attendants.filter(person => person.id !== currentAttendantId);
        const query = search.trim().toLocaleLowerCase("pt-BR");
        return source.filter(item => !query || item.name.toLocaleLowerCase("pt-BR").includes(query))
            .map(item => ({
                value: item.id,
                label: item.name,
                description: mode === "attendant" && !item.is_online ? "Offline" : undefined,
            }));
    }, [mode, search, queues, attendants, currentAttendantId]);

    function changeMode(next: TransferMode) {
        setMode(next);
        setSearch("");
        setSelectedId("");
        setError(null);
    }

    async function submit() {
        if (!threadId || !selectedId || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const response = await fetch("/api/inbox/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ threadId, targetType: mode, targetId: selectedId }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error ?? "Não foi possível transferir o atendimento.");
            await onTransferred();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Não foi possível transferir o atendimento.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal open={open} onClose={() => { if (!submitting) onClose(); }} width={460} height={560} maxHeight="calc(100dvh - 32px)" ariaLabelledBy="inbox-transfer-title" closeOnEscape={!submitting} closeOnOverlayClick={!submitting}>
            <div className="flex min-h-0 flex-1 flex-col gap-5 p-5 pt-6 sm:p-6">
                <h2 id="inbox-transfer-title" className="pr-10 text-lg font-bold text-slate-950">Transferir atendimento</h2>
                <fieldset className="flex items-center gap-6">
                    <legend className="sr-only">Transferir para</legend>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                        <input
                            type="radio"
                            name="transferDestinationType"
                            value="queue"
                            checked={mode === "queue"}
                            onChange={() => changeMode("queue")}
                            disabled={submitting}
                            className="h-4 w-4 cursor-pointer accent-brand"
                        />
                        Fila
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                        <input
                            type="radio"
                            name="transferDestinationType"
                            value="attendant"
                            checked={mode === "attendant"}
                            onChange={() => changeMode("attendant")}
                            disabled={submitting}
                            className="h-4 w-4 cursor-pointer accent-brand"
                        />
                        Atendente
                    </label>
                </fieldset>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        {mode === "queue" ? "Selecionar fila" : "Selecionar atendente"}
                    </label>
                    <DropdownSelect
                        value={selectedId}
                        onChange={id => { setSelectedId(id); setSearch(options.find(option => option.value === id)?.label ?? ""); setError(null); }}
                        options={options}
                        searchable
                        searchValue={search}
                        onSearchChange={value => { setSearch(value); setSelectedId(""); }}
                        searchPlaceholder={mode === "queue" ? "Buscar fila" : "Buscar atendente"}
                        icon={<Search size={16} />}
                        widthClassName="w-full"
                        dropdownWidthClassName="w-full"
                        contained
                        disabled={loading || submitting}
                        loading={loading}
                    />
                    {error && <p role="alert" className="mt-3 text-xs font-medium text-red">{error}</p>}
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                    <button type="button" onClick={onClose} disabled={submitting} className="h-10 cursor-pointer rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-selection disabled:opacity-50">Cancelar</button>
                    <button type="button" onClick={() => void submit()} disabled={!threadId || !selectedId || loading || submitting} className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
                        {submitting && <LoaderCircle size={16} className="animate-spin" />} Transferir
                    </button>
                </div>
            </div>
        </Modal>
    );
}
