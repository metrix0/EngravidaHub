const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const clock = new Date("2026-10-20T12:00:00Z");
class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock.getTime(); }
}
let database = {}, calls = [];
function split(value) {
    let depth = 0, start = 0;
    const result = [];
    for (let i = 0; i < value.length; i++) {
        if (value[i] === "(") depth++;
        if (value[i] === ")") depth--;
        if (value[i] === "," && depth === 0) { result.push(value.slice(start, i)); start = i + 1; }
    }
    result.push(value.slice(start));
    return result;
}
function expression(row, value) {
    if (value.startsWith("and(")) return split(value.slice(4, -1)).every(part => expression(row, part));
    const [, key, operator, target] = value.match(/^([^.]+)\.(gte|lt|lte|eq|is)\.(.*)$/) ?? [];
    assert.ok(key, `Unsupported expression ${value}`);
    const actual = row[key];
    if (operator === "is") return target === "null" && actual == null;
    if (actual == null) return false;
    if (operator === "gte") return actual >= target;
    if (operator === "lte") return actual <= target;
    if (operator === "lt") return actual < target;
    return actual === target;
}
function query(table) {
    const filters = [], orders = [];
    let from = 0, to = Infinity;
    const record = { table, filters: [] }; calls.push(record);
    const chain = new Proxy({}, { get(_, key) {
        if (key === "then") return (resolve, reject) => Promise.resolve().then(() => {
            let data = (database[table] ?? []).filter(row => filters.every(check => check(row)));
            data = [...data].sort((a, b) => {
                for (const [column, ascending] of orders) {
                    const diff = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
                    if (diff) return ascending ? diff : -diff;
                }
                return 0;
            }).slice(from, to + 1);
            return { data, error: null };
        }).then(resolve, reject);
        return (...args) => {
            record.filters.push([key, ...args]);
            if (key === "eq") filters.push(row => row[args[0]] === args[1]);
            if (key === "is") filters.push(row => row[args[0]] == args[1]);
            if (key === "not" && args[1] === "is" && args[2] === null) filters.push(row => row[args[0]] != null);
            if (key === "in") filters.push(row => args[1].includes(row[args[0]]));
            if (key === "gte") filters.push(row => row[args[0]] >= args[1]);
            if (key === "lt") filters.push(row => row[args[0]] < args[1]);
            if (key === "lte") filters.push(row => row[args[0]] <= args[1]);
            if (key === "or") filters.push(row => split(args[0]).some(part => expression(row, part)));
            if (key === "order") orders.push([args[0], args[1]?.ascending !== false]);
            if (key === "range") [from, to] = args;
            return chain;
        };
    } });
    return chain;
}
const loaded = new Map();
function load(relative, extra = "") {
    if (loaded.has(relative)) return loaded.get(relative);
    const exports = {};
    const built = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    });
    loaded.set(relative, exports);
    vm.runInNewContext(built.outputText + extra, {
        exports, console, Date: Clock, Intl, URL, URLSearchParams, AbortController, Request, Response,
        require: name => {
            if (name === "@/lib") return { supabase: { from: query, rpc: (name, args) => {
                if (name !== "dashboard_journey_outcomes_v1") return query("rpc");
                const ids = new Set(args.p_client_ids);
                const clients = (database.clients ?? []).filter(row => ids.has(row.id));
                const identity = phone => String(phone ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
                const hub = (database.appointments ?? []).flatMap(row => {
                    let client = row.client_id;
                    if (!client && row.source_external_id) client = [...database.schedules ?? [], ...database.funnel_clinisys_events ?? []].find(event => event.source_external_id === row.source_external_id)?.client_id;
                    if (!client) { const matches = (database.clients ?? []).filter(client => [client.phone, client.phone_identity].some(phone => phone && identity(phone) === identity(row.patient_phone))); if (matches.length === 1) client = matches[0].id; }
                    if (!client || !ids.has(client)) return [];
                    return [{ ...row, source_table: "appointments", client_id: client, source_hash: row.source_external_id ? null : "hub:" + row.id, created_in_source_at: null, scheduled_for: row.starts_at.slice(0, 10), unit_name: row.units?.name ?? null, status: ({completed:"Atendido",confirmed:"Não",scheduled:"Não",cancelled:"Desmarcou",no_show:"Faltou"})[row.status] ?? row.status }];
                });
                const data = { clients, schedule_rows: [...(database.schedules ?? []).filter(row => ids.has(row.client_id)).map(row => ({ ...row, source_table: "schedules" })), ...hub], funnel_rows: (database.funnel_clinisys_events ?? []).filter(row => ids.has(row.client_id)).map(row => ({ ...row, source_table: "funnel_clinisys_events" })), invoices: (database.clinisys_invoices ?? []).filter(row => ids.has(row.client_id)) };
                return { abortSignal: async () => ({ data, error: null }) };
            } } };
            if (name === "next/server") return { NextResponse: Response };
            if (name === "@/lib/auth/currentUserApi") return { getCachedCurrentUser: () => null };
            if (name === "@/components/ui/CalendarButton") return load("components/ui/CalendarButton.tsx");
            if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
            return require(name);
        },
    }, { filename: relative });
    return exports;
}
const { GET, __test } = load("app/api/dashboard/jornada/route.ts", "\nexports.__test = {loadPaidWhatsappConversations,loadFullJourneyPipeline,emptyPaidMediaTotals};");
const helpers = load("lib/funnel/fullJourney.ts");
const calendar = load("components/ui/CalendarButton.tsx");
for (const [preset, start, end] of [["mature_journey", "2026-07-22", "2026-09-20"], ["previous_month", "2026-09-01", "2026-09-30"], ["previous_two_months", "2026-08-01", "2026-09-30"]]) {
    const params = new URLSearchParams();
    calendar.applyCalendarDateParams({ params, selectedRange: { start: null, end: null }, selectedPreset: preset, presets: helpers.JOURNEY_CALENDAR_PRESETS });
    assert.equal(params.get("start_date"), start); assert.equal(params.get("end_date"), end);
}
const custom = new URLSearchParams();
calendar.applyCalendarDateParams({ params: custom, selectedRange: { start: "2026-06-01", end: "2026-06-12" }, selectedPreset: null, presets: helpers.JOURNEY_CALENDAR_PRESETS });
assert.equal(custom.get("start_date"), "2026-06-01");
const originalClock = clock.getTime();
clock.setTime(new Date("2026-01-15T12:00:00Z").getTime());
const january = calendar.getDateRangeFromPreset(helpers.JOURNEY_CALENDAR_PRESETS[2]);
assert.equal(january.start, "2025-11-01"); assert.equal(january.end, "2025-12-31");
clock.setTime(originalClock);
const registry = load("lib/personal-dashboard/registryExtended.ts");
assert.equal(registry.getDashboardWidget("jornada.jornada_completa"), null);
assert.ok(registry.getDashboardWidget("jornada.cobertura_whatsapp"));
assert.deepEqual(JSON.parse(JSON.stringify(helpers.getMatureJourneyRange(clock))), { start_date: "2026-07-22", end_date: "2026-09-20" });
assert.equal(helpers.getMatureJourneyRange(new Date("2026-10-20T01:00:00Z")).end_date, "2026-09-19");
for (const name of ["Retorno", "Ultrassonografia", "Novo procedimento", "", null]) {
    assert.equal(helpers.journeyProcedureKind({ procedure_name: name, event_kind: null }), "procedure");
}
assert.equal(helpers.journeyProcedureKind({ procedure_name: "1ª Avaliação de Reprodução Humana - presencial", event_kind: null }), "evaluation");
assert.equal(helpers.journeyProcedureKind({ procedure_name: "Nome antigo", event_kind: "evaluation" }), "evaluation");
const conversation = (client, date, origin = "Google Conta 1") => ({ id: "conversation-" + client, client_id: client, thread_id: client, channel: "WhatsApp", started_at: date + "T12:00:00Z", origin, unit_id: "11111111-1111-4111-8111-111111111111", service_id: null, attendant_id: null, tunnel: null, clients: {} });
const event = (id, client, kind, booked, date, status = "Atendido", name) => ({ id, source_external_id: id, source_hash: id, client_id: client, created_in_source_at: booked, created_at: booked + "T12:00:00Z", scheduled_for: date, status, event_kind: kind, procedure_name: name ?? (kind === "evaluation" ? "1ª Avaliação de Reprodução Humana - presencial" : "FIV"), unit_name: "Bauru" });
const invoice = (id, client, date, amount) => ({ source_invoice_id: id, client_id: client, issued_at: date + "T12:00:00Z", amount, status: "Autorizada" });
async function run(params = "") {
    const response = await GET(new Request("http://test/api/dashboard/jornada?full_pipeline_only=1&" + params));
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.full_pipeline.audit.error, null);
    return json.full_pipeline;
}
(async () => {
    database = {
        conversations: [conversation("p1", "2026-07-21"), conversation("p2", "2026-08-01"), conversation("p3", "2026-08-01"), conversation("p4", "2026-08-01")],
        clients: [1, 2, 3, 4].map(i => ({ id: "p" + i, phone: "551199999000" + i, phone_identity: "551199999000" + i })),
        schedules: [event("consult", "p1", null, "2026-07-23", "2026-08-01")],
        funnel_clinisys_events: [event("consult", "p1", "evaluation", "2026-07-23", "2026-08-01"), event("treatment", "p1", "procedure", "2026-08-02", "2026-08-10"), event("direct", "p2", "procedure", "2026-08-02", "2026-08-03"), event("unnamed", "p3", null, "2026-08-02", "2026-08-03", "Faltou", ""), event("future", "p3", "procedure", "2026-08-04", "2027-01-01")],
        appointments: [{ id: "hub-copy", client_id: "p1", source_external_id: "consult", created_at: "2026-07-23T12:00:00Z", starts_at: "2026-08-01T12:00:00Z", status: "completed", procedure_name: "1ª Avaliação de Reprodução Humana - presencial", units: { name: "Bauru" } }, { id: "hub-only", client_id: null, source_external_id: "local", patient_phone: "5511999990004", created_at: "2026-08-02T12:00:00Z", starts_at: "2026-08-03T12:00:00Z", status: "completed", procedure_name: null, units: { name: "Bauru" } }],
        clinisys_invoices: [invoice(1, "p1", "2026-08-01", 100), invoice(2, "p1", "2026-09-01", 300), invoice(2, "p1", "2026-09-01", 300), invoice(3, "p2", "2026-08-04", 200), invoice(4, "p1", "2026-06-01", 999)],
    };
    const pipeline = await run();
    const stages = Object.fromEntries(pipeline.stages.map(stage => [stage.key, stage]));
    assert.equal(pipeline.audit.cohort_start_date, "2026-07-22");
    assert.equal(stages.tracked_whatsapp.value, 4);
    assert.equal(stages.scheduled.value, 1);
    assert.equal(stages.attended.value, 1);
    assert.equal(stages.procedure_scheduled.value, 4);
    assert.equal(stages.procedure_attended.value, 3);
    assert.equal(stages.authorized.secondary_value, 600);
    assert.equal(stages.authorized.value, 2);
    assert.equal(pipeline.platform_breakdown.reduce((sum, item) => sum + item.authorized_revenue, 0), 600);
    assert.equal(stages.invoiced, undefined);
    assert.equal(pipeline.procedure_branches.reduce((sum, branch) => sum + branch.scheduled_appointments, 0), 6);
    assert.equal(pipeline.revenue_branches.reduce((sum, branch) => sum + branch.amount, 0), 600);
    assert.equal(pipeline.revenue_branches.find(branch => branch.kind === "evaluation").amount, 100);
    assert.equal(pipeline.revenue_branches.find(branch => branch.kind === "procedure").amount, 500);
    const originalContact = database.conversations[0].started_at;
    database.conversations[0].started_at = "2026-07-23T12:00:00Z";
    assert.equal((await run()).stages.find(stage => stage.key === "scheduled").value, 1);
    database.conversations[0].started_at = originalContact;
    database.clients.push({ id: "non-cohort", phone: "5511999990004" });
    assert.equal((await run()).audit.procedure_linkage.eligible_source_events, 5);
    database.clients.pop();
    const selected = await run("pipeline_use_selected=1&start_date=2026-10-01&end_date=2026-10-20");
    assert.equal(selected.stages.find(stage => stage.key === "tracked_whatsapp").value, 0);
    const filtered = await run("unit_ids=22222222-2222-4222-8222-222222222222");
    assert.equal(filtered.stages.find(stage => stage.key === "tracked_whatsapp").value, 0);
    // A historic unknown-origin conversation keeps its nearest TinTim evidence.
    database.tintim_attribution_events = [{ id: 7, client_id: "p1", occurred_at: "2026-07-21T12:00:00Z", platform: "google_ads", source: "Google Conta 1" }];
    database.conversations[0].origin = null;
    assert.equal((await run()).stages.find(stage => stage.key === "tracked_whatsapp").value, 4);
    for (let i = 5; i <= 9; i++) database.clients.push({ id: "p" + i, unit_id: "11111111-1111-4111-8111-111111111111" });
    database.conversations.push(conversation("p5", "2026-08-01", null), conversation("p6", "2026-08-01", "Site"));
    const profile = (id, client) => ({ id, client_id: client, last_meta_ad_id: "ad-" + id, last_paid_attribution_at: "2026-07-30T12:00:00Z" });
    database.instagram_users = [profile("ig8", "p8"), profile("ig9", null)];
    for (const [id, client] of [["ig8", "p8"], ["ig9", null]]) database.conversations.push({ ...conversation("social-" + id, "2026-08-01", "Instagram"), client_id: null, channel: "Instagram", instagram_user_id: id, instagram_users: profile(id, client) });
    database.conversations.push(conversation("p8", "2026-08-04", null));
    for (let i = 5; i <= 9; i++) {
        database.funnel_clinisys_events.push(event("consult-" + i, "p" + i, "evaluation", "2026-08-05", "2026-08-10"));
        database.clinisys_invoices.push(invoice(10 + i, "p" + i, "2026-08-11", i * 10));
    }
    for (let i = 8; i <= 9; i++) database.appointments.push({ id: "social-booking-" + i, client_id: "p" + i, source_external_id: "consult-" + i, booking_channel: "Instagram", booking_social_id: "ig" + i, created_at: "2026-08-05T12:00:00Z", starts_at: "2026-08-10T12:00:00Z", status: "completed", procedure_name: "1ª Avaliação de Reprodução Humana - presencial", units: { name: "Bauru" } });
    const expanded = await run();
    const groups = expanded.additional_pipelines;
    assert.equal(groups[0].pipeline.stages[0].value, 1);
    assert.equal(groups[1].pipeline.stages[0].value, 2);
    assert.equal(expanded.stages[0].value, 5);
    assert.equal(expanded.instagram.chats, 2);
    assert.equal(expanded.instagram.to_whatsapp, 1);
    assert.equal(expanded.instagram.to_consultation, 2);
    assert.equal(expanded.instagram.unlinked_chats, 1);
    assert.equal(expanded.instagram.clicks, null);
    database.ad_daily_instagram_direct_metrics = [
        { destination_type: "INSTAGRAM_DIRECT", metric_date: "2026-08-01", account_id: "a", adset_id: "1", link_clicks: 42 },
        { destination_type: "MESSENGER", metric_date: "2026-08-01", account_id: "a", adset_id: "2", link_clicks: 999 },
        { destination_type: "INSTAGRAM_DIRECT", metric_date: "2026-07-01", account_id: "a", adset_id: "3", link_clicks: 500 },
    ];
    assert.equal((await run()).instagram.clicks, 42);
    const summaryResponse = await GET(new Request("http://test/api/dashboard/jornada?summary_only=1&source_conversions=1&start_date=2026-07-22&end_date=2026-09-20"));
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.ok(summary.full_pipeline.audit.whatsapp_coverage.identified_clients > 0);
    assert.ok(summary.full_pipeline.audit.tracked_sources.some(source => source.scheduled_clients > 0));

    assert.equal([expanded, ...groups.map(group => group.pipeline)].reduce((sum, group) => sum + group.stages.find(stage => stage.key === "authorized").secondary_value, 0), 950);
    console.log("PASS: exclusive paid/untracked/organic cohorts, clinical-only patients, Instagram referral evidence, linked WhatsApp transfer, direct Instagram bookings, unavailable destination clicks and revenue counted once across all flows.");
    database.conversations = Array.from({ length: 1005 }, (_, i) => ({ ...conversation("p1", "2026-08-01"), id: "page-" + i }));
    const filters = { unitIds: [], serviceIds: [], attendantIds: [], tunnels: [], origins: [] };
    const range = { startAt: "2026-07-22T03:00:00Z", endAt: "2026-09-21T03:00:00Z" };
    const history = await __test.loadPaidWhatsappConversations(range, filters, new AbortController().signal, ["p1"]);
    assert.equal(history.rows.length, 1005);
    console.log("PASS: mature dates/timezone, pre-window contacts, all classifications, three-feed deduplication, phone-linked Hub appointments, future attendance, invoice chronology/deduplication, two revenue paths, selected dates, unit filters, TinTim history and pagination.");
    if (process.argv[2]) {
        database = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); calls = [];
        const started = performance.now();
        const live = await run();
        assert.ok(live.audit.procedure_linkage.invariant_ok);
        assert.ok(live.audit.procedure_linkage.tracked_clients > 0);
        const authorized = live.stages.find(stage => stage.key === "authorized");
        assert.equal(live.revenue_branches.reduce((sum, branch) => sum + branch.amount, 0), authorized.secondary_value);
        fs.writeFileSync("/tmp/jornada-live-result.json", JSON.stringify(live));
        console.log("PASS live-data sample:", JSON.stringify({ patients: database.clients.length, stages: live.stages.map(({ key, value, secondary_value }) => ({ key, value, secondary_value })), raw_events: live.audit.procedure_linkage.raw_events_read, eligible_events: live.audit.procedure_linkage.eligible_source_events, elapsed_ms: Math.round(performance.now() - started) }));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
