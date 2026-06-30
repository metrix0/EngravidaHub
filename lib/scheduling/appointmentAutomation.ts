// lib/scheduling/appointmentAutomation.ts
import { supabase } from "@/lib/supabase/client";
import type { CalendarAppointment } from "@/types/scheduling";

const DEFAULT_INTEGRATION_URL =
    "https://example.com/api/engravida/appointments";

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
    return normalize(procedureName ?? "") === "consulta inicial";
}

export async function sendAppointmentIntegration(
    payload: AppointmentIntegrationPayload,
): Promise<{ ok: boolean; status?: number; error?: string }> {
    const url =
        process.env.SCHEDULING_INTEGRATION_URL?.trim() ||
        DEFAULT_INTEGRATION_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Engravida-Event": payload.event,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
            cache: "no-store",
        });

        if (!response.ok) {
            const error = `Integration returned HTTP ${response.status}`;
            console.warn("[appointment-integration] request failed", {
                event: payload.event,
                appointmentId: payload.appointment.id,
                status: response.status,
            });
            return { ok: false, status: response.status, error };
        }

        return { ok: true, status: response.status };
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown integration error";
        console.warn("[appointment-integration] request failed", {
            event: payload.event,
            appointmentId: payload.appointment.id,
            error: message,
        });
        return { ok: false, error: message };
    } finally {
        clearTimeout(timeout);
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
