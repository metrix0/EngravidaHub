// app/api/inbox/scheduling-autofill/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import { autofillSchedulingForm } from "@/lib/ai/schedulingAutofill";
import { loadSchedulingContext } from "@/lib/inbox/schedulingData";

const personSchema = z.object({
    fullName: z.string().max(180),
    cpf: z.string().max(32),
    birthDate: z.string().max(32),
    email: z.string().max(180),
    phone: z.string().max(40),
});

const requestSchema = z.object({
    threadId: z.string().uuid(),
    format: z.enum(["congelamento", "casal"]),
    form: z.object({
        unitId: z.string().max(80),
        doctorId: z.string().max(80),
        schedulingDate: z.string().max(80),
        schedulingTime: z.string().max(20),
        durationMinutes: z.number().int().min(15).max(480),
        procedureName: z.string().max(180),
        primary: personSchema,
        spouse: personSchema,
        address: z.string().max(500),
        notes: z.string().max(1000),
    }),
});

export async function POST(request: Request) {
    try {
        const { attendant } = await getCurrentAttendantFromRequest();

        if (!attendant || !attendant.is_online) {
            return NextResponse.json(
                { ok: false, error: "Not allowed" },
                { status: 403 },
            );
        }

        const parsed = requestSchema.safeParse(await request.json());

        if (!parsed.success) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Invalid scheduling data",
                    issues: parsed.error.issues,
                },
                { status: 400 },
            );
        }

        const context = await loadSchedulingContext(
            supabase,
            parsed.data.threadId,
            attendant.id,
        );

        if (!context) {
            return NextResponse.json(
                { ok: false, error: "Scheduling data not found" },
                { status: 404 },
            );
        }

        const { data: messages, error: messagesError } = await supabase
            .from("messages")
            .select(
                "sender_type, sender_name, text, sent_at, sequence_index",
            )
            .eq("thread_id", parsed.data.threadId)
            .order("sent_at", { ascending: false })
            .order("sequence_index", { ascending: false })
            .limit(100);

        if (messagesError) throw messagesError;

        const orderedMessages = [...(messages ?? [])].reverse();

        const form = await autofillSchedulingForm({
            format: parsed.data.format,
            currentForm: parsed.data.form,
            client: context.client,
            spouse: context.spouse,
            units: context.units,
            doctors: context.doctors,
            messages: orderedMessages,
        });

        return NextResponse.json({
            ok: true,
            form,
            messagesUsed: orderedMessages.length,
        });
    } catch (error) {
        console.error("[scheduling-autofill] failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to autofill scheduling data",
            },
            { status: 500 },
        );
    }
}
