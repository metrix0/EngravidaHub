import { parseArgs } from "node:util";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      unit: { type: "string" }, type: { type: "string", default: "weekly" },
      "period-end": { type: "string" }, help: { type: "boolean" },
      "retry-failed": { type: "boolean" },
    },
  });
  if (values.help) {
    console.log("node --env-file=.env.local --import tsx scripts/run-unit-analysis.ts test|submit|collect --unit Bauru --type weekly --period-end 2026-09-13");
    console.log("test: resultado imediato, salvo no Supabase e visível em /unidades. submit/collect: uma unidade e um período por execução. period-end é exclusivo.");
    console.log("submit --retry-failed: reenvia somente uma análise com falha anterior à criação do arquivo/lote.");
    return;
  }
  const action = positionals[0] ?? "test";
  if (positionals.length > 1 || !["test", "submit", "collect"].includes(action) ||
      !values.unit || !["weekly", "monthly"].includes(values.type))
    throw new Error("Use --help para os parâmetros. Uma unidade exata é obrigatória.");
  if (values["retry-failed"] && action !== "submit")
    throw new Error("--retry-failed é permitido apenas com submit.");
  for (const key of ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
    if (!process.env[key]) throw new Error("Configuração ausente: " + key);
  const { testUnitAnalysis, submitUnitAnalysis, collectUnitAnalysis } = await import("../lib/units/macroAnalysis");
  const run = action === "test" ? testUnitAnalysis : action === "submit" ? submitUnitAnalysis : collectUnitAnalysis;
  const input = {
    unit: values.unit, type: values.type as "weekly" | "monthly",
    periodEnd: values["period-end"],
  };
  const result = action === "submit"
    ? await submitUnitAnalysis(input, values["retry-failed"] === true)
    : await run(input);
  if (action === "test" &&
      (!result || typeof result !== "object" || !("persisted" in result) || result.persisted !== true))
    throw new Error("A análise foi concluída, mas o salvamento no Supabase não foi confirmado.");
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
