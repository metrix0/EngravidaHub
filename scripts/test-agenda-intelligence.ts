// scripts/test-agenda-intelligence.ts
import assert from "node:assert/strict";
import { buildAgendaIntelligence, matchesSchedulingPreference, releasedSlotMetrics, type IntelligenceAgenda, type IntelligenceAppointment, type ScheduleHistory } from "../lib/scheduling/agendaIntelligence";
import { replicatedAgendaCapacity } from "../lib/clinisys/replicatedAvailability";
import { canAccessPathname, getTabIdForPathname, normalizeAllowedTabs } from "../lib/auth/userAccess";
import { formatDoctorName } from "../lib/scheduling/formatDoctorName";
import { AGENDA_INTELLIGENCE_WIDGETS } from "../lib/personal-dashboard/agendaIntelligenceWidgets";
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
const analysis = { conversation_id: "conversation", clients: { unit_id: "unit" }, pattern_signals: [consultation, consultation,
    { ...consultation, category: "callback_preference" }, { ...consultation, value: "saturday", confidence: 0.5 }] };
report = buildAgendaIntelligence({ ...base, analyses: [analysis, analysis] });
assert.equal(report.preferences.length, 1);
assert.equal(report.preferences[0].conversations, 1);
assert.equal(report.preferences[0].availableSlots, 1); // Exact 9:30 is feasible even though greedy 45-min packing starts 9:45.
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
const widgetIds = AGENDA_INTELLIGENCE_WIDGETS.map(widget => widget.id);
assert.equal(widgetIds.length, 9);
assert.deepEqual(filterDashboardWidgetIds(widgetIds, ["inteligencia_agenda"]), widgetIds);
assert.deepEqual(filterDashboardWidgetIds(widgetIds, ["agendamentos"]), []);
console.log("Agenda intelligence regression checks passed.");
