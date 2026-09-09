import { NextResponse } from "next/server";
import {
  enqueueUnitAnalyses,
  processUnitAnalysis,
} from "@/lib/units/macroAnalysis";
import { dueAnalysisTypes } from "@/lib/units/macroPeriods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    for (const type of dueAnalysisTypes()) await enqueueUnitAnalyses(type);
    return NextResponse.json({ ok: true, ...(await processUnitAnalysis()) });
  } catch (error) {
    console.error("[unit-analyses] cron failed", error);
    return NextResponse.json(
      { ok: false, error: "Analysis processing failed" },
      { status: 500 },
    );
  }
}
