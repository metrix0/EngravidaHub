import { NextResponse } from "next/server";
import { supabase } from "@/lib";
import { getUnitMacroAccess } from "@/lib/units/macroAccess";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const access = await getUnitMacroAccess();
  if (access.ok === false)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  const params = new URL(request.url).searchParams;
  const lock = access.permission.unit_lock?.id;
  const unitId = lock ?? params.get("unit_id");
  try {
    let unitsQuery = supabase
      .from("units")
      .select("id, name, city, state, active")
      .order("name");
    if (lock) unitsQuery = unitsQuery.eq("id", lock);
    const { data: units, error: unitsError } = await unitsQuery;
    if (unitsError) throw unitsError;
    const id = params.get("analysis_id");
    const includeDetails = Boolean(id) || params.get("include_details") === "true";
    let query = supabase
      .from("unit_macro_analyses")
      .select(
        includeDetails
          ? "id, unit_id, analysis_type, period_start, period_end, status, report, cards, metrics, completed_at, created_at"
          : "id, unit_id, analysis_type, period_start, period_end, status, completed_at, created_at",
        { count: "exact" },
      )
      .order("period_end", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id");
    if (unitId) query = query.eq("unit_id", unitId);
    if (id) query = query.eq("id", id);
    const offset = Math.max(
      0,
      Number.parseInt(params.get("offset") ?? "0", 10) || 0,
    );
    const {
      data: analyses,
      error,
      count,
    } = await query.range(offset, offset + (id ? 0 : 49));
    if (error) throw error;
    return NextResponse.json(
      {
        ok: true,
        units,
        analyses,
        total: count,
        next_offset: !id && offset + 50 < (count ?? 0) ? offset + 50 : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[unit-analyses] read failed", error);
    return NextResponse.json(
      { ok: false, error: "Não foi possível carregar as análises." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const access = await getUnitMacroAccess();
  if (access.ok === false)
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin)
    return NextResponse.json({ ok: false, error: "Origem inválida." }, { status: 403 });
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido." }, { status: 400 });
  }
  if (body?.mode !== "test" || typeof body.unit !== "string" || !body.unit.trim() ||
      (body.type !== "weekly" && body.type !== "monthly") ||
      (body.period_end !== undefined && typeof body.period_end !== "string"))
    return NextResponse.json({ ok: false, error: "Informe mode=test, unit, type=weekly|monthly e period_end opcional." }, { status: 400 });
  try {
    const { testUnitAnalysis } = await import("@/lib/units/macroAnalysis");
    return NextResponse.json(await testUnitAnalysis({ unit: body.unit, type: body.type, periodEnd: body.period_end }),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[unit-analyses] test failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Falha no teste." }, { status: 500 });
  }
}
