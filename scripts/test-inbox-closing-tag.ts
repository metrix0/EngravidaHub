import assert from "node:assert/strict";
import { deriveInboxClosingTag, EXISTING_INBOX_CLOSING_TAGS } from "../lib/analysis/deriveInboxClosingTag";
import { conversationAnalysisSchema } from "../lib/ai/conversationAnalysisSchema";
import type { ConversationAnalysis } from "../types/conversation-analysis";

type Input = Parameters<typeof deriveInboxClosingTag>[0];

const event = (type: ConversationAnalysis["outcome_events"][number]["type"], confidence = 0.95) => ({
    type,
    occurred_at: null,
    confidence,
    evidence_message_ids: ["message-1"],
});

const base: Input = {
    conversation_goal: "schedule_consultation",
    goal_status: "not_achieved",
    customer_final_state: "unclear",
    outcome_events: [],
    dropoff: {
        happened: false,
        moment: null,
        likely_reason: null,
        confidence: 0,
        evidence_message_ids: [],
    },
    resolution: {
        resolved: false,
        reasoning_category: "unclear",
        evidence_message_ids: [],
    },
};

const cases: Array<{ name: string; input: Input; expected: string | null }> = [
    { name: "no inferred tag for unclear outcome", input: base, expected: null },
    {
        name: "appointment booked with evidence",
        input: { ...base, goal_status: "achieved", customer_final_state: "scheduled", outcome_events: [event("appointment_scheduled")] },
        expected: "Agendamento de 1ª avaliação",
    },
    {
        name: "no booking tag without evidence",
        input: { ...base, goal_status: "achieved", customer_final_state: "scheduled" },
        expected: null,
    },
    {
        name: "no booking tag for weak evidence",
        input: { ...base, goal_status: "achieved", customer_final_state: "scheduled", outcome_events: [event("appointment_scheduled", 0.6)] },
        expected: null,
    },
    {
        name: "rescheduled appointment",
        input: { ...base, conversation_goal: "reschedule_consultation", goal_status: "achieved", customer_final_state: "scheduled", outcome_events: [event("appointment_rescheduled")] },
        expected: "Reagendamento de 1ª avaliação",
    },
    {
        name: "attendance confirmed",
        input: { ...base, conversation_goal: "confirm_attendance", goal_status: "achieved", customer_final_state: "confirmed_attendance", outcome_events: [event("attendance_confirmed")] },
        expected: "Confirmação de 1ª avaliação",
    },
    {
        name: "patient did not respond",
        input: {
            ...base,
            customer_final_state: "stopped_responding",
            dropoff: { ...base.dropoff, happened: true, confidence: 0.95, evidence_message_ids: ["message-1"] },
            resolution: { ...base.resolution, reasoning_category: "customer_abandoned" },
        },
        expected: "Sem retorno da paciente",
    },
    {
        name: "no false nonresponse when conversation was resolved",
        input: {
            ...base,
            goal_status: "achieved", customer_final_state: "stopped_responding",
            dropoff: { ...base.dropoff, happened: true, confidence: 0.95, evidence_message_ids: ["message-1"] },
            resolution: { ...base.resolution, reasoning_category: "customer_abandoned" },
        },
        expected: null,
    },
    {
        name: "non-booking of first evaluation",
        input: { ...base, customer_final_state: "objected_to_price" },
        expected: "Não agendou 1ª Avaliação",
    },
    {
        name: "question answered",
        input: {
            ...base, conversation_goal: "answer_information", goal_status: "achieved",
            customer_final_state: "received_information", outcome_events: [event("information_answered")],
        },
        expected: "Dúvidas gerais",
    },
    {
        name: "treatment guidance",
        input: {
            ...base, conversation_goal: "explain_treatment", goal_status: "achieved",
            customer_final_state: "received_information", outcome_events: [event("information_answered")],
        },
        expected: "Orientações",
    },
    {
        name: "unrelated conversations remain untagged",
        input: { ...base, conversation_goal: "other", goal_status: "achieved", customer_final_state: "received_information" },
        expected: null,
    },
];

const existingTags = new Set([
    "Agendamento de 1ª avaliação",
    "Reagendamento de 1ª avaliação",
    "Confirmação de 1ª avaliação",
    "Não agendou 1ª Avaliação",
    "Sem retorno da paciente",
    "Dúvidas gerais",
    "Orientações",
]);

for (const { name, input, expected } of cases) {
    const actual = deriveInboxClosingTag(input);
    assert.equal(actual, expected, name);
    assert.ok(actual === null || existingTags.has(actual), "Must use an existing closing tag");
}

console.log(`Inbox closing-tag mapping: ${cases.length} regression checks passed`);

const allTags = [...EXISTING_INBOX_CLOSING_TAGS];
assert.equal(allTags.length, 49, "The existing vocabulary contains 49 stored labels");
assert.equal(new Set(allTags).size, allTags.length, "No duplicate labels");
const guarded = new Set(["Agendamento de 1ª avaliação", "Reagendamento de 1ª avaliação", "Confirmação de 1ª avaliação", "Sem retorno da paciente"]);
for (const tag of allTags) {
    const closing_tag = { value: tag, evidence_message_ids: ["message-1"] };
    assert.ok(conversationAnalysisSchema.shape.closing_tag.safeParse(closing_tag).success, `Schema must accept ${tag}`);
    if (!guarded.has(tag)) assert.equal(deriveInboxClosingTag({ ...base, closing_tag }), tag, `Must support ${tag}`);
}
assert.equal(deriveInboxClosingTag({ ...base, closing_tag: { value: "Invented" as any, evidence_message_ids: ["message-1"] } }), null, "No invented tags");
assert.equal(deriveInboxClosingTag({ ...base, closing_tag: { value: "Financeiro", evidence_message_ids: [] } }), null, "Missing evidence");
assert.equal(deriveInboxClosingTag({ ...base, closing_tag: { value: null, evidence_message_ids: [] } }), null, "Explicit abstention");
assert.equal(deriveInboxClosingTag({ ...base, closing_tag: { value: "Agendamento de 1ª avaliação", evidence_message_ids: ["message-1"] } }), null, "No false booking");
assert.equal(deriveInboxClosingTag({ ...base, closing_tag: { value: "Sem retorno da paciente", evidence_message_ids: ["message-1"] } }), null, "No false abandonment");
console.log(`Full closing-tag catalogue verified: ${allTags.length} labels`);
