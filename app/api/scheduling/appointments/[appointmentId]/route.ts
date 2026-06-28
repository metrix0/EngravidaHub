// app/api/scheduling/appointments/[appointmentId]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import {
    fetchAppointmentById,
    validateDoctorForUnit,
} from "@/lib/scheduling/appointmentServer";

const updateSchema = z
    .object({
        startsAt: z.string().datetime({ offset: true }).optional(),
        endsAt: z.string().datetime({ offset: true }).optional(),
        unitId: z.string().uuid().optional(),
        doctorId: z.string().uuid().optional(),
        status: z
            .enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"])
            .optional(),
        procedureName: z.string().trim().min(1).max(180).optional(),
        notes: z.string().max(2000).nullable().optional(),
    })
    .strict();

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ appointmentId: string }> },
) {
    try {
        const { appointmentId } = await params;
        const { user } = await getCurrentAttendantFromRequest();

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

        const unitId = parsed.data.unitId ?? current.unit_id;
        const doctorId = parsed.data.doctorId ?? current.doctor_id;
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

        const startsAt = parsed.data.startsAt
            ? new Date(parsed.data.startsAt)
            : new Date(current.starts_at);
        const endsAt = parsed.data.endsAt
            ? new Date(parsed.data.endsAt)
            : new Date(current.ends_at);

        if (endsAt.getTime() <= startsAt.getTime()) {
            return NextResponse.json(
                { ok: false, error: "O término precisa ser posterior ao início." },
                { status: 400 },
            );
        }

        const updates: Record<string, unknown> = {
            unit_id: unitId,
            doctor_id: doctorId,
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
        };

        if (parsed.data.status !== undefined) {
            updates.status = parsed.data.status;
        }
        if (parsed.data.procedureName !== undefined) {
            updates.procedure_name = parsed.data.procedureName;
        }
        if (parsed.data.notes !== undefined) {
            updates.notes = parsed.data.notes || null;
        }

        const { error } = await supabase
            .from("appointments")
            .update(updates)
            .eq("id", appointmentId);

        if (error) throw error;

        if (parsed.data.unitId && current.client_id) {
            const { error: clientUnitError } = await supabase
                .from("clients")
                .update({ unit_id: unitId })
                .eq("id", current.client_id);

            if (clientUnitError) {
                console.warn(
                    "[appointments:patch] appointment updated but client unit was not updated",
                    { client_id: current.client_id, error: clientUnitError.message },
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

        return NextResponse.json({ ok: true, appointment });
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
        const { user } = await getCurrentAttendantFromRequest();

        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const { error } = await supabase
            .from("appointments")
            .delete()
            .eq("id", appointmentId);

        if (error) throw error;

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[appointments:delete] failed", error);
        return errorResponse(error);
    }
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
