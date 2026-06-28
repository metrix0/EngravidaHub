// lib/ai/schedulingAutofillSchema.ts
import { z } from "zod";

const aiString = (maxLength: number) =>
    z
        .union([z.string().max(maxLength), z.null()])
        .transform((value) => value ?? "");

const aiDuration = z
    .union([
        z.number().int().min(15).max(480),
        z.string().max(16),
        z.null(),
    ])
    .transform((value) => {
        if (typeof value === "number") return value;
        const parsed = Number.parseInt(value ?? "", 10);
        return Number.isFinite(parsed) ? parsed : 45;
    });

const personSchema = z
    .object({
        fullName: aiString(180),
        cpf: aiString(32),
        birthDate: aiString(32),
        email: aiString(180),
        phone: aiString(40),
    })
    .strict();

export const schedulingAutofillSchema = z
    .object({
        unitId: aiString(80),
        doctorId: aiString(80),
        schedulingDate: aiString(80),
        schedulingTime: aiString(20),
        durationMinutes: aiDuration,
        procedureName: aiString(180),
        primary: personSchema,
        spouse: personSchema,
        address: aiString(500),
        notes: aiString(1000),
    })
    .strict();

export type SchedulingAutofillAiResult = z.infer<
    typeof schedulingAutofillSchema
>;
