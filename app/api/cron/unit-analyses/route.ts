import { NextResponse } from "next/server";
import { supabase } from "@/lib";
import { collectUnitAnalysis, submitUnitAnalysis } from "@/lib/units/macroAnalysis";
import { brazilDate } from "@/lib/units/macroPeriods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type AnalysisType = "weekly" | "monthly";
type Action = "submit" | "collect";

type CronTarget = {
  unit: string;
  unit_name: string;
  period_end?: string;
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const action = params.get("action");
  const unit = params.get("unit")?.trim() || null;
  const type = params.get("type");
  const requestedPeriodEnd = params.get("period_end")?.trim() || null;
  if (!["submit", "collect"].includes(action ?? "") ||
      (type !== "weekly" && type !== "monthly"))
    return NextResponse.json({ ok: false, error: "Informe type=weekly|monthly e action=submit|collect. unit e period_end são opcionais." }, { status: 400 });
  try {
    if (unit) {
      const periodEnd = requestedPeriodEnd ?? brazilDate();
      const result = await runOne(action as Action, {
        unit,
        unit_name: unit,
        period_end: periodEnd,
      }, type);
      return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
    }

    const targets = action === "submit"
      ? await activeUnitTargets(requestedPeriodEnd ?? brazilDate())
      : await processingBatchTargets(type, requestedPeriodEnd);
    const results = [];
    for (const target of targets) {
      try {
        results.push({
          unit: target.unit_name,
          ok: true,
          result: await runOne(action as Action, target, type),
        });
      } catch (error) {
        results.push({
          unit: target.unit_name,
          ok: false,
          error: error instanceof Error ? error.message : "Falha na análise.",
        });
      }
    }
    const failed = results.filter((result) => !result.ok).length;
    return NextResponse.json({
      ok: failed === 0,
      action,
      type,
      period_end: action === "submit" ? targets[0]?.period_end ?? requestedPeriodEnd ?? brazilDate() : requestedPeriodEnd,
      total: results.length,
      succeeded: results.length - failed,
      failed,
      results,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[unit-analyses]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Falha na análise." }, { status: 500 });
  }
}

async function runOne(action: Action, target: CronTarget, type: AnalysisType) {
  const input = { unit: target.unit, type, periodEnd: target.period_end };
  return action === "submit"
    ? submitUnitAnalysis(input)
    : collectUnitAnalysis(input);
}

async function activeUnitTargets(periodEnd: string): Promise<CronTarget[]> {
  const { data, error } = await supabase
    .from("units")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((unit) => ({
    unit: unit.id,
    unit_name: unit.name,
    period_end: periodEnd,
  }));
}

async function processingBatchTargets(type: AnalysisType, periodEnd: string | null): Promise<CronTarget[]> {
  let query = supabase
    .from("unit_macro_analyses")
    .select("unit_id, period_end, units!inner(name)")
    .eq("analysis_type", type)
    .eq("status", "processing")
    .contains("context", { mode: "batch" })
    .order("period_end", { ascending: true });
  if (periodEnd) query = query.eq("period_end", periodEnd);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    unit: row.unit_id,
    unit_name: (Array.isArray(row.units) ? row.units[0] : row.units)?.name ?? row.unit_id,
    period_end: row.period_end,
  }));
}
