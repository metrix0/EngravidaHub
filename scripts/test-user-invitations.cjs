const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));

function load(file, mocks = {}, globals = {}, suffix = '') {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source + suffix, {
    exports, require: name => name in mocks ? mocks[name] : require(name),
    console, Date, URL, Headers, AbortSignal, ...globals,
  }, { filename: file });
  return exports;
}

let tables, accounts, events, access, createError, inviteError, writeError, invalidations;
function reset() {
  tables = {
    user_permissions: [],
    units: [{ id: 'unit', name: 'Bauru', active: true }],
    attendants: [{ id: 'attendant', name: 'Atendente', auth_user_id: null, queue_id: null }],
    queues: [{ id: 'queue', name: 'Assistência', active: true, unit_id: 'unit' }],
    internal_groups: [{ id: 'automatic', queue_id: 'queue', name: 'Assistência', active: true }, { id: 'manual', name: 'Equipe', active: true }],
    internal_group_members: [],
  };
  accounts = []; events = []; invalidations = 0;
  access = { ok: true }; createError = null; inviteError = null; writeError = null;
}

function query(table) {
  let predicates = [], op = 'read', values, one = false;
  const chain = new Proxy({}, { get(_, key) {
    if (key === 'then') return (resolve, reject) => Promise.resolve().then(() => {
      const rows = tables[table];
      let matched = rows.filter(row => predicates.every(test => test(row)));
      if (op !== 'read') {
        events.push(`${op}:${table}`);
        if (writeError?.table === table) return { data: null, error: { message: writeError.message } };
      }
      if (op === 'upsert') {
        matched = [rows.find(row => row.auth_user_id === values.auth_user_id)];
        if (!matched[0]) { matched[0] = {}; rows.push(matched[0]); }
        Object.assign(matched[0], values);
      }
      if (op === 'insert') {
        matched = Array.isArray(values) ? values : [values]; rows.push(...matched);
      }
      if (op === 'update') {
        matched.forEach(row => {
          const previousUser = row.auth_user_id;
          Object.assign(row, values);
          // Model the existing attendants trigger: queue membership is automatic.
          if (table === 'attendants') {
            tables.internal_group_members.forEach(member => {
              if (member.auth_user_id === previousUser) member.automatic = false;
            });
            const group = tables.internal_groups.find(group => group.queue_id === row.queue_id);
            if (row.auth_user_id && group) {
              let member = tables.internal_group_members.find(member => member.auth_user_id === row.auth_user_id && member.group_id === group.id);
              if (!member) { member = { auth_user_id: row.auth_user_id, group_id: group.id, manual: false }; tables.internal_group_members.push(member); }
              member.automatic = true;
            }
            tables.internal_group_members = tables.internal_group_members.filter(member => member.manual || member.automatic);
          }
        });
      }
      if (op === 'delete') tables[table] = rows.filter(row => !matched.includes(row));
      return { data: one ? matched[0] ?? null : matched, error: null };
    }).then(resolve, reject);
    return (...args) => {
      if (key === 'eq') predicates.push(row => row[args[0]] === args[1]);
      if (key === 'neq') predicates.push(row => row[args[0]] !== args[1]);
      if (key === 'in') predicates.push(row => args[1].includes(row[args[0]]));
      if (['upsert', 'insert', 'update'].includes(key)) { op = key; values = args[0]; }
      if (key === 'delete') op = key;
      if (key === 'single' || key === 'maybeSingle') one = true;
      return chain;
    };
  }});
  return chain;
}

const admin = {
  async createUser(attributes) {
    events.push('create');
    assert.equal(attributes.email_confirm, false);
    assert.equal(attributes.password, undefined);
    if (createError) return { data: { user: null }, error: createError };
    const user = { id: 'new-user', ...attributes, created_at: '2026-10-09', email_confirmed_at: null, last_sign_in_at: null };
    accounts.push(user);
    return { data: { user }, error: null };
  },
  async getUserById(id) { events.push('lookup'); return { data: { user: accounts.find(user => user.id === id) }, error: null }; },
  async inviteUserByEmail(email, options) {
    events.push('invite');
    assert.equal(options.redirectTo, 'https://preview-engravida.vercel.app/login');
    const user = accounts.find(user => user.email === email);
    assert.ok(tables.user_permissions.find(permission => permission.auth_user_id === user.id), 'permissions must exist before email');
    if (inviteError) return { data: { user: null }, error: { message: inviteError } };
    user.invited_at = '2026-10-09';
    return { data: { user }, error: null };
  },
};
const route = load('app/api/usuarios/route.ts', {
  'next/server': { NextResponse: { json: (body, init = {}) => ({ status: init.status ?? 200, ok: (init.status ?? 200) < 400, json: async () => plain(body) }) } },
  '@/lib': { supabase: { from: query, auth: { admin } } },
  '@/lib/supabase/authAdmin': { listAuthUsers: async options => { assert.equal(options.forceRefresh, true); return accounts; }, invalidateAuthUsersCache: () => invalidations++ },
  '@/lib/auth/getServerTabAccess': { getServerTabAccess: async tab => { assert.equal(tab, 'usuarios'); return access; } },
  '@/lib/users/formatSystemUserName': { formatSystemUserName: value => value },
});
const settings = { name: 'Ana Silva', email: ' ANA@example.com ', preset: 'atendente', allowed_tabs: ['inbox', 'inteligencia_agenda', 'inbox', 'invalid'], unit_id: 'unit', attendant_id: 'attendant', queue_id: 'queue', manual_group_ids: ['manual'], active: true };
const request = body => ({ url: 'https://preview-engravida.vercel.app/api/usuarios', json: async () => body });

(async () => {
  reset(); access = { ok: false, status: 403, error: 'Sem acesso' };
  assert.equal((await route.POST(request(settings))).status, 403);
  assert.deepEqual(events, []);
  assert.equal(invalidations, 0);
  for (const body of [null, [], { ...settings, email: 'invalid' }, { ...settings, name: '' }, { ...settings, preset: 'invalid' }, { ...settings, unit_id: 'missing' }, { ...settings, attendant_id: 'missing' }, { ...settings, queue_id: 'missing' }, { ...settings, manual_group_ids: ['missing'] }]) {
    reset(); assert.ok((await route.POST(request(body))).status >= 400); assert.deepEqual(events, [], 'validate before account creation');
  }

  reset();
  assert.equal((await route.POST(request(settings))).status, 201);
  assert.deepEqual(events.slice(0, 2), ['create', 'upsert:user_permissions']);
  assert.equal(events.at(-1), 'invite');
  assert.deepEqual(plain(tables.user_permissions[0].allowed_tabs), ['inbox', 'inteligencia_agenda']);
  assert.equal(tables.user_permissions[0].unit_id, 'unit');
  assert.equal(tables.attendants[0].auth_user_id, 'new-user');
  assert.equal(tables.attendants[0].queue_id, 'queue');
  assert.deepEqual(tables.internal_group_members.map(row => [row.group_id, row.automatic, row.manual]), [['automatic', true, false], ['manual', false, true]]);
  assert.equal(invalidations, 1);
  const listed = await (await route.GET()).json();
  assert.equal(listed.users[0].invited_at, '2026-10-09');
  assert.equal(listed.users[0].email_confirmed_at, null);
  assert.equal(listed.users[0].name, 'Ana Silva');

  reset(); inviteError = 'SMTP indisponível';
  let response = await route.POST(request(settings));
  assert.equal(response.status, 500);
  const failure = await response.json();
  assert.equal(failure.auth_user_id, 'new-user');
  assert.match(failure.error, /permissões salvos/);
  inviteError = null;
  response = await route.POST(request({ ...settings, auth_user_id: failure.auth_user_id }));
  assert.equal(response.status, 201);
  assert.equal(events.filter(event => event === 'create').length, 1, 'retry must reuse the identity');
  assert.equal(tables.internal_group_members.length, 2, 'retry must not duplicate memberships');
  assert.equal((await route.POST(request({ ...settings, auth_user_id: 'new-user' }))).status, 201, 'unaccepted invite can be resent');

  accounts[0].email_confirmed_at = '2026-10-09'; events = [];
  assert.equal((await route.POST(request({ ...settings, auth_user_id: 'new-user' }))).status, 409);
  assert.deepEqual(events, ['lookup']);
  accounts[0].email_confirmed_at = null; events = [];
  assert.equal((await route.POST(request({ ...settings, email: 'other@example.com', auth_user_id: 'new-user' }))).status, 400);
  assert.deepEqual(events, ['lookup']);
  accounts[0].last_sign_in_at = '2026-10-09';
  assert.equal((await route.POST(request({ ...settings, auth_user_id: 'new-user' }))).status, 409);

  reset(); createError = { code: 'email_exists', message: 'Already registered' };
  assert.equal((await route.POST(request(settings))).status, 409);
  assert.deepEqual(events, ['create']);
  reset(); writeError = { table: 'internal_group_members', message: 'Cannot save group' };
  response = await route.POST(request(settings));
  assert.equal(response.status, 500); assert.equal((await response.json()).auth_user_id, 'new-user');
  assert.ok(!events.includes('invite'), 'never send before all permissions are saved');
  writeError = null;
  assert.equal((await route.POST(request({ ...settings, auth_user_id: 'new-user' }))).status, 201);

  // Existing PATCH edits preserve the unit and manual/automatic membership rules.
  const { unit_id, ...patch } = settings;
  response = await route.PATCH(request({ ...patch, auth_user_id: 'new-user', preset: '__none__', manual_group_ids: [] }));
  assert.equal(response.status, 200);
  assert.equal(tables.user_permissions[0].unit_id, 'unit');
  assert.deepEqual(plain(tables.user_permissions[0].allowed_tabs), []);
  assert.deepEqual(tables.internal_group_members.map(row => row.group_id), ['automatic']);

  // Invalidation must bypass an older in-flight list and its eventual response.
  const resolvers = [];
  const cache = load('lib/supabase/authAdmin.ts', {}, {
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' } },
    fetch: () => new Promise(resolve => resolvers.push(resolve)),
  });
  const old = cache.listAuthUsers();
  cache.invalidateAuthUsersCache();
  const fresh = cache.listAuthUsers();
  assert.equal(resolvers.length, 2);
  resolvers[1]({ ok: true, json: async () => ({ users: [{ id: 'new-user' }] }) });
  assert.deepEqual(plain(await fresh), [{ id: 'new-user' }]);
  resolvers[0]({ ok: true, json: async () => ({ users: [] }) }); await old;
  assert.deepEqual(plain(await cache.listAuthUsers()), [{ id: 'new-user' }]);
  const forced = cache.listAuthUsers({ forceRefresh: true });
  assert.equal(resolvers.length, 3, 'management reads must bypass a warm cache on every server instance');
  resolvers[2]({ ok: true, json: async () => ({ users: [{ id: 'new-user' }, { id: 'another-user' }] }) });
  assert.equal((await forced).length, 2);

  const page = load('app/usuarios/page.tsx', {
    '@/components': {}, '@/components/auth/CurrentUserProvider': {}, '@/components/conversations/InitialsAvatar': {},
  }, {}, '\nexports.buildUserViews = buildUserViews; exports.PRESETS = PRESETS;');
  const viewData = { ...listed, users: [{ ...listed.users[0], email_confirmed_at: null, last_sign_in_at: null }], permissions: tables.user_permissions, attendants: tables.attendants, group_memberships: tables.internal_group_members };
  assert.equal(page.buildUserViews(viewData, tables.units)[0].can_invite, true);
  viewData.users[0].last_sign_in_at = '2026-10-09';
  assert.equal(page.buildUserViews(viewData, tables.units)[0].can_invite, false);
  const preset = page.PRESETS.find(preset => preset.id === 'atendente');
  assert.ok(preset.default_tabs.includes('inteligencia_agenda'));
  assert.ok(!preset.default_tabs.includes('assistente'));
  console.log('User invitation regression checks passed: validation, access, save-before-email, custom tabs, unit, attendant, groups, retry/resend, existing edits, cache and role defaults.');
})().catch(error => { console.error(error); process.exitCode = 1; });
