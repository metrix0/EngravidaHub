// app/api/performance/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { buildPerformanceReport, type PerformanceReport, type PerformanceSource } from "@/lib/performance/report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Avoid rerunning the same expensive report when components remount or permissions refresh.
const REPORT_CACHE_MS = 60_000;
const reportCache = new Map<string, { report: PerformanceReport; expiresAt: number }>();
const pendingReports = new Map<string, Promise<PerformanceReport>>();

async function fetchPerformanceReport(start: string, end: string, unitId: string | null) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data, error } = await supabase.rpc("performance_attendant_report_v1", {
            p_start: start, p_end: end, p_unit_id: unitId,
        });
        if (error) {
            // Supabase can occasionally cancel a report during concurrent load.
            if (error.code === "57014" && attempt === 0) continue;
            throw error;
        }
        if (!data || !Array.isArray(data.people) || !Array.isArray(data.bookings)) {
            throw new Error("Relatório incompleto");
        }
        return buildPerformanceReport(data as PerformanceSource, start, end);
    }
    throw new Error("Não foi possível obter o relatório.");
}

function getPerformanceReport(start: string, end: string, unitId: string | null) {
    const key = [start, end, unitId ?? ""].join(":");
    const cached = reportCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.report);

    const pending = pendingReports.get(key);
    if (pending) return pending;

    const request = fetchPerformanceReport(start, end, unitId)
        .then((report) => {
            reportCache.set(key, { report, expiresAt: Date.now() + REPORT_CACHE_MS });
            // Keep the cache bounded across custom date ranges.
            if (reportCache.size > 20) reportCache.delete(reportCache.keys().next().value!);
            return report;
        })
        .finally(() => pendingReports.delete(key));
    pendingReports.set(key, request);
    return request;
}
const querySchema = z.object({
    start: z.iso.date(), end: z.iso.date(), unit_id: z.string().uuid().optional(),
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
    const filters = querySchema.safeParse({ start: params.get("start"), end: params.get("end"), unit_id: params.get("unit_id") || undefined });
    if (!filters.success) return NextResponse.json({ error: "Período inválido." }, { status: 400 });
    try {
        const report = await getPerformanceReport(filters.data.start, filters.data.end, filters.data.unit_id ?? null);
        return NextResponse.json({ report }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        console.error("[performance] failed to load", error);
        return NextResponse.json({ error: "Não foi possível carregar a performance dos atendentes." }, { status: 500 });
    }
}
