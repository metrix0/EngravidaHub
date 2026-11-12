import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function load(file, names, mocks = {}) {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source + `\nexports.test = { ${names.join(',')} };`, {
        exports, require: name => mocks[name] ?? require(name), console, Date, Map,
    });
    return exports.test;
}
const { buildTintimAttributionEvent, extractTintimClientTracking } = load('lib/tintim/attribution.ts', [
    'buildTintimAttributionEvent', 'extractTintimClientTracking',
]);
const context = { clientId: 'client', phone: '5519999991234', receivedAt: '2026-11-12T12:00:00Z' };
const payload = {
    created_isoformat: context.receivedAt,
    source: 'Google Ads',
    gclid: 'original-click',
    campaign_id: 'campaign-top-level',
    visit: { meta: { remote_addr: '192.0.2.1' }, params: {
        gclid: 'nested-click', gbraid: 'braid', utm_source: 'google', utm_medium: 'cpc',
        utm_campaign: 'campaign-name', utm_content: 'content', utm_term: 'term',
        utm_id: 'utm-id', campaign_id: 'nested-campaign', ad_id: 123, adset_id: 'set', account_id: 'account',
    } },
};
const first = buildTintimAttributionEvent({ ...context, payload });
assert.equal(first.tracking.gclid, 'original-click');
assert.equal(first.tracking.campaign_id, 'campaign-top-level');
assert.equal(first.tracking.ad_id, '123');
assert.equal(first.tracking.utm_term, 'term');
assert.equal(first.tracking.account_id, 'account');
assert.equal(first.tracking.utm_id, 'utm-id');
assert.equal(first.tracking.client_ip_address, undefined, 'store attribution evidence only');
assert.equal(first.platform, 'google_ads');
assert.equal(extractTintimClientTracking(payload).campaign_id, undefined, 'do not send event IDs to client columns');
assert.equal(buildTintimAttributionEvent({ ...context, payload }).event_fingerprint, first.event_fingerprint);
const next = buildTintimAttributionEvent({ ...context, payload: {
    event_type: 'updated', updated_isoformat: '2026-11-12T14:00:00Z', source: 'Meta Ads',
    fbclid: 'meta-click', ctwa_clid: 'wa-click', fbc: 'fbc', fbp: 'fbp', campaign_id: 'retarget',
} });
assert.notEqual(next.event_fingerprint, first.event_fingerprint);
assert.equal(next.tracking.ctwa_clid, 'wa-click');
assert.equal(first.tracking.campaign_id, 'campaign-top-level', 'later touches do not overwrite earlier evidence');
const organic = buildTintimAttributionEvent({ ...context, payload: { source: 'Organic' } });
assert.equal(organic.platform, null);
assert.equal(Object.keys(organic.tracking).length, 0);

const phone = load('lib/clients/phoneIdentity.ts', ['normalizePhoneIdentity']);
const invoice = load('lib/invoices/syncBigqueryInvoices.ts', [
    'buildClientsByPhone', 'buildClientsByCpf', 'findClientId', 'normalizedCpf',
], { '@/lib': {}, '@/lib/clients/phoneIdentity': phone,
    '@/lib/invoices/categories': {}, '@/lib/invoices/getBigqueryInvoices': {}, '@/lib/invoices/matchDoctor': {} });
const clients = [
    { id: 'wife', phone: '11999990001', phone_identity: '5511999990001', cpf: '529.982.247-25' },
    { id: 'husband', phone: '11999990002', phone_identity: '5511999990002', cpf: '111.444.777-35' },
    { id: 'no-cpf', phone: '11999990003', phone_identity: null, cpf: null },
];
function match(row, people = clients) {
    return invoice.findClientId(row, invoice.buildClientsByPhone(people), invoice.buildClientsByCpf(people),
        new Map(people.map(c => [c.id, invoice.normalizedCpf(c.cpf)])));
}
assert.equal(match({ patient_cpf: '52998224725', patient_phone: null }), 'wife');
assert.equal(match({ patient_cpf: '11144477735', patient_phone: '11999990001' }), 'husband',
    'recipient CPF takes precedence over a household phone');
assert.equal(match({ patient_phone: '+55 (11) 99999-0001' }), 'wife');
assert.equal(match({ patient_cpf: '52998224725' }, [...clients, { id: 'duplicate', cpf: '52998224725' }]), null);
assert.equal(match({ patient_phone: '11999990001' }, [...clients, { id: 'duplicate', phone: '11999990001' }]), null);
assert.equal(match({ patient_cpf: '12345678909', patient_phone: '11999990001' }), null,
    'unmatched recipient CPF cannot use a different known recipient phone');
assert.equal(match({ patient_cpf: '12345678909', patient_phone: '11999990003' }), 'no-cpf');
assert.equal(match({ patient_code: 999 }), null, 'patient code alone never establishes identity');
for (const invalid of ['00000000000', '52998224724', '123']) assert.equal(invoice.normalizedCpf(invalid), null);
console.log('PASS revenue linkage: event evidence, stable retries, organic touches, CPF recovery, spouses and ambiguous identities.');
