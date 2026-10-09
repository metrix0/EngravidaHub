import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { listClinisysAvailability } from "@/lib/clinisys/client";
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

        const [unit, doctor] = await Promise.all([
            supabase.from("units").select("name").eq("id", unitId).maybeSingle(),
            supabase.from("doctors").select("name").eq("id", doctorId).maybeSingle(),
        ]);
        if (unit.error) throw unit.error;
        if (doctor.error) throw doctor.error;
        // A selected procedure must be checked against actual CliniSYS availability.
        const slots = await listClinisysAvailability({
            unitId,
            doctorId,
            unitName: unit.data?.name ?? null,
            doctorName: doctor.data?.name ?? null,
            procedureName,
            dateFrom: date,
            dateTo: date,
        });

        return NextResponse.json({ ok: true, slots: fitDuration(slots, durationMinutes, date) });
    } catch (error) {
        console.error("[scheduling-availability] failed", error);
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao consultar a disponibilidade do CliniSYS.",
            },
            { status: 502 },
        );
    }
}

type LiveSlot = { data?: string; inicio?: string; termino?: string };

function fitDuration(slots: LiveSlot[], durationMinutes: number | null, date: string | null) {
    const brazilDate = date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : null;
    const selected = slots.filter(slot =>
        typeof slot.data === "string" && typeof slot.inicio === "string" &&
        typeof slot.termino === "string" && (!brazilDate || slot.data === brazilDate)
    ) as Array<{ data: string; inicio: string; termino: string }>;
    if (durationMinutes === null) return selected;

    const minutes = (value: string) => {
        const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const intervals = new Map<string, Array<{ start: number; end: number }>>();
    for (const slot of selected) {
        const start = minutes(slot.inicio), end = minutes(slot.termino);
        if (start === null || end === null || end <= start) continue;
        intervals.set(slot.data, [...(intervals.get(slot.data) ?? []), { start, end }]);
    }
    for (const items of intervals.values()) items.sort((a, b) => a.start - b.start);
    return selected.flatMap(slot => {
        const start = minutes(slot.inicio);
        if (start === null || start + durationMinutes > 24 * 60) return [];
        const end = start + durationMinutes;
        let covered = start;
        for (const interval of intervals.get(slot.data) ?? []) {
            if (interval.start > covered) break;
            covered = Math.max(covered, interval.end);
            if (covered >= end) break;
        }
        if (covered < end) return [];
        const termino = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
        return [{ data: slot.data, inicio: slot.inicio, termino }];
    });
}
