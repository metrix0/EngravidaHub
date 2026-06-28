// app/api/scheduling/day-notes/[noteId]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

const updateSchema = z.object({
    text: z.string().trim().min(1).max(500),
});

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ noteId: string }> },
) {
    try {
        const { noteId } = await params;
        const { user } = await getCurrentAttendantFromRequest();

        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const parsed = updateSchema.safeParse(await request.json());
        if (!parsed.success) {
            return NextResponse.json(
                { ok: false, error: "Invalid note" },
                { status: 400 },
            );
        }

        const { data, error } = await supabase
            .from("appointment_day_notes")
            .update({ text: parsed.data.text })
            .eq("id", noteId)
            .select(
                "id, note_date, unit_id, doctor_id, text, color, created_at, updated_at",
            )
            .single();

        if (error) throw error;
        return NextResponse.json({ ok: true, note: data });
    } catch (error) {
        console.error("[day-notes:patch] failed", error);
        return errorResponse(error);
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ noteId: string }> },
) {
    try {
        const { noteId } = await params;
        const { user } = await getCurrentAttendantFromRequest();

        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const { error } = await supabase
            .from("appointment_day_notes")
            .delete()
            .eq("id", noteId);

        if (error) throw error;
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[day-notes:delete] failed", error);
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
                    : "Failed to update day note",
        },
        { status: 500 },
    );
}
