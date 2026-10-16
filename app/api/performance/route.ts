// app/api/performance/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { buildPerformanceReport, type PerformanceSource } from "@/lib/performance/report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const querySchema = z.object({
    start: z.iso.date(), end: z.iso.date(),
}).refine(data => data.start <= data.end &&
    Date.parse(data.end) - Date.parse(data.start) <= 366 * 86_400_000,
{ message: "Selecione um período de até 12 meses." });

export async function GET(request: Request) {
    const access = await getServerTabAccess("performance");
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    // Historical conversations do not consistently contain unit_id: a
    // unit-restricted account must not receive cross-unit employee metrics.
    if (access.permission.unit_lock) {
        return NextResponse.json({ error: "Esta visão está disponível apenas para perfis sem restrição de unidade." }, { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    const filters = querySchema.safeParse({ start: params.get("start"), end: params.get("end") });
    if (!filters.success) return NextResponse.json({ error: "Período inválido." }, { status: 400 });
    try {
        const { data, error } = await supabase.rpc("performance_attendant_report_v1", {
            p_start: filters.data.start, p_end: filters.data.end,
        });
        if (error) throw error;
        if (!data || !Array.isArray(data.people) || !Array.isArray(data.bookings)) throw new Error("Relatório incompleto");
        const report = buildPerformanceReport(data as PerformanceSource, filters.data.start, filters.data.end);
        return NextResponse.json({ report }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        console.error("[performance] failed to load", error);
        return NextResponse.json({ error: "Não foi possível carregar a performance dos atendentes." }, { status: 500 });
    }
}
