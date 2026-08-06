// app/api/(webhooks)/webhooks/clinisys/appointments/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

const nullableText = z.string().trim().max(500).nullable().optional();
const nullableDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date in YYYY-MM-DD format")
    .refine(isValidIsoDate, "Invalid calendar date")
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

const appointmentSchema = z
    .object({
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
        status: z
            .enum([
                "scheduled",
                "confirmed",
                "completed",
                "cancelled",
                "no_show",
            ])
            .default("scheduled"),
        format: z.enum(["congelamento", "casal"]).default("congelamento"),
        procedureName: z.string().trim().min(1).max(180),
        unitName: z.string().trim().min(1).max(180),
        doctorName: z.string().trim().min(1).max(180),
        patient: personSchema,
        address: addressSchema,
        notes: z.string().trim().max(2000).nullable().optional(),
    })
    .strict()
    .superRefine((appointment, context) => {
        if (
            new Date(appointment.endsAt).getTime() <=
            new Date(appointment.startsAt).getTime()
        ) {
            context.addIssue({
                code: "custom",
                path: ["endsAt"],
                message: "endsAt must be after startsAt",
            });
        }
    });

const appointmentWebhookSchema = z.discriminatedUnion("event", [
    z
        .object({
            event: z.literal("appointment.created"),
            source: z.literal("clinisys"),
            externalId: z.string().trim().min(1).max(180),
            appointment: appointmentSchema,
        })
        .strict(),
    z
        .object({
            event: z.literal("appointment.updated"),
            source: z.literal("clinisys"),
            externalId: z.string().trim().min(1).max(180),
            appointment: appointmentSchema,
        })
        .strict(),
    z
        .object({
            event: z.literal("appointment.deleted"),
            source: z.literal("clinisys"),
            externalId: z.string().trim().min(1).max(180),
        })
        .strict(),
]);

export async function POST(request: Request) {
    let payload: unknown;

    try {
        payload = await request.json();
    } catch {
        return NextResponse.json(
            { ok: false, error: "Invalid JSON body" },
            { status: 400 },
        );
    }

    const parsed = appointmentWebhookSchema.safeParse(payload);

    if (!parsed.success) {
        return NextResponse.json(
            {
                ok: false,
                error: "Invalid appointment webhook payload",
                issues: parsed.error.issues.map((issue) => ({
                    path: issue.path.join("."),
                    message: issue.message,
                })),
            },
            { status: 400 },
        );
    }

    return NextResponse.json({ ok: true });
}

function isValidIsoDate(value: string) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}
