import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib";
import { getUnitMacroAccess } from "@/lib/units/macroAccess";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await getUnitMacroAccess();
  if (access.ok === false)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  if (!access.permission.allowed_tabs.includes("dashboard"))
    return NextResponse.json(
      { ok: false, error: "Acesso às unidades necessário." },
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
  if (typeof body?.analysis_id !== "string")
    return NextResponse.json(
      { ok: false, error: "Análise inválida." },
      { status: 400 },
    );
  let query = supabase
    .from("unit_macro_analyses")
    .select(
      "id, unit_id, report, cards, metrics, period_start, period_end, units(name)",
    )
    .eq("id", body.analysis_id)
    .eq("status", "completed");
  if (access.permission.unit_lock)
    query = query.eq("unit_id", access.permission.unit_lock.id);
  const { data: analysis, error } = await query.maybeSingle();
  if (error)
    return NextResponse.json(
      { ok: false, error: "Não foi possível carregar a análise." },
      { status: 500 },
    );
  if (!analysis)
    return NextResponse.json(
      { ok: false, error: "Análise não encontrada." },
      { status: 404 },
    );
  const unit = (
    Array.isArray(analysis.units) ? analysis.units[0] : analysis.units
  ) as { name: string };
  const id = randomUUID();
  const now = new Date();
  const title = `Análise de ${unit.name}`;
  const { error: sessionError } = await supabase
    .from("assistant_chat_sessions")
    .insert({
      id,
      auth_user_id: access.user.id,
      title,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
  if (sessionError)
    return NextResponse.json(
      { ok: false, error: "Não foi possível criar a conversa." },
      { status: 500 },
    );
  const { error: messageError } = await supabase
    .from("assistant_chat_messages")
    .insert([
      {
        id: randomUUID(),
        session_id: id,
        role: "user",
        content: `Vamos aprofundar a análise de ${unit.name}, de ${analysis.period_start} até ${analysis.period_end} (fim exclusivo). Considere os agendamentos, faturamento, WhatsApp, Instagram e o histórico semanal e mensal dessa unidade.`,
        cards: [],
        created_at: now.toISOString(),
      },
      {
        id: randomUUID(),
        session_id: id,
        role: "assistant",
        content: analysis.report,
        cards: analysis.cards,
        created_at: new Date(now.getTime() + 1).toISOString(),
      },
      {
        id: randomUUID(),
        session_id: id,
        role: "user",
        content: `Dados verificados que sustentam a análise de ${unit.name}:\n${JSON.stringify(analysis.metrics)}\nUse get_unit_macro_history para consultar as análises históricas completas quando necessário.`,
        cards: [],
        created_at: new Date(now.getTime() + 2).toISOString(),
      },
    ]);
  if (messageError) {
    await supabase
      .from("assistant_chat_sessions")
      .delete()
      .eq("id", id)
      .eq("auth_user_id", access.user.id);
    return NextResponse.json(
      { ok: false, error: "Não foi possível inserir o contexto." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, href: `/assistente?session=${id}` });
}
