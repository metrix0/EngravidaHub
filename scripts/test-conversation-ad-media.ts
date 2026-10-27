// scripts/test-conversation-ad-media.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

type Details = Record<string, string | null>;
type Api = {
    requestMetaGraphAd: (id: string, token: string) => Promise<Details>;
    getMetaGraphAd: (id: string) => Promise<Details>;
    resolveConversationAd: (id: string) => Promise<Details>;
};
const require = createRequire(import.meta.url);
const permanent = "https://db.test/storage/v1/object/public/ad-creatives/thumbnails/ad";
const response = (payload: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => payload });
function load(fetch: typeof globalThis.fetch, options: { cached?: unknown; zernio?: unknown } = {}) {
    const exports = {};
    const query = new Proxy({}, { get: (_, key) => key === "maybeSingle"
        ? async () => ({ data: options.cached ?? null, error: null }) : () => query });
    const mocks: Record<string, unknown> = {
        "@/lib/ads/mediaBudgetByCity": {},
        "@/lib/supabase/client": { supabase: { from: () => query } },
        "@/lib/zernio/client": {
            ZernioApiError: class extends Error {},
            getZernioAd: async () => { if (options.zernio) return options.zernio; throw new Error("not indexed"); },
            getZernioAdMedia: async () => { throw new Error("no media"); },
        },
    };
    const source = readFileSync(new URL("../lib/zernio/conversationAdAttribution.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled + "\nexports.test = { requestMetaGraphAd, getMetaGraphAd, resolveConversationAd };", {
        exports, require: (name: string) => mocks[name] ?? require(name), fetch,
        process: { env: { META_ADS_ACCESS_TOKEN: "ads-token", META_ACCESS_TOKEN: "page-token", NEXT_PUBLIC_SUPABASE_URL: "https://db.test" } },
        console: { warn() {} }, URL, AbortSignal,
    });
    return (exports as { test: Api }).test;
}
const mockFetch = (fn: (url: URL, init?: RequestInit) => unknown) =>
    (async (input: string | URL | Request, init?: RequestInit) => fn(new URL(String(input)), init)) as typeof fetch;

async function main() {
    const image = load(mockFetch(url => {
        assert.match(url.searchParams.get("fields")!, /creative\{.*image_url/);
        return response({ id: "ad", name: "Actual ad", creative: { image_url: "https://image.test/full.jpg", thumbnail_url: "https://image.test/small.jpg" } });
    }));
    assert.equal((await image.requestMetaGraphAd("ad", "token")).imageUrl, "https://image.test/full.jpg");

    for (const videoAllowed of [true, false]) {
        const api = load(mockFetch(url => url.pathname.endsWith("/video")
            ? response(videoAllowed ? { source: "https://video.test/movie.mp4" } : { error: { code: 100 } }, videoAllowed)
            : response({ id: "ad", name: "Video ad", creative: { asset_feed_spec: { videos: [{ video_id: "video", thumbnail_url: "https://image.test/video.jpg" }] } } })));
        const ad = await api.requestMetaGraphAd("ad", "token");
        assert.equal(ad.name, "Video ad");
        assert.equal(ad.imageUrl, "https://image.test/video.jpg");
        assert.equal(ad.videoUrl, videoAllowed ? "https://video.test/movie.mp4" : null);
    }

    const tokens: string[] = [];
    const fallback = load(mockFetch((_, init) => {
        const token = (init?.headers as Record<string, string>).Authorization;
        tokens.push(token);
        return token === "Bearer ads-token" ? response({ error: { message: "No permission", code: 100, error_subcode: 33 } }, false)
            : response({ id: "ad", name: "Accessible" });
    }));
    assert.equal((await fallback.getMetaGraphAd("ad")).name, "Accessible");
    assert.deepEqual(tokens, ["Bearer ads-token", "Bearer page-token"]);

    const partial = load(mockFetch(() => response({ id: "ad", name: "Meta ad", creative: { image_url: permanent } })), {
        zernio: { id: "zernio-ad", name: "Stored ad", campaign_name: "Known campaign" },
    });
    const enriched = await partial.resolveConversationAd("ad");
    assert.equal(enriched.imageUrl, permanent, "Zernio metadata without media must allow Meta enrichment");
    assert.equal(enriched.zernioAdId, "zernio-ad");
    assert.equal(enriched.campaignName, "Known campaign");

    const unavailable = load(mockFetch(() => { throw new Error("denied"); }), { cached: { ad_name: "Known ad", campaign_name: "Known campaign" } });
    assert.equal((await unavailable.resolveConversationAd("ad")).name, "Known ad", "A denied creative refresh must preserve existing metadata");
    const denied = load(mockFetch(() => response({ error: { message: "Denied", code: 100, error_subcode: 33 } }, false)));
    await assert.rejects(denied.resolveConversationAd("ad"), /100\/33/);
    console.log("PASS ad media: full image, dynamic video, video denial, token fallback, partial enrichment, cached metadata and inaccessible ads.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
