import { after, NextResponse } from "next/server";
import { supabase } from "@/lib";
import { getUnitMacroAccess } from "@/lib/units/macroAccess";
import {
  enqueueUnitAnalyses,
  processUnitAnalysis,
} from "@/lib/units/macroAnalysis";
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
    const includeDetails = id || params.get("include_details") === "true";
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
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  if (!access.permission.allowed_tabs.includes("assistente"))
    return NextResponse.json(
      { ok: false, error: "Acesso ao Assistente necessário." },
      { status: 403 },
    );
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return NextResponse.json(
      { ok: false, error: "Origem inválida." },
      { status: 403 },
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "JSON inválido." },
      { status: 400 },
    );
  }
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !body ||
    (body.type !== "weekly" && body.type !== "monthly") ||
    (body.unit_id && !uuid.test(body.unit_id)) ||
    (body.analysis_id && !uuid.test(body.analysis_id)) ||
    (body.period_end && typeof body.period_end !== "string")
  )
    return NextResponse.json(
      { ok: false, error: "Parâmetros inválidos." },
      { status: 400 },
    );
  if (!process.env.OPENAI_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json(
      { ok: false, error: "Configuração da análise indisponível." },
      { status: 503 },
    );
  const unitId = access.permission.unit_lock?.id ?? body.unit_id;
  try {
    if (body.analysis_id) {
      let query = supabase
        .from("unit_macro_analyses")
        .select("id, status")
        .eq("id", body.analysis_id);
      if (unitId) query = query.eq("unit_id", unitId);
      const { data: row, error } = await query.maybeSingle();
      if (error) throw error;
      if (!row)
        return NextResponse.json(
          { ok: false, error: "Análise não encontrada." },
          { status: 404 },
        );
      if (row.status === "failed") {
        const { error: retryError } = await supabase
          .from("unit_macro_analyses")
          .update({
            status: "pending",
            attempt_count: 0,
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .eq("status", "failed");
        if (retryError) throw retryError;
      }
    }
    const analyses = body.analysis_id
      ? [{ id: body.analysis_id }]
      : await enqueueUnitAnalyses(body.type, unitId, body.period_end);
    after(async () => {
      try {
        await processUnitAnalysis(body.analysis_id, unitId);
      } catch (error) {
        console.error("[unit-analyses] manual processing failed", error);
      }
    });
    return NextResponse.json({ ok: true, analyses }, { status: 202 });
  } catch (error) {
    console.error("[unit-analyses] trigger failed", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível iniciar a análise.",
      },
      { status: 500 },
    );
  }
}
