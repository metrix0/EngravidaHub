import assert from "node:assert/strict";
import { analysisPeriod, brazilDate, dueAnalysisTypes } from "../lib/units/macroPeriods";
import { partitionEvidence, verifiedEvidence } from "../lib/units/macroEvidence";
import { BRAZIL_STATES } from "../lib/units/brazilMap";

assert.deepEqual(analysisPeriod("weekly", "2026-09-13"), { period_start: "2026-09-06", period_end: "2026-09-13" });
assert.deepEqual(analysisPeriod("monthly", "2026-02-28"), { period_start: "2026-01-30", period_end: "2026-02-28" });
assert.deepEqual(analysisPeriod("monthly", "2026-03-30"), { period_start: "2026-02-28", period_end: "2026-03-30" });
assert.deepEqual(analysisPeriod("monthly", "2028-02-29"), { period_start: "2028-01-30", period_end: "2028-02-29" });
assert.deepEqual(dueAnalysisTypes("2026-08-30"), ["monthly", "weekly"]);
assert.deepEqual(dueAnalysisTypes("2026-02-28"), ["monthly"]);
assert.deepEqual(dueAnalysisTypes("2026-09-09"), []);
assert.equal(brazilDate(new Date("2026-09-13T02:59:00Z")), "2026-09-12");
assert.throws(() => analysisPeriod("weekly", "2026-02-30"));

const messages = [
    { id: "m1", conversation_id: "c1", text: "Não consigo comparecer na terça-feira. ".repeat(3000) + "🩷" },
    { id: "m2", conversation_id: "c2", text: "Consegui agendar para sábado." },
    { id: "m3", conversation_id: "c2", text: null },
];
const parts = partitionEvidence({ conversations: [{ id: "c1" }, { id: "c2" }], messages }).map(part => JSON.parse(part));
assert.ok(parts.length > 1);
assert.ok(parts.every(part => part.conversations.length === 2));
for (const message of messages) {
    assert.equal(parts.flatMap(part => part.messages).filter(item => item.id === message.id).map(item => item.text).join(""), message.text ?? "");
}
assert.equal(verifiedEvidence(messages, { conversation: "c1", evidence: "m1", quote: "Não consigo comparecer na terça-feira." }), true);
assert.equal(verifiedEvidence(messages, { conversation: "c2", evidence: "m1", quote: "Não consigo comparecer na terça-feira." }), false);
assert.equal(verifiedEvidence(messages, { conversation: "c1", evidence: "m1", quote: "O preço está alto." }), false);
assert.equal(verifiedEvidence(messages, { conversation: "c1", evidence: "m1", quote: " " }), false);
assert.equal(JSON.parse(partitionEvidence({ conversations: [], messages: [] })[0]).messages.length, 0);
assert.equal(new Set(BRAZIL_STATES.map(state => state.state)).size, 27);
console.log("Unit macro checks passed: calendar boundaries, complete long-message partitioning, literal evidence ownership, empty conversations and all 27 map regions.");
