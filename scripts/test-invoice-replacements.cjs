const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

let invoiceRows = [];
const exportsObject = {};
const source = ts.transpileModule(
  fs.readFileSync(path.resolve(__dirname, '../lib/invoices/getBigqueryInvoices.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
vm.runInNewContext(source, {
  exports: exportsObject,
  require: (name) => {
    assert.equal(name, '@google-cloud/bigquery');
    return { BigQuery: class {
      async query() { return [invoiceRows]; }
    } };
  },
  process: { env: { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'test-project' }) } },
  console: { log() {} }, Date, Intl,
}, { filename: 'lib/invoices/getBigqueryInvoices.ts' });

const cases = [
  [53671, '2026-09-14', 250, 5883, 5884],
  [53921, '2026-09-17', 2500, 674, 675],
  [54069, '2026-09-21', 200, 5920, 5921],
  [54659, '2026-09-29', 3404.15, 2563, 2564],
];
const replacements = cases.flatMap(([id, date, amount, validNfe, cancelledNfe]) => [
  { id_fatura: id, data_emissao: date, valor: amount, status: 'Autorizada', nfe_numero: validNfe },
  { id_fatura: id, data_emissao: date, valor: amount, status: 'Cancelada', nfe_numero: cancelledNfe },
]);

async function select(rows) {
  invoiceRows = rows;
  return exportsObject.getBigqueryInvoices({ daysBack: 3650, limit: 25000 });
}

(async () => {
  for (const rows of [replacements, [...replacements].reverse()]) {
    const invoices = await select(rows);
    assert.equal(invoices.length, 4, 'one row per fatura, without double counting');
    assert.equal(invoices.reduce((sum, row) => sum + Math.round(row.amount * 100), 0), 635415);
    for (const [id, , , validNfe] of cases) {
      const invoice = invoices.find((row) => row.source_invoice_id === id);
      assert.equal(invoice.status, 'Autorizada');
      assert.equal(invoice.nfe_number, validNfe);
    }
  }

  const base = { id_fatura: 1, data_emissao: '2026-09-14', valor: 250 };
  const cancelled = { ...base, status: 'Cancelada', nfe_numero: 20 };
  assert.equal((await select([cancelled]))[0].status, 'Cancelada',
    'a genuinely cancelled invoice without a valid replacement stays cancelled');

  for (const status of ['Autorizada', 'Autorizada, aguardando PDF', 'CancelamentoNegado', 'Cancelamento rejeitado']) {
    const valid = { ...base, status: { value: status }, nfe_numero: 10 };
    const laterCancellation = { ...cancelled, data_emissao: { value: '2026-09-15' } };
    for (const rows of [[valid, laterCancellation], [laterCancellation, valid]]) {
      const invoice = (await select(rows))[0];
      assert.equal(invoice.nfe_number, 10, 'a later cancellation of a different NFS-e cannot hide a valid one');
      assert.equal(invoice.status, status);
    }
  }

  const authorized = { ...base, status: 'Autorizada', nfe_numero: 10 };
  const latest = { ...authorized, data_emissao: '2026-09-15', nfe_numero: 5 };
  assert.equal((await select([latest, authorized]))[0].nfe_number, 5,
    'existing date ordering remains for equally valid notes');
  assert.equal((await select([authorized, { ...authorized, nfe_numero: 11 }]))[0].nfe_number, 11,
    'existing number tie-break remains for equally valid notes');

  for (const status of ['Aguardando autorizacao', 'Aguardando cancelamento', 'Negada']) {
    const pending = { ...base, status, nfe_numero: 30 };
    assert.equal((await select([pending]))[0].status, status);
    assert.equal((await select([authorized, pending]))[0].status, 'Autorizada');
    assert.equal((await select([cancelled, pending]))[0].status, status,
      'existing ordering remains when neither note is authorized');
  }

  const wrapped = await select(replacements.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, { value }]),
  )));
  assert.equal(wrapped.length, 4);
  assert.ok(wrapped.every((row) => row.status === 'Autorizada'));
  console.log('Invoice replacement regression checks passed (4 real faturas; R$ 6,354.15 recovered).');
})().catch((error) => { console.error(error); process.exitCode = 1; });
