"use client";

import { useMemo, useRef, useState } from "react";
import {
    CircleAlert,
    FileText,
    LockKeyhole,
    Plus,
    Search,
    Send,
    Trash2,
} from "lucide-react";

import Card from "@/components/ui/Card";
import { DropdownSelect } from "@/components/ui/DropdownSelect";

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
const currency = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
});

function nonNegative(value: string) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export default function OrcamentosDraft() {
    const [patientSearch, setPatientSearch] = useState("");
    const [model, setModel] = useState("fiv");
    const [unit, setUnit] = useState("");
    const [issueDate, setIssueDate] = useState("");
    const [validUntil, setValidUntil] = useState("");
    const [responsible, setResponsible] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("");
    const [installments, setInstallments] = useState("");
    const [notes, setNotes] = useState("");
    const [procedures, setProcedures] = useState<Procedure[]>([
        emptyProcedure(1),
    ]);
    const nextProcedureId = useRef(2);

    const totals = useMemo(() => {
        const gross = procedures.reduce(
            (sum, procedure) =>
                sum + nonNegative(procedure.quantity) * nonNegative(procedure.price),
            0,
        );
        const discounts = procedures.reduce(
            (sum, procedure) =>
                sum + nonNegative(procedure.discount),
            0,
        );
        return { gross, discounts, total: Math.max(0, gross - discounts) };
    }, [procedures]);

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
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                                Orçamentos
                            </h1>
                            <span className="rounded-md bg-orange-soft px-2.5 py-1 text-xs font-bold text-orange">
                                Em preparação
                            </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">
                            Elaboração de orçamentos e futura integração com o Clinisys.
                        </p>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-xs font-semibold text-slate-500">
                        <LockKeyhole size={15} /> Acesso administrativo
                    </span>
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800" role="status">
                    <CircleAlert size={18} className="mt-0.5 shrink-0" />
                    <div>
                        <p className="font-semibold">Interface de preparação — sem API conectada</p>
                        <p className="mt-1 text-orange-700">
                            Os dados podem ser preenchidos apenas nesta tela. A busca de pacientes, o salvamento,
                            a geração do PDF e o envio ao Clinisys ainda não estão disponíveis.
                        </p>
                    </div>
                </div>

                <form onSubmit={(event) => event.preventDefault()} className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="min-w-0 space-y-6">
                        <Card>
                            <h2 className="text-lg font-bold text-slate-900">1. Paciente</h2>
                            <p className="mt-1 text-sm text-slate-500">
                                Localize e selecione o prontuário correto diretamente no Clinisys.
                            </p>
                            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                                <div className="min-w-0 flex-1">
                                    <label htmlFor="orcamentos-paciente" className={labelClass}>
                                        Nome, CPF, celular, e-mail ou RG
                                    </label>
                                    <div className="relative">
                                        <input
                                            id="orcamentos-paciente"
                                            className={fieldClass + " pr-10"}
                                            placeholder="Buscar paciente..."
                                            value={patientSearch}
                                            onChange={(event) => setPatientSearch(event.target.value)}
                                            autoComplete="off"
                                        />
                                        <Search size={16} className="pointer-events-none absolute right-3.5 top-3.5 text-slate-400" />
                                    </div>
                                </div>
                                <button type="button" disabled className="h-11 shrink-0 rounded-xl bg-brand px-4 text-sm font-bold text-white opacity-50 disabled:cursor-not-allowed">
                                    Buscar no Clinisys
                                </button>
                            </div>
                            <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-border bg-slate-50 p-4 text-sm sm:grid-cols-2">
                                <div>
                                    <p className="text-xs font-medium text-slate-500">Paciente selecionado</p>
                                    <p className="mt-1 font-semibold text-slate-700">Nenhum paciente selecionado</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-slate-500">Prontuário Clinisys</p>
                                    <p className="mt-1 font-semibold text-slate-700">—</p>
                                </div>
                                <p className="text-xs text-slate-500 sm:col-span-2">
                                    O prontuário será preenchido pela consulta de pacientes, sem digitação manual.
                                </p>
                            </div>
                        </Card>

                        <Card>
                            <h2 className="text-lg font-bold text-slate-900">2. Modelo e identificação</h2>
                            <p className="mt-1 text-sm text-slate-500">
                                O modelo FIV é uma referência inicial; outros tratamentos terão modelos próprios.
                            </p>
                            <div className="mt-5 grid gap-4 sm:grid-cols-2">
                                <div className="sm:col-span-2">
                                    <label className={labelClass}>Modelo de orçamento</label>
                                    <DropdownSelect
                                        value={model}
                                        onChange={setModel}
                                        options={[{ value: "fiv", label: "Fertilização In Vitro (FIV) — exemplo" }]}
                                        widthClassName="w-full"
                                    />
                                    <p className="mt-2 text-xs text-slate-500">PDF de referência ainda não vinculado à tela. A estrutura permitirá outros modelos.</p>
                                </div>
                                <div>
                                    <label htmlFor="orcamentos-unidade" className={labelClass}>Unidade</label>
                                    <input id="orcamentos-unidade" className={fieldClass} placeholder="Unidade responsável" value={unit} onChange={(event) => setUnit(event.target.value)} />
                                </div>
                                <div>
                                    <label className={labelClass}>Código externo do orçamento</label>
                                    <input className={fieldClass + " bg-slate-50 text-slate-500"} readOnly value="Gerado ao salvar" aria-label="Código externo do orçamento" />
                                </div>
                                <div>
                                    <label htmlFor="orcamentos-data" className={labelClass}>Data de emissão</label>
                                    <input id="orcamentos-data" type="date" className={fieldClass} value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
                                </div>
                                <div>
                                    <label htmlFor="orcamentos-validade" className={labelClass}>Validade</label>
                                    <input id="orcamentos-validade" type="date" className={fieldClass} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
                                </div>
                                <div className="sm:col-span-2">
                                    <label htmlFor="orcamentos-responsavel" className={labelClass}>Responsável pela emissão</label>
                                    <input id="orcamentos-responsavel" className={fieldClass} placeholder="Nome do colaborador" value={responsible} onChange={(event) => setResponsible(event.target.value)} />
                                </div>
                            </div>
                        </Card>

                        <Card>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">3. Procedimentos e valores</h2>
                                    <p className="mt-1 text-sm text-slate-500">Composição comercial prevista para o registro na Clinisys.</p>
                                </div>
                                <button
                                    type="button"
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
                                            <button type="button" title="Remover procedimento" aria-label="Remover procedimento" disabled={procedures.length === 1} onClick={() => setProcedures((current) => current.filter((item) => item.id !== procedure.id))} className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-soft hover:text-red disabled:cursor-not-allowed disabled:opacity-30">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_80px_120px_120px]">
                                            <div className="col-span-2 sm:col-span-1">
                                                <label htmlFor={"orcamentos-procedimento-" + procedure.id} className={labelClass}>Descrição / tratamento</label>
                                                <input id={"orcamentos-procedimento-" + procedure.id} className={fieldClass} placeholder="Descrição do procedimento" value={procedure.description} onChange={(event) => updateProcedure(procedure.id, "description", event.target.value)} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Qtd.</label>
                                                <input aria-label={"Quantidade procedimento " + (index + 1)} type="number" min="1" step="1" className={fieldClass} value={procedure.quantity} onChange={(event) => updateProcedure(procedure.id, "quantity", event.target.value)} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Valor (R$)</label>
                                                <input aria-label={"Valor procedimento " + (index + 1)} type="number" min="0" step="0.01" className={fieldClass} placeholder="0,00" value={procedure.price} onChange={(event) => updateProcedure(procedure.id, "price", event.target.value)} />
                                            </div>
                                            <div className="col-span-2 sm:col-span-1">
                                                <label className={labelClass}>Desconto (R$)</label>
                                                <input aria-label={"Desconto procedimento " + (index + 1)} type="number" min="0" step="0.01" className={fieldClass} placeholder="0,00" value={procedure.discount} onChange={(event) => updateProcedure(procedure.id, "discount", event.target.value)} />
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
                                    <input id="orcamentos-pagamento" className={fieldClass} placeholder="Ex.: Pix, cartão, boleto" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} />
                                </div>
                                <div>
                                    <label htmlFor="orcamentos-parcelamento" className={labelClass}>Parcelamento</label>
                                    <input id="orcamentos-parcelamento" className={fieldClass} placeholder="Condições de parcelamento" value={installments} onChange={(event) => setInstallments(event.target.value)} />
                                </div>
                                <div className="sm:col-span-2">
                                    <label htmlFor="orcamentos-observacoes" className={labelClass}>Observações</label>
                                    <textarea id="orcamentos-observacoes" rows={4} className="w-full rounded-xl border border-border bg-white px-3.5 py-3 text-sm text-slate-700 outline-none transition focus:border-brand placeholder:text-slate-400" placeholder="Informações adicionais do orçamento" value={notes} onChange={(event) => setNotes(event.target.value)} />
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
                                <p className="mt-1 text-xs leading-5 text-slate-500">A prévia ficará disponível após a conexão do gerador de modelos.</p>
                            </div>
                            <p className="mt-4 text-xs leading-5 text-slate-500">
                                O arquivo final poderá variar conforme o modelo escolhido, sem limitar a integração ao FIV.
                            </p>
                            <button type="button" disabled className="mt-4 inline-flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-slate-500 opacity-60">
                                <FileText size={16} /> Gerar PDF
                            </button>
                        </Card>
                        <Card>
                            <h2 className="text-lg font-bold text-slate-900">Integração Clinisys</h2>
                            <p className="mt-2 text-sm leading-6 text-slate-500">
                                O envio deverá registrar o PDF em Documentos → Orçamentos, manter o Acompanhamento e permitir atualizar pelo mesmo código externo sem duplicação.
                            </p>
                            <div className="mt-4 rounded-lg bg-orange-soft p-3 text-xs font-semibold text-orange">
                                Aguardando disponibilização da API de orçamentos
                            </div>
                            <button type="button" disabled className="mt-4 inline-flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white opacity-50">
                                <Send size={16} /> Salvar e enviar ao Clinisys
                            </button>
                            <p className="mt-3 text-center text-xs text-slate-500">Nenhuma informação é salva ou enviada nesta versão.</p>
                        </Card>
                    </div>
                </form>
            </div>
        </main>
    );
}
