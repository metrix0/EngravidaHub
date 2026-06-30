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
import {
    buildAppointmentIntegrationPayload,
    moveClientToFivFirstStage,
    sendAppointmentIntegration,
} from "@/lib/scheduling/appointmentAutomation";

const personSchema = z.object({
    fullName: z.string().max(180), cpf: z.string().max(32), birthDate: z.string().max(32),
    email: z.string().max(180), phone: z.string().max(40),
});
const addressSchema = z.object({
    street: z.string().trim().max(180), number: z.string().trim().max(40),
    complement: z.string().trim().max(120), neighborhood: z.string().trim().max(120),
    city: z.string().trim().max(120), state: z.string().trim().max(80),
    cep: z.string().trim().max(20), country: z.string().trim().max(80),
});
const createSchema = z.object({
    threadId: z.string().uuid().nullable().optional(), clientId: z.string().uuid().nullable().optional(),
    unitId: z.string().uuid(), doctorId: z.string().uuid(), startsAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(15).max(480),
    status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]).default("scheduled"),
    format: z.enum(["congelamento", "casal"]), procedureName: z.string().trim().min(1).max(180),
    primary: personSchema, spouse: personSchema, address: addressSchema, notes: z.string().max(2000),
    addToFivFunnel: z.boolean().optional().default(true),
}).superRefine((value, context) => {
    if (!value.primary.fullName.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["primary", "fullName"], message: "Informe o nome da pessoa principal." });
    if (value.format === "casal" && !value.spouse.fullName.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["spouse", "fullName"], message: "Informe o nome do cônjuge." });
});

export async function GET(request: Request) {
    try {
        const { user } = await getCurrentAttendantFromRequest();
        if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
        const { searchParams } = new URL(request.url);
        const start = searchParams.get("start"); const end = searchParams.get("end");
        if (!start || !end) return NextResponse.json({ ok: false, error: "start and end are required" }, { status: 400 });
        let query = supabase.from("appointments").select(APPOINTMENT_SELECT)
            .gte("starts_at", `${start}T00:00:00-03:00`).lt("starts_at", `${end}T00:00:00-03:00`).order("starts_at", { ascending: true });
        const unitIds = searchParams.getAll("unit_ids"); const doctorIds = searchParams.getAll("doctor_ids");
        const statuses = searchParams.getAll("statuses"); const formats = searchParams.getAll("formats");
        const search = searchParams.get("search")?.trim();
        if (unitIds.length) query = query.in("unit_id", unitIds);
        if (doctorIds.length) query = query.in("doctor_id", doctorIds);
        if (statuses.length) query = query.in("status", statuses);
        if (formats.length) query = query.in("format", formats);
        if (search) { const escaped = search.replace(/[,%()]/g, " ").trim(); if (escaped) query = query.or(`patient_name.ilike.%${escaped}%,procedure_name.ilike.%${escaped}%`); }
        const { data, error } = await query; if (error) throw error;
        return NextResponse.json({ ok: true, appointments: (data ?? []).map(mapAppointment) });
    } catch (error) { console.error("[appointments:get] failed", error); return errorResponse(error); }
}

export async function POST(request: Request) {
    try {
        const { user, attendant } = await getCurrentAttendantFromRequest();
        if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
        const parsed = createSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid appointment data", issues: parsed.error.issues }, { status: 400 });
        const body = parsed.data;
        if (!(await validateDoctorForUnit(supabase, body.doctorId, body.unitId))) return NextResponse.json({ ok: false, error: "O médico não pertence à unidade selecionada." }, { status: 400 });
        let clientId = body.clientId ?? null;
        if (body.threadId) {
            let threadQuery = supabase.from("thread").select("id, client_id").eq("id", body.threadId);
            if (attendant) threadQuery = threadQuery.eq("assigned_attendant_id", attendant.id);
            const { data: thread, error: threadError } = await threadQuery.maybeSingle();
            if (threadError) throw threadError;
            if (!thread) return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
            clientId = thread.client_id;
        }
        const startsAt = new Date(body.startsAt);
        if (startsAt.getUTCMinutes() % 15 !== 0) return NextResponse.json({ ok: false, error: "Selecione um horário em intervalos de 15 minutos." }, { status: 400 });
        const endsAt = new Date(startsAt.getTime() + body.durationMinutes * 60_000);

        const { data: conflicts, error: conflictError } = await supabase.from("appointments").select("id")
            .eq("doctor_id", body.doctorId).in("status", ["scheduled", "confirmed"])
            .lt("starts_at", endsAt.toISOString()).gt("ends_at", startsAt.toISOString()).limit(1);
        if (conflictError) throw conflictError;
        if (conflicts?.length) return NextResponse.json({ ok: false, error: "Este horário já está ocupado para o médico selecionado." }, { status: 409 });

        const { data: inserted, error: insertError } = await supabase.from("appointments").insert({
            client_id: clientId, thread_id: body.threadId ?? null, unit_id: body.unitId, doctor_id: body.doctorId,
            starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), status: body.status, format: body.format,
            procedure_name: body.procedureName, patient_name: body.primary.fullName,
            patient_phone: body.primary.phone || null, patient_email: body.primary.email || null,
            patient_cpf: body.primary.cpf || null, patient_birth_date: parseBrazilDate(body.primary.birthDate),
            spouse_name: body.format === "casal" ? body.spouse.fullName || null : null,
            spouse_phone: body.format === "casal" ? body.spouse.phone || null : null,
            spouse_email: body.format === "casal" ? body.spouse.email || null : null,
            spouse_cpf: body.format === "casal" ? body.spouse.cpf || null : null,
            spouse_birth_date: body.format === "casal" ? parseBrazilDate(body.spouse.birthDate) : null,
            address_street: body.address.street || null, address_number: body.address.number || null,
            address_complement: body.address.complement || null, address_neighborhood: body.address.neighborhood || null,
            address_city: body.address.city || null, address_state: body.address.state || null,
            address_cep: onlyDigits(body.address.cep) || null, address_country: body.address.country || null,
            notes: body.notes || null, created_by: user.id, created_by_attendant_id: attendant?.id ?? null,
        }).select("id").single();
        if (insertError) throw insertError;

        if (clientId) {
            const { error: clientUpdateError } = await supabase.from("clients").update({
                name: body.primary.fullName || null, phone: body.primary.phone || null, email: body.primary.email || null,
                cpf: body.primary.cpf || null, birth_date: parseBrazilDate(body.primary.birthDate), unit_id: body.unitId,
                street: body.address.street || null, number: body.address.number || null,
                complement: body.address.complement || null, neighborhood: body.address.neighborhood || null,
                city: body.address.city || null, state: body.address.state || null,
                cep: onlyDigits(body.address.cep) || null, country: body.address.country || null,
            }).eq("id", clientId);
            if (clientUpdateError) console.warn("[appointments:post] appointment created but client data was not updated", { client_id: clientId, error: clientUpdateError.message });
        }
        const appointment = await fetchAppointmentById(supabase, inserted.id);
        if (!appointment) throw new Error("Appointment was created but could not be reloaded");

        let fivAutomation: Awaited<ReturnType<typeof moveClientToFivFirstStage>>;
        try {
            fivAutomation = await moveClientToFivFirstStage({
                clientId,
                enabled: body.addToFivFunnel,
                procedureName: body.procedureName,
                movedByAttendantId: attendant?.id ?? null,
            });
        } catch (automationError) {
            console.warn("[appointments:post] FIV automation failed", automationError);
            fivAutomation = {
                applied: false,
                reason:
                    automationError instanceof Error
                        ? automationError.message
                        : "fiv_automation_failed",
            };
        }

        const integration = await sendAppointmentIntegration(
            buildAppointmentIntegrationPayload("appointment.created", appointment),
        );

        return NextResponse.json(
            {
                ok: true,
                appointment,
                automation: {
                    fiv: fivAutomation,
                    integration,
                },
            },
            { status: 201 },
        );
    } catch (error) { console.error("[appointments:post] failed", error); return errorResponse(error); }
}
function onlyDigits(value: string) { return value.replace(/\D/g, ""); }
function errorResponse(error: unknown) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to process appointment" }, { status: 500 }); }
