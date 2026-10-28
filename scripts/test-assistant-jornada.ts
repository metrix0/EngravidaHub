import assert from 'node:assert/strict';
import { buildAssistantJourneySections } from '../lib/ai/assistantJourneyContext';
import { boundedData, type AssistantPageContext } from '../lib/ai/assistantPageContext';
import { readCurrentPageContext } from '../lib/ai/assistantCurrentPage';

const flow = (offset: number) => ({
    available: true, ads_scope_global: true, filters_applied: true,
    currency_code: 'BRL',
    stages: Array.from({length: 9}, (_, i) => ({key: `stage-${i}`, label: `Etapa ${i}`, value: offset + i, secondary_value: 1234.56, secondary_kind: 'currency'})),
    transitions: Array.from({length: 8}, (_, i) => ({key: `transition-${i}`, label: `Transição ${i}`, rate: i ? 12.3 : null, from_value: offset + i, to_value: offset, lost: i, estimated: true})),
    procedure_branches: Array.from({length: 80}, (_, i) => ({key: `procedure-${i}`, procedure_name: `Procedimento ${i}`, scheduled_appointments: offset + i, attended_appointments: i})),
    acquisition_branches: [{platform:'meta_ads', clicks: offset}],
    instagram: {chats:offset, to_whatsapp:4, unlinked_chats:1},
    revenue_branches: [{kind:'procedure', clients:7, amount:1234.56}],
    audit: {cohort_start_date:'2026-07-01', cohort_end_date:'2026-08-31', matured_through:'2026-09-30', error:null, tracked_sources: Array.from({length:40}, (_, i) => ({source:`Source ${i}`, clients:i, scheduled_clients:i, attended_clients:i, percentage:12.3}))},
});
const pipeline = {...flow(100), additional_pipelines: [
    {key:'untracked_whatsapp', pipeline:flow(200)},
    {key:'organic', pipeline:flow(300)},
]};
const sections = buildAssistantJourneySections({pipeline, loading:false, error:null, query:'unit_ids=unit-a&start_date=2026-07-01'});
const bounded = sections.map(section => ({...section, ...boundedData(section.data, 6000)}));
assert.ok(bounded.every(section => !section.truncated), 'Complete flow metrics must survive context bounding');
assert.equal(new Set(sections.map(section => section.id)).size, sections.length);
const context: AssistantPageContext = {path:'/jornada', title:'Jornada', focused_section:'jornada-pipeline', visible_sections:['jornada-pipeline'], filters:{unidades:['unit-a']}, sections:bounded, visible_text:'Jornada'};
assert.ok(JSON.stringify(context).length < 120000);
assert.ok(context.sections.length < 100);
for (const scope of ['visible','section','all']) {
    const result = readCurrentPageContext(context, scope, 'jornada-pipeline');
    assert.equal(result.ok,true);
    assert.equal(result.secoes.length,sections.length,'Graph read must resolve every referenced branch');
    for (const key of ['paid','untracked_whatsapp','organic']) {
        const stages = result.secoes.find(section => section.id === `jornada-pipeline-${key}-stages-0`);
        assert.equal((stages.data as {valores: unknown[]}).valores.length,9);
        assert.equal((stages.data as {valores: Array<{secondary_value: number}>}).valores[0].secondary_value,1234.56);
        const transitions = result.secoes.find(section => section.id === `jornada-pipeline-${key}-transitions-0`);
        assert.equal((transitions.data as {valores: Array<{rate: number | null}>}).valores[0].rate,null);
        const sources = result.secoes.filter(section => section.id.startsWith(`jornada-pipeline-${key}-audit-tracked_sources-`));
        assert.equal(sources.flatMap(section => (section.data as {valores: unknown[]}).valores).length,40);
        const procedures = result.secoes.filter(section => section.id.startsWith(`jornada-pipeline-${key}-procedure_branches-`));
        assert.equal(procedures.flatMap(section => (section.data as {valores: unknown[]}).valores).length,80);
    }
    assert.equal(result.aviso,null);
    assert.deepEqual(result.filtros,{unidades:['unit-a']});
}
for (const state of [{loading:true,error:null},{loading:false,error:'Falha no grafo'}]) {
    const unavailable = buildAssistantJourneySections({pipeline,...state,query:'unit_ids=unit-b'});
    assert.equal(unavailable.length,1,'Loading/failed graph must not expose previous or summary metrics');
    assert.equal((unavailable[0].data as {carregando: boolean; erro: string | null}).carregando,state.loading);
    assert.equal((unavailable[0].data as {carregando: boolean; erro: string | null}).erro,state.error);
}
const legacy = {...context, sections:[{id:'widget',title:'Widget',data:{dados_referencia:'source'},truncated:false},{id:'source',title:'Source',data:{count:42},truncated:false}]};
assert.equal(readCurrentPageContext(legacy,'section','widget').secoes.length,2,'Dashboard string references remain supported');
assert.equal(readCurrentPageContext(context,'section','missing').secoes.length,0);
assert.equal(readCurrentPageContext(null,'all',null).ok,false);
console.log('Jornada assistant regression passed: three flows, 240 procedure branches, exact currency/null metrics, context limits, reference resolution, filters, loading/error isolation, legacy dashboard references.');
