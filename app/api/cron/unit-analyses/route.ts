import { after, NextResponse } from "next/server";
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
    const requestedType = new URL(request.url).searchParams.get("type");
    if (
      requestedType &&
      requestedType !== "weekly" &&
      requestedType !== "monthly"
    )
      return NextResponse.json(
        { ok: false, error: "Tipo de análise inválido." },
        { status: 400 },
      );
    const types: UnitAnalysisType[] =
      requestedType === "weekly" || requestedType === "monthly"
        ? [requestedType]
        : dueAnalysisTypes();
    const queued = [];
    for (const type of types)
      queued.push(...(await enqueueUnitAnalyses(type)));
    after(async () => {
      try {
        await processUnitAnalysisQueue();
      } catch (error) {
        console.error("[unit-analyses] cron processing failed", error);
      }
    });
    return NextResponse.json(
      { ok: true, queued: queued.length, analyses: queued },
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
