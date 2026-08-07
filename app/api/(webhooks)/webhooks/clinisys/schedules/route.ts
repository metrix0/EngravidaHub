// app/api/(webhooks)/webhooks/clinisys/schedules/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

type ValidationContext = {
    addIssue(issue: {
        code: "custom";
        path?: Array<string | number>;
        message: string;
    }): void;
};

const isoDateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date in YYYY-MM-DD format")
    .refine(isValidIsoDate, "Invalid calendar date");

const timeSchema = z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected time in HH:mm format");

const daysOfWeekSchema = z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .superRefine((days, context) => {
        if (new Set(days).size !== days.length) {
            context.addIssue({
                code: "custom",
                message: "daysOfWeek must not contain duplicate values",
            });
        }
    });

const workingHoursSchema = z
    .object({
        daysOfWeek: daysOfWeekSchema,
        startsAt: timeSchema,
        endsAt: timeSchema,
        validFrom: isoDateSchema,
        validUntil: isoDateSchema.nullable(),
    })
    .strict()
    .superRefine((workingHours, context) => {
        validateTimeRange(workingHours, context);
        validateDateRange(workingHours, context);
    });

const exceptionPeriodSchema = z
    .object({
        startsAt: timeSchema,
        endsAt: timeSchema,
    })
    .strict()
    .superRefine(validateTimeRange);

const exceptionSchema = z
    .object({
        id: z.string().trim().min(1).max(180),
        date: isoDateSchema,
        available: z.boolean(),
        periods: z.array(exceptionPeriodSchema),
    })
    .strict();

const oneTimeBlockSchema = z
    .object({
        id: z.string().trim().min(1).max(180),
        type: z.literal("one_time"),
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
        reason: z.string().trim().max(500).nullable().optional(),
    })
    .strict()
    .superRefine((block, context) => {
        if (
            new Date(block.endsAt).getTime() <=
            new Date(block.startsAt).getTime()
        ) {
            context.addIssue({
                code: "custom",
                path: ["endsAt"],
                message: "endsAt must be after startsAt",
            });
        }
    });

const recurringBlockSchema = z
    .object({
        id: z.string().trim().min(1).max(180),
        type: z.literal("recurring"),
        daysOfWeek: daysOfWeekSchema,
        startsAt: timeSchema,
        endsAt: timeSchema,
        validFrom: isoDateSchema,
        validUntil: isoDateSchema.nullable(),
        reason: z.string().trim().max(500).nullable().optional(),
    })
    .strict()
    .superRefine((block, context) => {
        validateTimeRange(block, context);
        validateDateRange(block, context);
    });

const blockSchema = z.union([oneTimeBlockSchema, recurringBlockSchema]);

const agendaSchema = z
    .object({
        unitName: z.string().trim().min(1).max(180),
        doctorName: z.string().trim().min(1).max(180),
        timezone: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .refine(isValidTimezone, "Invalid IANA timezone"),
        slotDurationMinutes: z.number().int().min(1).max(1440),
        workingHours: z.array(workingHoursSchema),
        exceptions: z.array(exceptionSchema),
        blocks: z.array(blockSchema),
    })
    .strict();

const scheduleWebhookSchema = z.discriminatedUnion("event", [
    z
        .object({
            event: z.literal("agenda.created"),
            source: z.literal("clinisys"),
            externalId: z.string().trim().min(1).max(180),
            agenda: agendaSchema,
        })
        .strict(),
    z
        .object({
            event: z.literal("agenda.updated"),
            source: z.literal("clinisys"),
            externalId: z.string().trim().min(1).max(180),
            agenda: agendaSchema,
        })
        .strict(),
    z
        .object({
            event: z.literal("agenda.deleted"),
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

    const parsed = scheduleWebhookSchema.safeParse(payload);

    if (!parsed.success) {
        return NextResponse.json(
            {
                ok: false,
                error: "Invalid schedule webhook payload",
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

function isValidTimezone(value: string) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

function minutesFromTime(value: string) {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
}

function validateTimeRange(
    value: { startsAt: string; endsAt: string },
    context: ValidationContext,
) {
    if (minutesFromTime(value.endsAt) <= minutesFromTime(value.startsAt)) {
        context.addIssue({
            code: "custom",
            path: ["endsAt"],
            message: "endsAt must be after startsAt",
        });
    }
}

function validateDateRange(
    value: { validFrom: string; validUntil?: string | null },
    context: ValidationContext,
) {
    if (value.validUntil && value.validUntil < value.validFrom) {
        context.addIssue({
            code: "custom",
            path: ["validUntil"],
            message: "validUntil must be on or after validFrom",
        });
    }
}
