// app/api/performance/blip/route.ts
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { BlipDeskConfigurationError, loadDeskPerformance } from "@/lib/blip/deskPerformance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const query = z.object({ start: z.iso.date(), end: z.iso.date() }).refine(
    ({ start, end }) => start <= end && Date.parse(end) - Date.parse(start) < 90 * 86_400_000,
);
const getReport = unstable_cache(loadDeskPerformance, ["blip-desk-performance"], { revalidate: 300 });
const pending = new Map<string, ReturnType<typeof getReport>>();

export async function GET(request: Request) {
    const access = await getServerTabAccess("performance");
    if (access.ok === false) return NextResponse.json({ error: access.error }, { status: access.status });
    if (access.permission.unit_lock) {
        return NextResponse.json({ error: "Esta visão está disponível apenas para perfis sem restrição de unidade." }, { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    const selection = query.safeParse({ start: params.get("start"), end: params.get("end") });
    if (!selection.success) {
        return NextResponse.json({ error: "Selecione um período de até 90 dias para o Blip." }, { status: 400 });
    }
    const { start, end } = selection.data;
    const key = start + ":" + end;
    const report = pending.get(key) ?? getReport(start, end).finally(() => pending.delete(key));
    pending.set(key, report);
    try {
        return NextResponse.json({ report: await report }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        if (error instanceof BlipDeskConfigurationError) {
            return NextResponse.json({ error: error.message }, { status: 503 });
        }
        console.error("[performance/blip] Falha ao consultar o histórico", error);
        return NextResponse.json({ error: "Não foi possível consultar o histórico de tickets do Blip." }, { status: 502 });
    }
}
