// lib/scheduling/dayNoteBlockAccess.ts
import { NextResponse } from "next/server";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { supabase } from "@/lib/supabase/client";
import { validateDoctorForUnit } from "./appointmentServer";

export async function checkDayNoteBlockAccess(
    unitId: string | null,
    doctorId: string | null,
    enableBlock: boolean,
) {
    const access = await getServerTabAccess("agendamentos");
    if (access.ok === false) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    if (access.permission.unit_lock && access.permission.unit_lock.id !== unitId) {
        return NextResponse.json({ ok: false, error: "Sem acesso à agenda desta unidade." }, { status: 403 });
    }
    if (enableBlock && (!unitId || !doctorId || !(await validateDoctorForUnit(supabase, doctorId, unitId)))) {
        return NextResponse.json({ ok: false, error: "Selecione uma unidade e um médico dessa unidade." }, { status: 400 });
    }
    return null;
}
