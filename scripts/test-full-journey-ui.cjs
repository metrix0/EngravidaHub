const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "..");
const components = {
    Card: ({ children, className }) => React.createElement("div", { className }, children),
    InfoTooltip: ({ children }) => React.createElement("span", null, children),
    Skeleton: ({ className }) => React.createElement("div", { "data-skeleton": true, className }),
};
const source = ts.transpileModule(fs.readFileSync(path.join(root, "components/personal-dashboard/ExactJornadaDashboardGraphs.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const connectionsSource = ts.transpileModule(fs.readFileSync(path.join(root, "lib/funnel/journeyConnections.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const connectionExports = {};
vm.runInNewContext(connectionsSource, { exports: connectionExports });
const journeyContextSource = ts.transpileModule(fs.readFileSync(path.join(root, "lib/ai/assistantJourneyContext.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const journeyContextExports = {};
vm.runInNewContext(journeyContextSource, { exports: journeyContextExports });
let readGraphContext;
const fixture = {
    available: true, ads_available: true, filters_applied: false, currency_code: "BRL", acquisition_branches: [], procedure_branches: [], transitions: [],
    revenue_branches: [{ kind: "evaluation", clients: 1, amount: 100 }, { kind: "procedure", clients: 1, amount: 200 }],
    instagram: { clicks: null, chats: 20, to_whatsapp: 4, to_consultation: 2, unlinked_chats: 16 },
    stages: ["tracked_whatsapp", "scheduled", "attended", "procedure_scheduled", "procedure_attended", "authorized"].map((key, i) => ({ key, label: ["WhatsApp rastreado", "Agendaram Consulta", "Compareceram", "Agendaram Procedimento", "Compareceram", "Liberados"][i], value: 2, secondary_value: key === "authorized" ? 300 : null, secondary_kind: key === "authorized" ? "currency" : null })),
    audit: { error: null, matured_through: "2026-10-20", cohort_start_date: "2026-07-22", cohort_end_date: "2026-09-20" },
};
fixture.acquisition_branches = ["google_ads", "meta_ads"].map(platform => ({ platform, label: platform === "meta_ads" ? "Meta Ads" : "Google Ads", impressions: 1000, clicks: 100, click_through_rate: 10, tracked_clients: 2, click_to_tracked_rate: 2 }));
fixture.additional_pipelines = [{ key: "untracked", label: "WhatsApp não rastreado" }, { key: "organic", label: "Origem orgânica ou não rastreada" }].map(group => ({ key: group.key, pipeline: { ...fixture, instagram: undefined, acquisition_branches: [], stages: fixture.stages.map((stage, index) => index === 0 ? { ...stage, label: group.label } : stage) } }));
function load(react, fetch, window) {
    const exports = {};
    vm.runInNewContext(source + "\nexports.__test = ProcedurePipelineStages;", { exports, console, URLSearchParams, AbortController, fetch, window,
        require: name => name === "react" ? { ...React, ...react } : name === "@/components/dashboard/JourneyPatientsPanel" ? { default: () => null } : name === "@/lib/ai/assistantPageContext" ? { useAssistantPageContext: (_id, read) => { readGraphContext = read; } } : name === "@/lib/ai/assistantJourneyContext" ? journeyContextExports : name === "@/components" ? components : name === "@/lib/funnel/journeyConnections" ? connectionExports : require(name),
    });
    exports.FullJourneyPipelineCard.details = exports.__test;
    return exports.FullJourneyPipelineCard;
}
const Card = load(React);
const markup = renderToStaticMarkup(React.createElement(Card, { data: { full_pipeline: fixture } }));
assert.ok(!markup.includes("data-dashboard-card"));
assert.ok(!markup.includes(">Jornada completa<"));
assert.ok(markup.includes('aria-expanded="false"'));
assert.ok(markup.includes("Agendaram Consulta"));
assert.ok(markup.includes("Agendaram Procedimento"));
assert.ok(markup.includes("WhatsApp não rastreado"));
assert.ok(markup.includes("Origem orgânica ou não rastreada"));
assert.ok(markup.includes("Instagram Chat"));
assert.equal((markup.match(/>Clientes<\/button>/g) ?? []).length, 19);
assert.ok(markup.includes("Cliques pagos"));
assert.ok(markup.includes("absolute left-3 top-[190px] flex items-center"));
assert.ok(markup.includes("width:144px"));
assert.ok(!markup.includes("rounded-t-none"));
assert.ok(!markup.includes("rounded-b-none"));
assert.ok(!markup.includes("Maior gargalo clínico"));
assert.ok(!markup.includes("Conversão ponta a ponta"));
assert.ok(!markup.includes("Desfechos observados até"));
assert.ok(!markup.includes("WhatsApp: —"));
assert.ok(!markup.includes("Consultas: —"));
assert.ok(markup.includes("Caminhos confirmados do Instagram"));
assert.ok(markup.includes("R$ 300,00"));
assert.ok(!markup.includes("Faturados"));
assert.ok(markup.includes("Receita liberada após a consulta"));
const measured = {
    instagram_chat: { left: 560, right: 728, top: 388, bottom: 570 },
    tracked_whatsapp: { left: 644, right: 812, top: 107, bottom: 289 },
    scheduled: { left: 930, right: 1170, top: 107, bottom: 322 },
    attended: { left: 1288, right: 1528, top: 107, bottom: 322 },
    authorized: { left: 2362, right: 2572, top: 107, bottom: 289 },
};
const paths = connectionExports.journeyConnections(measured, { consultationRevenue: "R$ 100 · consultas", instagramWhatsapp: "0 → WhatsApp", instagramConsultations: "0 consultas" });
assert.equal(paths.find(row => row.key === "instagram_whatsapp").label, "0 → WhatsApp");
assert.ok(paths.find(row => row.key === "instagram_whatsapp").path.startsWith("M 728 467"));
assert.ok(paths.find(row => row.key === "instagram_whatsapp").path.endsWith("V 289"));
assert.ok(paths.find(row => row.key === "instagram_consultation").path.endsWith("V 322"));
const resized = connectionExports.journeyConnections({ ...measured, scheduled: { ...measured.scheduled, left: 940, right: 1180, bottom: 350 } }, { consultationRevenue: "R$ 100", instagramConsultations: "4 consultas" });
assert.ok(resized.find(row => row.key === "instagram_consultation").path.endsWith("H 1060 V 350"));
assert.ok(paths.find(row => row.key === "consultation_revenue").path.endsWith("V 107"));
assert.deepEqual(Array.from(connectionExports.journeyConnections({
    attended: { left: 0, right: 0, top: 0, bottom: 0 },
    authorized: { left: 0, right: 0, top: 0, bottom: 0 },
}, { consultationRevenue: "R$ 100" })), []);
for (const label of ["Clique → WhatsApp", "Clique → Instagram", "Rastreado → agenda", "Agenda → presença", "Agenda → Presença", "Consulta → procedimento"]) {
    assert.ok(!markup.includes(`>${label}</div>`));
}
let cursor = 0, slots = [], queue = [], requests = [], fail = false, defer = false, hold = false, pending = [], timers = new Map(), timerId = 0;
const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index];
        if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
            previous?.cleanup?.(); slots[index] = { deps }; queue.push(() => { slots[index].cleanup = effect(); });
        }
    },
    useRef(value) { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); },
};
const fetch = async (url, options) => {
    requests.push(url);
    if (hold) { hold = false; return new Promise(resolve => pending.push(resolve)); }
    if (defer) { defer = false; return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("Abort")))); }
    if (fail) { fail = false; return { ok: false, json: async () => ({ error: "Erro de teste" }) }; }
    return { ok: true, json: async () => ({ full_pipeline: fixture }) };
};
const Window = { setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id) { timers.delete(id); } };
function flushTimers(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } }
const Widget = load(hooks, fetch, Window);
let params = "start_date=2026-10-01&end_date=2026-10-20";
function render() { cursor = 0; const node = Widget({ data: { full_pipeline: { ...fixture, stages: fixture.stages.map(stage => ({ ...stage, value: 999 })), query_params: params } } });
    queue.splice(0).forEach(run => run()); return node; }
function nodes(node, test, result = []) {
    if (!node || typeof node !== "object") return result;
    if (test(node)) result.push(node);
    for (const child of React.Children.toArray(node.props?.children)) nodes(child, test, result);
    return result;
}
function button(node, text) { const result = nodes(node, item => item.type === "button" && String(item.props.children).includes(text))[0]; assert.ok(result, text); return result; }
const settle = () => { flushTimers(150); return new Promise(resolve => setImmediate(resolve)); };
(async () => {
    render();
    assert.equal(readGraphContext().sections.length, 1);
    assert.equal(readGraphContext().sections[0].data.carregando, true);
    assert.equal(requests.length, 1, "Initial load must start immediately without debounce");
    await settle(); let node = render();
    const loadedStages = readGraphContext().sections.find(section => section.id === "jornada-pipeline-paid-stages-0");
    assert.equal(loadedStages.data.valores[0].value, 2, "Assistant must read full graph response, not summary's 999");
    assert.ok(readGraphContext().sections.some(section => section.id.startsWith("jornada-pipeline-organic-")));
    assert.equal(requests.length, 1); assert.ok(requests[0].includes("start_date=2026-10-01"));
    params = "start_date=2026-09-01&end_date=2026-09-30";
    render(); await settle(); node = render(); assert.equal(requests.length, 2);
    assert.ok(requests.at(-1).includes("start_date=2026-09-01"));
    assert.equal(nodes(node, item => item.type === "button").length, 0);
    fail = true; params += "&unit_ids=u1"; render(); await settle(); node = render();
    assert.equal(readGraphContext().sections.length, 1);
    assert.equal(readGraphContext().sections[0].data.erro, "Erro de teste");
    button(node, "Tentar novamente").props.onClick(); render(); await settle(); node = render();
    assert.equal(nodes(node, item => item.type === "button" && item.props.children === "Tentar novamente").length, 0);
    defer = true; params = "start_date=2026-08-01&end_date=2026-08-31"; render();
    flushTimers(150); flushTimers(45_000); await settle(); node = render();
    assert.ok(button(node, "Tentar novamente"));
    defer = true; button(node, "Tentar novamente").props.onClick(); render();
    params = "start_date=2026-07-01&end_date=2026-07-31"; render(); await settle(); node = render();
    assert.ok(requests.at(-1).includes("start_date=2026-07-01"));
    assert.equal(nodes(node, item => item.type === "button" && item.props.children === "Tentar novamente").length, 0);
    // A failed period must recover when selected again after visiting another period.
    fail = true; params = "start_date=2026-06-01&end_date=2026-06-30";
    render(); await settle(); node = render();
    assert.ok(button(node, "Tentar novamente"));
    params = "start_date=2026-05-01&end_date=2026-05-31";
    render(); await settle(); render();
    params = "start_date=2026-06-01&end_date=2026-06-30";
    render(); await settle(); node = render();
    assert.equal(nodes(node, item => item.type === "button" && item.props.children === "Tentar novamente").length, 0,
        "Returning to a failed period must discard its old error after a successful response");
    const beforeRapidChanges = requests.length;
    params = "start_date=2026-04-01&end_date=2026-04-30"; render();
    params = "start_date=2026-03-01&end_date=2026-03-31"; render();
    params = "start_date=2026-02-01&end_date=2026-02-28"; render();
    assert.equal(requests.length, beforeRapidChanges, "Intermediate date changes must not start requests");
    await settle(); render();
    assert.equal(requests.length, beforeRapidChanges + 1);
    assert.ok(requests.at(-1).includes("start_date=2026-02-01"));

    // An old request may finish even after abort (including a delayed timeout rejection).
    hold = true; params = "start_date=2026-01-01&end_date=2026-01-31";
    render(); await settle();
    const resolveOld = pending.shift();
    flushTimers(45_000);
    params = "start_date=2026-02-01&end_date=2026-02-28";
    render(); await settle();
    hold = true; params = "start_date=2026-01-01&end_date=2026-01-31";
    render(); await settle();
    resolveOld({ ok: false, json: async () => ({ error: "Obsolete failure" }) });
    await settle(); node = render();
    assert.equal(readGraphContext().sections[0].data.carregando, true, "An obsolete timeout must not fail a new visit to the same period");
    pending.shift()({ ok: true, json: async () => ({ full_pipeline: fixture }) });
    await settle(); node = render();
    assert.equal(nodes(node, item => item.type === "button" && item.props.children === "Tentar novamente").length, 0);
    slots.forEach(slot => slot?.cleanup?.());
    slots = []; cursor = 0; queue = [];
    const props = { scheduled: fixture.stages[1], attended: fixture.stages[2], branches: [{ key: "exam", procedure_name: "Consulta específica", scheduled_appointments: 2, attended_appointments: 1 }], topOffset: 0, idPrefix: "paid" };
    let details = Widget.details(props);
    const toggle = nodes(details, item => item.type === "button")[0];
    assert.equal(toggle.props["aria-expanded"], false);
    assert.equal(nodes(details, item => item.props?.procedureName === "Consulta específica").length, 0);
    toggle.props.onClick(); cursor = 0; details = Widget.details(props);
    assert.equal(nodes(details, item => item.type === "button")[0].props["aria-expanded"], true);
    assert.equal(nodes(details, item => item.props?.procedureName === "Consulta específica").length, 2);
    console.log("PASS UI: card/title removed, clinical stages, currency headline, two revenue paths, global date changes, no widget-specific date controls, errors/retry, timeout, stale-request cancellation and collapsed/expanded consultation details.");
})().catch(error => { console.error(error); process.exitCode = 1; });

// Exercise the actual insights provider with loaded, failed and changing filters.
const insightsSource = ts.transpileModule(fs.readFileSync(path.join(root, "components/dashboard/JourneyDeepInsights.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const insightsData = {
    analytics: { timelines: [], sources: [], touchpoints: [], recovery: { total: 0, mature: 0, returned: 0, booked: 0, median_days: null }, recovery_moments: [] },
    creatives: { scope: {}, creatives: [] }, creative_error: false,
};
for (const state of [
    { data: null, loaded: null, loading: true, error: null, ready: false },
    { data: insightsData, loaded: "unit_ids=a", loading: false, error: null, ready: true },
    { data: insightsData, loaded: "unit_ids=a", loading: false, error: "Não foi possível carregar as análises da jornada.", ready: false },
    { data: insightsData, loaded: "unit_ids=old", loading: false, error: null, ready: false },
]) {
    const values = [state.data, state.loaded, state.loading, state.error, "authorized_revenue", 0, 1];
    let index = 0;
    let readInsights;
    const exports = {};
    vm.runInNewContext(insightsSource, { exports,
        require: name => name === "react" ? { useState: () => [values[index++], () => {}], useEffect: () => {}, useMemo: fn => fn() }
            : name === "@/components" ? components
            : name === "@/lib/conversationAnalysisLabels" ? { getDropoffMomentLabel: value => value }
            : name === "@/lib/ai/assistantPageContext" ? { useAssistantPageContext: (_id, read) => { readInsights = read; } }
            : require(name),
    });
    exports.default({ query: "unit_ids=a" });
    const context = readInsights();
    const status = context.sections.find(section => section.id === "jornada-insights-estado").data;
    assert.equal(status.dados_disponiveis, state.ready);
    assert.equal(status.erro, state.error);
    assert.equal(status.carregando, state.loading || (!state.error && state.loaded !== "unit_ids=a"));
    assert.equal(status.query, "unit_ids=a");
    assert.equal(context.sections.length, state.ready ? 5 : 1, "Unavailable insights must report status without stale metrics");
}
console.log("PASS insights context: loading, success, failed requests and changed filters expose explicit status without stale results.");

// Exercise server cancellation: abandoning dates must stop the remaining insight batches.
(async () => {
    const routeSource = ts.transpileModule(fs.readFileSync(path.join(root, "app/api/dashboard/jornada/insights/route.ts"), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    async function runInsights(cancelAfterFirstBatch, alreadyAborted = false) {
        const controller = new AbortController();
        if (alreadyAborted) controller.abort();
        const calls = [];
        const exports = {};
        vm.runInNewContext(routeSource, { exports, console, URL,
            require: name => name === "next/server" ? { NextResponse: Response }
                : name === "@/lib/attendants/getCurrentAttendantFromRequest" ? { getCurrentAttendantFromRequest: async () => ({ user: { id: "test" } }) }
                : name === "@/lib/dashboard/metrics" ? {
                    resolveDashboardDateRange: () => ({ startAt: "2026-07-30T03:00:00Z", endAt: "2026-09-29T03:00:00Z" }),
                    readDashboardFilters: () => ({ unitIds: [], attendantIds: [], tunnels: [], origins: [] }),
                }
                : name === "@/lib/supabase/client" ? { supabase: { rpc(name, params) {
                    let signal;
                    return { abortSignal(value) { signal = value; return this; }, then(resolve, reject) {
                        calls.push({ name, params, signal });
                        if (cancelAfterFirstBatch && params.p_shard === 0) controller.abort();
                        return Promise.resolve({ error: null, data: {
                            scope: { clients: 1 }, timeline_hist: [], touch_hist: [], return_hist: [],
                            recovery: { total: 0, mature: 0, returned: 0, booked: 0 }, recovery_moments: [], sources: [],
                        } }).then(resolve, reject);
                    } };
                } } } : require(name),
        });
        const request = new Request("http://localhost/api/dashboard/jornada/insights", { signal: controller.signal });
        const response = await exports.GET(request);
        return { response, calls, signal: request.signal };
    }
    const abandoned = await runInsights(true);
    assert.equal(abandoned.response.status, 499, "Abandoned date queries must not complete all eight expensive shards");
    assert.ok(abandoned.calls.length <= 2, "Cancellation must stop the next batch and creative query");
    assert.ok(abandoned.calls.every(call => call.signal === abandoned.signal), "Every RPC must receive the request's abort signal");
    const cancelledBeforeStart = await runInsights(false, true);
    assert.equal(cancelledBeforeStart.response.status, 499);
    assert.equal(cancelledBeforeStart.calls.length, 0);
    const normal = await runInsights(false);
    assert.equal(normal.response.status, 200);
    assert.equal(normal.calls.filter(call => call.name === "dashboard_journey_deep_insights").length, 8);
    assert.equal(normal.calls.filter(call => call.name === "dashboard_journey_creative_outcomes").length, 1);
    assert.ok(normal.calls.every(call => call.signal === normal.signal));
    assert.equal((await normal.response.json()).analytics.scope.clients, 8, "Normal load must retain all shards and aggregation");
    console.log("PASS insights cancellation: every RPC receives abort signal, abandoned requests stop batching, normal eight-shard output preserved.");
})().catch(error => { console.error(error); process.exitCode = 1; });
