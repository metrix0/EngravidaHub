// app/api/scheduling/appointments/[appointmentId]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import {
    fetchAppointmentById,
    parseBrazilDate,
    validateDoctorForUnit,
} from "@/lib/scheduling/appointmentServer";
import {
    buildAppointmentIntegrationPayload,
    moveClientToFivFirstStage,
    sendAppointmentIntegration,
} from "@/lib/scheduling/appointmentAutomation";

const personSchema = z.object({
    fullName: z.string().max(180),
    cpf: z.string().max(32),
    birthDate: z.string().max(32),
    email: z.string().max(180),
    phone: z.string().max(40),
});

const addressSchema = z.object({
    street: z.string().trim().max(180),
    number: z.string().trim().max(40),
    complement: z.string().trim().max(120),
    neighborhood: z.string().trim().max(120),
    city: z.string().trim().max(120),
    state: z.string().trim().max(80),
    cep: z.string().trim().max(20),
    country: z.string().trim().max(80),
});

const updateSchema = z
    .object({
        startsAt: z.string().datetime({ offset: true }).optional(),
        endsAt: z.string().datetime({ offset: true }).optional(),
        unitId: z.string().uuid().optional(),
        doctorId: z.string().uuid().optional(),
        status: z
            .enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"])
            .optional(),
        format: z.enum(["congelamento", "casal"]).optional(),
        procedureName: z.string().trim().min(1).max(180).optional(),
        primary: personSchema.optional(),
        spouse: personSchema.optional(),
        address: addressSchema.optional(),
        notes: z.string().max(2000).nullable().optional(),
        addToFivFunnel: z.boolean().optional().default(false),
    })
    .strict();

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ appointmentId: string }> },
) {
    try {
        const { appointmentId } = await params;
        const { user, attendant } = await getCurrentAttendantFromRequest();

        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const parsed = updateSchema.safeParse(await request.json());
        if (!parsed.success) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Invalid appointment update",
                    issues: parsed.error.issues,
                },
                { status: 400 },
            );
        }

        const current = await fetchAppointmentById(supabase, appointmentId);
        if (!current) {
            return NextResponse.json(
                { ok: false, error: "Appointment not found" },
                { status: 404 },
            );
        }

        const body = parsed.data;
        const unitId = body.unitId ?? current.unit_id;
        const doctorId = body.doctorId ?? current.doctor_id;
        const status = body.status ?? current.status;
        const format = body.format ?? current.format;

        const doctorIsValid = await validateDoctorForUnit(
            supabase,
            doctorId,
            unitId,
        );

        if (!doctorIsValid) {
            return NextResponse.json(
                { ok: false, error: "O médico não pertence à unidade selecionada." },
                { status: 400 },
            );
        }

        const startsAt = body.startsAt
            ? new Date(body.startsAt)
            : new Date(current.starts_at);
        const endsAt = body.endsAt
            ? new Date(body.endsAt)
            : new Date(current.ends_at);

        if (startsAt.getUTCMinutes() % 15 !== 0) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Selecione um horário em intervalos de 15 minutos.",
                },
                { status: 400 },
            );
        }

        if (endsAt.getTime() <= startsAt.getTime()) {
            return NextResponse.json(
                { ok: false, error: "O término precisa ser posterior ao início." },
                { status: 400 },
            );
        }

        if (status === "scheduled" || status === "confirmed") {
            const { data: conflicts, error: conflictError } = await supabase
                .from("appointments")
                .select("id")
                .eq("doctor_id", doctorId)
                .in("status", ["scheduled", "confirmed"])
                .neq("id", appointmentId)
                .lt("starts_at", endsAt.toISOString())
                .gt("ends_at", startsAt.toISOString())
                .limit(1);

            if (conflictError) throw conflictError;
            if (conflicts?.length) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: "Este horário já está ocupado para o médico selecionado.",
                    },
                    { status: 409 },
                );
            }
        }

        const updates: Record<string, unknown> = {
            unit_id: unitId,
            doctor_id: doctorId,
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
            status,
            format,
        };

        if (body.procedureName !== undefined) {
            updates.procedure_name = body.procedureName;
        }
        if (body.notes !== undefined) {
            updates.notes = body.notes || null;
        }
        if (body.primary) {
            updates.patient_name = body.primary.fullName;
            updates.patient_phone = body.primary.phone || null;
            updates.patient_email = body.primary.email || null;
            updates.patient_cpf = body.primary.cpf || null;
            updates.patient_birth_date = parseBrazilDate(body.primary.birthDate);
        }
        if (body.spouse || body.format !== undefined) {
            const spouse = body.spouse;
            updates.spouse_name =
                format === "casal" ? spouse?.fullName || current.spouse_name || null : null;
            updates.spouse_phone =
                format === "casal" ? spouse?.phone || null : null;
            updates.spouse_email =
                format === "casal" ? spouse?.email || null : null;
            updates.spouse_cpf =
                format === "casal" ? spouse?.cpf || null : null;
            updates.spouse_birth_date =
                format === "casal" && spouse
                    ? parseBrazilDate(spouse.birthDate)
                    : null;
        }
        if (body.address) {
            updates.address_street = body.address.street || null;
            updates.address_number = body.address.number || null;
            updates.address_complement = body.address.complement || null;
            updates.address_neighborhood = body.address.neighborhood || null;
            updates.address_city = body.address.city || null;
            updates.address_state = body.address.state || null;
            updates.address_cep = onlyDigits(body.address.cep) || null;
            updates.address_country = body.address.country || null;
        }

        const { error } = await supabase
            .from("appointments")
            .update(updates)
            .eq("id", appointmentId);

        if (error) throw error;

        if (current.client_id) {
            const clientUpdates: Record<string, unknown> = { unit_id: unitId };

            if (body.primary) {
                clientUpdates.name = body.primary.fullName || null;
                clientUpdates.phone = body.primary.phone || null;
                clientUpdates.email = body.primary.email || null;
                clientUpdates.cpf = body.primary.cpf || null;
                clientUpdates.birth_date = parseBrazilDate(body.primary.birthDate);
            }

            if (body.address) {
                clientUpdates.street = body.address.street || null;
                clientUpdates.number = body.address.number || null;
                clientUpdates.complement = body.address.complement || null;
                clientUpdates.neighborhood = body.address.neighborhood || null;
                clientUpdates.city = body.address.city || null;
                clientUpdates.state = body.address.state || null;
                clientUpdates.cep = onlyDigits(body.address.cep) || null;
                clientUpdates.country = body.address.country || null;
            }

            const { error: clientUpdateError } = await supabase
                .from("clients")
                .update(clientUpdates)
                .eq("id", current.client_id);

            if (clientUpdateError) {
                console.warn(
                    "[appointments:patch] appointment updated but client data was not updated",
                    {
                        client_id: current.client_id,
                        error: clientUpdateError.message,
                    },
                );
            }
        }

        const appointment = await fetchAppointmentById(
            supabase,
            appointmentId,
        );

        if (!appointment) {
            throw new Error("Appointment was updated but could not be reloaded");
        }

        let fivAutomation: Awaited<ReturnType<typeof moveClientToFivFirstStage>>;
        try {
            fivAutomation = await moveClientToFivFirstStage({
                clientId: appointment.client_id,
                enabled: body.addToFivFunnel,
                procedureName: appointment.procedure_name,
                movedByAttendantId: attendant?.id ?? null,
            });
        } catch (automationError) {
            console.warn("[appointments:patch] FIV automation failed", automationError);
            fivAutomation = {
                applied: false,
                reason:
                    automationError instanceof Error
                        ? automationError.message
                        : "fiv_automation_failed",
            };
        }

        const integration = await sendAppointmentIntegration(
            buildAppointmentIntegrationPayload("appointment.updated", appointment),
        );

        return NextResponse.json({
            ok: true,
            appointment,
            automation: {
                fiv: fivAutomation,
                integration,
            },
        });
    } catch (error) {
        console.error("[appointments:patch] failed", error);
        return errorResponse(error);
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ appointmentId: string }> },
) {
    try {
        const { appointmentId } = await params;
        const { user, attendant } = await getCurrentAttendantFromRequest();

        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const appointment = await fetchAppointmentById(supabase, appointmentId);
        if (!appointment) {
            return NextResponse.json(
                { ok: false, error: "Appointment not found" },
                { status: 404 },
            );
        }

        const { error } = await supabase
            .from("appointments")
            .delete()
            .eq("id", appointmentId);

        if (error) throw error;

        const integration = await sendAppointmentIntegration(
            buildAppointmentIntegrationPayload("appointment.deleted", appointment),
        );

        return NextResponse.json({ ok: true, integration });
    } catch (error) {
        console.error("[appointments:delete] failed", error);
        return errorResponse(error);
    }
}

function onlyDigits(value: string) {
    return value.replace(/\D/g, "");
}

function errorResponse(error: unknown) {
    return NextResponse.json(
        {
            ok: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to update appointment",
        },
        { status: 500 },
    );
}
