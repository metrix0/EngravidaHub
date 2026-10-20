import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { requireActiveMessageAccess } from "@/lib/active-messages/access";
import { ActiveMessageBatchError, sendActiveMessageBatch } from "@/lib/active-messages/sendActiveMessageBatch";
import type { ActiveMessageTemplate } from "@/lib/active-messages/templates";
import { supabase } from "@/lib/supabase/client";
import {
    isRecoveryVacancyFilled,
    loadRecoveryCandidates,
    loadRecoveryVacancies,
    loadRecoveryVacancy,
} from "@/lib/scheduling/slotRecoveryServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Must be approved on the active-message WhatsApp router before template sends work.
const RECOVERY_TEMPLATE: ActiveMessageTemplate = {
    id: "antecipacao_agendamento",
    name: "Antecipação de agendamento",
    category: "utility",
    preview: "Olá, {{1}}! Surgiu um horário de atendimento na Engravida de {{2}}, em {{3}} às {{4}}. Você gostaria de antecipar seu agendamento? Responda por aqui para conversarmos.",
    blip_template_name: "antecipacao_agendamento",
    active_campaign: { flow_id: "", state_id: "", masterstate: "fluxocampanhaativa@msging.net" },
    parameters: [
        { key: "1", source: { type: "database", field: "client_first_name" } },
        { key: "2", source: { type: "dynamic", field_id: "unit", label: "Unidade" } },
        { key: "3", source: { type: "dynamic", field_id: "date", label: "Data" } },
        { key: "4", source: { type: "dynamic", field_id: "time", label: "Horário" } },
    ],
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const postSchema = z.object({
    vacancy_id: z.number().int().positive(),
    client_id: z.uuid(),
});

export async function GET(request: Request) {
    const access = await getServerTabAccess("agendamentos");
    if (access.ok === false) {
        return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const params = new URL(request.url).searchParams;
    const unitIds = access.permission.unit_lock
        ? [access.permission.unit_lock.id] : params.getAll("unit_ids");
    try {
        const id = params.get("vacancy_id");
        if (id !== null) {
            const parsedId = Number(id);
            if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
                return NextResponse.json({ error: "Vaga inválida." }, { status: 400 });
            }
            const vacancy = await loadRecoveryVacancy(parsedId);
            if (!vacancy || (access.permission.unit_lock && vacancy.unitId !== access.permission.unit_lock.id)) {
                return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 });
            }
            const filled = await isRecoveryVacancyFilled(vacancy);
            const candidates = await loadRecoveryCandidates(vacancy);
            const visibleCandidates = filled ? candidates.filter(candidate => candidate.status !== "available") : candidates;
            return NextResponse.json({ vacancy, filled: Boolean(filled), candidates: visibleCandidates }, {
                headers: { "Cache-Control": "private, no-store" },
            });
        }
        const start = params.get("start"), end = params.get("end");
        if (!start || !end || !datePattern.test(start) || !datePattern.test(end) ||
            start >= end || Date.parse(end) - Date.parse(start) > 62 * 86_400_000 ||
            unitIds.some(id => !z.uuid().safeParse(id).success)) {
            return NextResponse.json({ error: "Filtros inválidos." }, { status: 400 });
        }
        const vacancies = await loadRecoveryVacancies({ start, end, unitIds });
        return NextResponse.json({ vacancies }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        console.error("[slot-recovery] GET failed", error);
        return NextResponse.json({ error: "Não foi possível carregar a recuperação de vagas." }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const [access, activeAccess] = await Promise.all([
        getServerTabAccess("agendamentos"),
        requireActiveMessageAccess(),
    ]);
    if (access.ok === false) return NextResponse.json({ error: access.error }, { status: access.status });
    if (activeAccess.ok === false) return NextResponse.json({ error: activeAccess.error }, { status: activeAccess.status });

    let body: z.infer<typeof postSchema>;
    try {
        body = postSchema.parse(await request.json());
    } catch {
        return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    let claimedId: string | null = null;
    try {
        const vacancy = await loadRecoveryVacancy(body.vacancy_id);
        if (!vacancy || (access.permission.unit_lock && vacancy.unitId !== access.permission.unit_lock.id)) {
            return NextResponse.json({ error: "Vaga não encontrada ou não disponível." }, { status: 404 });
        }
        if (await isRecoveryVacancyFilled(vacancy)) {
            return NextResponse.json({ error: "Este horário já foi preenchido." }, { status: 409 });
        }
        const candidates = await loadRecoveryCandidates(vacancy);
        const candidate = candidates.find(item => item.clientId === body.client_id);
        if (!candidate || !candidate.canContact) {
            return NextResponse.json({ error: "Cliente indisponível para contato ou contatado recentemente." }, { status: 409 });
        }
        const { data: inserted, error: insertError } = await supabase
            .from("appointment_recovery_contacts")
            .insert({ vacancy_history_id: vacancy.id, client_id: body.client_id, status: "pending" })
            .select("id").single();
        if (insertError?.code === "23505") {
            const { data: retried, error: retryError } = await supabase
                .from("appointment_recovery_contacts")
                .update({ status: "pending", error: null, updated_at: new Date().toISOString() })
                .eq("vacancy_history_id", vacancy.id).eq("client_id", body.client_id)
                .eq("status", "failed")
                .select("id").maybeSingle();
            if (retryError) throw retryError;
            if (!retried) return NextResponse.json({ error: "Contato já iniciado para este cliente." }, { status: 409 });
            claimedId = retried.id;
        } else {
            if (insertError) throw insertError;
            claimedId = inserted.id;
        }
        // Recheck immediately before contacting; another attendant may have booked meanwhile.
        if (await isRecoveryVacancyFilled(vacancy)) {
            await supabase.from("appointment_recovery_contacts")
                .update({ status: "failed", error: "Horário preenchido antes do envio" }).eq("id", claimedId);
            return NextResponse.json({ error: "Este horário já foi preenchido." }, { status: 409 });
        }
        const { data: unit, error: unitError } = await supabase.from("units")
            .select("name").eq("id", vacancy.unitId).single();
        if (unitError) throw unitError;
        const date = new Intl.DateTimeFormat("pt-BR", {
            timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
        }).format(new Date(vacancy.startsAt));
        const time = new Intl.DateTimeFormat("pt-BR", {
            timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
        }).format(new Date(vacancy.startsAt));
        const result = await sendActiveMessageBatch({
            template: RECOVERY_TEMPLATE,
            clientIds: [body.client_id],
            filters: { source: "slot_recovery", vacancy_history_id: vacancy.id },
            dynamicValues: { unit: unit.name, date, time },
            actor: { id: activeAccess.actor.id, name: activeAccess.actor.name },
        });
        const recipient = result.results.find(item => item.client_id === body.client_id);
        if (!recipient || recipient.status !== "sent") {
            const error = recipient?.error ?? "Não foi possível enviar a mensagem.";
            await supabase.from("appointment_recovery_contacts").update({
                status: "failed", batch_id: result.batch_id, error, updated_at: new Date().toISOString(),
            }).eq("id", claimedId);
            return NextResponse.json({ error }, { status: 502 });
        }
        const { error: updateError } = await supabase.from("appointment_recovery_contacts").update({
            status: "contacted", contacted_at: new Date().toISOString(),
            batch_id: result.batch_id, error: null, updated_at: new Date().toISOString(),
        }).eq("id", claimedId);
        if (updateError) throw updateError;
        return NextResponse.json({ ok: true, status: "contacted", mode: recipient.mode });
    } catch (error) {
        console.error("[slot-recovery] send failed", error);
        if (claimedId) {
            await supabase.from("appointment_recovery_contacts").update({
                status: "failed",
                error: error instanceof Error ? error.message : "Erro no envio",
                updated_at: new Date().toISOString(),
                ...(error instanceof ActiveMessageBatchError ? { batch_id: error.batchId } : {}),
            }).eq("id", claimedId);
        }
        return NextResponse.json({ error: error instanceof Error ? error.message : "Falha no envio." }, { status: 500 });
    }
}
