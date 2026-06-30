// lib/scheduling/appointmentAutomation.ts
import { supabase } from "@/lib/supabase/client";

const DEFAULT_INTEGRATION_URL =
    "https://example.com/api/engravida/appointments";

export type AppointmentIntegrationEvent =
    | "appointment.created"
    | "appointment.updated";

type IntegrationPayload = {
    event: AppointmentIntegrationEvent;
    appointment: {
        id: string;
        clientId: string | null;
        threadId?: string | null;
        unitId: string;
        doctorId: string;
        startsAt: string;
        endsAt: string;
        status: string;
        format: string;
        procedureName: string;
        patient: {
            name: string;
            phone: string | null;
            email: string | null;
        };
        spouse?: {
            name: string | null;
            phone: string | null;
            email: string | null;
        } | null;
        address: {
            street: string | null;
            number: string | null;
            complement: string | null;
            neighborhood: string | null;
            city: string | null;
            state: string | null;
            cep: string | null;
            country: string | null;
        };
        notes: string | null;
    };
};

export function isInitialConsultation(procedureName: string | null | undefined) {
    return normalize(procedureName ?? "") === "consulta inicial";
}

export async function sendAppointmentIntegration(
    payload: IntegrationPayload,
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
            body: JSON.stringify({
                version: 1,
                sentAt: new Date().toISOString(),
                ...payload,
            }),
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
    if (!funnel) {
        throw new Error("O Funil FIV não foi encontrado.");
    }

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
