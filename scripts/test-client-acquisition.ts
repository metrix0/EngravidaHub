// scripts/test-client-acquisition.ts
import assert from "node:assert/strict";
import { buildClientAcquisition as build } from "../lib/clients/acquisition";

const result = build({
    client: { last_origin: "Google conta 1", last_tunnel: "LGBT", utm_source: "google", utm_term: "engravida clinica" },
    instagramUsers: [],
    threads: [{ id: "direct", channel: "Instagram" }, { id: "other", channel: "Instagram" }],
    appointments: [{ id: "booking", thread_id: "direct", created_at: "2026-10-22T15:00:00Z" }],
    adAttributions: [
        { id: "original", thread_id: "direct", meta_ad_id: "123", referral_received_at: "2026-10-21T15:00:00Z" },
        { id: "future", thread_id: "direct", meta_ad_id: "456", referral_received_at: "2026-10-23T15:00:00Z" },
        { id: "unrelated", thread_id: "other", referral_received_at: "2026-10-22T14:00:00Z", creative_image_url: "javascript:alert(1)" },
    ],
});
assert.equal(result.appointments[0].adAttributionId, "original", "A later ad or another conversation cannot replace the booking's recorded origin");
assert.equal(result.ads.length, 3, "Keep the complete referral history");
assert.equal(result.ads.find(ad => ad.id === "unrelated").imageUrl, null);
assert.equal(result.fields.find(field => field.key === "utm_source").value, "google");
assert.equal(result.fields.find(field => field.key === "last_origin").value, "Google conta 1");
assert.equal(result.fields.find(field => field.key === "utm_term").value, "engravida clinica");
assert.equal(result.fields.find(field => field.key === "last_tunnel").value, "LGBT");
const missing = build({ client: null, instagramUsers: [], adAttributions: [], threads: [{ id: "direct", channel: "Messenger" }], appointments: [{ id: "untracked", thread_id: "direct" }] });
assert.equal(missing.appointments[0].adAttributionId, null, "Missing evidence must remain unattributed");
console.log("PASS acquisition: booking chronology, conversation isolation, complete ad history, tracking fields, safe media URLs and missing evidence.");
