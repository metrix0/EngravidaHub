import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { listClinisysAvailability } from "@/lib/clinisys/client";
import { supabase } from "@/lib/supabase/client";
import { validateDoctorForUnit } from "@/lib/scheduling/appointmentServer";

export async function GET(request: Request) {
    try {
        const { user } = await getCurrentAttendantFromRequest();
        if (!user) {
            return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
        }

        const params = new URL(request.url).searchParams;
        const unitId = params.get("unit_id")?.trim() ?? "";
        const doctorId = params.get("doctor_id")?.trim() ?? "";
        const procedureName = params.get("procedure_name")?.trim() ?? "";
        const date = params.get("date")?.trim() || null;
        if (!unitId || !doctorId || !procedureName) {
            return NextResponse.json({ ok: false, error: "unit_id, doctor_id and procedure_name are required" }, { status: 400 });
        }
        if (!(await validateDoctorForUnit(supabase, doctorId, unitId))) {
            return NextResponse.json({ ok: false, error: "O médico não pertence à unidade selecionada." }, { status: 400 });
        }

        const [{ data: unit, error: unitError }, { data: doctor, error: doctorError }] = await Promise.all([
            supabase.from("units").select("id, name").eq("id", unitId).maybeSingle(),
            supabase.from("doctors").select("id, name").eq("id", doctorId).maybeSingle(),
        ]);
        if (unitError) throw unitError;
        if (doctorError) throw doctorError;
        if (!unit || !doctor) {
            return NextResponse.json({ ok: false, error: "Unidade ou médico não encontrado." }, { status: 404 });
        }

        const slots = await listClinisysAvailability({
            unitId,
            doctorId,
            unitName: unit.name,
            doctorName: doctor.name,
            procedureName,
        });
        const filtered = date
            ? slots.filter((slot) => toIsoDate(slot.data ?? "") === date)
            : slots;

        return NextResponse.json({ ok: true, slots: filtered });
    } catch (error) {
        console.error("[scheduling-availability] failed", error);
        return NextResponse.json({
            ok: false,
            error: error instanceof Error ? error.message : "Falha ao consultar disponibilidade do CliniSYS.",
        }, { status: 502 });
    }
}

function toIsoDate(value: string) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}
