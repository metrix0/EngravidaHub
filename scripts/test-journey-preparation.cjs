const assert = require("node:assert/strict");
(async () => {
    const { prepareJourneyPatients } = await import("../supabase/functions/journey-refresh/journey-engine.mjs");
    const c = { id: "p1", unit_id: null, last_origin: null };
    const event = (id, kind, date, status = "Atendido") => ({ source_table: "schedules", client_id: c.id, source_external_id: id, source_hash: id,
        created_in_source_at: date, created_at: date + "T12:00:00Z", scheduled_for: date, status,
        procedure_name: kind === "evaluation" ? "1ª Avaliação de Reprodução Humana - presencial" : null, event_kind: kind, unit_name: "Bauru" });
    const source = { clients: [c], conversations: [
        { id: "early", client_id: c.id, started_at: "2026-07-01T12:00:00Z", origin: "Google Conta 1", unit_id: null, service_id: null, attendant_id: null, tunnel: null, clients: {} },
        { id: "later", client_id: c.id, started_at: "2026-08-10T12:00:00Z", origin: null, unit_id: null, service_id: null, attendant_id: null, tunnel: null, clients: {} },
    ], social: [], tintim: [], outcomes: { schedule_rows: [event("consult", "evaluation", "2026-07-20"), event("procedure", "procedure", "2026-09-01"), event("future", "procedure", "2099-01-01")],
        funnel_rows: [event("consult", "evaluation", "2026-07-20")], invoices: [
            { source_invoice_id: 1, client_id: c.id, issued_at: "2026-07-20T12:00:00Z", amount: 100, status: "Autorizada" },
            { source_invoice_id: 1, client_id: c.id, issued_at: "2026-07-20T12:00:00Z", amount: 100, status: "Autorizada" },
            { source_invoice_id: 2, client_id: c.id, issued_at: "2026-09-02T12:00:00Z", amount: 200, status: "Autorizada" },
        ] } };
    const [patient] = await prepareJourneyPatients(source);
    assert.equal(patient.contacts.length, 2);
    const early = patient.anchors.find(row => row.anchor_key === "2026-07-01");
    const later = patient.anchors.find(row => row.anchor_key === "2026-08-10");
    assert.equal(early.metrics.authorized_amount, 300);
    assert.equal(early.metrics.evaluation_revenue, 100);
    assert.equal(early.metrics.procedure_revenue, 200);
    assert.equal(early.metrics.authorized, 1);
    assert.equal(early.metrics.scheduled, 1);
    assert.equal(early.metrics.procedure_attended, 1);
    assert.equal(later.metrics.scheduled, 0);
    assert.equal(later.metrics.authorized_amount, 200);
    assert.equal(early.procedures.find(row => row.event_kind === "evaluation").scheduled_appointments, 1);
    assert.equal(early.procedures.find(row => row.event_kind === "procedure").scheduled_appointments, 2);
    assert.equal(early.procedures.find(row => row.event_kind === "procedure").attended_appointments, 1);
    assert.ok(patient.activity.includes("2026-07-20"));
    assert.equal(patient.contacts[0].platform, "google_ads");
    source.tintim = [{ id: "tin", client_id: c.id, occurred_at: "2026-08-09T12:00:00Z", source: "Meta", platform: "meta_ads" }];
    const [updated] = await prepareJourneyPatients(source);
    assert.equal(updated.contacts[1].platform, "meta_ads");
    assert.equal(updated.contacts[1].evidence, "tintim");
    assert.equal((await prepareJourneyPatients({ ...source, clients: [] })).length, 0);
    console.log("PASS: pure bounded preparation, historical entry anchors, TinTim updates, invoice uniqueness/chronology, shared classifications, unnamed procedures, future attendance and cross-feed deduplication.");
})().catch(error => { console.error(error); process.exitCode = 1; });
