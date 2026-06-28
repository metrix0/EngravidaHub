// app/api/scheduling/day-notes/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

const createSchema = z.object({
    noteDate: z.string().date(),
    unitId: z.string().uuid().nullable().optional(),
    doctorId: z.string().uuid().nullable().optional(),
    text: z.string().trim().min(1).max(500),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#f59e0b"),
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

        const { data, error } = await supabase
            .from("appointment_day_notes")
            .select(
                "id, note_date, unit_id, doctor_id, text, color, created_at, updated_at",
            )
            .gte("note_date", start)
            .lt("note_date", end)
            .order("created_at", { ascending: true });

        if (error) throw error;

        return NextResponse.json({ ok: true, notes: data ?? [] });
    } catch (error) {
        console.error("[day-notes:get] failed", error);
        return errorResponse(error);
    }
}

export async function POST(request: Request) {
    try {
        const { user } = await getCurrentAttendantFromRequest();

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
                    error: "Invalid note",
                    issues: parsed.error.issues,
                },
                { status: 400 },
            );
        }

        const { data, error } = await supabase
            .from("appointment_day_notes")
            .insert({
                note_date: parsed.data.noteDate,
                unit_id: parsed.data.unitId ?? null,
                doctor_id: parsed.data.doctorId ?? null,
                text: parsed.data.text,
                color: parsed.data.color,
                created_by: user.id,
            })
            .select(
                "id, note_date, unit_id, doctor_id, text, color, created_at, updated_at",
            )
            .single();

        if (error) throw error;

        return NextResponse.json({ ok: true, note: data }, { status: 201 });
    } catch (error) {
        console.error("[day-notes:post] failed", error);
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
                    : "Failed to process day note",
        },
        { status: 500 },
    );
}
