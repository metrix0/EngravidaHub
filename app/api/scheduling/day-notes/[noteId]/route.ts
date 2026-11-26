// app/api/scheduling/day-notes/[noteId]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { checkDayNoteBlockAccess } from "@/lib/scheduling/dayNoteBlockAccess";
import { supabase } from "@/lib/supabase/client";

const updateSchema = z.object({
    text: z.string().trim().min(1).max(500),
    blocksFirstEvaluation: z.boolean().optional(),
    unitId: z.string().uuid().optional(),
    doctorId: z.string().uuid().optional(),
    doctorIds: z.array(z.string().uuid()).min(1).optional(),
    blockStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
    blockEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
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

        const { text, blocksFirstEvaluation, unitId, doctorId, doctorIds, blockStartTime, blockEndTime } = parsed.data;
        const updates: Record<string, string | boolean | null> = { text };
        let expectedUpdatedAt: string | undefined;
        if (blocksFirstEvaluation !== undefined) {
            const current = await loadNoteScope(noteId);
            if (!current) return NextResponse.json({ ok: false, error: "Nota não encontrada." }, { status: 404 });
            expectedUpdatedAt = current.updated_at;
            if (current.blocks_first_evaluation && (!blocksFirstEvaluation || (unitId && unitId !== current.unit_id))) {
                const denied = await checkDayNoteBlockAccess(current.unit_id, current.doctor_id, false);
                if (denied) return denied;
            }
            if (blocksFirstEvaluation) {
                const selectedUnit = unitId ?? current.unit_id;
                const selectedDoctors = [...new Set(doctorIds ?? [doctorId ?? current.doctor_id])];
                if (current.doctor_id && selectedDoctors.includes(current.doctor_id)) {
                    selectedDoctors.splice(selectedDoctors.indexOf(current.doctor_id), 1);
                    selectedDoctors.unshift(current.doctor_id);
                }
                const selectedDoctor = selectedDoctors[0];
                const selectedStart = blockStartTime === undefined ? current.block_start_time : blockStartTime;
                const selectedEnd = blockEndTime === undefined ? current.block_end_time : blockEndTime;
                if ((selectedStart == null) !== (selectedEnd == null) ||
                    (selectedStart != null && selectedEnd != null && selectedStart >= selectedEnd)) {
                    return NextResponse.json({ ok: false, error: "O horário final deve ser posterior ao inicial." }, { status: 400 });
                }
                for (const selectedId of selectedDoctors) {
                    const denied = await checkDayNoteBlockAccess(selectedUnit, selectedId, true);
                    if (denied) return denied;
                }
                if (selectedDoctors.length > 1) {
                    const { data, error } = await supabase.rpc("expand_day_note_doctor_blocks", {
                        p_note_id: noteId,
                        p_updated_at: expectedUpdatedAt,
                        p_unit_id: selectedUnit,
                        p_doctor_ids: selectedDoctors,
                        p_text: text,
                        p_start: selectedStart,
                        p_end: selectedEnd,
                        p_created_by: user.id,
                    });
                    if (error) throw error;
                    if (!data?.length) return NextResponse.json({ ok: false, error: "A nota foi alterada. Recarregue a agenda." }, { status: 409 });
                    return NextResponse.json({ ok: true, note: data[0], notes: data });
                }
                if (selectedUnit && selectedDoctor) {
                    updates.unit_id = selectedUnit;
                    updates.doctor_id = selectedDoctor;
                }
                updates.block_start_time = selectedStart;
                updates.block_end_time = selectedEnd;
            } else {
                updates.block_start_time = null;
                updates.block_end_time = null;
            }
            updates.blocks_first_evaluation = blocksFirstEvaluation;
        }

        let update = supabase
            .from("appointment_day_notes")
            .update(updates)
            .eq("id", noteId);
        if (expectedUpdatedAt) update = update.eq("updated_at", expectedUpdatedAt);
        const { data, error } = await update
            .select(
                "id, note_date, unit_id, doctor_id, text, color, blocks_first_evaluation, block_start_time, block_end_time, created_at, updated_at",
            )
            .maybeSingle();

        if (error) throw error;
        if (!data) return NextResponse.json({ ok: false, error: "A nota foi alterada. Recarregue a agenda." }, { status: 409 });
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

        const current = await loadNoteScope(noteId);
        if (!current) return NextResponse.json({ ok: true });
        if (current.blocks_first_evaluation) {
            const denied = await checkDayNoteBlockAccess(current.unit_id, current.doctor_id, false);
            if (denied) return denied;
        }
        const { data, error } = await supabase
            .from("appointment_day_notes")
            .delete()
            .eq("id", noteId)
            .eq("updated_at", current.updated_at)
            .select("id").maybeSingle();

        if (error) throw error;
        if (!data) return NextResponse.json({ ok: false, error: "A nota foi alterada. Recarregue a agenda." }, { status: 409 });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[day-notes:delete] failed", error);
        return errorResponse(error);
    }
}

async function loadNoteScope(noteId: string) {
    const { data, error } = await supabase.from("appointment_day_notes")
        .select("unit_id, doctor_id, blocks_first_evaluation, block_start_time, block_end_time, updated_at")
        .eq("id", noteId).maybeSingle();
    if (error) throw error;
    return data;
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
