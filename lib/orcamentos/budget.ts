import { z } from "zod";

export const budgetUnits = [
    { value: "1", label: "Brasília" },
    { value: "2", label: "Rio de Janeiro" },
    { value: "4", label: "São Paulo" },
    { value: "5", label: "Salvador" },
    { value: "6", label: "Campinas" },
    { value: "7", label: "Manaus" },
    { value: "8", label: "SA" },
    { value: "9", label: "Juiz de Fora" },
    { value: "10", label: "Bauru" },
    { value: "11", label: "Vitória" },
    { value: "12", label: "Belo Horizonte" },
];

export const budgetModels = [{ value: "fiv", label: "Fertilização In Vitro (FIV)" }] as const;
export const patientFilters = [
    { value: "nome", label: "Nome" },
    { value: "cpf", label: "CPF" },
    { value: "celular", label: "Celular" },
    { value: "email", label: "E-mail" },
    { value: "rg", label: "RG" },
    { value: "prontuario", label: "Prontuário" },
];

export type BudgetPatient = { record: string; name: string; unit: string; unitName: string };

const money = z.number().finite().min(0).max(100000000).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001);
export const budgetSchema = z.object({
    code: z.string().regex(/^HUB-[0-9a-f-]{36}$/i),
    record: z.string().regex(/^\d{1,20}$/).refine((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0),
    model: z.literal("fiv"),
    unit: z.string().refine((value) => budgetUnits.some((u) => u.value === value)),
    issueDate: z.iso.date(),
    validUntil: z.union([z.iso.date(), z.literal("")]),
    responsible: z.string().trim().max(150),
    paymentMethod: z.string().trim().max(200),
    installments: z.string().trim().max(200),
    notes: z.string().trim().max(4000),
    procedures: z.array(z.object({
        description: z.string().trim().min(1).max(300),
        quantity: z.number().int().min(1).max(1000),
        price: money,
        discount: money,
    }).refine((item) => cents(item.discount) <= cents(item.price) * item.quantity,
        "O desconto não pode superar o valor do procedimento.")).min(1).max(100),
}).refine((value) => !value.validUntil || value.validUntil >= value.issueDate,
    "A validade não pode ser anterior à emissão.");

export type Budget = z.infer<typeof budgetSchema>;
export const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const cents = (value: number) => Math.round(value * 100);
export function budgetTotals(items: Budget["procedures"]) {
    const gross = items.reduce((sum, item) => sum + cents(item.price) * item.quantity, 0);
    const discounts = items.reduce((sum, item) => sum + cents(item.discount), 0);
    return { gross: gross / 100, discounts: discounts / 100, total: (gross - discounts) / 100 };
}
export function brazilianDate(date: string) {
    return date.split("-").reverse().join("/");
}
export function validityDays(issueDate: string, validUntil: string) {
    return Math.round((Date.parse(validUntil) - Date.parse(issueDate)) / 86400000);
}
export function budgetUnitForLock(lock?: { name: string; city: string } | null) {
    if (!lock) return null;
    const normalize = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    return budgetUnits.find((unit) => [lock.name, lock.city].some((name) => normalize(name) === normalize(unit.label)))?.value ?? "";
}
