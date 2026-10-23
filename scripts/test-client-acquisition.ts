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

const context = build({
    client: { last_origin: "Site - Home | Engravida", first_seen_at: "2026-10-22T10:00:00Z" },
    instagramUsers: [], threads: [{ id: "direct", channel: "Instagram" }],
    appointments: [{ id: "booking", thread_id: "direct", created_at: "2026-10-21T15:00:00Z" }],
    adAttributions: [
        { id: "official", message_id: "entry", thread_id: "direct", channel: "Instagram", meta_ad_id: "ad", referral_received_at: "2026-10-20T12:00:00Z", campaign_name: "Direct - Congelamento de óvulos", ad_set_name: "BH - mulheres" },
        { id: "unknown", message_id: "second", thread_id: "other", referral_received_at: "2026-10-20T13:00:00Z" },
        { id: "generic-reply", message_id: "attendant", thread_id: "other", referral_received_at: "2026-10-20T14:00:00Z" },
    ],
    entryMessages: [
        { id: "entry", thread_id: "direct", sender_type: "client", text: "Gostaria de saber os valores para o Congelamento de óvulos." },
        { id: "second", thread_id: "other", sender_type: "client", text: "Gostaria de saber os valores para o Congelamento de óvulos." },
        { id: "attendant", thread_id: "other", sender_type: "attendant", text: "Atendemos Congelamento de óvulos, Laqueadura, Ovodoação e LGBT." },
        { id: "later", thread_id: "direct", sender_type: "client", text: "FIV" },
    ],
    tintim: [{ id: "site", occurred_at: "2026-10-22T11:00:00Z", source: "Site", platform: "web" }],
});
const official = context.ads.find(ad => ad.id === "official")!;
assert.equal(official.campaignTheme, "Congelamento de óvulos");
assert.equal(official.campaignUnit, "Belo Horizonte");
assert.equal(official.entryInterest, "Congelamento de óvulos");
assert.equal(context.appointments[0].adAttributionId, "official", "The later site visit must not replace the booking's Direct referral");
assert.match(context.touchpoints[0].label, /Instagram/);
assert.equal(context.touchpoints.at(-1)!.label, "Site");
const unknown = context.ads.find(ad => ad.id === "unknown")!;
assert.equal(unknown.entryInterest, "Congelamento de óvulos");
assert.equal(unknown.campaignName, null, "A message cannot invent an official campaign name");
assert.equal(unknown.campaignTheme, null, "Message interest must remain separate from campaign metadata");
assert.equal(context.ads.find(ad => ad.id === "generic-reply")!.entryMessage, null, "An attendant's template must not classify the patient");
console.log("PASS campaign context: exact entry message, official theme/unit, separate patient interest, no attendant templates and Direct → site chronology.");
