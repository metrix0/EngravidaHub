import { NextResponse } from "next/server";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { clinisysBudgetRequest } from "@/lib/clinisys/client";
import { budgetSchema, budgetUnitForLock, patientFilters, type BudgetPatient } from "@/lib/orcamentos/budget";
import { buildClinisysBudgetPayload, generateBudgetPdf } from "@/lib/orcamentos/pdf";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
type PatientResponse = { pacientes?: Array<{ prontuario?: string | number; paciente_nome?: string; unidade_id?: string | number; unidade_nome?: string }> };

async function patients(filter: string, term: string): Promise<BudgetPatient[]> {
    const params = new URLSearchParams({ [filter]: term });
    const response = await clinisysBudgetRequest<PatientResponse>("GET", "/Pacientes/Cadastros?" + params);
    return (response.pacientes ?? []).flatMap((patient) => {
        const record = String(patient.prontuario ?? "").trim();
        const name = String(patient.paciente_nome ?? "").trim();
        return record && name ? [{
            record, name, unit: String(Number(patient.unidade_id) || ""),
            unitName: String(patient.unidade_nome ?? ""),
        }] : [];
    });
}

async function search(input: { filter?: unknown; q?: unknown }, lockedUnit: string | null) {
    if (lockedUnit === "") return json({ error: "Unidade não vinculada ao Clinisys." }, 403);
    const filter = typeof input.filter === "string" ? input.filter : "nome";
    let term = typeof input.q === "string" ? input.q.trim() : "";
    if (["cpf", "rg", "celular", "prontuario"].includes(filter)) term = term.replace(/\D/g, "");
    if (!patientFilters.some((entry) => entry.value === filter) || term.length < 3 || term.length > 200) {
        return json({ error: "Informe um filtro e pelo menos três caracteres." }, 400);
    }
    try {
        const results = await patients(filter, term);
        return json({ patients: results.filter((patient) => !lockedUnit || patient.unit === lockedUnit) });
    } catch {
        return json({ error: "Não foi possível consultar pacientes no Clinisys. Verifique a integração e tente novamente." }, 502);
    }
}

export async function POST(request: Request) {
    const access = await getServerTabAccess("orcamentos");
    if (access.ok === false) return json({ error: "Acesso não autorizado." }, access.status);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Formato inválido." }, 415);
    const input = await request.json().catch(() => null);
    if (input?.action === "search") return search(input, budgetUnitForLock(access.permission.unit_lock));
    if (!input || !["pdf", "send"].includes(input.action)) return json({ error: "Ação inválida." }, 400);
    const parsed = budgetSchema.safeParse(input.budget);
    if (!parsed.success) return json({ error: "Confira os campos, procedimentos, descontos e datas do orçamento." }, 400);
    const budget = parsed.data;
    const lockedUnit = budgetUnitForLock(access.permission.unit_lock);
    if (lockedUnit !== null && budget.unit !== lockedUnit) return json({ error: "Unidade não autorizada." }, 403);
    try {
        const matches = await patients("prontuario", budget.record);
        const patient = matches.find((row) => row.record.replace(/^0+/, "") === budget.record.replace(/^0+/, ""));
        if (!patient || (lockedUnit && patient.unit !== lockedUnit)) return json({ error: "Paciente não encontrado ou fora da unidade autorizada." }, 404);
        const pdf = await generateBudgetPdf(budget, patient);
        const filename = budget.code + ".pdf";
        if (input.action === "pdf") {
            return new NextResponse(new Uint8Array(pdf), { headers: {
                ...headers, "Content-Type": "application/pdf",
                "Content-Disposition": 'attachment; filename="' + filename + '"',
            } });
        }
        await clinisysBudgetRequest("POST", "/Pacientes/Orcamentos", buildClinisysBudgetPayload(budget, patient, pdf));
        return json({ code: budget.code });
    } catch {
        return json({ error: "Não foi possível concluir a operação no Clinisys. Em caso de falha no envio, tente novamente com o mesmo código." }, 502);
    }
}
