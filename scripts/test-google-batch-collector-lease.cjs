// Regression: collector leases must be atomic across separate serverless workers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const src = fs.readFileSync(path.join(__dirname, "..", "lib/ai/googleBatchAnalysis.ts"), "utf8");
const code = ts.transpileModule(
    src + "\nexports.__leaseTest = { acquireBatchCollectionLease, releaseBatchCollectionLease };",
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
let now = Date.parse("2026-10-13T12:00:00Z");
let generation = 0;
const objects = new Map();
class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
}
async function fakeFetch(input, init = {}) {
    const url = new URL(String(input));
    const key = url.searchParams.get("name") || decodeURIComponent(url.pathname.split("/o/")[1] || "");
    const current = objects.get(key);
    const expected = url.searchParams.get("ifGenerationMatch");
    const reply = (status, obj = {}) =>
        new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
    if (init.method === "POST") {
        if (expected === "0" ? !!current : expected !== current?.generation) return reply(412);
        const metadata = { generation: String(++generation), timeCreated: new Clock().toISOString() };
        objects.set(key, metadata);
        return reply(200, metadata);
    }
    if (init.method === "DELETE") {
        if (!current) return reply(404);
        if (expected !== current.generation) return reply(412);
        objects.delete(key);
        return reply(200);
    }
    return current ? reply(200, current) : reply(404);
}
function worker() {
    const exports = {};
    const modules = {
        "zod": { z: { toJSONSchema: () => ({}) } },
        "google-auth-library": { GoogleAuth: class {
            async getClient() { return { getAccessToken: async () => ({ token: "fake" }) }; }
        } },
    };
    vm.runInNewContext(code, {
        exports, require: (name) => modules[name] || {},
        process: { env: {
            GOOGLE_AI_BATCH_BUCKET: "test-bucket",
            GOOGLE_AI_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "test@example.invalid", private_key: "fake" }),
        } },
        URL, Headers, Response, fetch: fakeFetch, Date: Clock, console,
    }, { filename: "lib/ai/googleBatchAnalysis.ts" });
    return exports.__leaseTest;
}
async function test() {
    const a = worker(), b = worker();
    const [aLease, bLease] = await Promise.all([
        a.acquireBatchCollectionLease("job-1"),
        b.acquireBatchCollectionLease("job-1"),
    ]);
    assert.equal(Number(!!aLease) + Number(!!bLease), 1, "only one collector owns the job");
    const owner = aLease ? a : b, contender = aLease ? b : a, first = aLease || bLease;
    assert.equal(await contender.acquireBatchCollectionLease("job-1"), null, "active lease blocks second collector");
    await owner.releaseBatchCollectionLease(first);
    const next = await contender.acquireBatchCollectionLease("job-1");
    assert.ok(next, "released lease is reusable");

    now += 10 * 60_000 + 1;
    const recovered = await owner.acquireBatchCollectionLease("job-1");
    assert.ok(recovered, "expired lock recovers after an invocation dies");
    assert.notEqual(recovered.generation, next.generation);
    await contender.releaseBatchCollectionLease(next);
    assert.equal(await contender.acquireBatchCollectionLease("job-1"), null,
        "stale owner must not delete replacement lock");
    await owner.releaseBatchCollectionLease(recovered);
    assert.ok(await contender.acquireBatchCollectionLease("job-1"), "current owner can release its lock");
    assert.ok(await a.acquireBatchCollectionLease("job-2"), "unrelated batch can run in parallel");
    console.log("Google batch collector lease regression tests passed");
}
test().catch((error) => { console.error(error); process.exitCode = 1; });
