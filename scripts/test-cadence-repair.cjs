const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks, extras = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, require: (name) => name in mocks ? mocks[name] : require(name),
    console, Date, Intl, URL, performance, ...extras,
  }, { filename: file });
  return exports;
}
const next = { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
const history = load('lib/active-messages/history.ts', {});
let now, rows, sent, dbReads;
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return new Date(now).getTime(); }
}
function cadenceQuery(table) {
  assert.equal(table, 'active_message_cadences');
  let conditions = [], patch, single = false;
  const query = new Proxy({}, { get(_, key) {
    if (key === 'then') return (resolve, reject) => Promise.resolve().then(() => {
      dbReads++;
      const matched = rows.filter((row) => conditions.every((test) => test(row)));
      if (patch) matched.forEach((row) => Object.assign(row, patch));
      const snapshots = matched.map((row) => ({ ...row }));
      return { data: single ? snapshots[0] ?? null : snapshots, error: null };
    }).then(resolve, reject);
    return (...args) => {
      if (key === 'eq' || key === 'is') conditions.push((row) => row[args[0]] === args[1]);
      if (key === 'in') conditions.push((row) => args[1].includes(row[args[0]]));
      if (key === 'update') patch = args[0];
      if (key === 'maybeSingle') single = true;
      return query;
    };
  }});
  return query;
}
const cadence = load('app/api/(cron)/mensagem-ativa-cadence/route.ts', {
  'next/server': next,
  '@/lib/supabase/client': { supabase: { from: cadenceQuery } },
  '@/lib/active-messages/templates': { getActiveMessageTemplate: () => ({ id: 'template' }) },
  '@/lib/active-messages/templateSenders': {
    DEFAULT_ACTIVE_MESSAGE_TEMPLATE_SENDER: 'secondary', parseActiveMessageTemplateSender: (v) => v,
  },
  '@/lib/active-messages/sendActiveMessageBatch': {
    ActiveMessageBatchError: class extends Error {},
    sendActiveMessageBatch: async (input) => {
      sent.push(input);
      return { batch_id: 'real-batch', sent_count: input.clientIds.length, failed_count: 0 };
    },
  },
}, { Date: Clock });
function reset(count = 1000) {
  now = '2026-10-06T14:00:00Z'; sent = []; dbReads = 0;
  rows = [{ id: 'cadence', template_id: 'template', client_ids: Array.from({ length: count }, (_, i) => `client-${i}`),
    filters: {}, template_sender: 'secondary', messages_per_day: 200, next_index: 0, sent_count: 0,
    failed_count: 0, status: 'scheduled', last_slot_key: null, started_at: null }];
}
async function checkHistory(file) {
  const seenMetrics = [];
  const fake = { id: history.SYNTHETIC_ACTIVE_MESSAGE_SEND_ID, sent_count: 200, client_ids: [], results: [] };
  const real = { id: 'real', sent_count: 50, requested_count: 50, client_ids: ['real-client'], results: [],
    created_at: '2026-10-06T14:00:00Z', template_id: 'template', template_name: 'Real', filters: {} };
  const supabase = {
    from: (table) => {
      let excluded;
      const query = new Proxy({}, { get(_, key) {
        if (key === 'then') return (resolve) => {
          if (table === 'active_message_sends') assert.equal(excluded, fake.id);
          resolve({ data: table === 'active_message_sends' ? [fake, real].filter((row) => row.id !== excluded) : [], error: null });
        };
        return (...args) => { if (key === 'neq' && args[0] === 'id') excluded = args[1]; return query; };
      }});
      return query;
    },
    rpc: async (name, args) => {
      seenMetrics.push(...args.p_send_ids);
      return { data: [], error: null };
    },
  };
  const route = load(file, {
    'next/server': next, '@/lib/supabase/client': { supabase },
    '@/lib/active-messages/history': history,
    '@/lib/active-messages/access': { requireActiveMessageAccess: async () => ({ ok: true }) },
    '@/lib/active-messages/templates': { ACTIVE_MESSAGE_TEMPLATES: [] },
    '@/lib/active-messages/templateSenders': { getActiveMessageTemplateSenderOptions: () => [] },
  });
  const result = await route.GET(new Request('http://localhost/api?start_date=2026-10-01&end_date=2026-10-06'));
  assert.equal(result.status, 200);
  assert.deepEqual(Array.from(result.body.history, (row) => row.id), ['real']);
  assert.ok(seenMetrics.includes('real'));
  assert.ok(!seenMetrics.includes(fake.id));
}
async function checkNewerPromptGuard() {
  const row = { id: 'analysis', status: 'processing', prompt_version: 'unit-macro-v10-future' };
  const unitRows = [{ id: 'unit', name: 'Bauru', active: true }];
  function analysisQuery(table) {
    const chain = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve) => resolve({ data: table === 'units' ? unitRows : row, error: null });
      if (key === 'update' || key === 'insert') throw new Error('Must not mutate a newer analysis');
      return () => chain;
    }});
    return chain;
  }
  const periods = load('lib/units/macroPeriods.ts', {});
  const pipeline = load('lib/units/macroAnalysis.ts', {
    '@/lib': { supabase: { from: analysisQuery } },
    '@/lib/analysis/patternSignals': {}, '@/lib/units/patternAggregates': {},
    '@/lib/ai/openai': { openai: {} }, '@/lib/ai/executeAssistantTool': {},
    '@/lib/ai/assistantHubKnowledge': {}, '@/lib/units/macroEvidence': {},
    '@/lib/units/macroPeriods': periods,
  });
  assert.equal(
    pipeline.formatAnalysisError({ code: 'PGRST123', message: 'Falha no banco', details: 'detalhes', hint: 'tente novamente' }),
    'Falha no banco | code=PGRST123 | detalhes | hint=tente novamente',
  );
  const enrichedError = Object.assign(new Error('Falha no banco'), {
    code: 'PGRST123',
    details: 'detalhes',
    hint: 'tente novamente',
    status: 503,
  });
  assert.equal(
    pipeline.formatAnalysisError(enrichedError),
    'Falha no banco | code=PGRST123 | detalhes | hint=tente novamente | status=503',
  );
  const circularError = {};
  circularError.self = circularError;
  assert.notEqual(pipeline.formatAnalysisError(circularError), '[object Object]');
  assert.notEqual(pipeline.formatAnalysisError({ code: 'PGRST123' }), '[object Object]');
  const result = await pipeline.collectUnitAnalysis({ unit: 'unit', type: 'weekly', periodEnd: '2026-10-04' });
  assert.equal(result.reason, 'newer_prompt_version');
  assert.equal(result.status, 'processing');
  assert.equal(row.status, 'processing');
}
(async () => {
  const cron = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).crons
    .find((job) => job.path.includes('mensagem-ativa-cadence'));
  const route = '/api/(cron)/mensagem-ativa-cadence'.split('/').filter((part) => !/^\(.+\)$/.test(part)).join('/');
  assert.equal(cron.path, route);
  assert.equal(cron.schedule, '0 14-17 * * *');
  reset();
  for (const hour of [14, 15, 16, 17]) {
    now = `2026-10-06T${hour}:00:00Z`;
    assert.equal((await cadence.GET()).body.results[0].sent_count, 50);
    assert.equal((await cadence.GET()).body.results[0].reason, 'already_processed');
  }
  assert.equal(sent.length, 4);
  assert.equal(rows[0].sent_count, 200);
  assert.equal(new Set(sent.flatMap((batch) => batch.clientIds)).size, 200);
  reset();
  now = '2026-10-06T17:25:00Z';
  await Promise.all([cadence.GET(), cadence.GET()]);
  assert.equal(sent.length, 1, 'concurrent claims must send once');
  assert.equal(sent[0].clientIds.length, 50, 'missed days/slots must not be sent as catch-up');
  reset(23);
  await cadence.GET();
  assert.equal(rows[0].status, 'completed');
  assert.equal(sent[0].clientIds.length, 23);
  reset(); now = '2026-10-06T18:00:00Z';
  assert.equal((await cadence.GET()).body.reason, 'outside_cadence_window');
  assert.equal(dbReads, 0);
  await checkHistory('app/api/mensagem-ativa/route.ts');
  await checkHistory('app/api/mensagem-ativa/analytics/route.ts');
  await checkNewerPromptGuard();
  console.log('PASS: cron route; 200/day without catch-up or duplicate slots; short final batch; synthetic send excluded from history and metrics; older collectors cannot downgrade newer analyses.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
