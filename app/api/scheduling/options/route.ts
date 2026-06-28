// app/api/scheduling/options/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import type { SchedulingDoctorOption } from "@/types/scheduling";

export async function GET() {
    try {
        const { user } = await getCurrentAttendantFromRequest();

        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const [unitsResult, doctorsResult] = await Promise.all([
            supabase
                .from("units")
                .select(
                    "id, name, city, state, street, number, cep, latitude, longitude",
                )
                .eq("active", true)
                .order("name", { ascending: true }),
            supabase
                .from("doctor_units")
                .select(`
                    unit_id,
                    doctor:doctors!inner (
                        id,
                        name,
                        specialty,
                        crm,
                        color,
                        email,
                        phone,
                        active
                    )
                `)
                .eq("active", true)
                .eq("doctor.active", true),
        ]);

        if (unitsResult.error) throw unitsResult.error;
        if (doctorsResult.error) throw doctorsResult.error;

        const doctors = (doctorsResult.data ?? [])
            .flatMap((row) => {
                const doctor = Array.isArray(row.doctor)
                    ? row.doctor[0]
                    : row.doctor;

                if (!doctor) return [];

                return [
                    {
                        unit_id: row.unit_id,
                        id: doctor.id,
                        name: doctor.name,
                        specialty: doctor.specialty,
                        crm: doctor.crm,
                        color: doctor.color,
                        email: doctor.email,
                        phone: doctor.phone,
                    } satisfies SchedulingDoctorOption,
                ];
            })
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

        return NextResponse.json({
            ok: true,
            units: unitsResult.data ?? [],
            doctors,
        });
    } catch (error) {
        console.error("[scheduling-options] failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load scheduling options",
            },
            { status: 500 },
        );
    }
}
