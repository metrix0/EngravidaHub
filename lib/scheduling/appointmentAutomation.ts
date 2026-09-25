// lib/scheduling/appointmentAutomation.ts
import {
    createClinisysAppointment,
    deleteClinisysAppointment,
    updateClinisysAppointment,
} from "@/lib/clinisys/client";
import { supabase } from "@/lib/supabase/client";
import type { CalendarAppointment } from "@/types/scheduling";

export type AppointmentIntegrationEvent =
    | "appointment.created"
    | "appointment.updated"
    | "appointment.deleted";

export type AppointmentIntegrationPerson = {
    name: string;
    cpf: string | null;
    birthDate: string | null;
    phone: string | null;
    email: string | null;
};

export type AppointmentIntegrationAddress = {
    street: string | null;
    number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    cep: string | null;
    country: string | null;
};

export type AppointmentIntegrationPayload = {
    event: AppointmentIntegrationEvent;
    appointment: {
        id: string;
        source: string;
        sourceExternalId: string | null;
        unitId: string;
        doctorId: string;
        startsAt: string;
        endsAt: string;
        status: string;
        format: string;
        procedureName: string;
        unitName: string | null;
        doctorName: string | null;
        patient: AppointmentIntegrationPerson;
        spouse: AppointmentIntegrationPerson | null;
        address: AppointmentIntegrationAddress;
        notes: string | null;
    };
};

export function buildAppointmentIntegrationPayload(
    event: AppointmentIntegrationEvent,
    appointment: CalendarAppointment,
): AppointmentIntegrationPayload {
    return {
        event,
        appointment: {
            id: appointment.id,
            source: appointment.source,
            sourceExternalId: appointment.source_external_id,
            unitId: appointment.unit_id,
            doctorId: appointment.doctor_id,
            startsAt: appointment.starts_at,
            endsAt: appointment.ends_at,
            status: appointment.status,
            format: appointment.format,
            procedureName: appointment.procedure_name,
            unitName: appointment.unit?.name ?? null,
            doctorName: appointment.doctor?.name ?? null,
            patient: {
                name: appointment.patient_name,
                cpf: appointment.patient_cpf,
                birthDate: appointment.patient_birth_date,
                phone: appointment.patient_phone,
                email: appointment.patient_email,
            },
            spouse: appointment.spouse_name
                ? {
                      name: appointment.spouse_name,
                      cpf: appointment.spouse_cpf,
                      birthDate: appointment.spouse_birth_date,
                      phone: appointment.spouse_phone,
                      email: appointment.spouse_email,
                  }
                : null,
            address: {
                street: appointment.address?.street || null,
                number: appointment.address?.number || null,
                complement: appointment.address?.complement || null,
                neighborhood: appointment.address?.neighborhood || null,
                city: appointment.address?.city || null,
                state: appointment.address?.state || null,
                cep: appointment.address?.cep || null,
                country: appointment.address?.country || null,
            },
            notes: appointment.notes,
        },
    };
}

export function isInitialConsultation(procedureName: string | null | undefined) {
    const normalized = normalize(procedureName ?? "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    return (
        normalized === "consulta inicial" ||
        normalized === "1 avaliacao de reproducao humana presencial"
    );
}

export async function sendAppointmentIntegration(
    payload: AppointmentIntegrationPayload,
): Promise<{
    ok: boolean;
    status?: number;
    error?: string;
    externalId?: string;
}> {
    try {
        if (payload.event === "appointment.deleted") {
            const externalId = payload.appointment.sourceExternalId;
            if (!externalId) return { ok: true, status: 200 };
            await deleteClinisysAppointment(externalId);
            return { ok: true, status: 200, externalId };
        }

        if (!payload.appointment.sourceExternalId) {
            const created = await createClinisysAppointment(payload.appointment);
            const { error } = await supabase
                .from("appointments")
                .update({
                    source: "clinisys",
                    source_external_id: created.externalId,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", payload.appointment.id);
            if (error) throw error;
            return { ok: true, status: 200, externalId: created.externalId };
        }

        if (payload.event === "appointment.updated") {
            await updateClinisysAppointment(payload.appointment);
        }

        return {
            ok: true,
            status: 200,
            externalId: payload.appointment.sourceExternalId,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Falha na integração com o CliniSYS.";
        console.warn("[appointment-integration] CliniSYS request failed", {
            event: payload.event,
            appointmentId: payload.appointment.id,
            error: message,
        });
        return { ok: false, error: message };
    }
}

export async function moveClientToFivFirstStage({
    clientId,
    enabled,
    procedureName,
    movedByAttendantId,
}: {
    clientId: string | null;
    enabled: boolean;
    procedureName: string;
    movedByAttendantId?: string | null;
}): Promise<{
    applied: boolean;
    unchanged?: boolean;
    reason?: string;
    funnelId?: string;
    stageId?: string;
}> {
    if (!enabled) return { applied: false, reason: "disabled" };
    if (!clientId) return { applied: false, reason: "missing_client" };
    if (!isInitialConsultation(procedureName)) {
        return { applied: false, reason: "procedure_not_eligible" };
    }

    const { data: funnel, error: funnelError } = await supabase
        .from("funnels")
        .select("id, name")
        .ilike("name", "%fiv%")
        .limit(1)
        .maybeSingle();

    if (funnelError) throw funnelError;
    if (!funnel) throw new Error("O Funil FIV não foi encontrado.");

    const { data: firstStage, error: stageError } = await supabase
        .from("funnel_stages")
        .select("id, funnel_id, name, position")
        .eq("funnel_id", funnel.id)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (stageError) throw stageError;
    if (!firstStage) {
        throw new Error("A primeira etapa do Funil FIV não foi encontrada.");
    }

    const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id, funnel_stage_id")
        .eq("id", clientId)
        .maybeSingle();

    if (clientError) throw clientError;
    if (!client) throw new Error("Cliente não encontrado para automação do funil.");

    const previousStageId = client.funnel_stage_id ?? null;
    if (previousStageId === firstStage.id) {
        return {
            applied: true,
            unchanged: true,
            funnelId: funnel.id,
            stageId: firstStage.id,
        };
    }

    const { error: updateError } = await supabase
        .from("clients")
        .update({
            funnel_stage_id: firstStage.id,
            updated_at: new Date().toISOString(),
        })
        .eq("id", clientId);

    if (updateError) throw updateError;

    const { error: historyError } = await supabase.from("funnel_history").insert({
        client_id: clientId,
        funnel_id: funnel.id,
        from_stage_id: previousStageId,
        to_stage_id: firstStage.id,
        moved_by_attendant_id: movedByAttendantId ?? null,
    });

    if (historyError) {
        console.warn(
            "[appointment-automation] client moved but funnel history failed",
            {
                clientId,
                funnelId: funnel.id,
                stageId: firstStage.id,
                error: historyError.message,
            },
        );
    }

    return {
        applied: true,
        funnelId: funnel.id,
        stageId: firstStage.id,
    };
}

function normalize(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ");
}
