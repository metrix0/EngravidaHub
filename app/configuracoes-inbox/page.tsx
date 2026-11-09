// app/configuracoes-inbox/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, PencilLine, Plus, Trash2 } from "lucide-react";
import { DataTable, Modal, Pagination, SearchFilter, SidePanel, Skeleton, type DataTableColumn } from "@/components";
import type { PrewrittenMessage } from "@/components/inbox/InboxPrewrittenMessagesController";

const PAGE_SIZE = 20;

function normalize(value: string) {
    return value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export default function ConfiguracoesInboxPage() {
    const [templates, setTemplates] = useState<PrewrittenMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [editing, setEditing] = useState<PrewrittenMessage | "new" | null>(null);
    const [draft, setDraft] = useState({ command: "/", text: "" });
    const [deleting, setDeleting] = useState<PrewrittenMessage | null>(null);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const response = await fetch("/api/inbox/message-templates", { cache: "no-store" });
                const body: { templates?: PrewrittenMessage[]; error?: string } = await response.json();
                if (!response.ok) throw new Error(body.error ?? "Erro ao carregar mensagens prontas");
                if (active) setTemplates(body.templates ?? []);
            } catch (cause) {
                if (active) setError(cause instanceof Error ? cause.message : "Erro ao carregar mensagens prontas");
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, []);

    const filtered = useMemo(() => {
        const term = normalize(search.trim());
        return term ? templates.filter((item) => normalize(item.command).includes(term) || normalize(item.text).includes(term)) : templates;
    }, [templates, search]);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    function openEditor(template: PrewrittenMessage | "new") {
        setEditing(template);
        setDraft(template === "new" ? { command: "/", text: "" } : { command: template.command, text: template.text });
        setFormError(null);
    }

    async function saveTemplate() {
        if (!editing || saving) return;
        setSaving(true);
        setFormError(null);
        try {
            const create = editing === "new";
            const response = await fetch("/api/inbox/message-templates", {
                method: create ? "POST" : "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(create ? draft : { ...draft, id: editing.id }),
            });
            const body: { template?: PrewrittenMessage; error?: string } = await response.json();
            if (!response.ok || !body.template) throw new Error(body.error ?? "Não foi possível salvar");
            const saved = body.template;
            setTemplates((prev) => create ? [...prev, saved] : prev.map((item) => item.id === saved.id ? saved : item));
            if (create) {
                setSearch("");
                setPage(Math.ceil((templates.length + 1) / PAGE_SIZE));
            }
            setEditing(null);
        } catch (cause) {
            setFormError(cause instanceof Error ? cause.message : "Não foi possível salvar");
        } finally {
            setSaving(false);
        }
    }

    async function removeTemplate() {
        if (!deleting || saving) return;
        setSaving(true);
        setFormError(null);
        try {
            const response = await fetch("/api/inbox/message-templates?id=" + encodeURIComponent(deleting.id), { method: "DELETE" });
            const body: { error?: string } = await response.json();
            if (!response.ok) throw new Error(body.error ?? "Não foi possível remover");
            setTemplates((prev) => prev.filter((item) => item.id !== deleting.id));
            setDeleting(null);
        } catch (cause) {
            setFormError(cause instanceof Error ? cause.message : "Não foi possível remover");
        } finally {
            setSaving(false);
        }
    }

    const columns: DataTableColumn<PrewrittenMessage>[] = [
        {
            id: "command", label: "Comando", width: "23%",
            render: (item) => <code className="inline-flex max-w-full truncate rounded-md bg-brand-soft px-2 py-1 text-xs font-bold text-brand" title={item.command}>{item.command}</code>,
        },
        {
            id: "text", label: "Mensagem", width: "57%",
            render: (item) => <p className="truncate text-sm text-slate-700" title={item.text}>{item.text}</p>,
        },
        {
            id: "actions", label: "Ações", width: "20%", align: "right",
            render: (item) => (
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => openEditor(item)} title="Editar mensagem" aria-label={"Editar " + item.command} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><PencilLine size={16} /></button>
                    <button type="button" onClick={() => { setFormError(null); setDeleting(item); }} title="Remover mensagem" aria-label={"Remover " + item.command} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-red hover:bg-red-soft"><Trash2 size={16} /></button>
                </div>
            ),
        },
    ];

    return (
        <main className="flex h-full w-full overflow-y-auto bg-white text-slate-900 md:h-screen">
            <SidePanel />
            <section className="min-w-0 flex-1 px-4 py-5 pb-16 md:px-8 md:py-8">
                <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">Configurações Inbox</h1>
                        <p className="mt-2 text-sm text-slate-500">Gerencie as mensagens prontas utilizadas no Inbox.</p>
                    </div>
                    <button type="button" onClick={() => openEditor("new")} className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm hover:opacity-90"><Plus size={16} />Adicionar mensagem</button>
                </header>

                {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
                <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                    <SearchFilter value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Buscar comando ou mensagem..." widthClassName="w-[340px]" />
                    <span className="text-sm text-slate-500">{filtered.length} mensagens</span>
                </div>
                {loading ? (
                    <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
                ) : (
                    <>
                        <DataTable columns={columns} rows={visible} getRowKey={(item) => item.id} emptyMessage="Nenhuma mensagem encontrada." />
                        {filtered.length > PAGE_SIZE && (
                            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                                <span className="text-sm text-slate-500">Mostrando {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} de {filtered.length}</span>
                                <Pagination totalPages={totalPages} currentPage={currentPage} onPageChange={setPage} activeTone="brand" />
                            </div>
                        )}
                    </>
                )}
            </section>

            <Modal open={editing !== null} onClose={() => { if (!saving) setEditing(null); }} width={640} height="auto" maxHeight="82vh" ariaLabelledBy="inbox-template-modal-title">
                <div className="overflow-y-auto p-6 md:p-8">
                    <h2 id="inbox-template-modal-title" className="mb-6 pr-8 text-xl font-bold text-slate-900">{editing === "new" ? "Adicionar mensagem" : "Editar mensagem"}</h2>
                    <form onSubmit={(event) => { event.preventDefault(); void saveTemplate(); }} className="space-y-5">
                        <label className="block space-y-2 text-sm font-semibold text-slate-700">
                            <span>Comando</span>
                            <input required maxLength={100} value={draft.command} onChange={(event) => setDraft((prev) => ({ ...prev, command: event.target.value }))} placeholder="/comando" className="h-11 w-full rounded-xl border border-border px-4 text-sm font-normal outline-none focus:ring-2 focus:ring-brand/30" />
                        </label>
                        <label className="block space-y-2 text-sm font-semibold text-slate-700">
                            <span>Mensagem</span>
                            <textarea required rows={7} value={draft.text} onChange={(event) => setDraft((prev) => ({ ...prev, text: event.target.value }))} placeholder="Texto da mensagem pronta" className="min-h-32 w-full resize-y rounded-xl border border-border p-4 text-sm font-normal outline-none focus:ring-2 focus:ring-brand/30" />
                        </label>
                        {formError && <p role="alert" className="text-sm text-red">{formError}</p>}
                        <div className="flex justify-end gap-3">
                            <button type="button" disabled={saving} onClick={() => setEditing(null)} className="h-10 cursor-pointer rounded-xl border border-border px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancelar</button>
                            <button type="submit" disabled={saving} className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white disabled:opacity-50">{saving && <LoaderCircle size={16} className="animate-spin" />}Salvar</button>
                        </div>
                    </form>
                </div>
            </Modal>

            <Modal open={deleting !== null} onClose={() => { if (!saving) setDeleting(null); }} width={480} height="auto" maxHeight="82vh" ariaLabelledBy="inbox-template-delete-title">
                <div className="p-6 md:p-8">
                    <h2 id="inbox-template-delete-title" className="mb-3 pr-8 text-xl font-bold">Remover mensagem?</h2>
                    <p className="mb-6 text-sm text-slate-600">O comando <strong>{deleting?.command}</strong> não estará mais disponível no Inbox.</p>
                    {formError && <p role="alert" className="mb-4 text-sm text-red">{formError}</p>}
                    <div className="flex justify-end gap-3">
                        <button type="button" disabled={saving} onClick={() => setDeleting(null)} className="h-10 cursor-pointer rounded-xl border border-border px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancelar</button>
                        <button type="button" disabled={saving} onClick={() => void removeTemplate()} className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-red px-4 text-sm font-bold text-white disabled:opacity-50">{saving && <LoaderCircle size={16} className="animate-spin" />}Remover</button>
                    </div>
                </div>
            </Modal>
        </main>
    );
}
