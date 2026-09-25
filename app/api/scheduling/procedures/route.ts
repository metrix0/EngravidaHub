import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

type StoredProcedure = {
    id?: unknown;
    name?: unknown;
};

export async function GET(request: Request) {
    try {
        const { user } = await getCurrentAttendantFromRequest();
        if (!user) {
            return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const unitId = searchParams.get("unit_id");
        const doctorId = searchParams.get("doctor_id");
        if (!unitId || !doctorId) {
            return NextResponse.json(
                { ok: false, error: "unit_id and doctor_id are required" },
                { status: 400 },
            );
        }

        const { data, error } = await supabase
            .from("clinisys_agendas")
            .select("procedures")
            .eq("unit_id", unitId)
            .eq("doctor_id", doctorId)
            .eq("active", true)
            .maybeSingle();
        if (error) throw error;

        const procedures = Array.isArray(data?.procedures)
            ? (data.procedures as StoredProcedure[]).flatMap((procedure) => {
                  const id =
                      typeof procedure?.id === "string" ? procedure.id.trim() : "";
                  const name =
                      typeof procedure?.name === "string" ? procedure.name.trim() : "";
                  return id && name ? [{ id, name }] : [];
              })
            : [];

        return NextResponse.json({ ok: true, procedures });
    } catch (error) {
        console.error("[scheduling-procedures] failed", error);
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load Clinisys procedures",
            },
            { status: 500 },
        );
    }
}
