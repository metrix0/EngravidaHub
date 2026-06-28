// app/api/scheduling/appointments/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import {
    APPOINTMENT_SELECT,
    fetchAppointmentById,
    mapAppointment,
    parseBrazilDate,
    validateDoctorForUnit,
} from "@/lib/scheduling/appointmentServer";

const personSchema = z.object({
    fullName: z.string().trim().min(1).max(180),
    cpf: z.string().max(32),
    birthDate: z.string().max(32),
    email: z.string().max(180),
    phone: z.string().max(40),
});

const createSchema = z.object({
    threadId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().nullable().optional(),
    unitId: z.string().uuid(),
    doctorId: z.string().uuid(),
    startsAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(15).max(480),
    status: z
        .enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"])
        .default("scheduled"),
    format: z.enum(["congelamento", "casal"]),
    procedureName: z.string().trim().min(1).max(180),
    primary: personSchema,
    spouse: personSchema,
    address: z.string().max(500),
    notes: z.string().max(2000),
});

export async function GET(request: Request) {
    try {
        const { user } = await getCurrentAttendantFromRequest();

        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const { searchParams } = new URL(request.url);
        const start = searchParams.get("start");
        const end = searchParams.get("end");

        if (!start || !end) {
            return NextResponse.json(
                { ok: false, error: "start and end are required" },
                { status: 400 },
            );
        }

        let query = supabase
            .from("appointments")
            .select(APPOINTMENT_SELECT)
            .gte("starts_at", `${start}T00:00:00-03:00`)
            .lt("starts_at", `${end}T00:00:00-03:00`)
            .order("starts_at", { ascending: true });

        const unitIds = searchParams.getAll("unit_ids");
        const doctorIds = searchParams.getAll("doctor_ids");
        const statuses = searchParams.getAll("statuses");
        const formats = searchParams.getAll("formats");
        const search = searchParams.get("search")?.trim();

        if (unitIds.length > 0) query = query.in("unit_id", unitIds);
        if (doctorIds.length > 0) query = query.in("doctor_id", doctorIds);
        if (statuses.length > 0) query = query.in("status", statuses);
        if (formats.length > 0) query = query.in("format", formats);
        if (search) {
            const escaped = search.replace(/[,%()]/g, " ").trim();
            if (escaped) {
                query = query.or(
                    `patient_name.ilike.%${escaped}%,procedure_name.ilike.%${escaped}%`,
                );
            }
        }

        const { data, error } = await query;
        if (error) throw error;

        return NextResponse.json({
            ok: true,
            appointments: (data ?? []).map(mapAppointment),
        });
    } catch (error) {
        console.error("[appointments:get] failed", error);
        return errorResponse(error);
    }
}

export async function POST(request: Request) {
    try {
        const { user, attendant } = await getCurrentAttendantFromRequest();

        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const parsed = createSchema.safeParse(await request.json());

        if (!parsed.success) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Invalid appointment data",
                    issues: parsed.error.issues,
                },
                { status: 400 },
            );
        }

        const body = parsed.data;
        const doctorIsValid = await validateDoctorForUnit(
            supabase,
            body.doctorId,
            body.unitId,
        );

        if (!doctorIsValid) {
            return NextResponse.json(
                { ok: false, error: "O médico não pertence à unidade selecionada." },
                { status: 400 },
            );
        }

        let clientId = body.clientId ?? null;

        if (body.threadId) {
            let threadQuery = supabase
                .from("thread")
                .select("id, client_id")
                .eq("id", body.threadId);

            if (attendant) {
                threadQuery = threadQuery.eq(
                    "assigned_attendant_id",
                    attendant.id,
                );
            }

            const { data: thread, error: threadError } =
                await threadQuery.maybeSingle();

            if (threadError) throw threadError;
            if (!thread) {
                return NextResponse.json(
                    { ok: false, error: "Conversation not found" },
                    { status: 404 },
                );
            }

            clientId = thread.client_id;
        }

        const startsAt = new Date(body.startsAt);
        const endsAt = new Date(
            startsAt.getTime() + body.durationMinutes * 60_000,
        );

        const { data: inserted, error: insertError } = await supabase
            .from("appointments")
            .insert({
                client_id: clientId,
                thread_id: body.threadId ?? null,
                unit_id: body.unitId,
                doctor_id: body.doctorId,
                starts_at: startsAt.toISOString(),
                ends_at: endsAt.toISOString(),
                status: body.status,
                format: body.format,
                procedure_name: body.procedureName,
                patient_name: body.primary.fullName,
                patient_phone: body.primary.phone || null,
                patient_email: body.primary.email || null,
                patient_cpf: body.primary.cpf || null,
                patient_birth_date: parseBrazilDate(body.primary.birthDate),
                spouse_name:
                    body.format === "casal" ? body.spouse.fullName || null : null,
                spouse_phone:
                    body.format === "casal" ? body.spouse.phone || null : null,
                spouse_email:
                    body.format === "casal" ? body.spouse.email || null : null,
                spouse_cpf:
                    body.format === "casal" ? body.spouse.cpf || null : null,
                spouse_birth_date:
                    body.format === "casal"
                        ? parseBrazilDate(body.spouse.birthDate)
                        : null,
                address: body.address || null,
                notes: body.notes || null,
                created_by: user.id,
                created_by_attendant_id: attendant?.id ?? null,
            })
            .select("id")
            .single();

        if (insertError) throw insertError;

        if (clientId) {
            const { error: clientUnitError } = await supabase
                .from("clients")
                .update({ unit_id: body.unitId })
                .eq("id", clientId);

            if (clientUnitError) {
                console.warn(
                    "[appointments:post] appointment created but client unit was not updated",
                    { client_id: clientId, error: clientUnitError.message },
                );
            }
        }

        const appointment = await fetchAppointmentById(
            supabase,
            inserted.id,
        );

        if (!appointment) {
            throw new Error("Appointment was created but could not be reloaded");
        }

        return NextResponse.json(
            { ok: true, appointment },
            { status: 201 },
        );
    } catch (error) {
        console.error("[appointments:post] failed", error);
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
                    : "Failed to process appointment",
        },
        { status: 500 },
    );
}
