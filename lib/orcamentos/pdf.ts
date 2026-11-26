import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { budgetModels, budgetTotals, budgetUnits, brazilianDate, currency, validityDays, type Budget, type BudgetPatient } from "./budget";

export async function generateBudgetPdf(budget: Budget, patient: BudgetPatient) {
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const supported = new Set(regular.getCharacterSet());
    const clean = (value: string) => Array.from(value.replace(/[\t\r]/g, " ")).map((c) =>
        c === "\n" || supported.has(c.codePointAt(0)!) ? c : "?").join("");
    let page = doc.addPage([595.28, 841.89]);
    let y = 0;
    const margin = 48;
    const width = page.getWidth() - margin * 2;
    const ink = rgb(0.11, 0.16, 0.24);
    const brand = rgb(0.82, 0.19, 0.22);
    function header() {
        y = page.getHeight() - margin;
        page.drawText("ENGRAVIDA", { x: margin, y, size: 18, font: bold, color: brand });
        y -= 30;
        page.drawText("Orçamento", { x: margin, y, size: 21, font: bold, color: ink });
        y -= 18;
        page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, color: brand, thickness: 1 });
        y -= 22;
    }
    function ensure(height: number) {
        if (y - height < margin) {
            page = doc.addPage([595.28, 841.89]);
            header();
        }
    }
    function line(value: string, size = 11, emphasis = false) {
        const font = emphasis ? bold : regular;
        for (const paragraph of clean(value).split("\n")) {
            let current = "";
            for (const character of paragraph) {
                if (font.widthOfTextAtSize(current + character, size) > width && current) {
                    ensure(size + 5);
                    page.drawText(current.trimEnd(), { x: margin, y, size, font, color: ink });
                    y -= size + 5;
                    current = character.trimStart();
                } else current += character;
            }
            ensure(size + 5);
            page.drawText(current, { x: margin, y, size, font, color: ink });
            y -= size + 5;
        }
    }
    function section(title: string) {
        ensure(40);
        y -= 12;
        line(title, 13, true);
        y -= 5;
    }
    header();
    line(budgetModels[0].label, 14, true);
    line("Código: " + budget.code);
    line("Paciente: " + patient.name);
    line("Prontuário: " + patient.record);
    line("Unidade: " + budgetUnits.find((u) => u.value === budget.unit)!.label);
    line("Emissão: " + brazilianDate(budget.issueDate));
    if (budget.validUntil) line("Validade: " + brazilianDate(budget.validUntil));
    if (budget.responsible) line("Responsável: " + budget.responsible);
    section("Procedimentos e valores");
    for (const item of budget.procedures) {
        const total = budgetTotals([item]);
        line(item.description, 11, true);
        line("Qtd.: " + item.quantity + " | Valor unitário: " + currency.format(item.price) +
            " | Desconto: " + currency.format(item.discount));
        line("Total: " + currency.format(total.total));
        y -= 5;
    }
    const totals = budgetTotals(budget.procedures);
    section("Resumo");
    line("Subtotal: " + currency.format(totals.gross));
    line("Descontos: " + currency.format(totals.discounts));
    line("Total: " + currency.format(totals.total), 15, true);
    if (budget.paymentMethod || budget.installments || budget.notes) {
        section("Condições comerciais");
        if (budget.paymentMethod) line("Pagamento: " + budget.paymentMethod);
        if (budget.installments) line("Parcelamento: " + budget.installments);
        if (budget.notes) line("Observações: " + budget.notes);
    }
    const pages = doc.getPages();
    pages.forEach((p, index) => p.drawText(`${index + 1}/${pages.length}`, {
        x: p.getWidth() - margin - 25, y: 26, size: 9, font: regular, color: ink,
    }));
    return doc.save();
}

export function buildClinisysBudgetPayload(budget: Budget, patient: BudgetPatient, pdf: Uint8Array) {
    const totals = budgetTotals(budget.procedures);
    const conditions = [
        budget.paymentMethod && "Pagamento: " + budget.paymentMethod,
        budget.installments && "Parcelamento: " + budget.installments,
        budget.responsible && "Responsável: " + budget.responsible,
        budget.notes,
    ].filter(Boolean).join("\n");
    return {
        codigo: budget.code,
        prontuario: Number(patient.record),
        unidade: Number(budget.unit),
        data_emissao: brazilianDate(budget.issueDate),
        titulo: budgetModels[0].label,
        ...(budget.validUntil ? { validade_dias: validityDays(budget.issueDate, budget.validUntil) } : {}),
        valor_total: totals.total,
        itens: budget.procedures.map((item) => ({
            descricao: item.description,
            quantidade: item.quantity,
            valor: item.price,
            ...(item.discount ? { observacao: "Desconto: " + currency.format(item.discount) + "; total líquido: " + currency.format(budgetTotals([item]).total) } : {}),
        })),
        ...(conditions ? { condicoes: conditions } : {}),
        pdf: { nome: budget.code + ".pdf", conteudo: Buffer.from(pdf).toString("base64") },
    };
}
