// lib/invoices/categories.ts
export const FINANCIAL_CATEGORIES = [
    { value: "ivf", label: "Fertilização in vitro" },
    { value: "freezing", label: "Congelamento" },
    { value: "storage", label: "Armazenamento e anuidades" },
    { value: "genetics", label: "Genética e biópsias" },
    { value: "embryo_transfer", label: "Transferências embrionárias" },
    { value: "evaluation", label: "Avaliações" },
    { value: "exams", label: "Exames" },
    { value: "bank_donation", label: "Banco e doação" },
    { value: "other", label: "Outros" },
] as const;

export type FinancialCategory = (typeof FINANCIAL_CATEGORIES)[number]["value"];

const CATEGORY_LABELS = new Map<string, string>(
    FINANCIAL_CATEGORIES.map((category) => [category.value, category.label]),
);

export function getFinancialCategoryLabel(value: string) {
    return CATEGORY_LABELS.get(value) ?? "Outros";
}

export function classifyInvoiceDescription(
    description: string | null | undefined,
): FinancialCategory {
    const normalized = normalizeText(description);

    if (/anuidade|armazenamento|manutencao/.test(normalized)) {
        return "storage";
    }
    if (/biopsia|\bpgt|\bngs\b/.test(normalized)) {
        return "genetics";
    }
    if (/transferencia.*embriao|\bted\b/.test(normalized)) {
        return "embryo_transfer";
    }
    if (/fertilizacao|\bfiv\b|recepcao.*ovul/.test(normalized)) {
        return "ivf";
    }
    if (/congelamento|criopreserv|vitrificacao/.test(normalized)) {
        return "freezing";
    }
    if (/avaliacao/.test(normalized)) {
        return "evaluation";
    }
    if (/espermograma|exame|ultrassom|laborator/.test(normalized)) {
        return "exams";
    }
    if (/banco|doacao|doador|doadora/.test(normalized)) {
        return "bank_donation";
    }

    return "other";
}

function normalizeText(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .trim();
}
