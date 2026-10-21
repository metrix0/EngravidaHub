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
        require: name => name === "react" ? { ...React, ...react } : name === "@/components/dashboard/JourneyPatientsPanel" ? { default: () => null } : name === "@/components" ? components : name === "@/lib/funnel/journeyConnections" ? connectionExports : require(name),
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
let cursor = 0, slots = [], queue = [], requests = [], fail = false, defer = false, timers = new Map(), timerId = 0;
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
    if (defer) { defer = false; return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("Abort")))); }
    if (fail) { fail = false; return { ok: false, json: async () => ({ error: "Erro de teste" }) }; }
    return { ok: true, json: async () => ({ full_pipeline: fixture }) };
};
const Window = { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
const Widget = load(hooks, fetch, Window);
let params = "start_date=2026-10-01&end_date=2026-10-20";
function render() { cursor = 0; const node = Widget({ data: { full_pipeline: { ...fixture, query_params: params } } });
    queue.splice(0).forEach(run => run()); return node; }
function nodes(node, test, result = []) {
    if (!node || typeof node !== "object") return result;
    if (test(node)) result.push(node);
    for (const child of React.Children.toArray(node.props?.children)) nodes(child, test, result);
    return result;
}
function button(node, text) { const result = nodes(node, item => item.type === "button" && String(item.props.children).includes(text))[0]; assert.ok(result, text); return result; }
const settle = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    render(); await settle(); let node = render();
    assert.equal(requests.length, 1); assert.ok(requests[0].includes("start_date=2026-10-01"));
    params = "start_date=2026-09-01&end_date=2026-09-30";
    render(); await settle(); node = render(); assert.equal(requests.length, 2);
    assert.ok(requests.at(-1).includes("start_date=2026-09-01"));
    assert.equal(nodes(node, item => item.type === "button").length, 0);
    fail = true; params += "&unit_ids=u1"; render(); await settle(); node = render();
    button(node, "Tentar novamente").props.onClick(); render(); await settle(); node = render();
    assert.equal(nodes(node, item => item.type === "button" && item.props.children === "Tentar novamente").length, 0);
    defer = true; params = "start_date=2026-08-01&end_date=2026-08-31"; render();
    for (const fn of [...timers.values()]) fn(); await settle(); node = render();
    assert.ok(button(node, "Tentar novamente"));
    defer = true; button(node, "Tentar novamente").props.onClick(); render();
    params = "start_date=2026-07-01&end_date=2026-07-31"; render(); await settle(); node = render();
    assert.ok(requests.at(-1).includes("start_date=2026-07-01"));
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
