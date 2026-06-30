// app/api/integrations/appointments/webhook/route.ts
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { supabase } from "@/lib/supabase/client";
import { validateDoctorForUnit } from "@/lib/scheduling/appointmentServer";

const DEFAULT_WEBHOOK_SECRET = "replace-this-fake-webhook-secret";
const nullableText = z.string().trim().max(500).nullable().optional();
const nullableDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional();

const personSchema = z
    .object({
        name: z.string().trim().min(1).max(180),
        cpf: z.string().trim().max(30).nullable().optional(),
        birthDate: nullableDate,
        phone: z.string().trim().max(40).nullable().optional(),
        email: z.string().trim().email().max(180).nullable().optional(),
    })
    .strict();

const addressSchema = z
    .object({
        street: nullableText,
        number: nullableText,
        complement: nullableText,
        neighborhood: nullableText,
        city: nullableText,
        state: nullableText,
        cep: nullableText,
        country: nullableText,
    })
    .strict();

const appointmentDataSchema = z
    .object({
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
        status: z
            .enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"])
            .default("scheduled"),
        format: z.enum(["congelamento", "casal"]).default("congelamento"),
        procedureName: z.string().trim().min(1).max(180),
        unitName: z.string().trim().min(1).max(180),
        doctorName: z.string().trim().min(1).max(180),
        patient: personSchema,
        spouse: personSchema.nullable().optional(),
        address: addressSchema,
        notes: z.string().trim().max(2000).nullable().optional(),
    })
    .strict();

const webhookSchema = z.discriminatedUnion("event", [
    z
        .object({
            event: z.literal("appointment.created"),
            source: z.string().trim().min(1).max(80),
            externalId: z.string().trim().min(1).max(180),
            appointment: appointmentDataSchema,
        })
        .strict(),
    z
        .object({
            event: z.literal("appointment.updated"),
            source: z.string().trim().min(1).max(80),
            externalId: z.string().trim().min(1).max(180),
            appointment: appointmentDataSchema,
        })
        .strict(),
    z
        .object({
            event: z.literal("appointment.deleted"),
            source: z.string().trim().min(1).max(80),
            externalId: z.string().trim().min(1).max(180),
        })
        .strict(),
]);

export async function POST(request: Request) {
    try {
        const expectedSecret =
            process.env.APPOINTMENTS_WEBHOOK_SECRET?.trim() ||
            DEFAULT_WEBHOOK_SECRET;
        const receivedSecret = request.headers.get("x-webhook-secret")?.trim();

        if (!receivedSecret || receivedSecret !== expectedSecret) {
            return NextResponse.json(
                { ok: false, error: "Invalid webhook secret" },
                { status: 401 },
            );
        }

        const parsed = webhookSchema.safeParse(await request.json());
        if (!parsed.success) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Invalid webhook payload",
                    issues: parsed.error.issues,
                },
                { status: 400 },
            );
        }

        const body = parsed.data;
        const appointmentId = externalAppointmentUuid(
            body.source,
            body.externalId,
        );

        if (body.event === "appointment.deleted") {
            const { error } = await supabase
                .from("appointments")
                .delete()
                .eq("id", appointmentId);

            if (error) throw error;

            return NextResponse.json({
                ok: true,
                event: body.event,
                appointmentId,
            });
        }

        const startsAt = new Date(body.appointment.startsAt);
        const endsAt = new Date(body.appointment.endsAt);

        if (endsAt.getTime() <= startsAt.getTime()) {
            return NextResponse.json(
                { ok: false, error: "endsAt must be after startsAt" },
                { status: 400 },
            );
        }

        const unit = await findUniqueByName("units", body.appointment.unitName);
        if (!unit) {
            return NextResponse.json(
                { ok: false, error: "Unit not found or name is ambiguous" },
                { status: 422 },
            );
        }

        const doctor = await findUniqueByName(
            "doctors",
            body.appointment.doctorName,
        );
        if (!doctor) {
            return NextResponse.json(
                { ok: false, error: "Doctor not found or name is ambiguous" },
                { status: 422 },
            );
        }

        const doctorIsValid = await validateDoctorForUnit(
            supabase,
            doctor.id,
            unit.id,
        );
        if (!doctorIsValid) {
            return NextResponse.json(
                { ok: false, error: "Doctor does not belong to the unit" },
                { status: 422 },
            );
        }

        const patient = body.appointment.patient;
        const spouse = body.appointment.spouse ?? null;
        const address = body.appointment.address;

        const clientId = await upsertClient({
            name: patient.name,
            cpf: patient.cpf ?? null,
            birthDate: patient.birthDate ?? null,
            phone: patient.phone ?? null,
            email: patient.email ?? null,
            unitId: unit.id,
            address,
        });

        const { error: appointmentError } = await supabase
            .from("appointments")
            .upsert(
                {
                    id: appointmentId,
                    client_id: clientId,
                    unit_id: unit.id,
                    doctor_id: doctor.id,
                    starts_at: startsAt.toISOString(),
                    ends_at: endsAt.toISOString(),
                    status: body.appointment.status,
                    format: body.appointment.format,
                    procedure_name: body.appointment.procedureName,
                    patient_name: patient.name,
                    patient_phone: patient.phone ?? null,
                    patient_email: patient.email ?? null,
                    patient_cpf: patient.cpf ?? null,
                    patient_birth_date: patient.birthDate ?? null,
                    spouse_name: spouse?.name ?? null,
                    spouse_phone: spouse?.phone ?? null,
                    spouse_email: spouse?.email ?? null,
                    spouse_cpf: spouse?.cpf ?? null,
                    spouse_birth_date: spouse?.birthDate ?? null,
                    address_street: address.street ?? null,
                    address_number: address.number ?? null,
                    address_complement: address.complement ?? null,
                    address_neighborhood: address.neighborhood ?? null,
                    address_city: address.city ?? null,
                    address_state: address.state ?? null,
                    address_cep: address.cep ?? null,
                    address_country: address.country ?? null,
                    notes: body.appointment.notes ?? null,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "id" },
            );

        if (appointmentError) throw appointmentError;

        return NextResponse.json({
            ok: true,
            event: body.event,
            appointmentId,
            clientId,
        });
    } catch (error) {
        console.error("[appointments-webhook] failed", error);
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Webhook processing failed",
            },
            { status: 500 },
        );
    }
}

async function findUniqueByName(table: "units" | "doctors", name: string) {
    const { data, error } = await supabase
        .from(table)
        .select("id, name")
        .ilike("name", name)
        .limit(2);

    if (error) throw error;
    return data?.length === 1 ? data[0] : null;
}

async function upsertClient({
    name,
    cpf,
    birthDate,
    phone,
    email,
    unitId,
    address,
}: {
    name: string;
    cpf: string | null;
    birthDate: string | null;
    phone: string | null;
    email: string | null;
    unitId: string;
    address: z.infer<typeof addressSchema>;
}) {
    let client: { id: string } | null = null;

    if (cpf) {
        const { data, error } = await supabase
            .from("clients")
            .select("id")
            .eq("cpf", cpf)
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        client = data;
    }

    if (!client && phone) {
        const { data, error } = await supabase
            .from("clients")
            .select("id")
            .eq("phone", phone)
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        client = data;
    }

    if (!client && email) {
        const { data, error } = await supabase
            .from("clients")
            .select("id")
            .eq("email", email)
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        client = data;
    }

    const now = new Date().toISOString();
    const clientValues = {
        name,
        cpf,
        birth_date: birthDate,
        phone,
        email,
        unit_id: unitId,
        street: address.street ?? null,
        number: address.number ?? null,
        complement: address.complement ?? null,
        neighborhood: address.neighborhood ?? null,
        city: address.city ?? null,
        state: address.state ?? null,
        cep: address.cep ?? null,
        country: address.country ?? null,
        last_interaction_at: now,
        updated_at: now,
    };

    if (client) {
        const { error } = await supabase
            .from("clients")
            .update(clientValues)
            .eq("id", client.id);
        if (error) throw error;
        return client.id;
    }

    const { data: created, error } = await supabase
        .from("clients")
        .insert({
            ...clientValues,
            first_seen_at: now,
        })
        .select("id")
        .single();

    if (error) throw error;
    return created.id;
}

function externalAppointmentUuid(source: string, externalId: string) {
    const bytes = createHash("sha256")
        .update(`${source.trim().toLowerCase()}:${externalId.trim()}`)
        .digest()
        .subarray(0, 16);

    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
