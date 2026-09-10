import { after, NextResponse } from "next/server";
import { supabase } from "@/lib";
import {
  enqueueUnitAnalyses,
  processUnitAnalysisQueue,
} from "@/lib/units/macroAnalysis";
import { dueAnalysisTypes } from "@/lib/units/macroPeriods";
import type { UnitAnalysisType } from "@/types/unit-macro-analysis";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const requestedType = params.get("type");
    const requestedUnit = params.get("unit")?.trim() ?? "";
    if (
      requestedType &&
      requestedType !== "weekly" &&
      requestedType !== "monthly"
    )
      return NextResponse.json(
        { ok: false, error: "Tipo de análise inválido." },
        { status: 400 },
      );
    let unitId: string | undefined;
    if (requestedUnit) {
      const pattern = "%" + requestedUnit.replace(/[%_]/g, "\\$&") + "%";
      const { data: matches, error: unitError } = await supabase
        .from("units")
        .select("id, name, city")
        .eq("active", true)
        .or("name.ilike." + pattern + ",city.ilike." + pattern)
        .limit(2);
      if (unitError) throw unitError;
      if (!matches?.length)
        return NextResponse.json(
          { ok: false, error: "Unidade não encontrada." },
          { status: 404 },
        );
      if (matches.length > 1)
        return NextResponse.json(
          { ok: false, error: "Informe uma unidade mais específica." },
          { status: 400 },
        );
      unitId = matches[0].id;
    }
    const types: UnitAnalysisType[] =
      requestedType === "weekly" || requestedType === "monthly"
        ? [requestedType]
        : dueAnalysisTypes();
    const queued = [];
    for (const type of types)
      queued.push(...(await enqueueUnitAnalyses(type, unitId)));
    after(async () => {
      try {
        await processUnitAnalysisQueue(unitId);
      } catch (error) {
        console.error("[unit-analyses] cron processing failed", error);
      }
    });
    return NextResponse.json(
      {
        ok: true,
        unit: requestedUnit || null,
        queued: queued.length,
        analyses: queued,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("[unit-analyses] cron failed", error);
    return NextResponse.json(
      { ok: false, error: "Analysis processing failed" },
      { status: 500 },
    );
  }
}
