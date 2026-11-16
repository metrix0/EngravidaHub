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

// The first matching description rule owns the invoice amount.
export const INVOICE_TUNNEL_RULES = [
    {
        tunnel: "Congelamento",
        summary: "Congelamento, criopreservação, vitrificação, armazenamento, anuidades, manutenção e descongelamento avulso de óvulos, embriões ou sêmen.",
        pattern: /\b(?:congelamento|criopreservacao|vitrificacao)\b|\b(?:armazenamento|anuidade|manutencao) (?:d[eo] )?(?:ovulos|embrioes|semen)\b|^(?:(?:me|parte \d+) )*descongelamento (?:de )?(?:ovulos|embrioes|semen)\b/,
    },
    {
        tunnel: "Laqueadura",
        summary: "Laqueadura, reversão de ligadura tubária e recanalização tubária.",
        pattern: /\b(?:laqueadura|reversao (?:de|da) ligadura(?: tubaria)?|recanalizacao (?:tubaria|de trompas))\b/,
    },
    {
        tunnel: "LGBT",
        summary: "LGBT, método ROPA, gestação compartilhada e menção a casal homoafetivo.",
        pattern: /\b(?:lgbt\w*|ropa|gestacao compartilhada|homoafetiv\w*)\b/,
    },
    {
        tunnel: "Problemas e Tratamentos",
        summary: "Infertilidade, FIV, ICSI, inseminação, doação, recepção e banco de gametas, transferência embrionária, biópsias e PGT, coleta cirúrgica de espermatozoides, relação sexual programada e procedimentos de reprodução assistida, como Zymot e EmbryoGlue.",
        pattern: /\b(?:infertil\w*|dificuldade (?:de|para) engravidar|fertilizacao in vitro|fiv|icsi|iiu|inseminacao|ovodoacao|ovorecepcao|(?:doacao|recepcao|banco) de (?:ovulos?|embrioes|semen|esperma|gametas)|reproducao assistida|transferencia (?:de )?embrio(?:es|naria)|ted|tod|biopsia (?:de )?(?:embriao|embrioes|embrionaria|endometrio)|pgt[amrs]?|pesa|mesa(?= extracao)|tesa|tese|zymot|embr[yi]o ?glue|relacao sexual programada|tratamento(?:s| para (?:engravidar|fertilidade)| de (?:infertilidade|reproducao humana))?)\b/,
    },
    {
        tunnel: "Bio Instagram",
        summary: "Menção explícita a Bio Instagram ou bio do Instagram na descrição.",
        pattern: /\bbio(?: do)? instagram\b/,
    },
    {
        tunnel: "Site - Home | Engravida",
        summary: "Menção explícita a Site – Home | Engravida na descrição.",
        pattern: /\bsite home engravida\b/,
    },
] as const;

export function classifyInvoiceTunnel(description: string | null | undefined) {
    const normalized = normalizeText(description).replace(/[^a-z0-9]+/g, " ").trim();
    return INVOICE_TUNNEL_RULES.find(({ pattern }) => pattern.test(normalized))?.tunnel ?? null;
}

function normalizeText(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .trim();
}
