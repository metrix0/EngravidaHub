import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { budgetSchema, budgetTotals, budgetUnitForLock, validityDays } from "../lib/orcamentos/budget";
import { buildClinisysBudgetPayload, generateBudgetPdf } from "../lib/orcamentos/pdf";

const budget = budgetSchema.parse({
    code: "HUB-00000000-0000-4000-8000-000000000001",
    record: "00001", model: "fiv", unit: "6",
    issueDate: "2026-11-26", validUntil: "2026-12-26",
    responsible: "Colaborador QA", paymentMethod: "Pix", installments: "2 vezes", notes: "Condição de teste.",
    procedures: [
        { description: "Fertilização", quantity: 2, price: 100.15, discount: 10.30 },
        { description: "Consulta", quantity: 1, price: 50, discount: 0 },
    ],
});
const patient = { record: "00001", name: "Paciente fictício QA", unit: "6", unitName: "Campinas" };

test("totais monetários, validade, validação e bloqueio de unidade", () => {
    assert.deepEqual(budgetTotals(budget.procedures), { gross: 250.30, discounts: 10.30, total: 240 });
    assert.equal(validityDays(budget.issueDate, budget.validUntil), 30);
    assert.equal(budgetUnitForLock({ name: "São Paulo", city: "São Paulo" }), "4");
    assert.equal(budgetUnitForLock({ name: "Desconhecida", city: "Desconhecida" }), "");
    assert.equal(budgetSchema.safeParse({ ...budget, validUntil: "2026-11-25" }).success, false);
    assert.equal(budgetSchema.safeParse({ ...budget, procedures: [{ ...budget.procedures[0], discount: 201 }] }).success, false);
    assert.equal(budgetSchema.safeParse({ ...budget, procedures: [{ ...budget.procedures[0], quantity: 1.5 }] }).success, false);
    assert.equal(budgetSchema.safeParse({ ...budget, procedures: [{ ...budget.procedures[0], price: 1.001 }] }).success, false);
});

test("PDF válido, paginação, payload e código estável para reenvio", async () => {
    const pdf = await generateBudgetPdf(budget, patient);
    assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-");
    assert.ok((await PDFDocument.load(pdf)).getPageCount() >= 1);
    const payload = buildClinisysBudgetPayload(budget, patient, pdf);
    assert.equal(payload.codigo, budget.code);
    assert.equal(payload.prontuario, 1);
    assert.equal(payload.unidade, 6);
    assert.equal(payload.data_emissao, "26/11/2026");
    assert.equal(payload.validade_dias, 30);
    assert.equal(payload.valor_total, 240);
    assert.equal(payload.itens.length, 2);
    assert.match(payload.itens[0].observacao!, /Desconto/);
    assert.match(payload.condicoes!, /Pix/);
    assert.equal(payload.pdf.nome, budget.code + ".pdf");
    assert.deepEqual(Buffer.from(payload.pdf.conteudo, "base64"), Buffer.from(pdf));
    assert.equal(buildClinisysBudgetPayload({ ...budget, notes: "Revisão" }, patient, pdf).codigo, budget.code);
    const longPdf = await generateBudgetPdf({ ...budget, procedures: Array.from({ length: 50 }, () => budget.procedures[0]) }, patient);
    assert.ok((await PDFDocument.load(longPdf)).getPageCount() > 1);
});
