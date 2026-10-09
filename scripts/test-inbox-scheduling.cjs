const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, suffix = '') {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source + suffix, {
    exports, require: name => name in mocks ? mocks[name] : require(name),
    console, Date, Intl, URL, performance,
  }, { filename: file });
  return exports;
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = { fullName: 'Ana Silva', cpf: '529.982.247-25', birthDate: '02/01/1990', email: 'ana@example.com', phone: '(19) 98876-0900' };
const emptyPerson = { fullName: '', cpf: '', birthDate: '', email: '', phone: '' };
const address = { street: '', number: '', complement: '', neighborhood: '', city: '', state: '', cep: '', country: '' };
const form = { unitId: id(2), doctorId: id(3), schedulingDate: '09/10/2026', schedulingTime: '14:30', durationMinutes: 60, procedureName: 'Consulta', primary: person, spouse: emptyPerson, address, notes: '' };
const { parseBrazilDate } = load('lib/scheduling/appointmentServer.ts');
const phone = load('lib/clients/phoneIdentity.ts');
const clientHelper = load('lib/inbox/schedulingClient.ts', {
  '@/lib/clients/phoneIdentity': phone,
  '@/lib/scheduling/appointmentServer': { parseBrazilDate },
});
let tables, inserts, updates;
function reset(linked = null) {
  tables = {
    thread: [{ id: id(1), client_id: null, instagram_user_id: id(4), assigned_attendant_id: id(5), instagram_user: { client_id: linked, display_name: 'Ana Instagram', location: 'Bauru' } }],
    instagram_users: [{ id: id(4), client_id: linked }],
    clients: linked ? [{ id: linked, name: 'Ana Silva', phone_identity: '5519988760900', street: 'Rua antiga', city: 'Bauru', units: null }] : [],
    units: [{ id: id(2), name: 'Bauru', active: true }], doctor_units: [], appointments: [], messages: [],
  };
  inserts = []; updates = [];
}
function query(table) {
  let conditions = [], op = 'read', values, one = false, range, orders = [];
  const chain = new Proxy({}, { get(_, key) {
    if (key === 'then') return (resolve, reject) => Promise.resolve().then(() => {
      let matched = (tables[table] ?? []).filter(row => conditions.every(test => test(row)));
      if (op === 'insert') {
        const row = { id: id(100 + inserts.length), ...values };
        if (table === 'clients') row.phone_identity = phone.normalizePhoneIdentity(row.phone);
        tables[table].push(row); inserts.push({ table, values: row }); matched = [row];
      }
      if (op === 'update') { matched.forEach(row => Object.assign(row, values)); updates.push({ table, values }); }
      if (op === 'delete') tables[table] = tables[table].filter(row => !matched.includes(row));
      for (const [field, ascending] of [...orders].reverse()) matched.sort((a,b) => a[field] < b[field] ? (ascending ? -1 : 1) : a[field] > b[field] ? (ascending ? 1 : -1) : 0);
      if (range) matched = matched.slice(range[0], range[1] + 1);
      return { data: one ? matched[0] ?? null : matched, error: null };
    }).then(resolve, reject);
    return (...args) => {
      if (key === 'eq' || key === 'is') conditions.push(row => row[args[0]] === args[1]);
      if (key === 'in') conditions.push(row => args[1].includes(row[args[0]]));
      if (key === 'lt') conditions.push(row => row[args[0]] < args[1]);
      if (key === 'gt') conditions.push(row => row[args[0]] > args[1]);
      if (key === 'lte') conditions.push(row => row[args[0]] <= args[1]);
      if (key === 'insert' || key === 'update') { op = key; values = args[0]; }
      if (key === 'delete') op = 'delete';
      if (key === 'single' || key === 'maybeSingle') one = true;
      if (key === 'range') range = args;
      if (key === 'limit') range = [0, args[0] - 1];
      if (key === 'order') orders.push([args[0], args[1]?.ascending !== false]);
      return chain;
    };
  }});
  return chain;
}
const supabase = { from: query };
const contextHelper = load('lib/inbox/schedulingData.ts');
const next = { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
let online = true, integrationOk = true;
const route = load('app/api/scheduling/appointments/route.ts', {
  'next/server': next,
  '@/lib/attendants/getCurrentAttendantFromRequest': { getCurrentAttendantFromRequest: async () => ({ user: { id: id(6) }, attendant: { id: id(5), is_online: online } }) },
  '@/lib/supabase/client': { supabase },
  '@/lib/inbox/schedulingData': contextHelper,
  '@/lib/inbox/schedulingClient': clientHelper,
  '@/lib/scheduling/appointmentServer': { APPOINTMENT_SELECT: '*', parseBrazilDate, validateDoctorForUnit: async () => true, fetchAppointmentById: async (_, key) => tables.appointments.find(row => row.id === key) },
  '@/lib/scheduling/appointmentAutomation': { buildAppointmentIntegrationPayload: (_, row) => row, sendAppointmentIntegration: async () => ({ ok: integrationOk }), moveClientToFivFirstStage: async ({clientId}) => ({ applied: !!clientId }) },
});
async function create(extra = {}) {
  return route.POST({ json: async () => ({ threadId: id(1), unitId: form.unitId, doctorId: form.doctorId, startsAt: '2026-10-09T14:30:00-03:00', durationMinutes: 60, format: 'congelamento', procedureName: 'Consulta', primary: person, spouse: emptyPerson, notes: '', ...extra }) });
}

(async () => {
  reset();
  const unlinked = await contextHelper.loadSchedulingContext(supabase, id(1), id(5));
  assert.equal(unlinked.client, null);
  assert.equal(unlinked.form.primary.fullName, 'Ana Instagram');
  assert.equal(await contextHelper.loadSchedulingContext(supabase, id(1), id(999)), null);
  const dataRoute = load('app/api/inbox/scheduling-data/route.ts', {
    'next/server': next,
    '@/lib/attendants/getCurrentAttendantFromRequest': { getCurrentAttendantFromRequest: async () => ({user:{id:id(6)},attendant:{id:id(5),is_online:true}}) },
    '@/lib/supabase/client': {supabase}, '@/lib/inbox/schedulingData':contextHelper,
  });
  const schedulingData = await dataRoute.GET(new Request(`https://example.com/api/inbox/scheduling-data?thread_id=${id(1)}`));
  assert.equal(schedulingData.status,200);
  assert.equal(schedulingData.body.client,null);
  assert.equal(schedulingData.body.contact.name,'Ana Instagram');
  const created = await create(); // Neither selected client nor address is required.
  assert.equal(created.status, 201);
  assert.ok(created.body.appointment.client_id);
  assert.equal(tables.instagram_users[0].client_id, created.body.appointment.client_id);
  assert.equal(tables.thread[0].client_id, null, 'social thread keeps its own identity');
  assert.equal(tables.clients[0].cpf, '52998224725');
  assert.equal(tables.appointments[0].address_street, null);
  assert.equal(created.body.automation.fiv.applied, true);

  reset();
  tables.clients.push({id: id(40), phone_identity: '5519988760900', street: 'Rua antiga'});
  const reused = await create({address});
  assert.equal(reused.body.appointment.client_id, id(40));
  assert.equal(tables.clients.length, 1);
  assert.equal(tables.clients[0].street, 'Rua antiga', 'blank address must not erase profile');
  reset();
  tables.clients.push({ id: id(41), name: 'Selecionado' });
  assert.equal((await create({clientId:id(41)})).body.appointment.client_id, id(41));
  reset(id(42));
  assert.equal((await create({clientId:id(999)})).body.appointment.client_id, id(42), 'never overwrite an existing social link');
  reset(); online = false;
  assert.equal((await create()).status, 403);
  assert.equal(inserts.length, 0);
  online = true; reset(); integrationOk = false;
  assert.equal((await create()).status, 502);
  assert.equal(tables.appointments.length, 0);
  integrationOk = true;

  const panel = load('components/inbox/SchedulingPanel.tsx', new Proxy({}, { has: () => true, get: () => ({}) }), '\nexports.validate = validate;');
  assert.equal(Object.keys(panel.validate(form, 'congelamento')).length, 0);
  assert.ok(panel.validate({...form,address:{...address,cep:'123'}}, 'congelamento')['address.cep']);

  reset();
  tables.messages = Array.from({length: 530}, (_, index) => ({ id: id(index + 1000), instagram_user_id:id(4), client_id:null, thread_id:index < 300 ? id(80) : id(1), sender_type:'client', sender_name:'Ana', text:`Mensagem ${index}`, sent_at:'2026-10-08T12:00:00Z', sequence_index:index }));
  tables.messages.push({id:id(9999), instagram_user_id:id(999), text:'Outro contato', sent_at:'2026-10-08T12:00:00Z'});
  const messageHelper = load('lib/inbox/schedulingMessages.ts');
  const messages = await messageHelper.loadSchedulingMessages(supabase, unlinked.thread);
  assert.equal(messages.length, 530, 'read beyond latest 100 and first database page');
  assert.equal(messages[0].text, 'Mensagem 0');
  assert.equal(messages[529].text, 'Mensagem 529');

  const schema = load('lib/ai/schedulingAutofillSchema.ts');
  let prompts = [], seen = [];
  const extraction = load('lib/ai/schedulingAutofill.ts', {
    '@/lib/ai/schedulingAutofillSchema': schema,
    '@/lib/ai/generateValidatedJson': { generateValidatedJson: async ({schema:validator,systemPrompt,userPrompt}) => {
      const prompt = JSON.parse(userPrompt); prompts.push(prompt);
      assert.ok(systemPrompt.includes('CPF, nascimento, e-mail e telefone'));
      assert.equal(prompt.database_client, null);
      if (prompts.length > 1) assert.ok(prompt.preceding_chat_messages.length > 0, "retain questions across chunk boundaries");
      seen.push(...prompt.chat_messages.map(m=>m.text));
      const candidate = { ...prompt.current_form, durationMinutes:null };
      if (prompt.chat_messages.some(m=>m.text==='Mensagem 0')) Object.assign(candidate, {
        primary:{...person,birthDate:'1990-01-02',phone:'+55 19 98876-0900'},
        spouse:{...person,fullName:'Bruno Silva'}, address:{...address,street:'Rua Um',number:'12',city:'Bauru',state:'SP',cep:'17010000'},
        unitId:id(2),doctorId:id(3),schedulingTime:'14h30',notes:'Preferência por consulta presencial',
      });
      return validator.parse(candidate);
    } },
  });
  const longMessage = 'X'.repeat(9000) + ' ENDEREÇO NO FIM';
  messages.push({sender_type:'client',sender_name:'Ana',sent_at:'2026-10-08T12:00:00Z',text:longMessage});
  const filled = await extraction.autofillSchedulingForm({
    format:'congelamento',currentForm:{...form,primary:emptyPerson},client:null,spouse:null,
    units:[{id:id(2),name:'Bauru'}],doctors:[{id:id(3),unit_id:id(2)}],messages,
  });
  assert.ok(prompts.length > 1);
  assert.equal(seen.slice(0,530).join('|'), messages.slice(0,530).map(m=>m.text).join('|'));
  assert.equal(seen.slice(530).join(''),longMessage,'no message tail is discarded');
  assert.equal(filled.primary.cpf, person.cpf);
  assert.equal(filled.primary.birthDate, person.birthDate);
  assert.equal(filled.primary.email, person.email);
  assert.equal(filled.primary.phone, person.phone);
  assert.equal(filled.spouse.fullName, 'Bruno Silva');
  assert.equal(filled.address.cep, '17010-000');
  assert.equal(filled.schedulingTime, '14:30');
  assert.equal(filled.durationMinutes,60,'missing AI duration preserves the form');
  assert.equal(filled.notes,'Preferência por consulta presencial');
  console.log('PASS: optional address; unlinked social scheduling and profile linkage; selected/existing clients; authorization; rollback; complete paginated history and extraction merge.');
})().catch(error => { console.error(error); process.exitCode = 1; });
