"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    FileText,
    LoaderCircle,
    Plus,
    Search,
    Send,
    Trash2,
} from "lucide-react";

import Card from "@/components/ui/Card";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { Modal } from "@/components/ui/Modal";
import { budgetModels, budgetSchema, budgetTotals, budgetUnits, currency, patientFilters, type BudgetPatient } from "@/lib/orcamentos/budget";

type Procedure = {
    id: number;
    description: string;
    quantity: string;
    price: string;
    discount: string;
};

const fieldClass =
    "h-11 w-full min-w-0 rounded-xl border border-border bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-brand placeholder:text-slate-400";
const labelClass = "mb-2 block text-xs font-semibold text-slate-600";
const emptyProcedure = (id: number): Procedure => ({
    id,
    description: "",
    quantity: "1",
    price: "",
    discount: "",
});
function nonNegative(value: string) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
}

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export default function OrcamentosDraft({ lockedUnit, defaultResponsible }: { lockedUnit: string | null; defaultResponsible: string }) {
    const [patientSearch, setPatientSearch] = useState("");
    const [model, setModel] = useState("fiv");
    const [unit, setUnit] = useState(lockedUnit || "");
    const [issueDate, setIssueDate] = useState(today);
    const [validUntil, setValidUntil] = useState("");
    const [responsible, setResponsible] = useState(defaultResponsible);
    const [paymentMethod, setPaymentMethod] = useState("");
    const [installments, setInstallments] = useState("");
    const [notes, setNotes] = useState("");
    const [procedures, setProcedures] = useState<Procedure[]>([
        emptyProcedure(1),
    ]);
    const nextProcedureId = useRef(2);

    const totals = useMemo(() => {
        const values = budgetTotals(procedures.map((item) => ({
            description: item.description, quantity: nonNegative(item.quantity),
            price: nonNegative(item.price), discount: nonNegative(item.discount),
        })));
        return { ...values, total: Math.max(0, values.total) };
    }, [procedures]);

    const [filter, setFilter] = useState("nome");
    const [patients, setPatients] = useState<BudgetPatient[]>([]);
    const [patient, setPatient] = useState<BudgetPatient | null>(null);
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState<"search" | "pdf" | "send" | null>(null);
    const pending = useRef(false);
    const [searched, setSearched] = useState(false);
    const [attempted, setAttempted] = useState(false);
    const [saved, setSaved] = useState("");
    const [error, setError] = useState("");
    const [pdfUrl, setPdfUrl] = useState("");
    const [previewOpen, setPreviewOpen] = useState(false);
    const objectUrl = useRef("");
    useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

    const candidate = {
        code, record: patient?.record ?? "", model, unit, issueDate, validUntil,
        responsible, paymentMethod, installments, notes,
        procedures: procedures.map(({ description, quantity, price, discount }) => ({
            description, quantity: Number(quantity), price: price.trim() ? Number(price) : NaN,
            discount: discount.trim() ? Number(discount) : 0,
        })),
    };
    const snapshot = JSON.stringify(candidate);

    async function searchPatients() {
        if (pending.current || attempted || patientSearch.trim().length < 3) return;
        pending.current = true;
        setBusy("search");
        setError("");
        setSearched(false);
        setPatients([]);
        try {
            const response = await fetch("/api/orcamentos", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "search", filter, q: patientSearch.trim() }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Não foi possível buscar pacientes.");
            setPatients(data.patients);
            setSearched(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível buscar pacientes.");
        } finally {
            pending.current = false;
            setBusy(null);
        }
    }

    function selectPatient(result: BudgetPatient) {
        if (pending.current || attempted) return;
        if (patient?.record !== result.record) {
            setCode("HUB-" + crypto.randomUUID());
            setUnit(lockedUnit || (budgetUnits.some((option) => option.value === result.unit) ? result.unit : ""));
        }
        setPatient(result);
        setPatients([]);
        setSearched(false);
        setError("");
    }

    function resetBudget() {
        setPatientSearch("");
        setPatients([]);
        setPatient(null);
        setCode("");
        setSearched(false);
        setAttempted(false);
        setSaved("");
        setError("");
        setUnit(lockedUnit || "");
        setIssueDate(today());
        setValidUntil("");
        setResponsible(defaultResponsible);
        setPaymentMethod("");
        setInstallments("");
        setNotes("");
        setProcedures([emptyProcedure(nextProcedureId.current++)]);
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = "";
        setPdfUrl("");
        setPreviewOpen(false);
    }

    async function submitBudget(action: "pdf" | "send") {
        if (pending.current) return;
        setError("");
        const parsed = budgetSchema.safeParse(candidate);
        if (!parsed.success) {
            setError("Selecione o paciente e a unidade, preencha os procedimentos e confira os valores, descontos e datas.");
            return;
        }
        pending.current = true;
        if (action === "send") setAttempted(true);
        setBusy(action);
        try {
            const response = await fetch("/api/orcamentos", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, budget: parsed.data }),
            });
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.error || "Não foi possível concluir a operação.");
            }
            if (action === "pdf") {
                if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
                const url = URL.createObjectURL(await response.blob());
                objectUrl.current = url;
                setPdfUrl(url);
                setPreviewOpen(true);
            } else setSaved(snapshot);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível concluir a operação.");
        } finally {
            pending.current = false;
            setBusy(null);
        }
    }


    function updateProcedure(id: number, field: Exclude<keyof Procedure, "id">, value: string) {
        setProcedures((current) =>
            current.map((procedure) =>
                procedure.id === id ? { ...procedure, [field]: value } : procedure,
            ),
        );
    }

    return (
        <main className="h-full w-full overflow-y-auto bg-background px-4 py-5 md:px-8 md:py-8">
            <div className="mx-auto max-w-7xl space-y-6 pb-12">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                    Orçamentos
                </h1>

                <form onSubmit={(event) => event.preventDefault()} className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="min-w-0 space-y-6">
                        <Card>
                            <h2 className="text-lg font-bold text-slate-900">1. Paciente</h2>
                            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                                <div className="min-w-0 flex-1">
                                    <label htmlFor="orcamentos-paciente" className={labelClass}>
                                        Buscar por
                                    </label>
                                    <div className="mb-2">
                                        <DropdownSelect value={filter} onChange={(value) => { setFilter(value); setPatients([]); setSearched(false); }} options={patientFilters} disabled={!!busy || attempted} widthClassName="w-full" />
                                    </div>
                                    <div className="relative">
                                        <input
                                            id="orcamentos-paciente"
                                            className={fieldClass + " pr-10"}
                                            placeholder="Buscar paciente..."
                                            value={patientSearch}
                                            onChange={(event) => { setPatientSearch(event.target.value); setPatients([]); setSearched(false); }} disabled={!!busy || attempted} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchPatients(); } }}
                                            autoComplete="off"
                                        />
                                        <Search size={16} className="pointer-events-none absolute right-3.5 top-3.5 text-slate-400" />
                                    </div>
                                </div>
                                <button type="button" onClick={searchPatients} disabled={!!busy || attempted || patientSearch.trim().length < 3} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed">
                                    {busy === "search" && <LoaderCircle size={16} className="animate-spin" />} Buscar no Clinisys
                                </button>
                            </div>
                            {patients.length > 0 && (
                                <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-border">
                                    {patients.map((result) => (
                                        <button key={result.record} type="button" onClick={() => selectPatient(result)} disabled={!!busy || attempted} className="block w-full border-b border-border px-4 py-3 text-left text-sm last:border-b-0 hover:bg-slate-50">
                                            <span className="block font-semibold text-slate-700">{result.name}</span>
                                            <span className="text-xs text-slate-500">Prontuário {result.record} · {result.unitName}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {searched && !patients.length && <p className="mt-4 text-sm text-slate-500">Nenhum paciente encontrado.</p>}
                            <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-border bg-slate-50 p-4 text-sm sm:grid-cols-2">
                                <div>
                                    <p className="text-xs font-medium text-slate-500">Paciente selecionado</p>
                                    <p className="mt-1 font-semibold text-slate-700">{patient?.name ?? "Nenhum"}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-slate-500">Prontuário Clinisys</p>
                                    <p className="mt-1 font-semibold text-slate-700">{patient?.record ?? "—"}</p>
                                </div>
                            </div>
                        </Card>

                        <Card>
                            <h2 className="text-lg font-bold text-slate-900">2. Modelo e identificação</h2>
                            <div className="mt-5 grid gap-4 sm:grid-cols-2">
                                <div className="sm:col-span-2">
                                    <label className={labelClass}>Modelo de orçamento</label>
                                    <DropdownSelect
                                        value={model}
                                        onChange={setModel}
                                        options={[...budgetModels]} disabled={!!busy}
                                        widthClassName="w-full"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="orcamentos-unidade" className={labelClass}>Unidade</label>
                                    <DropdownSelect value={unit} onChange={setUnit} options={budgetUnits.filter((option) => !lockedUnit || option.value === lockedUnit)} placeholder="Selecionar unidade" disabled={!!busy || lockedUnit !== null} widthClassName="w-full" />
                                </div>
                                <div>
                                    <label className={labelClass}>Código externo do orçamento</label>
                                    <input className={fieldClass + " bg-slate-50 text-slate-500"} readOnly value={code || "—"} aria-label="Código externo do orçamento" />
                                </div>
                                <div>
                                    <label htmlFor="orcamentos-data" className={labelClass}>Data de emissão</label>
                                    <input id="orcamentos-data" type="date" disabled={!!busy} className={fieldClass} value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
                                </div>
                                <div>
                                    <label htmlFor="orcamentos-validade" className={labelClass}>Validade</label>
                                    <input id="orcamentos-validade" type="date" min={issueDate} disabled={!!busy} className={fieldClass} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
                                </div>
                                <div className="sm:col-span-2">
                                    <label htmlFor="orcamentos-responsavel" className={labelClass}>Responsável pela emissão</label>
                                    <input id="orcamentos-responsavel" className={fieldClass} placeholder="Nome do colaborador" disabled={!!busy} value={responsible} onChange={(event) => setResponsible(event.target.value)} />
                                </div>
                            </div>
                        </Card>

                        <Card>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">3. Procedimentos e valores</h2>
                                </div>
                                <button
                                    type="button"
                                    disabled={!!busy || procedures.length >= 100}
                                    onClick={() => {
                                        const id = nextProcedureId.current++;
                                        setProcedures((current) => [...current, emptyProcedure(id)]);
                                    }}
                                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                >
                                    <Plus size={16} /> Adicionar procedimento
                                </button>
                            </div>
                            <div className="mt-5 space-y-3">
                                {procedures.map((procedure, index) => (
                                    <div key={procedure.id} className="rounded-xl border border-border bg-slate-50/60 p-4">
                                        <div className="mb-3 flex items-center justify-between gap-2">
                                            <h3 className="text-sm font-semibold text-slate-700">Procedimento {index + 1}</h3>
                                            <button type="button" title="Remover procedimento" aria-label="Remover procedimento" disabled={!!busy || procedures.length === 1} onClick={() => setProcedures((current) => current.filter((item) => item.id !== procedure.id))} className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-soft hover:text-red disabled:cursor-not-allowed disabled:opacity-30">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_80px_120px_120px]">
                                            <div className="col-span-2 sm:col-span-1">
                                                <label htmlFor={"orcamentos-procedimento-" + procedure.id} className={labelClass}>Descrição / tratamento</label>
                                                <input id={"orcamentos-procedimento-" + procedure.id} className={fieldClass} placeholder="Descrição do procedimento" disabled={!!busy} value={procedure.description} onChange={(event) => updateProcedure(procedure.id, "description", event.target.value)} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Qtd.</label>
                                                <input aria-label={"Quantidade procedimento " + (index + 1)} type="number" min="1" step="1" disabled={!!busy} className={fieldClass} value={procedure.quantity} onChange={(event) => updateProcedure(procedure.id, "quantity", event.target.value)} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Valor (R$)</label>
                                                <input aria-label={"Valor procedimento " + (index + 1)} type="number" min="0" step="0.01" disabled={!!busy} className={fieldClass} placeholder="0,00" value={procedure.price} onChange={(event) => updateProcedure(procedure.id, "price", event.target.value)} />
                                            </div>
                                            <div className="col-span-2 sm:col-span-1">
                                                <label className={labelClass}>Desconto (R$)</label>
                                                <input aria-label={"Desconto procedimento " + (index + 1)} type="number" min="0" step="0.01" disabled={!!busy} className={fieldClass} placeholder="0,00" value={procedure.discount} onChange={(event) => updateProcedure(procedure.id, "discount", event.target.value)} />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-5 ml-auto max-w-sm space-y-2 border-t border-border pt-4 text-sm">
                                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{currency.format(totals.gross)}</span></div>
                                <div className="flex justify-between text-slate-500"><span>Descontos</span><span>− {currency.format(totals.discounts)}</span></div>
                                <div className="flex justify-between border-t border-border pt-3 font-bold text-slate-900"><span>Total</span><span className="text-lg">{currency.format(totals.total)}</span></div>
                            </div>
                        </Card>

                        <Card>
                            <h2 className="text-lg font-bold text-slate-900">4. Condições comerciais</h2>
                            <div className="mt-5 grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label htmlFor="orcamentos-pagamento" className={labelClass}>Forma de pagamento</label>
                                    <input id="orcamentos-pagamento" className={fieldClass} placeholder="Ex.: Pix, cartão, boleto" disabled={!!busy} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} />
                                </div>
                                <div>
                                    <label htmlFor="orcamentos-parcelamento" className={labelClass}>Parcelamento</label>
                                    <input id="orcamentos-parcelamento" className={fieldClass} placeholder="Condições de parcelamento" disabled={!!busy} value={installments} onChange={(event) => setInstallments(event.target.value)} />
                                </div>
                                <div className="sm:col-span-2">
                                    <label htmlFor="orcamentos-observacoes" className={labelClass}>Observações</label>
                                    <textarea id="orcamentos-observacoes" rows={4} className="w-full rounded-xl border border-border bg-white px-3.5 py-3 text-sm text-slate-700 outline-none transition focus:border-brand placeholder:text-slate-400" placeholder="Informações adicionais do orçamento" disabled={!!busy} value={notes} onChange={(event) => setNotes(event.target.value)} />
                                </div>
                            </div>
                        </Card>
                    </div>

                    <div className="min-w-0 space-y-6 xl:sticky xl:top-2">
                        <Card>
                            <h2 className="text-lg font-bold text-slate-900">Documento</h2>
                            <div className="mt-4 flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-slate-50 p-5 text-center">
                                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand"><FileText size={24} /></span>
                                <p className="mt-3 text-sm font-semibold text-slate-700">PDF do orçamento</p>
                            </div>
                            <button type="button" onClick={() => submitBudget("pdf")} disabled={!!busy || !patient} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                                {busy === "pdf" ? <LoaderCircle size={16} className="animate-spin" /> : <FileText size={16} />} Gerar PDF
                            </button>
                        </Card>
                        <Card>
                            <h2 className="text-lg font-bold text-slate-900">Integração Clinisys</h2>
                            <button type="button" onClick={() => submitBudget("send")} disabled={!!busy || !patient} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
                                {busy === "send" ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />} {saved ? "Atualizar no Clinisys" : "Salvar e enviar ao Clinisys"}
                            </button>
                            {saved && <p role="status" className={snapshot === saved ? "mt-3 rounded-xl bg-green-soft p-3 text-sm text-green" : "mt-3 rounded-xl bg-orange-soft p-3 text-sm text-orange"}>{snapshot === saved ? "Orçamento salvo no Clinisys." : "Alterações ainda não enviadas."} O reenvio utiliza o mesmo código.</p>}
                            {attempted && !saved && <p className="mt-3 text-xs text-slate-500">Em caso de falha, reenvie com o mesmo código para evitar duplicidade.</p>}
                            {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                            {patient && <button type="button" disabled={!!busy} onClick={() => { if (window.confirm("Iniciar outro orçamento? As alterações não enviadas serão descartadas.")) resetBudget(); }} className="mt-4 w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Novo orçamento</button>}
                        </Card>
                    </div>
                </form>
                <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} ariaLabelledBy="orcamentos-pdf-title">
                    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
                        <div className="flex flex-wrap items-center gap-3 pr-10">
                            <h2 id="orcamentos-pdf-title" className="text-lg font-bold text-slate-900">PDF do orçamento</h2>
                            {pdfUrl && <a href={pdfUrl} download={code + ".pdf"} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Baixar PDF</a>}
                        </div>
                        {pdfUrl && <iframe title="PDF do orçamento" src={pdfUrl} className="min-h-0 flex-1 rounded-xl border border-border" />}
                    </div>
                </Modal>
            </div>
        </main>
    );
}
