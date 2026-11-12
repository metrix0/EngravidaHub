import assert from "node:assert/strict";
import { inferTunnelFromTracking } from "../lib/analysis/tunnelAttribution";
import { buildOperationalAgenda, type OperationalAgenda } from "../lib/scheduling/operationalAgenda";

assert.equal(inferTunnelFromTracking("[Direct] - BR - Congelamento - 20260713"), "Congelamento");
assert.equal(inferTunnelFromTracking("[Direct] - BR - LGBTQIA+ Vídeo 1"), "LGBT");
assert.equal(inferTunnelFromTracking("[Direct] - BR - Ovodoação - 20261013"), "Tratamentos");
assert.equal(inferTunnelFromTracking(null, "congelamento_post_01"), "Congelamento");
assert.equal(inferTunnelFromTracking("[SEARCH] LP Salvador"), null);
assert.equal(inferTunnelFromTracking("FIV e congelamento"), null);
assert.equal(inferTunnelFromTracking("Problemas", "Congelamento"), "Problemas");

const agenda: OperationalAgenda = {
    unit_id: "unit", unit_name: "Salvador", doctor_id: "doctor", doctor_name: "Dr. Joventina de Oliveira  Araujo",
    timezone: "America/Sao_Paulo", slot_duration_minutes: 15, procedures: [], exceptions: [], blocks: [],
    working_hours: [{ daysOfWeek: [1, 2, 3, 5], startsAt: "07:30", endsAt: "17:30", validFrom: "2026-01-01", validUntil: null }],
};
const input = { agendas: [agenda], appointments: [], start: "2026-11-16", end: "2026-11-23", reportDate: "2026-11-16", now: Date.parse("2026-11-16T06:00:00-03:00"), includeHistory: false };
const calendar = buildOperationalAgenda(input);
assert.equal(calendar.availability[0].firstDate, "2026-11-16");
const report = buildOperationalAgenda({ ...input, reportAvailability: true });
assert.equal(report.availability[0].firstDate, "2026-11-17");
assert.equal(report.availability[0].threeDate, "2026-11-18");
assert.ok(report.availability[0].nextDates.every(date => date > input.reportDate));
assert.ok(report.availability[0].weeks[0] < calendar.availability[0].weeks[0]);

const campinas = { ...agenda, unit_name: "Campinas", doctor_name: "Dr. Fábio Padilla", working_hours: [{ daysOfWeek: [1, 3, 4, 5], startsAt: "08:00", endsAt: "18:00", validFrom: "2026-01-01", validUntil: null }] };
const quota = buildOperationalAgenda({ ...input, agendas: [campinas], reportAvailability: true, raFirstEvaluationCounts: { "doctor|2026-11-16|afternoon": 1 } });
// Monday quota is exhausted; Wed has 2 morning + 2 afternoon, Thu/Fri 1 each.
assert.equal(quota.availability[0].weeks[0], 6);
assert.equal(quota.availability[0].firstDate, "2026-11-18");
console.log("PASS: campaign examples, ambiguous/unidentified evidence, report dates, procedure restrictions, Campinas quotas, calendar preservation.");
