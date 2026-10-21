// app/api/dashboard/jornada/patients/route.ts
import { NextResponse } from "next/server";
import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { executiveRpcParams, readDashboardFilters, resolveDashboardDateRange } from "@/lib/dashboard/metrics";
import { getMatureJourneyRange } from "@/lib/funnel/fullJourney";
import { supabase } from "@/lib/supabase/client";

export async function GET(request: Request) {
    try {
        const { user } = await getCurrentAttendantFromRequest();
        if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const group = searchParams.get("group") ?? "paid";
        const stage = searchParams.get("stage") ?? "";
        const page = Number(searchParams.get("page") ?? 1);
        const procedureKey = searchParams.get("procedure_key");
        const eventKind = searchParams.get("event_kind");
        if (!["paid", "untracked_whatsapp", "organic"].includes(group) ||
            !["tracked_whatsapp", "scheduled", "attended", "procedure_scheduled", "procedure_attended", "authorized", "instagram_chat"].includes(stage) ||
            !Number.isSafeInteger(page) || page < 1 || page > 1_000_000 ||
            (eventKind !== null && !["evaluation", "procedure"].includes(eventKind)) ||
            (procedureKey !== null && (!["evaluation", "procedure"].includes(eventKind ?? "") ||
                !["scheduled", "attended", "procedure_scheduled", "procedure_attended"].includes(stage)))) {
            return NextResponse.json({ error: "Filtros inválidos." }, { status: 400 });
        }
        const range = resolveDashboardDateRange(searchParams.has("start_date")
            ? searchParams : new URLSearchParams(getMatureJourneyRange()));
        const { data, error } = await supabase.rpc("dashboard_journey_patients_v1", {
            ...executiveRpcParams(range, readDashboardFilters(searchParams)),
            p_group: group, p_stage: stage, p_page: page,
            p_procedure_key: procedureKey, p_event_kind: eventKind,
        }).abortSignal(request.signal);
        if (error) throw error;
        return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        if (request.signal.aborted) return new NextResponse(null, { status: 499 });
        console.error("[jornada/patients] failed", error);
        return NextResponse.json({ error: "Não foi possível carregar os pacientes." }, { status: 500 });
    }
}
