const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, suffix = '', globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source + suffix, {
    exports, require: name => name in mocks ? mocks[name] : require(name),
    console, Date, Intl, URL, URLSearchParams, performance, process, ...globals,
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
  '@/lib/scheduling/operationalAgendaServer': { enrichBookingTeams: async rows => rows },
  '@/lib/scheduling/appointmentServer': { APPOINTMENT_SELECT: '*', parseBrazilDate, validateDoctorForUnit: async () => true, fetchAppointmentById: async (_, key) => tables.appointments.find(row => row.id === key) },
  '@/lib/scheduling/appointmentAutomation': { buildAppointmentIntegrationPayload: (_, row) => row, sendAppointmentIntegration: async () => ({ ok: integrationOk }), moveClientToFivFirstStage: async ({clientId}) => ({ applied: !!clientId }) },
});
async function create(extra = {}) {
  return route.POST({ json: async () => ({ threadId: id(1), unitId: form.unitId, doctorId: form.doctorId, startsAt: '2026-10-09T14:30:00-03:00', durationMinutes: 60, format: 'congelamento', procedureName: 'Consulta', primary: person, spouse: emptyPerson, notes: '', ...extra }) });
}

async function testAiGeneration() {
  const {z}=require('zod');
  const validator=z.object({value:z.string()}).strict();
  const jsonSchema=z.toJSONSchema(validator,{io:'input',target:'draft-7'});
  const calls=[],logs=[];
  let respond;
  const ai=load('lib/ai/generateValidatedJson.ts',{
    '@/lib/ai/groq':{getGroqClient:()=>({chat:{completions:{create:async request=>{calls.push(request);return respond(request);}}}})},
  },'',{Error,console:{error:(...values)=>logs.push(values)}});
  const options={schema:validator,jsonSchema,systemPrompt:'Return JSON.',userPrompt:'Extract the value.',models:['openai/gpt-oss-120b','openai/gpt-oss-20b']};
  respond=request=>{
    if(request.model==='openai/gpt-oss-120b')throw Object.assign(new Error('Model unavailable'),{status:404});
    return {choices:[{message:{content:'{"value":"ok"}'}}]};
  };
  assert.equal((await ai.generateValidatedJson(options)).value,'ok');
  assert.equal(calls.length,2,'try the supported fallback after a missing model');
  assert.equal(calls[1].model,'openai/gpt-oss-20b');
  assert.equal(calls[0].response_format.type,'json_schema');
  assert.equal(calls[0].response_format.json_schema.strict,true);
  assert.equal(calls[0].max_completion_tokens,2048,'reserve bounded output within the account token limit');
  assert.ok(!calls[1].messages[1].content.includes('Corrija o JSON'),'provider failures are not JSON failures');

  calls.length=0;
  respond=()=>({choices:[{message:{content:calls.length===1?'{}':'{"value":"repaired"}'}}]});
  assert.equal((await ai.generateValidatedJson(options)).value,'repaired');
  assert.ok(calls[1].messages[1].content.includes('Corrija o JSON'),'retry actual schema failures with validation feedback');

  respond=()=>{throw Object.assign(new Error('Rate limit'),{status:429});};
  await assert.rejects(ai.generateValidatedJson({...options,maxAttempts:1}),error=>error instanceof ai.AiGenerationError&&error.reason==='provider'&&error.providerStatus===429&&error.message.includes('limite de uso'));
  respond=()=>{throw Object.assign(new Error('Model unavailable'),{status:404});};
  calls.length=0;
  await assert.rejects(ai.generateValidatedJson(options),error=>error.reason==='provider'&&error.providerStatus===404);
  assert.equal(calls.length,2,'do not repeat models already returning 404');

  respond=()=>({choices:[{message:{content:'Private patient text without JSON'}}]});
  await assert.rejects(ai.generateValidatedJson({...options,maxAttempts:1}),error=>error.reason==='validation'&&error.providerStatus===undefined);
  assert.ok(!JSON.stringify(logs).includes('Private patient text'),'never log patient response content');

  const autofillRoute=load('app/api/inbox/scheduling-autofill/route.ts',{
    'next/server':next,
    '@/lib/attendants/getCurrentAttendantFromRequest':{getCurrentAttendantFromRequest:async()=>({attendant:{id:id(5),is_online:true}})},
    '@/lib/supabase/client':{supabase},
    '@/lib/inbox/schedulingData':{loadSchedulingContext:async()=>({thread:{id:id(1)},client:null,spouse:null,units:[],doctors:[]})},
    '@/lib/inbox/schedulingMessages':{loadSchedulingMessages:async()=>[]},
    '@/lib/ai/generateValidatedJson':ai,
    '@/lib/ai/schedulingAutofill':{autofillSchedulingForm:async()=>{throw new ai.AiGenerationError('provider',404);}},
  },'',{Error,console:{error:()=>{}}});
  const failedRoute=await autofillRoute.POST({json:async()=>({threadId:id(1),format:'casal',form})});
  assert.equal(failedRoute.status,502,'provider failure has an upstream error status');
  assert.ok(failedRoute.body.error.includes('modelos de IA'));
}

// Run the actual panel with controlled hooks and network responses; inspect its rendered props.
async function testPanelSelection() {
  const matchMocks=new Proxy({react:{},'react/jsx-runtime':require('react/jsx-runtime')},{
    has:()=>true,
    get(target,name){return target[name]??(target[name]=new Proxy({}, {get:(_,key)=>key==='__esModule'?false:function Stub(){}}));},
  });
  const nameMatcher=load('components/inbox/SchedulingPanel.tsx',matchMocks,';exports.areNamesSimilar=areNamesSimilar;').areNamesSimilar;
  assert.equal(nameMatcher('João da Silva','Joao Silva'),true,'ignore accents and name particles');
  assert.equal(nameMatcher('Ana Beatriz Santos','Ana Beatriz'),true,'allow missing surname with strong overlap');
  assert.equal(nameMatcher('joao.v.almeida [TESTE META]','João Vitor Almeida'),true,'compare usernames without test labels');
  assert.equal(nameMatcher('Maria Silva','Maria Souza'),false,'different surnames do not auto-link');
  assert.equal(nameMatcher('joao.v.almeida [TESTE META]','Ana Beatriz Santos (TESTE CRM)'),false,'test profile must default unchecked');
  assert.equal(nameMatcher(null,'Ana Beatriz Santos'),false,'missing social name must default unchecked');
  let slots = [], cursor = 0, effects = [], timers = new Map(), timerId = 0, dirty = true, tree;
  let props = {open:true,threadId:id(1),clientId:null,instagramUserId:id(4),instagramName:'Ana Instagram',selectClient:true,onClose:()=>{}};
  let pendingSelection = null, pendingContext = null, failSelection = false, liveAvailability = false;
  const blankForm = {...form,unitId:'',doctorId:'',schedulingDate:'',schedulingTime:'',primary:emptyPerson};
  const responseData = (client, contact = null) => ({client,contact,spouse:null,units:[],doctors:[],suggestedFormat:'congelamento',form:{...blankForm,primary:{...emptyPerson,fullName:client?.name??contact?.name??''}}});
  let context = responseData(null,{name:'Ana Instagram'});
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index],value=>{const next = typeof value === 'function' ? value(slots[index]) : value;if (!Object.is(next,slots[index])) {slots[index]=next;dirty=true;}}];
    },
    useRef(initial) {const index=cursor++;return slots[index]??(slots[index]={current:initial});},
    useMemo(fn) {cursor++;return fn();},
    useEffect(fn,deps) {
      const index=cursor++,previous=slots[index];
      if (!previous || deps.some((value,i)=>!Object.is(value,previous.deps[i]))) {
        slots[index]={deps,cleanup:previous?.cleanup};
        effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});
      }
    },
  };
  const mocks = new Proxy({react:hooks,'react/jsx-runtime':require('react/jsx-runtime')}, {
    has:()=>true,
    get(target,name) {return target[name]??(target[name]=new Proxy({}, {get:(_,key)=>key==='__esModule'?false:function Stub(){}}));},
  });
  const panel = load('components/inbox/SchedulingPanel.tsx',mocks,'',{
    AbortController,Event,
    window:{setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:key=>timers.delete(key),dispatchEvent:()=>{}},
    fetch:async url=>{
      if(liveAvailability && url.includes('/scheduling/procedures?')) return {ok:true,json:async()=>({procedures:[{name:'1 Avaliação de Reprodução Humana Presencial'}]})};
      if(liveAvailability && url.includes('/scheduling/availability?')) return {ok:true,json:async()=>({slots:[{data:'14/10/2026',inicio:'09:00',termino:'09:45'}]})};
      if(url.includes('scheduling-data?thread_id=')) return pendingContext??{ok:true,json:async()=>context};
      if(url.includes('scheduling-data?client_id=')) {
        if(pendingSelection)return pendingSelection;
        return failSelection?{ok:false,json:async()=>({error:'Falha ao carregar'})}:{ok:true,json:async()=>responseData({id:id(41),name:'Maria Souza'})};
      }
      return {ok:true,json:async()=>({clients:[],units:[],doctors:[]})};
    },
  }).default;
  async function settle() {
    for(let n=0;n<20;n++) {
      if(dirty){dirty=false;cursor=0;tree=panel(props);const batch=effects;effects=[];batch.forEach(fn=>fn());}
      const batch=[...timers.values()];timers.clear();batch.forEach(fn=>fn());
      await new Promise(resolve=>setImmediate(resolve));
      if(!dirty&&!effects.length&&!timers.size)return;
    }
    throw new Error('Panel did not settle');
  }
  function find(node,predicate) {
    if(!node||typeof node!=='object')return null;
    if(Array.isArray(node)){for(const child of node){const found=find(child,predicate);if(found)return found;}return null;}
    if(predicate(node))return node;
    return find(node.props?.children,predicate);
  }
  const picker=()=>find(tree,node=>typeof node.props?.label==='string'&&node.props.label.startsWith('Cliente'));
  const summary=()=>tree.props.headerContent;
  const patient=()=>find(tree,node=>node.props?.who==='primary');
  await settle();
  assert.equal(summary().props.name,'Ana Instagram');
  assert.equal(picker(),null,'social contact in header must hide the picker');
  assert.equal(typeof summary().props.onClear,'function','social contact has an X without a CRM id');
  summary().props.onClear();await settle();
  assert.equal(summary(),undefined,'X removes the current header');
  assert.equal(picker().props.label,'Cliente cadastrado','remove optional from the label');
  assert.equal(patient().props.values.fullName,'','clear the patient fields');
  await picker().props.children.props.onChange(id(41));await settle();
  assert.equal(summary().props.name,'Maria Souza');
  const linkingCheckbox=()=>find(tree,node=>node.props?.['aria-label']==='Vincular perfil do Instagram ao cadastro');
  assert.equal(linkingCheckbox().props.checked,false,'different names must start unchecked');
  const linkText=find(tree,node=>node.props?.className==="space-y-0.5 text-xs leading-relaxed text-slate-500");
  assert.ok(linkText,'both profile names should render under the checkbox title');
  assert.ok(linkText.props.children[0].props.children.includes('Ana Instagram'));
  assert.ok(linkText.props.children[1].props.children.includes('Maria Souza'));
  linkingCheckbox().props.onChange({target:{checked:true}});await settle();
  assert.equal(linkingCheckbox().props.checked,true,'checkbox controls social linkage');
  assert.equal(picker(),null,'manual selection hides the picker');
  assert.equal(typeof summary().props.onClear,'function','manual selection retains its X');
  summary().props.onClear();await settle();
  assert.equal(linkingCheckbox(),null,'clearing the chosen CRM client hides the link checkbox');
  props={...props,instagramName:'Maria Souza'};dirty=true;await settle();
  await picker().props.children.props.onChange(id(41));await settle();
  assert.equal(linkingCheckbox().props.checked,true,'matching names must be checked by default');
  linkingCheckbox().props.onChange({target:{checked:false}});await settle();
  assert.equal(linkingCheckbox().props.checked,false,'manual unchecking must remain possible');
  summary().props.onClear();await settle();
  props={...props,instagramName:'Ana Instagram'};dirty=true;await settle();
  failSelection=true;await picker().props.children.props.onChange(id(41));await settle();
  assert.equal(summary(),undefined,'failed selection must not become the current client');
  assert.ok(picker(),'failed selection remains retryable');
  failSelection=false;

  context=responseData({id:id(42),name:'Cliente vinculado'});
  props={...props,threadId:id(2),clientId:id(42),selectClient:false,client:{name:'Cliente vinculado'}};dirty=true;await settle();
  assert.equal(picker(),null,'linked client hides picker even when passed by props');
  assert.equal(linkingCheckbox(),null,'no social-link checkbox without a manual selection');
  assert.equal(typeof summary().props.onClear,'function','automatically loaded client retains an X');
  summary().props.onClear();await settle();
  assert.equal(summary(),undefined,'clearing must suppress clientId/client prop fallbacks');
  assert.ok(picker(),'clearing linked client exposes picker despite selectClient=false');
  await picker().props.children.props.onChange(id(42));await settle();
  assert.equal(linkingCheckbox().props.checked,false,'different names remain unchecked for explicitly selected clients');
  summary().props.onClear();await settle();
  assert.equal(linkingCheckbox(),null);

  let resolveSelection;
  pendingSelection=new Promise(resolve=>{resolveSelection=resolve;});
  const staleRequest=picker().props.children.props.onChange(id(41));await settle();
  context=responseData(null,{name:'Outro contato'});
  props={...props,threadId:id(3),clientId:null,client:null,selectClient:true};dirty=true;await settle();
  resolveSelection({ok:true,json:async()=>responseData({id:id(41),name:'Maria Souza'})});
  await staleRequest;await settle();
  assert.equal(summary().props.name,'Outro contato','late response cannot overwrite the next conversation');
  assert.equal(picker(),null);
  pendingSelection=null;
  summary().props.onClear();await settle();
  pendingSelection=new Promise(resolve=>{resolveSelection=resolve;});
  const closedRequest=picker().props.children.props.onChange(id(41));await settle();
  props={...props,open:false};dirty=true;await settle();
  resolveSelection({ok:true,json:async()=>responseData({id:id(41),name:'Maria Souza'})});await closedRequest;await settle();
  assert.equal(summary(),undefined,'closing invalidates a pending manual selection');
  pendingSelection=null;
  props={...props,open:true};dirty=true;await settle();
  assert.equal(summary().props.name,'Outro contato','reopening restores current conversation context');
  assert.equal(typeof summary().props.onClear,'function');

  let resolveContext;
  pendingContext=new Promise(resolve=>{resolveContext=resolve;});
  props={...props,threadId:id(4),clientId:id(42),selectClient:false,client:{name:'Cliente vinculado'}};dirty=true;await settle();
  assert.equal(typeof summary().props.onClear,'function','retain the X during context loading');
  summary().props.onClear();await settle();
  resolveContext({ok:true,json:async()=>responseData({id:id(42),name:'Cliente vinculado'})});await settle();
  assert.equal(summary(),undefined,'late context cannot restore a cleared selection');
  assert.ok(picker());
  pendingContext=null;

  props={...props,threadId:null,clientId:id(42),selectClient:false,client:null};dirty=true;await settle();
  assert.equal(summary().props.onClear,undefined,'standalone scheduling retains its existing behavior');
  assert.equal(picker(),null);
  liveAvailability=true;
  props={...props,clientId:null,selectClient:true,initialSlot:{unitId:id(2),doctorId:id(3),startsAt:'2026-10-14T12:00:00Z',durationMinutes:45}};dirty=true;await settle();
  const field=label=>find(tree,node=>node.props?.label===label);
  assert.equal(field('Unidade').props.value,id(2));
  assert.equal(field('Médico').props.value,id(3));
  assert.equal(field('Horário').props.value,'09:00','clicked vacancy is preselected after live verification');
  await picker().props.children.props.onChange(id(41));await settle();
  assert.equal(field('Médico').props.value,id(3),'selecting the client preserves the chosen doctor');
  assert.equal(field('Horário').props.value,'09:00','selecting the client preserves the verified vacancy');
}

async function testInboxTransfer() {
  tables = {
    thread: [{ id: id(1), status: 'open', assigned_attendant_id: id(5), target_queue_id: null }],
    attendants: [
      { id: id(5), name: 'Atual', active: true, is_online: true },
      { id: id(6), name: 'Destino', active: true, is_online: false },
      { id: id(7), name: 'Inativo', active: false, is_online: true },
    ],
    queues: [
      { id: id(10), name: 'RA', active: true },
      { id: id(11), name: 'Inativa', active: false },
    ],
  };
  let current = tables.attendants[0];
  const transferRoute = load('app/api/inbox/transfer/route.ts', {
    'next/server': next,
    '@/lib/attendants/getCurrentAttendantFromRequest': {
      getCurrentAttendantFromRequest: async () => ({ attendant: current }),
    },
    '@/lib/supabase/client': { supabase },
  });

  let response = await transferRoute.GET();
  assert.equal(response.status, 200);
  assert.equal(response.body.attendants.length, 1);
  assert.equal(response.body.attendants[0].name, 'Destino');
  assert.equal(response.body.queues.length, 1);

  const transfer = async (body) => transferRoute.POST({ json: async () => body });
  const payload = { threadId: id(1), targetType: 'attendant', targetId: id(6) };

  response = await transfer({ ...payload, targetId: id(7) });
  assert.equal(response.status, 404, 'inactive attendants cannot receive transfers');
  response = await transfer({ ...payload, targetId: id(5) });
  assert.equal(response.status, 400, 'cannot transfer to self');

  response = await transfer(payload);
  assert.equal(response.status, 200, 'transfer to another attendant');
  assert.equal(tables.thread[0].assigned_attendant_id, id(6));
  assert.equal(tables.thread[0].target_queue_id, null);
  assert.ok(tables.thread[0].claimed_at);

  response = await transfer(payload);
  assert.equal(response.status, 409, 'stale ownership cannot be transferred twice');
  tables.thread[0].assigned_attendant_id = id(5);
  response = await transfer({ threadId: id(1), targetType: 'queue', targetId: id(10) });
  assert.equal(response.status, 200, 'transfer to an active queue');
  assert.equal(tables.thread[0].assigned_attendant_id, null, 'queue transfer removes direct ownership');
  assert.equal(tables.thread[0].target_queue_id, id(10), 'queue handoff preserves destination');
  assert.equal(tables.thread[0].claimed_at, null);
  assert.ok(tables.thread[0].queued_at);

  response = await transfer({ threadId: id(1), targetType: 'queue', targetId: id(11) });
  assert.equal(response.status, 404, 'inactive queues cannot receive transfers');
  current = null;
  response = await transfer(payload);
  assert.equal(response.status, 403, 'unauthenticated users cannot transfer');

  const queueSource = fs.readFileSync(path.join(root, 'app/api/inbox/queue/route.ts'), 'utf8');
  assert.ok(queueSource.includes('target_queue_id.eq.'), 'queue counters honor a destination queue');
  console.log('PASS: Inbox transfers to attendants and queues; authorization; disabled targets; ownership race; queue counters.');
}

(async () => {
  await testAiGeneration();
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
  const manual = await create({clientId:id(41),manualClientSelection:true});
   assert.equal(manual.body.appointment.client_id, id(41));
   assert.equal(tables.instagram_users[0].client_id,null,'manual selection must await confirmation');
   assert.equal(manual.body.socialLinkSuggestion.clientId,id(41));
   assert.equal(manual.body.socialLinkSuggestion.expectedClientId,null);
   const socialLinkRoute=load('app/api/inbox/scheduling-link/route.ts',{
     'next/server':next,
     '@/lib/attendants/getCurrentAttendantFromRequest':{getCurrentAttendantFromRequest:async()=>({user:{id:id(6)},attendant:{id:id(5),is_online:true}})},
     '@/lib/inbox/schedulingData':contextHelper,
     '@/lib/supabase/client':{supabase},
   });
   const link=await socialLinkRoute.POST({json:async()=>({threadId:id(1),clientId:id(41),expectedClientId:null})});
   assert.equal(link.status,200,'confirm profile link only after appointment');
   assert.equal(tables.instagram_users[0].client_id,id(41));
  reset(id(42));
  tables.clients.push({id:id(43),name:'Paciente substituto'});
  const replacement = await create({clientId:id(43),manualClientSelection:true});
   assert.equal(replacement.body.appointment.client_id,id(43),'honor the replacement patient');
  assert.equal(tables.instagram_users[0].client_id,id(42),'replacement must not relink the social conversation');
   assert.equal(replacement.body.socialLinkSuggestion.expectedClientId,id(42),'replacement requires explicit confirmation');
  assert.equal(tables.clients.find(row=>row.id===id(42)).name,'Ana Silva','do not update the original client with replacement details');
  reset(id(42));
  assert.equal((await create()).body.appointment.client_id,id(42),'without replacement use the current social link');
  reset();
  tables.thread[0].client_id=id(44);
  tables.clients.push({id:id(44),name:'Contato WhatsApp'},{id:id(45),name:'Paciente substituto'});
  assert.equal((await create({clientId:id(45)})).body.appointment.client_id,id(45),'honor replacement on a CRM-linked thread');
  assert.equal(tables.thread[0].client_id,id(44),'do not rewrite the thread identity');
  // Preserve Meta referral details and click identifiers from the original webhook.
  const zernioParser=load('lib/importers/zernio/parseZernioWebhook.ts',{
    '@/lib/zernio/client':{zernioExternalMessageId:value=>value},
  });
  const received=zernioParser.parseZernioMessageWebhook({
    event:'message.received',id:'event-1',timestamp:'2026-10-09T12:00:00Z',
    account:{id:'account-1',platform:'instagram'},
    conversation:{id:'thread-1',participantId:'person-1'},
    message:{id:'msg-1',direction:'incoming',text:'Olá',metadata:{
      fbclid:'test-click-id',utm_campaign:'test-utm',
      referral:{ad_id:'ad-1',source:'ADS',campaign_id:'campaign-1',campaign_name:'Campaign',
        adscontextdata:{adtitle:'Creative',photo_url:'https://example.com/photo.jpg'}},
      patient_secret:'never-save',
    }},
  });
  assert.equal(received.referral.campaign_id,'campaign-1');
  assert.equal(received.social_metadata.fbclid,'test-click-id');
  assert.equal(received.social_metadata.referral.adscontextdata.adtitle,'Creative');
  assert.equal(received.social_metadata.patient_secret,undefined);

  reset(); online = false;
  assert.equal((await create()).status, 403);
  assert.equal(inserts.length, 0);
  online = true; reset(); integrationOk = false;
  assert.equal((await create()).status, 502);
  assert.equal(tables.appointments.length, 0);
  integrationOk = true;

  await testPanelSelection();
  // Report endpoints enforce the tab grant and server-side unit lock. Snapshot
  // counts are calculated by the server, never accepted from a browser payload.
  let reportAccess={ok:true,user:{id:id(6)},permission:{unit_lock:{id:id(2)}}};
  let loadedReportArgs, savedSnapshot, requestedTab, readScope;
  const reportRoute=load('app/api/scheduling/reports/route.ts',{
    'next/server':next,
    '@/lib/auth/getServerTabAccess':{getServerTabAccess:async tab=>{requestedTab=tab;return reportAccess;}},
    '@/lib/scheduling/operationalAgenda':{agendaDate:()=> '2026-10-13',agendaWeekStart:()=> '2026-10-11',agendaAddDays:()=> '2026-10-18',agendaMonthStart:()=> '2026-11-01'},
    '@/lib/scheduling/operationalAgendaServer':{agendaScopeKey:(units,doctors)=>[...units,...doctors].join(','),loadOperationalAgenda:async args=>{loadedReportArgs=args;return {counts:{total:12},byUnit:[{unitName:'Bauru',total:12}]};}},
    '@/lib/supabase/client':{supabase:{from:()=>({select:()=>({eq:(_,value)=>{readScope=value;return {order:()=>({limit:async()=>({data:[],error:null})})};}}),upsert:async value=>{savedSnapshot=value;return {error:null};}})}},
  });
  const reportUrl=`https://hub.test/api/scheduling/reports?view=reports&start=2026-10-01&end=2026-11-01&unit_ids=${id(999)}`;
  assert.equal((await reportRoute.GET({url:reportUrl})).status,200);
  assert.equal(requestedTab,'inteligencia_agenda');
  assert.equal(loadedReportArgs.unitIds[0],id(2),'caller cannot override unit lock');
  assert.equal(readScope,id(2),'saved reports cannot expose another unit');
  assert.equal((await reportRoute.GET({url:'https://hub.test/api/scheduling/reports?view=calendar'})).status,200);
  assert.equal(requestedTab,'agendamentos');
  assert.equal((await reportRoute.POST({json:async()=>({month:'2026-10',unitIds:[id(999)],doctorIds:[],report:{counts:{total:9999}}})})).status,200);
  assert.equal(savedSnapshot.unit_ids[0],id(2));
  assert.equal(savedSnapshot.captured_by,id(6));
  assert.equal(savedSnapshot.report.counts.total,12,'ignore forged client-side counts');
  reportAccess={ok:false,status:403,error:'Tab not allowed'};
  assert.equal((await reportRoute.GET({url:reportUrl})).status,403);
  assert.equal((await reportRoute.POST({json:async()=>({})})).status,403);
  const panel = load('components/inbox/SchedulingPanel.tsx', new Proxy({}, { has: () => true, get: () => ({}) }), '\nexports.validate = validate; exports.withInitialSlot = withInitialSlot;');
  assert.equal(Object.keys(panel.validate(form, 'congelamento')).length, 0);

  assert.ok(!fs.readFileSync(path.join(root,'components/inbox/SchedulingPanel.tsx'),'utf8').includes('FivAutomationBox'),'purple FIV checkbox stays hidden');

  const slotForm = panel.withInitialSlot(form, {unitId:id(7),doctorId:id(8),startsAt:'2026-10-14T12:00:00Z',durationMinutes:45});
  assert.equal(slotForm.unitId,id(7));
  assert.equal(slotForm.doctorId,id(8));
  assert.equal(slotForm.schedulingDate,'14/10/2026');
  assert.equal(slotForm.durationMinutes,45);
  assert.equal(slotForm.primary,form.primary,'choosing a vacancy preserves the selected client');
  assert.equal(slotForm.schedulingTime,'','time must be verified against live procedure availability');

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
    '@/lib/ai/generateValidatedJson': { generateValidatedJson: async ({schema:validator,jsonSchema,models,systemPrompt,userPrompt}) => {
      assert.equal(jsonSchema.additionalProperties,false,'send a closed JSON schema');
      assert.ok(models.every(model=>model.startsWith('openai/gpt-oss-')),'do not inherit inaccessible Llama models');
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
  await testInboxTransfer();
  console.log('PASS: manual social-to-CRM linking requires confirmation; AI model fallback, strict JSON, bounded output, provider/validation errors and privacy; rendered client selection, X, clearing and request races; optional address; social scheduling and profile linkage; authorization; rollback; complete history and extraction merge.');
})().catch(error => { console.error(error); process.exitCode = 1; });
