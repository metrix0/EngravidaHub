import { parseArgs } from "node:util";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      unit: { type: "string" }, type: { type: "string", default: "weekly" },
      "period-end": { type: "string" }, help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log("node --env-file=.env.local --import tsx scripts/run-unit-analysis.ts test|submit|collect --unit Bauru --type weekly --period-end 2026-09-13");
    console.log("test: resultado e custo imediato, sem Batch e sem salvar no histórico. submit/collect: uma unidade e um período por execução. period-end é exclusivo.");
    return;
  }
  const action = positionals[0] ?? "test";
  if (positionals.length > 1 || !["test", "submit", "collect"].includes(action) ||
      !values.unit || !["weekly", "monthly"].includes(values.type))
    throw new Error("Use --help para os parâmetros. Uma unidade exata é obrigatória.");
  for (const key of ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
    if (!process.env[key]) throw new Error("Configuração ausente: " + key);
  const { testUnitAnalysis, submitUnitAnalysis, collectUnitAnalysis } = await import("../lib/units/macroAnalysis");
  const run = action === "test" ? testUnitAnalysis : action === "submit" ? submitUnitAnalysis : collectUnitAnalysis;
  console.log(JSON.stringify(await run({
    unit: values.unit, type: values.type as "weekly" | "monthly",
    periodEnd: values["period-end"],
  }), null, 2));
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
