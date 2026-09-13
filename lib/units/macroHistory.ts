import { supabase } from "@/lib";
import type { AssistantToolContext } from "@/lib/ai/assistantToolContext";

export async function getUnitMacroHistory(
  args: Record<string, unknown>,
  context: AssistantToolContext,
) {
  if (context.unitLock)
    return {
      output: {
        ok: false,
        error: "Análises macro incluem dados globais e requerem acesso geral.",
      },
      cards: [],
    };
  const name =
    context.unitLock?.name ??
    (typeof args.unit_name === "string" ? args.unit_name : null);
  if (!name)
    return { output: { ok: false, error: "Informe a unidade." }, cards: [] };
  const { data: unit, error: unitError } = await supabase
    .from("units")
    .select("id, name")
    .eq("name", name)
    .maybeSingle();
  if (unitError) throw unitError;
  if (!unit)
    return {
      output: { ok: false, error: "Unidade não encontrada." },
      cards: [],
    };
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  let query = supabase
    .from("unit_macro_analyses")
    .select(
      "id, analysis_type, period_start, period_end, report, metrics, completed_at",
      { count: "exact" },
    )
    .eq("unit_id", unit.id)
    .eq("status", "completed")
    .order("period_end", { ascending: false })
    .order("id")
    .range(offset, offset + 4);
  if (args.analysis_type === "weekly" || args.analysis_type === "monthly")
    query = query.eq("analysis_type", args.analysis_type);
  const { data, error, count } = await query;
  if (error) throw error;
  return {
    output: {
      ok: true,
      unit: unit.name,
      analyses: data,
      total: count,
      next_offset:
        offset + (data?.length ?? 0) < (count ?? 0) ? offset + 5 : null,
    },
    cards: [],
  };
}
