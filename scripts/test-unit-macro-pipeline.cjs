const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
let rows, tools, active, peak, batches, calls, badEvidence, partial;
const unit = { id: "u1", name: "Bauru", city: "Bauru", state: "SP", active: true };
const summary = { id: "a1", conversation_id: "c1", client_id: "p1",
  started_at: "2026-09-10T12:00:00Z", dropoff_likely_reason: "Horário incompatível",
  clients: { unit_id: "u1", name: "Exemplo" } };
function reset() {
  rows = []; tools = []; active = 0; peak = 0; batches = 0; calls = 0;
  badEvidence = false; partial = false;
}
function query(table) {
  let filters = [], operation = "read", values, one = false;
  const chain = new Proxy({}, { get(_, key) {
    if (key === "then") return (resolve, reject) => Promise.resolve().then(() => {
      let result;
      if (table === "units") result = [unit];
      else if (table === "conversation_analysis") result = [summary];
      else {
        const matches = rows.filter(row => filters.every(([k, v]) => row[k] === v));
        if (operation === "insert") {
          if (rows.some(row => row.unit_id === values.unit_id && row.period_start === values.period_start && row.analysis_type === values.analysis_type))
            return { data: null, error: { code: "23505", message: "duplicate" } };
          rows.push({ ...values, created_at: new Date().toISOString() });
          result = [rows.at(-1)];
        } else if (operation === "update") {
          matches.forEach(row => Object.assign(row, values)); result = matches;
        } else result = matches;
      }
      return { data: one ? result[0] ?? null : result, error: null };
    }).then(resolve, reject);
    return (...args) => {
      if (key === "eq") filters.push(args);
      if (key === "insert" || key === "update") { operation = key; values = args[0]; }
      if (key === "single" || key === "maybeSingle") one = true;
      return chain;
    };
  }});
  return chain;
}
function response() {
  return { status: partial ? "incomplete" : "completed", usage: {
    input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 200 },
  }, output: [{ content: [{ type: "output_text", text: JSON.stringify({
    report: "Resumo agregado.", evidence: [{ conversation: badEvidence ? "other" : "c1", evidence: "a1", quote: "Horário incompatível" }],
  }) }] }] };
}
const openai = {
  responses: { create: async (_, options) => { assert.equal(options.maxRetries, 0); calls++; return response(); } },
  files: {
    uploadBatch: async content => { const item = JSON.parse(content); assert.equal(item.body.tools, undefined); return { id: "file1" }; },
    content: async () => ({ text: async () => JSON.stringify({ custom_id: rows[0].id, response: { status_code: 200, body: response() } }) }),
  },
  batches: {
    create: async () => { batches++; return { id: "batch1" }; },
    retrieve: async () => ({ status: "completed", output_file_id: "out1" }),
  },
};
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const text = fs.readFileSync(filename, "utf8");
  const built = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, reportDiagnostics: true });
  assert.equal(built.diagnostics.length, 0);
  const exports = {};
  vm.runInNewContext(built.outputText, {
    exports, require: name => name in mocks ? mocks[name] : require(name),
    console, performance, Date, Intl, Buffer,
  }, { filename });
  return exports;
}
const periods = load("lib/units/macroPeriods.ts");
const evidence = load("lib/units/macroEvidence.ts");
const pipeline = load("lib/units/macroAnalysis.ts", {
  "@/lib": { supabase: { from: query } },
  "@/lib/ai/openai": { openai },
  "@/lib/ai/assistantHubKnowledge": { ASSISTANT_HUB_KNOWLEDGE_BASE: "" },
  "@/lib/units/macroPeriods": periods,
  "@/lib/units/macroEvidence": evidence,
  "@/lib/ai/executeAssistantTool": { executeAssistantTool: async name => {
    tools.push(name); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return { output: { ok: true, coverage: { total_conversations: 20, analyzed_conversations: 18 } } };
  } },
});
(async () => {
  reset();
  const input = { unit: "Bauru", type: "weekly", periodEnd: "2026-09-13" };
  const direct = await pipeline.testUnitAnalysis(input);
  assert.equal(direct.persisted, false);
  assert.equal(rows.length, 0);
  assert.equal(batches, 0);
  assert.equal(calls, 1);
  assert.equal(peak, 1);
  assert.equal(tools.join(","), "get_schedule_overview,get_conversation_analysis_overview,get_financial_overview");
  assert.ok(Math.abs(direct.usage.estimated_cost_usd - 0.000284) < 1e-12);
  assert.equal(direct.cards[0].data.messages, undefined);
  assert.ok(direct.report.includes("Horário incompatível"));
  await assert.rejects(pipeline.testUnitAnalysis({ ...input, unit: "" }));
  badEvidence = true;
  await assert.rejects(pipeline.testUnitAnalysis(input), /evidência/);
  badEvidence = false; partial = true;
  await assert.rejects(pipeline.testUnitAnalysis(input), /não concluída/);
  reset();
  const submitted = await pipeline.submitUnitAnalysis(input);
  assert.equal(rows.length, 1); assert.equal(batches, 1);
  const before = tools.length;
  const reused = await pipeline.submitUnitAnalysis(input);
  assert.equal(reused.reused, true);
  assert.equal(tools.length, before); assert.equal(batches, 1);
  const collected = await pipeline.collectUnitAnalysis(input);
  assert.equal(collected.status, "completed");
  assert.equal(tools.length, before);
  assert.ok(Math.abs(collected.usage.estimated_cost_usd - 0.000142) < 1e-12);
  assert.equal(rows[0].id, submitted.id);
  reset();
  await pipeline.submitUnitAnalysis(input);
  badEvidence = true;
  await assert.rejects(pipeline.collectUnitAnalysis(input), /evidência/);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].report, undefined);
  console.log("PASS: sequential tools, direct test without persistence/Batch, evidence ownership, incomplete output rejection, cost/cache math, duplicate submission and collection without re-preparation.");
})().catch(error => { console.error(error); process.exitCode = 1; });
