import { NextResponse } from "next/server";
import { collectUnitAnalysis, submitUnitAnalysis } from "@/lib/units/macroAnalysis";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "Configure CRON_SECRET para habilitar este endpoint." }, { status: 503 });
  if (request.headers.get("authorization") !== "Bearer " + secret)
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const action = params.get("action");
  const unit = params.get("unit")?.trim();
  const type = params.get("type");
  if (!unit || !["submit", "collect"].includes(action ?? "") || (type !== "weekly" && type !== "monthly"))
    return NextResponse.json({ ok: false, error: "Informe unit, type=weekly|monthly e action=submit|collect." }, { status: 400 });
  try {
    const input = { unit, type, periodEnd: params.get("period_end") ?? undefined } as const;
    const result = action === "submit" ? await submitUnitAnalysis(input) : await collectUnitAnalysis(input);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[unit-analyses]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Falha na análise." }, { status: 500 });
  }
}
