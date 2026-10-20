// scripts/test-agenda-intelligence.ts
import assert from "node:assert/strict";
import { buildAgendaIntelligence, matchesSchedulingPreference, releasedSlotMetrics, type IntelligenceAgenda, type IntelligenceAppointment, type ScheduleHistory } from "../lib/scheduling/agendaIntelligence";
import { replicatedAgendaCapacity } from "../lib/clinisys/replicatedAvailability";
import { canAccessPathname, getTabIdForPathname, normalizeAllowedTabs } from "../lib/auth/userAccess";
import { formatDoctorName } from "../lib/scheduling/formatDoctorName";
import { AGENDA_REPORT_WIDGETS, agendaReportDashboardUrl } from "../lib/personal-dashboard/agendaReportWidgets";
import { AGENDA_INTELLIGENCE_WIDGETS } from "../lib/personal-dashboard/agendaIntelligenceWidgets";
import { buildOperationalAgenda, normalizeAgendaText } from "../lib/scheduling/operationalAgenda";
import { monthlyAgendaCounts } from "../lib/scheduling/agendaReportMetrics";
import { sectorBookingTeam, teamForAttendantName } from "../lib/scheduling/bookingOrigin";
import { filterDashboardWidgetIds } from "../lib/personal-dashboard/registryExtended";

// The separate page requires its own grant, even when appointments are allowed.
assert.equal(getTabIdForPathname("/inteligencia-agenda"), "inteligencia_agenda");
assert.equal(canAccessPathname("/inteligencia-agenda", ["agendamentos"]), false);
assert.equal(canAccessPathname("/inteligencia-agenda", ["inteligencia_agenda"]), true);
assert.deepEqual(normalizeAllowedTabs(["inteligencia_agenda", "inteligencia_agenda", "invalid"]), ["inteligencia_agenda"]);

const now = Date.parse("2026-10-05T07:00:00-03:00");
const agenda: IntelligenceAgenda = { unit_id: "unit", unit_name: "Unidade", doctor_id: "doctor", doctor_name: "Médico",
    timezone: "America/Sao_Paulo", slot_duration_minutes: 45, procedures: [], blocks: [], exceptions: [],
    working_hours: [{ daysOfWeek: [1], startsAt: "08:00", endsAt: "12:00", validFrom: "2026-01-01", validUntil: null }] };
const appointment = (id: string, start: string, end: string, status = "scheduled"): IntelligenceAppointment => ({ id, unit_id: "unit", doctor_id: "doctor", starts_at: `2026-10-05T${start}:00-03:00`, ends_at: `2026-10-05T${end}:00-03:00`, status });
const evidence = [{ message_id: "message", quote: "Quero consulta às 9:30" }];
const base = { days: 7, now, agendas: [agenda], appointments: [], analyses: [], history: [], historyStartedAt: null,
    doctors: [{ id: "doctor", unit_id: "unit", name: "Médico" }] };

// The 15-minute booking grid offers overlapping alternatives, not 14 real vacancies.
let report = buildAgendaIntelligence(base);
assert.equal(report.freeSlots, 5);
assert.equal(report.capacityMinutes, 240);
assert.equal(report.occupancy, 0);
assert.equal(report.medianWaitDays, 1 / 24);
report = buildAgendaIntelligence({ ...base, agendas: [agenda, agenda], appointments: [appointment("a", "08:00", "08:45"), appointment("b", "08:15", "09:00"), appointment("cancel", "09:00", "12:00", "cancelled")] });
assert.equal(report.capacityMinutes, 240); // Duplicate replicated agendas do not inflate capacity.
assert.equal(report.occupiedMinutes, 60); // Overlapping appointments are unioned.
assert.equal(report.occupancy, 25);
assert.equal(report.freeSlots, 4);
assert.equal(report.heatmap.reduce((sum, cell) => sum + cell.occupiedMinutes, 0), 60);

const unavailable = { ...agenda, exceptions: [{ date: "2026-10-05", available: false, periods: [{ startsAt: "09:00", endsAt: "10:00" }] }],
    blocks: [{ id: "block", type: "one_time", startsAt: "2026-10-05T11:00:00-03:00", endsAt: "2026-10-05T12:00:00-03:00" }] };
assert.equal(replicatedAgendaCapacity(unavailable, "2026-10-05").reduce((sum, slot) => sum + (slot.end - slot.start) / 60_000, 0), 120);
assert.equal(buildAgendaIntelligence({ ...base, agendas: [{ ...agenda, exceptions: [{ date: "2026-10-05", available: false, periods: [] }] }] }).freeSlots, 0);
const override = { ...agenda, exceptions: [{ date: "2026-10-06", available: true, periods: [{ startsAt: "17:00", endsAt: "18:30" }] }] };
assert.equal(buildAgendaIntelligence({ ...base, agendas: [override] }).freeSlots, 7);
assert.equal(matchesSchedulingPreference("saturday_afternoon", "2026-10-10", 17 * 60), true);
assert.equal(matchesSchedulingPreference("saturday_afternoon", "2026-10-09", 17 * 60), false);
assert.equal(matchesSchedulingPreference("after_18_30", "2026-10-05", 18 * 60 + 30), false);
assert.equal(matchesSchedulingPreference("from_17", "2026-10-05", 17 * 60), true);

const consultation = { category: "consultation_preference", value: "at_09_30", label: "Consulta às 9:30", confidence: 0.99, evidence };
const analysis = { conversation_id: "conversation", client_id: "client", started_at: "2026-10-04T12:00:00-03:00", clients: { unit_id: "unit" }, pattern_signals: [consultation, consultation,
    { ...consultation, category: "callback_preference" }, { ...consultation, value: "saturday", confidence: 0.5 }] };
report = buildAgendaIntelligence({ ...base, analyses: [analysis, analysis] });
assert.equal(report.preferences.length, 1);
assert.equal(report.preferences[0].conversations, 1);
assert.equal(report.preferences[0].availableSlots, 1); // Exact 9:30 is feasible even though greedy 45-min packing starts 9:45.
assert.deepEqual(
    buildAgendaIntelligence({ ...base, analyses: [analysis], coverage: { analyzedConversations: 25, signalsProcessed: 7 } }).coverage,
    { analyzedConversations: 25, signalsProcessed: 7, signalsPending: 18 },
);
report = buildAgendaIntelligence({ ...base, agendas: [], analyses: [analysis] });
assert.equal(report.preferences[0].coverageComplete, false);
assert.equal(report.occupancy, null);
assert.equal(report.medianWaitDays, null);
assert.equal(report.missingDoctors.length, 1);

const old = appointment("old", "08:00", "08:45");
const releasedAt = "2026-10-04T18:00:00-03:00";
const history: ScheduleHistory[] = [{ entity_id: "old", entity_type: "appointment", operation: "UPDATE", recorded_at: releasedAt, before_state: old, after_state: { ...old, status: "cancelled" } },
    { entity_id: "new", entity_type: "appointment", operation: "INSERT", recorded_at: "2026-10-04T19:00:00-03:00", before_state: null, after_state: appointment("new", "08:00", "08:45") }];
assert.deepEqual(releasedSlotMetrics(history, Date.parse("2026-10-05T09:00:00-03:00")), { released: 1, lateReleases: 1, settled: 1, recovered: 1, reschedules: 0 });
assert.equal(releasedSlotMetrics(history, now).settled, 0);
history.push({ entity_id: "new", entity_type: "appointment", operation: "UPDATE", recorded_at: "2026-10-04T20:00:00-03:00", before_state: appointment("new", "08:00", "08:45"), after_state: appointment("new", "08:00", "08:45", "cancelled") });
assert.equal(releasedSlotMetrics(history, Date.parse("2026-10-05T09:00:00-03:00")).recovered, 0);

// Calendar ranges select the cancellation/demand cohort; replacements may be recorded later.
const rangeStart = "2026-10-04T00:00:00-03:00", rangeEnd = "2026-10-05T00:00:00-03:00";
const replacementLater: ScheduleHistory[] = [history[0], { ...history[1], recorded_at: "2026-10-05T07:00:00-03:00" }];
assert.equal(releasedSlotMetrics(replacementLater, Date.parse("2026-10-06T09:00:00-03:00"), { start: Date.parse(rangeStart), end: Date.parse(rangeEnd) }).recovered, 1);
report = buildAgendaIntelligence({ ...base, now: Date.parse("2026-10-06T09:00:00-03:00"), resultsStart: rangeStart, resultsEnd: rangeEnd,
    appointments: [appointment("outside", "08:00", "08:45", "cancelled"), { ...appointment("inside", "08:00", "08:45", "cancelled"), starts_at: "2026-10-04T08:00:00-03:00" }],
    analyses: [{ ...analysis, started_at: "2026-10-04T12:00:00-03:00", clients: { unit_id: "unit", name: "Ana Silva" } }, { ...analysis, conversation_id: "outside", started_at: "2026-10-03T12:00:00-03:00" }],
    history: replacementLater, historyStartedAt: "2026-10-04T00:00:00-03:00" });
assert.equal(report.cancellations, 1);
assert.equal(report.preferences[0].conversations, 1);
assert.equal(report.evidenceDetails.conversation.name, "Ana Silva");
assert.equal(report.history.recovered, 1);
assert.equal(buildAgendaIntelligence({ ...base, resultsStart: rangeStart, resultsEnd: rangeEnd, historyStartedAt: "2026-10-05T12:00:00-03:00" }).history.observedFrom, null);
assert.equal(formatDoctorName("  DR.  ANA CAROLINA DE SOUZA  "), "Dr. Ana Carolina de Souza");
assert.equal(formatDoctorName("DRA. BÁRBARA D'ÁVILA"), "Dra. Bárbara D'Ávila");
assert.equal(formatDoctorName("Kelma Luana Abreu de Siqueira"), "Dr. Kelma Luana Abreu de Siqueira");
const widgetIds = AGENDA_INTELLIGENCE_WIDGETS.map(widget => widget.id);
assert.equal(widgetIds.length, 11);
assert.equal(widgetIds.includes("inteligencia_agenda.demanda_horaria"), true);
assert.equal(widgetIds.includes("inteligencia_agenda.demanda_horaria_unidade"), true);
assert.equal(widgetIds.indexOf("inteligencia_agenda.demanda_horaria") + 1, widgetIds.indexOf("inteligencia_agenda.demanda_horaria_unidade"));
assert.equal(widgetIds.indexOf("inteligencia_agenda.demanda_horaria_unidade") + 1, widgetIds.indexOf("inteligencia_agenda.preferencias"));
assert.equal(widgetIds.includes("inteligencia_agenda.recomendacoes"), false);
assert.deepEqual(filterDashboardWidgetIds(widgetIds, ["inteligencia_agenda"]), widgetIds);
assert.deepEqual(filterDashboardWidgetIds(widgetIds, ["agendamentos"]), []);
// Both report sections use the same dashboard permission and preserve daily/monthly scopes.
const reportWidgetIds = AGENDA_REPORT_WIDGETS.map(widget => widget.id);
assert.equal(reportWidgetIds.length, 15);
assert.equal(new Set(reportWidgetIds).size, 15);
assert.equal(AGENDA_REPORT_WIDGETS.filter(widget => widget.kind === "kpi").length, 8);
assert.equal(AGENDA_REPORT_WIDGETS.filter(widget => widget.kind === "chart").length, 2);
assert.equal(AGENDA_REPORT_WIDGETS.filter(widget => widget.kind === "table").length, 5);
assert.equal(reportWidgetIds.includes("agenda_indicadores.atendentes"), false);
assert.deepEqual(filterDashboardWidgetIds(reportWidgetIds, ["inteligencia_agenda"]), reportWidgetIds);
assert.deepEqual(filterDashboardWidgetIds(reportWidgetIds, ["agendamentos"]), []);
for (const widget of AGENDA_REPORT_WIDGETS) {
    assert.equal(widget.sourcePath, "/inteligencia-agenda");
    assert.deepEqual(widget.supportedFilters, ["units"]);
}
const dashboardReportParams = (source: "agenda_disponibilidade" | "agenda_indicadores", date: string) => new URL(agendaReportDashboardUrl(source, new URLSearchParams({ start_date: "2024-01-01", end_date: date }), ["unit-a", "unit-b"]), "http://localhost").searchParams;
const dailyParams = dashboardReportParams("agenda_disponibilidade", "2024-02-29");
assert.equal(dailyParams.get("report_date"), "2024-02-29");
assert.equal(dailyParams.get("start"), "2024-02-01");
assert.equal(dailyParams.get("end"), "2024-03-01");
assert.deepEqual(dailyParams.getAll("unit_ids"), ["unit-a", "unit-b"]);
const monthlyParams = dashboardReportParams("agenda_indicadores", "2026-12-31");
assert.equal(monthlyParams.get("report_date"), "2026-12-01");
assert.equal(monthlyParams.get("start"), "2026-12-01");
assert.equal(monthlyParams.get("end"), "2027-01-01");
assert.equal(monthlyParams.get("view"), "reports");

// Interest is actionable only with enough conversations; doctors without synchronized agendas are ignored.
const interested = Array.from({ length: 4 }, (_, index) => ({ ...analysis, client_id: `client-${index}`, conversation_id: `interest-${index}` }));
report = buildAgendaIntelligence({ ...base, analyses: interested });
assert.equal(report.opportunities[0].action, "expand");
assert.equal(report.opportunities[0].gap, 3);
assert.equal(report.opportunities[0].firstCompatibleSlot?.startsAt, "2026-10-05T12:30:00.000Z");
assert.equal(report.opportunities[0].firstCompatibleSlot?.doctorName, "Médico");
report = buildAgendaIntelligence({ ...base, analyses: interested, doctors: [...base.doctors, { id: "unsynced", unit_id: "unit", name: "Sem agenda" }] });
assert.equal(report.preferences[0].coverageComplete, true);
assert.equal(report.opportunities[0].action, "expand");
assert.equal(report.opportunities[0].gap, 3);
report = buildAgendaIntelligence({ ...base, analyses: interested.map(item => ({ ...item, pattern_signals: [{ ...consultation, value: "morning" }] })) });
assert.equal(report.opportunities[0].action, "fill");
assert.equal(buildAgendaIntelligence({ ...base, analyses: [analysis] }).opportunities.length, 0);

// Historical preferences stay visible; only clients without an identified booking drive suggestions.
const morning = { ...consultation, value: "morning", label: "Preferência por consultas pela manhã" };
const twelveRequests = Array.from({ length: 12 }, (_, index) => ({ ...analysis, conversation_id: `request-${index}`, client_id: `person-${index}`, pattern_signals: [morning] }));
const booked = Array.from({ length: 10 }, (_, index) => ({ ...appointment(`booking-${index}`, index < 8 ? "09:00" : "14:00", index < 8 ? "09:45" : "14:45"), client_id: `person-${index}` }));
report = buildAgendaIntelligence({ ...base, analyses: twelveRequests, demandAppointments: booked });
assert.equal(report.preferences[0].conversations, 12);
assert.equal(report.preferences[0].bookedMatching, 8);
assert.equal(report.preferences[0].bookedOther, 2);
assert.equal(report.preferences[0].withoutBooking, 2);
assert.equal(report.opportunities[0].conversations, 2);
assert.equal(report.opportunities[0].action, "fill");
assert.deepEqual(report.opportunities[0].contacts, ["request-10", "request-11"]);
assert.deepEqual(report.preferences[0].examples.slice(0, 2), ["request-10", "request-11"]);
assert.equal(Object.keys(report.evidenceDetails).length, 3);

// Existing outcomes are reused; a reported booking without a matching agenda record stays uncertain.
report = buildAgendaIntelligence({ ...base, analyses: twelveRequests.map(item => ({ ...item, customer_final_state: "scheduled" })) });
assert.equal(report.preferences[0].bookingUnverified, 12);
assert.equal(report.opportunities.length, 0);
report = buildAgendaIntelligence({ ...base, analyses: [{ ...twelveRequests[0], outcome_events: [{ type: "appointment_scheduled", confidence: 0.95, occurred_at: "2026-10-04T13:00:00-03:00" }] }] });
assert.equal(report.preferences[0].bookingUnverified, 1);
report = buildAgendaIntelligence({ ...base, analyses: [{ ...twelveRequests[0], outcome_events: [{ type: "appointment_scheduled", confidence: 0.95, occurred_at: "2026-10-03T13:00:00-03:00" }] }] });
assert.equal(report.preferences[0].withoutBooking, 1);

// New requests cannot be resolved by earlier visits. Cancellation/no-show do not fulfill the preference.
const earlierVisit = { ...booked[0], status: "completed", starts_at: "2026-10-03T09:00:00-03:00" };
for (const previous of [earlierVisit, { ...booked[0], status: "cancelled" }, { ...booked[0], status: "no_show" }]) {
    assert.equal(buildAgendaIntelligence({ ...base, analyses: [twelveRequests[0]], demandAppointments: [previous] }).preferences[0].withoutBooking, 1);
}
const lateRequest = { ...twelveRequests[0], pattern_signals: [{ ...morning, evidence: [{ message_id: "later", quote: "Quero consulta de manhã" }] }] };
const requestMessage = { id: "later", conversation_id: lateRequest.conversation_id, sent_at: "2026-10-05T15:00:00-03:00" };
assert.equal(buildAgendaIntelligence({ ...base, now: Date.parse("2026-10-05T17:00:00-03:00"), analyses: [lateRequest], evidenceMessages: [requestMessage], demandAppointments: [booked[0]] }).preferences[0].withoutBooking, 1);
assert.equal(buildAgendaIntelligence({ ...base, analyses: [twelveRequests[0]], evidenceMessages: [] }).preferences[0].bookingUnverified, 1);

// Another doctor's booking and dates beyond the visible capacity horizon still resolve a request.
assert.equal(buildAgendaIntelligence({ ...base, analyses: [twelveRequests[0]], demandAppointments: [{ ...booked[0], doctor_id: "another-doctor", starts_at: "2027-01-05T09:00:00-03:00" }] }).preferences[0].bookedMatching, 1);
const phoneRequest = { ...twelveRequests[0], clients: { id: "person-0", unit_id: "unit", phone: "+55 (61) 99999-1234" } };
const phoneBooking = { ...booked[0], client_id: null, patient_phone: "61999991234" };
assert.equal(buildAgendaIntelligence({ ...base, analyses: [phoneRequest], demandAppointments: [phoneBooking] }).preferences[0].bookedMatching, 1);
assert.equal(buildAgendaIntelligence({ ...base, analyses: [phoneRequest], demandAppointments: [{ ...phoneBooking, client_id: "different-person" }] }).preferences[0].withoutBooking, 1);
assert.equal(buildAgendaIntelligence({ ...base, analyses: [phoneRequest, { ...phoneRequest, client_id: "person-1", conversation_id: "ambiguous" }], demandAppointments: [phoneBooking] }).preferences[0].bookingUnverified, 2);
report = buildAgendaIntelligence({ ...base, analyses: interested.map(item => ({ ...item, client_id: "same-person" })) });
assert.equal(report.preferences[0].withoutBooking, 4);
assert.equal(report.preferences[0].casesToReview, 1);
assert.equal(report.opportunities[0].conversations, 1);
assert.equal(report.opportunities[0].contacts.length, 1);
report = buildAgendaIntelligence({ ...base, analyses: twelveRequests });
assert.equal(report.opportunities[0].contacts.length, 12); // All eligible contacts, not just the table's three examples.
assert.equal(Object.keys(report.evidenceDetails).length, 12);
assert.equal(buildAgendaIntelligence({ ...base, analyses: [{ ...analysis, customer_final_state: "not_qualified" }] }).preferences[0].casesToReview, 0);
// Operational reports pack physical consultations; repeated agendas and 15-minute
// alternatives must not inflate the free-slot count or the 3+ vacancies date.
const operationalBase = { agendas: [agenda], appointments: [], start: "2026-10-04", end: "2026-10-11", reportDate: "2026-10-05", now };
let operational = buildOperationalAgenda(operationalBase);
assert.equal(operational.counts.available, 5);
assert.equal(operational.slots.length, 5);
const compactOperational = buildOperationalAgenda({ ...operationalBase, includeHistory: false });
for (const key of ["counts", "byUnit", "byDoctor", "slots", "blocks", "availability", "daily"] as const) {
    assert.deepEqual(compactOperational[key], operational[key], `omitting unused history must preserve ${key}`);
}

assert.equal(operational.availability[0].firstWaitDays, 0);
assert.equal(operational.availability[0].threeWaitDays, 0);
assert.equal(operational.availability[0].weeks[0], 5);
// Replit's current-week count includes elapsed unfilled slots, while the
// next-date search still returns future dates only.
const fridayReport = buildOperationalAgenda({ ...operationalBase, reportDate: "2026-10-09", now: Date.parse("2026-10-09T13:00:00-03:00"), includeHistory: false });
assert.equal(fridayReport.availability[0].weeks[0], 5);
assert.equal(fridayReport.availability[0].firstDate, "2026-10-12");
assert.equal(fridayReport.slots.length, 0);
// A week crossing the month boundary still includes its previous-month day.
const boundaryReport = buildOperationalAgenda({ ...operationalBase, start: "2026-06-01", end: "2026-07-01", reportDate: "2026-06-01", now: Date.parse("2026-06-01T07:00:00-03:00"), includeHistory: false,
    agendas: [{ ...agenda, working_hours: [{ daysOfWeek: [7], startsAt: "08:00", endsAt: "12:00", validFrom: "2026-01-01", validUntil: null }] }],
    appointments: [{ ...appointment("past-booking", "08:00", "08:45"), starts_at: "2026-05-31T08:00:00-03:00", ends_at: "2026-05-31T08:45:00-03:00", booking_team: "ra" }] });
assert.equal(boundaryReport.availability[0].weeks[0], 4);
assert.equal(boundaryReport.availability[0].firstDate, "2026-06-07");
assert.equal(buildOperationalAgenda({ ...operationalBase, agendas: [agenda, agenda] }).counts.available, 5);
operational = buildOperationalAgenda({ ...operationalBase, appointments: [{ ...appointment("ra", "08:00", "08:45"), booking_team: "ra" }, { ...appointment("unit", "08:45", "09:30"), booking_team: "unit" }, appointment("unknown", "09:30", "10:15"), appointment("cancel", "10:15", "12:00", "cancelled")] });
assert.equal(operational.counts.ra, 1);
assert.equal(operational.counts.unit, 1);
assert.equal(operational.counts.unknown, 1);
assert.equal(operational.counts.available, 2);
assert.equal(operational.counts.occupancy, 60);
assert.equal(monthlyAgendaCounts(operational.counts).occupancy, 40);
assert.equal(operational.counts.occupancy, 60); // Calendar occupancy remains physical.
// Live Replit October report, checked 16/10/2026: 1,536 total records,
// including 10 other statuses that its four chart series do not represent.
const referenceMonthly = monthlyAgendaCounts({ total: 1536, available: 400, open: 283, ra: 337, unit: 504, unknown: 10, blocked: 2, occupancy: null, raOccupancy: null, unitOccupancy: null });
assert.equal(referenceMonthly.available, 683);
assert.equal(referenceMonthly.occupancy!.toFixed(1), "54.8");
assert.equal(referenceMonthly.raOccupancy!.toFixed(1), "21.9");
assert.equal(referenceMonthly.unitOccupancy!.toFixed(1), "32.8");
assert.deepEqual(monthlyAgendaCounts(referenceMonthly), referenceMonthly); // Saved snapshots are not counted twice.
assert.equal(monthlyAgendaCounts({ ...referenceMonthly, total: 0 }).occupancy, 0);
assert.equal(operational.availability[0].threeWaitDays, 7); // Next Monday, not the third chronological slot.
assert.equal(operational.availability[0].nextDates[1], "2026-10-12");
operational = buildOperationalAgenda({ ...operationalBase, agendas: [unavailable] });
assert.equal(operational.counts.available, 2);
assert.equal(operational.counts.blocked, 3);
assert.equal(operational.blocks.length, 2);
assert.ok(operational.slots.every(slot => !operational.blocks.some(block => Date.parse(slot.startsAt) < Date.parse(block.endsAt) && Date.parse(slot.endsAt) > Date.parse(block.startsAt))));
// Blocked slots remain part of the reference occupancy denominator.
const blockedAndBooked = buildOperationalAgenda({ ...operationalBase, agendas: [unavailable], appointments: [{ ...appointment("booked", "08:00", "08:45"), booking_team: "ra" }] });
assert.equal(blockedAndBooked.counts.total, 5);
assert.equal(blockedAndBooked.counts.occupancy, 20);
assert.equal(blockedAndBooked.counts.raOccupancy, 20);
assert.equal(normalizeAgendaText("HOR├üRIO DE ALMO├çO"), "HORÁRIO DE ALMOÇO");
assert.equal(normalizeAgendaText("Almo├ºo 12h ├ás 14h"), "Almoço 12h às 14h");
assert.equal(normalizeAgendaText("Férias / São Paulo / Almoço"), "Férias / São Paulo / Almoço");
const corruptLabels = buildOperationalAgenda({ ...operationalBase, agendas: [{ ...agenda, unit_name: "S├úo Paulo", blocks: [{ id: "lunch", type: "recurring", daysOfWeek: [1], validFrom: "2026-01-01", validUntil: null, startsAt: "10:00", endsAt: "11:00", reason: "Almo├ºo 1" }] }] });
assert.equal(corruptLabels.byUnit[0].unitName, "São Paulo");
assert.ok(corruptLabels.blocks.every(block => block.reason === "Almoço 1"));
const vacation = { ...agenda, blocks: [{ id: "vacation", type: "one_time", startsAt: "2026-10-04T00:00:00-03:00", endsAt: "2026-10-07T00:00:00-03:00", reason: "Férias" }] };
operational = buildOperationalAgenda({ ...operationalBase, agendas: [vacation] });
assert.equal(operational.counts.available, 0);
assert.equal(operational.blocks.length, 3);
assert.ok(operational.blocks.every(block => block.reason === "Férias"));
assert.equal(operational.availability[0].firstWaitDays, 7);
assert.equal(sectorBookingTeam("ra"), "ra");
assert.equal(sectorBookingTeam("reception"), "unit");
assert.equal(sectorBookingTeam(null), null);
const originAttendants = [{ id: "ra", name: "Ana Silva", team: "ra" as const }, { id: "unit", name: "Ana Souza", team: "unit" as const }];
assert.equal(teamForAttendantName("Ana da Silva", originAttendants), "ra");
assert.equal(teamForAttendantName("Ana", originAttendants), null);
assert.equal(teamForAttendantName("Ana Maria Silva", [...originAttendants, { id: "other", name: "Ana Maria Silva", team: "unit" as const }]), "unit");
assert.equal(teamForAttendantName("Ana Silva", [originAttendants[0], { id: "duplicate", name: "Ana Silva", team: "unit" as const }]), null);
console.log("Agenda intelligence and operational report regression checks passed.");
