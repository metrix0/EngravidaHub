import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { listReplicatedClinisysAvailability } from "@/lib/clinisys/replicatedAvailability";
import { supabase } from "@/lib/supabase/client";
import { validateDoctorForUnit } from "@/lib/scheduling/appointmentServer";

export async function GET(request: Request) {
    try {
        const { user } = await getCurrentAttendantFromRequest();
        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const params = new URL(request.url).searchParams;
        const unitId = params.get("unit_id")?.trim() ?? "";
        const doctorId = params.get("doctor_id")?.trim() ?? "";
        const procedureName = params.get("procedure_name")?.trim() ?? "";
        const durationParam = params.get("duration_minutes")?.trim() ?? "";
        const durationMinutes = durationParam ? Number(durationParam) : null;
        const date = params.get("date")?.trim() || null;
        if (!unitId || !doctorId || !procedureName) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "unit_id, doctor_id and procedure_name are required",
                },
                { status: 400 },
            );
        }
        if (
            durationParam &&
            (!Number.isInteger(durationMinutes) ||
                durationMinutes === null ||
                durationMinutes < 15 ||
                durationMinutes > 480)
        ) {
            return NextResponse.json(
                { ok: false, error: "duration_minutes must be between 15 and 480" },
                { status: 400 },
            );
        }
        if (!(await validateDoctorForUnit(supabase, doctorId, unitId))) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "O médico não pertence à unidade selecionada.",
                },
                { status: 400 },
            );
        }

        const availability = await listReplicatedClinisysAvailability({
            unitId,
            doctorIds: [doctorId],
            dateFrom: date,
            dateTo: date,
            durationMinutes,
        });

        if (availability.missingDoctorIds.includes(doctorId)) {
            return NextResponse.json(
                {
                    ok: false,
                    error:
                        "A agenda replicada do CliniSYS ainda não está disponível para este médico.",
                },
                { status: 503 },
            );
        }

        return NextResponse.json({
            ok: true,
            slots: availability.slots.map((slot) => ({
                data: slot.data,
                inicio: slot.inicio,
                termino: slot.termino,
            })),
        });
    } catch (error) {
        console.error("[scheduling-availability] failed", error);
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao consultar a disponibilidade replicada.",
            },
            { status: 502 },
        );
    }
}
