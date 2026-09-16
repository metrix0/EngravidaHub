import { NextResponse } from "next/server";
import { z } from "zod";

import { supabase } from "@/lib/supabase/client";
import {
    normalizeWebhookDate,
    onlyDigits,
    resolveHubUnitDoctor,
    verifyClinisysWebhook,
} from "@/lib/clinisys/webhook";

const nullableText = z.string().trim().max(500).nullable().optional();
const personSchema = z.object({
    name: z.string().trim().min(1).max(180),
    cpf: z.string().trim().max(40).nullable().optional(),
    birthDate: z.string().trim().max(32).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    email: z.string().trim().max(180).nullable().optional(),
}).strict();
const addressSchema = z.object({
    street: nullableText,
    number: nullableText,
    complement: nullableText,
    neighborhood: nullableText,
    city: nullableText,
    state: nullableText,
    cep: nullableText,
    country: nullableText,
}).strict();
const appointmentSchema = z.object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]),
    format: z.enum(["congelamento", "casal"]).nullable(),
    procedureName: z.string().trim().min(1).max(180),
    unitName: z.string().trim().min(1).max(180),
    doctorName: z.string().trim().min(1).max(180),
    patient: personSchema,
    spouse: personSchema.nullable().optional(),
    address: addressSchema,
    notes: z.string().trim().max(2000).nullable().optional(),
}).strict();
const webhookSchema = z.discriminatedUnion("event", [
    z.object({
        event: z.literal("appointment.created"),
        source: z.literal("clinisys"),
        externalId: z.string().trim().min(1).max(180),
        appointment: appointmentSchema,
    }).strict(),
    z.object({
        event: z.literal("appointment.updated"),
        source: z.literal("clinisys"),
        externalId: z.string().trim().min(1).max(180),
        appointment: appointmentSchema,
    }).strict(),
    z.object({
        event: z.literal("appointment.deleted"),
        source: z.literal("clinisys"),
        externalId: z.string().trim().min(1).max(180),
    }).strict(),
]);

export async function POST(request: Request) {
    let rawBody: string;
    try {
        rawBody = await request.text();
    } catch {
        return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
    }

    try {
        if (!verifyClinisysWebhook(rawBody, request.headers.get("x-clinisys-signature"))) {
            return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
        }
    } catch (error) {
        console.error("[clinisys-appointments] signature configuration failed", error);
        return NextResponse.json({ ok: false, error: "Webhook signature is not configured" }, { status: 500 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = webhookSchema.safeParse(payload);
    if (!parsed.success) {
        return NextResponse.json({
            ok: false,
            error: "Invalid appointment webhook payload",
            issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        }, { status: 400 });
    }

    try {
        const body = parsed.data;
        if (body.event === "appointment.deleted") {
            const { error } = await supabase
                .from("appointments")
                .delete()
                .eq("source", "clinisys")
                .eq("source_external_id", body.externalId);
            if (error) throw error;
            return NextResponse.json({ ok: true });
        }

        const appointment = body.appointment;
        const match = await resolveHubUnitDoctor(appointment.unitName, appointment.doctorName);
        if (!match) {
            return NextResponse.json({
                ok: false,
                error: `Não foi possível mapear ${appointment.doctorName} / ${appointment.unitName} no Hub.`,
            }, { status: 422 });
        }

        const startsAt = new Date(appointment.startsAt);
        const endsAt = new Date(appointment.endsAt);
        if (endsAt.getTime() <= startsAt.getTime()) {
            return NextResponse.json({ ok: false, error: "endsAt must be after startsAt" }, { status: 400 });
        }

        const existing = await findExistingAppointment({
            externalId: body.externalId,
            doctorId: match.doctorId,
            startsAt: startsAt.toISOString(),
            patientName: appointment.patient.name,
        });
        const clientId = existing?.client_id ?? await upsertClient({
            patient: appointment.patient,
            unitId: match.unitId,
            address: appointment.address,
        });
        const spouse = appointment.spouse ?? null;
        const values = {
            source: "clinisys",
            source_external_id: body.externalId,
            client_id: clientId,
            unit_id: match.unitId,
            doctor_id: match.doctorId,
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
            status: appointment.status,
            format: appointment.format ?? existing?.format ?? null,
            procedure_name: appointment.procedureName,
            patient_name: appointment.patient.name,
            patient_phone: appointment.patient.phone ?? null,
            patient_email: appointment.patient.email ?? null,
            patient_cpf: appointment.patient.cpf ?? null,
            patient_birth_date: normalizeWebhookDate(appointment.patient.birthDate),
            spouse_name: spouse?.name ?? null,
            spouse_phone: spouse?.phone ?? null,
            spouse_email: spouse?.email ?? null,
            spouse_cpf: spouse?.cpf ?? null,
            spouse_birth_date: normalizeWebhookDate(spouse?.birthDate),
            address_street: appointment.address.street ?? null,
            address_number: appointment.address.number ?? null,
            address_complement: appointment.address.complement ?? null,
            address_neighborhood: appointment.address.neighborhood ?? null,
            address_city: appointment.address.city ?? null,
            address_state: appointment.address.state ?? null,
            address_cep: onlyDigits(appointment.address.cep),
            address_country: appointment.address.country ?? null,
            notes: appointment.notes ?? null,
            updated_at: new Date().toISOString(),
        };

        const result = existing
            ? await supabase
                .from("appointments")
                .update(values)
                .eq("id", existing.id)
                .select("id")
                .single()
            : await supabase
                .from("appointments")
                .upsert(values, { onConflict: "source,source_external_id" })
                .select("id")
                .single();
        if (result.error) throw result.error;

        return NextResponse.json({ ok: true, appointmentId: result.data.id });
    } catch (error) {
        console.error("[clinisys-appointments] processing failed", error);
        return NextResponse.json({
            ok: false,
            error: error instanceof Error ? error.message : "Webhook processing failed",
        }, { status: 500 });
    }
}

async function findExistingAppointment({
    externalId,
    doctorId,
    startsAt,
    patientName,
}: {
    externalId: string;
    doctorId: string;
    startsAt: string;
    patientName: string;
}) {
    const { data: linked, error: linkedError } = await supabase
        .from("appointments")
        .select("id, client_id, format")
        .eq("source", "clinisys")
        .eq("source_external_id", externalId)
        .limit(1)
        .maybeSingle();
    if (linkedError) throw linkedError;
    if (linked) return linked;

    const { data: candidates, error } = await supabase
        .from("appointments")
        .select("id, client_id, format")
        .eq("doctor_id", doctorId)
        .eq("starts_at", startsAt)
        .eq("patient_name", patientName)
        .is("source_external_id", null)
        .limit(2);
    if (error) throw error;
    return candidates?.length === 1 ? candidates[0] : null;
}

async function upsertClient({
    patient,
    unitId,
    address,
}: {
    patient: z.infer<typeof personSchema>;
    unitId: string;
    address: z.infer<typeof addressSchema>;
}) {
    let client: { id: string } | null = null;
    const cpf = onlyDigits(patient.cpf);
    const phone = onlyDigits(patient.phone);

    if (cpf) {
        const result = await supabase.from("clients").select("id").eq("cpf", cpf).limit(1).maybeSingle();
        if (result.error) throw result.error;
        client = result.data;
    }
    if (!client && phone) {
        const result = await supabase.from("clients").select("id").eq("phone", phone).limit(1).maybeSingle();
        if (result.error) throw result.error;
        client = result.data;
    }
    if (!client && patient.email) {
        const result = await supabase.from("clients").select("id").ilike("email", patient.email).limit(1).maybeSingle();
        if (result.error) throw result.error;
        client = result.data;
    }

    const now = new Date().toISOString();
    const values = {
        name: patient.name,
        cpf,
        birth_date: normalizeWebhookDate(patient.birthDate),
        phone,
        email: patient.email || null,
        unit_id: unitId,
        street: address.street ?? null,
        number: address.number ?? null,
        complement: address.complement ?? null,
        neighborhood: address.neighborhood ?? null,
        city: address.city ?? null,
        state: address.state ?? null,
        cep: onlyDigits(address.cep),
        country: address.country ?? null,
        last_interaction_at: now,
        updated_at: now,
    };
    if (client) {
        const { error } = await supabase.from("clients").update(values).eq("id", client.id);
        if (error) throw error;
        return client.id;
    }
    const { data: created, error } = await supabase
        .from("clients")
        .insert({ ...values, first_seen_at: now })
        .select("id")
        .single();
    if (error) throw error;
    return created.id;
}
