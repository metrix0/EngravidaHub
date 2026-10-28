const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { monthlyAgendaCounts } = require('../lib/scheduling/agendaReportMetrics.ts');
const source = ts.transpileModule(fs.readFileSync('components/scheduling/AgendaReports.tsx','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const date='2026-10-28', month='2026-10';
const dailyQuery=new URLSearchParams({view:'reports',start:'2026-10-01',end:'2026-11-01',report_date:date}).toString()+':0';
const monthlyQuery=new URLSearchParams({view:'reports',start:'2026-10-01',end:'2026-11-01',report_date:'2026-10-01'}).toString()+':0';
const report={generatedAt:'2026-10-28T15:00:00Z',horizonEnd:'2026-12-01',counts:{total:125,available:7,open:57,ra:10,unit:8,unknown:20,blocked:23},byUnit:[{unitName:'Campinas',total:125,available:7,open:57,ra:10,unit:8,unknown:20,blocked:23}],availability:[{unitName:'Campinas',firstDate:date,weeks:[12,18,25,21]}],missingDoctors:[]};
for(const mode of ['ready','loading','failed','changed-filter']) {
 let cursor=0, read;
 const result=(query)=>({query:mode==='changed-filter'?'old-filter':query,report:mode==='failed'?null:report,error:mode==='failed'?'Falha de teste':null});
 const values=[date,month,false,null,0,result(dailyQuery),0,result(monthlyQuery)];
 const exports={};
 vm.runInNewContext(source,{exports,URLSearchParams,require:name=>name==='react'?{useState:()=>[values[cursor++],()=>{}],useMemo:fn=>fn(),useEffect:()=>{}}:name==='react/jsx-runtime'?require(name):name==='@/lib/ai/assistantPageContext'?{useAssistantPageContext:(_,fn)=>{read=fn;}}:name==='@/lib/scheduling/agendaReportMetrics'?{monthlyAgendaCounts}:new Proxy({},{get:()=>()=>null})});
 exports.default({unitIds:[],doctorIds:[],units:[],doctors:[],ready:mode!=='loading'});
 const context=read();
 const status=context.sections.find(s=>s.id==='agenda-indicadores-estado').data;
 assert.equal(status.carregando,mode==='loading'||mode==='changed-filter');
 assert.equal(status.erro,mode==='failed'?'Falha de teste':null);
 assert.equal(context.sections.length,mode==='ready'?4:2);
 if(mode==='ready') {
  const data=context.sections.find(s=>s.id==='agenda-indicadores').data;
  assert.equal(data.totais.available,64);assert.equal(data.totais.occupancy.toFixed(1),"14.4");
  assert.equal(data.unidades[0].unknown,20);
  assert.equal(context.sections.find(s=>s.id==='agenda-disponibilidade').data.unidades[0].weeks.length,4);
 }
}
console.log('PASS agenda report context: exact monthly totals and availability; separate date scopes; loading, failure and changed filters exclude stale data.');
