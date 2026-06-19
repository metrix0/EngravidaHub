// lib/ai/schedulingAutofillSchema.ts
import { z } from "zod";

const aiString = (maxLength: number) =>
    z
        .union([z.string().max(maxLength), z.null()])
        .transform((value) => value ?? "");

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
        schedulingDate: aiString(80),
        primary: personSchema,
        spouse: personSchema,
        address: aiString(500),
    })
    .strict();

export type SchedulingAutofillAiResult = z.infer<
    typeof schedulingAutofillSchema
>;
