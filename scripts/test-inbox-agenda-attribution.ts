import assert from "node:assert/strict";
import { scheduleSourcePatch } from "../lib/schedules/reconcileScheduleSource";
import { inferTunnelFromAnalysis, inferTunnelFromReferrals, inferTunnelFromTracking, isMissingTunnel, validateTunnelAttribution } from "../lib/analysis/tunnelAttribution";
import { buildOperationalAgenda, type OperationalAgenda } from "../lib/scheduling/operationalAgenda";

assert.equal(inferTunnelFromTracking("[Direct] - BR - Congelamento - 20260713"), "Congelamento");
assert.equal(inferTunnelFromTracking("[Direct] - BR - LGBTQIA+ Vídeo 1"), "LGBT");
assert.equal(inferTunnelFromTracking("[Direct] - BR - Ovodoação - 20261013"), "Tratamentos");
assert.equal(inferTunnelFromTracking(null, "congelamento_post_01"), "Congelamento");
assert.equal(inferTunnelFromTracking("[SEARCH] LP Salvador"), null);
assert.equal(inferTunnelFromTracking("FIV e congelamento"), null);
assert.equal(inferTunnelFromTracking("Problemas", "Congelamento"), "Problemas");
assert.equal(inferTunnelFromTracking("não consigo engravidar"), "Problemas");
assert.equal(isMissingTunnel(" Entrada Orgânica "), true);

const referral = (campaign_name: string | null, text: string) => ({
    campaign_name, ad_set_name: null, ad_name: null, referral_ad_title: null, messages: { text },
});
assert.equal(inferTunnelFromReferrals([referral(null, "Oi"), referral("Problemas", "Quero saber sobre FIV")]), "Problemas");
assert.equal(inferTunnelFromReferrals([referral(null, "Olá! Gostaria de saber mais sobre congelamento de óvulos.")]), "Congelamento");
assert.equal(inferTunnelFromReferrals([referral(null, "Não tenho interesse em congelamento de óvulos")]), null);
assert.equal(inferTunnelFromReferrals([referral(null, "Quero informações sobre FIV e congelamento")]), null);
assert.equal(inferTunnelFromReferrals([referral(null, "Minha amiga fez FIV, quero marcar uma consulta")]), null);

const interest = (value: string, label: string, quote: string) => ({
    value, label, confidence: 0.95, category: "treatment_interest", evidence: [{ message_id: "entry", quote }],
});
const laqueadura = interest("reversao_laqueadura", "Reversão de laqueadura", "Vocês fazem reversão de laqueadura?");
const ovorecepcao = interest("ovorecepcao", "Ovorecepção", "Quero saber mais sobre ovorecepção.");
assert.equal(inferTunnelFromAnalysis({ pattern_signals: [laqueadura] })?.tunnel, "Laqueadura");
assert.equal(inferTunnelFromAnalysis({ pattern_signals: [ovorecepcao] })?.tunnel, "Tratamentos");
assert.equal(inferTunnelFromAnalysis({ pattern_signals: [laqueadura, ovorecepcao] }), null);
assert.equal(inferTunnelFromAnalysis({ pattern_signals: [{ ...laqueadura, confidence: 0.88 }] }), null);
assert.equal(inferTunnelFromAnalysis({ pattern_signals: [interest("fiv", "FIV", "Nunca quis fazer FIV.")] }), null);
assert.equal(validateTunnelAttribution({ tunnel: "Laqueadura", confidence: 0.95, evidence: laqueadura.evidence },
    [{ id: "entry", sender_type: "bot", text: laqueadura.evidence[0].quote }]), null);

const agenda: OperationalAgenda = {
    unit_id: "unit", unit_name: "Salvador", doctor_id: "doctor", doctor_name: "Dr. Joventina de Oliveira  Araujo",
    timezone: "America/Sao_Paulo", slot_duration_minutes: 15, procedures: [{ id: "rh", name: "1ª Avaliação de Reprodução Humana - presencial" }], exceptions: [], blocks: [],
    working_hours: [{ daysOfWeek: [1, 2, 3, 5], startsAt: "07:30", endsAt: "17:30", validFrom: "2026-01-01", validUntil: null }],
};
const input = { agendas: [agenda], appointments: [], start: "2026-11-16", end: "2026-11-23", reportDate: "2026-11-16", now: Date.parse("2026-11-16T06:00:00-03:00"), includeHistory: false };
const calendar = buildOperationalAgenda(input);
assert.equal(calendar.availability[0].firstDate, "2026-11-16");
const liveAgenda = { ...agenda, availability_snapshot: {
    dateFrom: "2026-11-16", dateTo: "2026-11-23", syncedAt: new Date(input.now).toISOString(), procedureId: "rh",
    slots: [16, 17, 18, 20].flatMap(day => Array.from({ length: 40 }, (_, index) => { const minute = 450 + index * 15; const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; return { data: `${day}/11/2026`, inicio: clock(minute), termino: clock(minute + 15) }; })),
} };
const report = buildOperationalAgenda({ ...input, agendas: [liveAgenda], reportAvailability: true });
assert.equal(report.availability[0].firstDate, "2026-11-17");
assert.equal(report.availability[0].threeDate, "2026-11-18");
assert.ok(report.availability[0].nextDates.every(date => date > input.reportDate));
assert.equal(report.availability[0].weeks[0], 21);
assert.ok(report.slots.every(slot => slot.durationMinutes === 45));

const campinas = { ...agenda, unit_name: "Campinas", doctor_name: "Dr. Fábio Padilla", working_hours: [{ daysOfWeek: [1, 3, 4, 5], startsAt: "08:00", endsAt: "18:00", validFrom: "2026-01-01", validUntil: null }] };
const liveCampinas = { ...campinas, availability_snapshot: { ...liveAgenda.availability_snapshot, slots: [16, 18, 19, 20].flatMap(day => Array.from({ length: 20 }, (_, index) => { const minute = 480 + index * 30; const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; return { data: `${day}/11/2026`, inicio: clock(minute), termino: clock(minute + 30) }; })) } };
const quota = buildOperationalAgenda({ ...input, agendas: [liveCampinas], reportAvailability: true, raFirstEvaluationCounts: { "doctor|2026-11-16|afternoon": 1 } });
// Monday quota is exhausted; Wed has 2 morning + 2 afternoon, Thu/Fri 1 each.
assert.equal(quota.availability[0].weeks[0], 6);
assert.equal(quota.availability[0].firstDate, "2026-11-18");
console.log("PASS: campaign examples, report dates, consultation durations, Campinas consultation quotas and calendar preservation.");

const noSnapshot = buildOperationalAgenda({ ...input, reportAvailability: true });
assert.equal(noSnapshot.availability[0].firstDate, null);
assert.equal(noSnapshot.availability[0].availabilityVerified, false);
const stale = buildOperationalAgenda({ ...input, agendas: [liveAgenda], now: input.now + 16 * 60_000, reportAvailability: true });
assert.equal(stale.availability[0].firstDate, null);
const wrongProcedure = buildOperationalAgenda({ ...input, agendas: [{ ...liveAgenda, availability_snapshot: { ...liveAgenda.availability_snapshot, procedureId: "usg" } }], reportAvailability: true });
assert.equal(wrongProcedure.availability[0].firstDate, null);
const emptyDate = buildOperationalAgenda({ ...input, agendas: [{ ...liveAgenda, availability_snapshot: { ...liveAgenda.availability_snapshot, slots: liveAgenda.availability_snapshot.slots.filter(row => row.data !== "17/11/2026") } }], reportAvailability: true });
assert.equal(emptyDate.availability[0].firstDate, "2026-11-18");
assert.ok(report.slots.every(slot => slot.date <= "2026-11-23"));
console.log("PASS: reports reject stale, missing, wrong-procedure and uncovered availability; provider-empty days stay empty.");

const unpublishedStart = buildOperationalAgenda({ ...input, agendas: [{ ...liveAgenda, availability_snapshot: { ...liveAgenda.availability_snapshot, slots: [{ data: "17/11/2026", inicio: "08:30", termino: "12:00" }] } }], reportAvailability: true });
assert.equal(unpublishedStart.availability[0].firstDate, null);
console.log("PASS: reports preserve the provider start without inventing RA starts.");

const sourceNow = Date.parse("2026-11-12T12:00:00Z");
const stored = { id: "schedule", source_external_id: "1", source: "bigquery", created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-01T12:00:00Z", source_visible: true, scheduled_for: "2026-11-09", created_in_source_at: "2026-11-01", procedure_name: "1ª Avaliação de Reprodução Humana - presencial", status: "Remarcou" };
const source = { id: "1", visible: true, scheduled_for: stored.scheduled_for, created_in_source_at: stored.created_in_source_at, procedure_name: stored.procedure_name, status: stored.status };
assert.equal(scheduleSourcePatch(stored, source, sourceNow), null);
assert.equal(scheduleSourcePatch(stored, undefined, sourceNow)?.source_visible, false);
assert.equal(scheduleSourcePatch({ ...stored, source: "clinisys", created_at: new Date(sourceNow).toISOString() }, undefined, sourceNow), null);
assert.equal(scheduleSourcePatch(stored, { ...source, visible: false }, sourceNow)?.source_visible, false);
assert.equal(scheduleSourcePatch(stored, { ...source, procedure_name: "Avaliação de Ciclo", status: "Atendido" }, sourceNow)?.procedure_name, "Avaliação de Ciclo");
assert.equal(scheduleSourcePatch({ ...stored, source_visible: false }, source, sourceNow)?.source_visible, true);
console.log("PASS: source changes, disappearance, hidden records, restoration and webhook warehouse-lag grace.");

const manaus = buildOperationalAgenda({ ...input, agendas: [{ ...liveAgenda, unit_name: "Manaus", doctor_name: "Dra. Mariana Coelho", availability_snapshot: { ...liveAgenda.availability_snapshot, slots: [{ data: "23/11/2026", inicio: "13:00", termino: "13:45" }], dateTo: "2026-11-30" } }], reportAvailability: true });
assert.equal(manaus.availability[0].firstDate, "2026-11-23");
console.log("PASS: Manaus provider times and RA restrictions use the same local timezone.");

const trailing = buildOperationalAgenda({ ...input, agendas: [{ ...liveAgenda, slot_duration_minutes: 45, availability_snapshot: { ...liveAgenda.availability_snapshot, slots: [{ data: "17/11/2026", inicio: "08:30", termino: "09:45" }, { data: "17/11/2026", inicio: "09:00", termino: "09:45" }] } }], reportAvailability: true });
assert.equal(trailing.availability[0].firstDate, "2026-11-17");
console.log("PASS: a valid full consultation at the end of verified capacity is preserved.");

const sundayDate = "2026-11-29";
const sundayNow = Date.parse(`${sundayDate}T18:00:00-03:00`);
const saturdayAgenda = { ...agenda, unit_name: "São Paulo", doctor_name: "Dr. Bárbara Tavares", availability_snapshot: {
    dateFrom: "2026-11-28", dateTo: "2026-12-20", syncedAt: new Date(sundayNow).toISOString(), procedureId: "rh",
    slots: ["28/11/2026", "05/12/2026", "12/12/2026", "19/12/2026"].map(data => ({ data, inicio: "08:00", termino: "08:45" })),
} };
const sundayReport = buildOperationalAgenda({ ...input, agendas: [saturdayAgenda], start: "2026-11-01", end: "2026-12-01", reportDate: sundayDate, now: sundayNow, reportAvailability: true });
assert.deepEqual(sundayReport.availability[0].weeks, [0, 1, 1, 1]);
assert.equal(sundayReport.availability[0].firstDate, "2026-12-05");

const fridayDate = "2026-11-13";
const fridayNow = Date.parse(`${fridayDate}T18:00:00-03:00`);
const morningAgenda = { ...agenda, unit_name: "Bauru", doctor_name: "Dr. Paula Nunes", availability_snapshot: {
    dateFrom: fridayDate, dateTo: "2026-11-20", syncedAt: new Date(fridayNow).toISOString(), procedureId: "rh",
    slots: [{ data: "13/11/2026", inicio: "08:00", termino: "08:45" }],
} };
const fridayInput = { ...input, agendas: [morningAgenda], reportDate: fridayDate, now: fridayNow };
const fridayReport = buildOperationalAgenda({ ...fridayInput, reportAvailability: true });
assert.equal(fridayReport.availability[0].weeks[0], 1);
assert.equal(fridayReport.availability[0].firstDate, null);
assert.equal(buildOperationalAgenda(fridayInput).slots.length, 0);
console.log("PASS: RA weeks start Monday, include D0 in full, end Sunday and cross months without changing the calendar.");

const specialSaturday = { ...liveAgenda, unit_name: "Juiz de Fora", doctor_name: "Dr. Leila Lamas", exceptions: [{ id: "explicit-opening", date: "2026-11-21", available: true, periods: [{ startsAt: "08:00", endsAt: "12:00" }] }], availability_snapshot: { ...liveAgenda.availability_snapshot, slots: [{ data: "21/11/2026", inicio: "08:00", termino: "08:45" }] } };
assert.equal(buildOperationalAgenda({ ...input, agendas: [specialSaturday], reportAvailability: true }).availability[0].saturdays[0]?.date, "2026-11-21");
assert.equal(buildOperationalAgenda({ ...input, agendas: [{ ...specialSaturday, exceptions: [{ ...specialSaturday.exceptions[0], id: "clinisys-availability:generated" }] }], reportAvailability: true }).availability[0].firstDate, null);
console.log("PASS: explicit Saturday openings are preserved; generated API exceptions cannot open procedure-only days.");
const overlappingOpenings = { ...specialSaturday, exceptions: [{ ...specialSaturday.exceptions[0], periods: [
    { startsAt: "08:00", endsAt: "10:00" }, { startsAt: "08:15", endsAt: "10:00" },
] }], availability_snapshot: { ...specialSaturday.availability_snapshot, slots: [
    { data: "21/11/2026", inicio: "08:00", termino: "08:45" },
    { data: "21/11/2026", inicio: "08:15", termino: "09:00" },
    { data: "21/11/2026", inicio: "08:45", termino: "09:30" },
    { data: "21/11/2026", inicio: "09:00", termino: "09:45" },
] } };
const packedSaturday = buildOperationalAgenda({ ...input, agendas: [overlappingOpenings, overlappingOpenings], reportAvailability: true });
assert.equal(packedSaturday.slots.length, 2);
assert.equal(packedSaturday.availability[0].saturdays[0].threeOrMore, false);

const unknownDoctor = { ...liveAgenda, doctor_name: "Not in RA timetable", availability_snapshot: { ...liveAgenda.availability_snapshot, dateTo: "2027-01-11", slots: [{ data: "17/11/2026", inicio: "08:15", termino: "09:00" }, { data: "17/11/2026", inicio: "08:15", termino: "09:00" }, { data: "17/11/2026", inicio: "08:30", termino: "09:15" }, { data: "09/01/2027", inicio: "08:00", termino: "08:45" }] } };
const exactSource = buildOperationalAgenda({ ...input, agendas: [unknownDoctor], reportAvailability: true });
assert.equal(exactSource.slots.length, 0);
assert.equal(exactSource.horizonEnd, "2027-01-11");
assert.equal(exactSource.availability[0].saturdays.length, 0);
console.log("PASS: doctors without a consultation timetable cannot contribute unverified consultation slots.");

const consultationAgenda = (unit: string, doctor: string, slots: Array<{ data: string; inicio: string; termino: string }>) => ({
    ...liveAgenda, unit_name: unit, doctor_name: doctor,
    availability_snapshot: { ...liveAgenda.availability_snapshot, dateFrom: "2026-11-13", dateTo: "2027-01-11", slots },
});
const bauru = consultationAgenda("Bauru", "Dr. Paula Nunes", [
    { data: "17/11/2026", inicio: "08:00", termino: "08:45" },
    { data: "18/11/2026", inicio: "08:00", termino: "08:45" },
    { data: "18/11/2026", inicio: "08:15", termino: "09:00" },
    { data: "18/11/2026", inicio: "08:30", termino: "09:15" },
    { data: "19/11/2026", inicio: "08:00", termino: "08:45" },
    { data: "19/11/2026", inicio: "08:45", termino: "09:30" },
    { data: "19/11/2026", inicio: "09:30", termino: "10:15" },
    { data: "19/11/2026", inicio: "09:30", termino: "10:15" },
    { data: "07/01/2027", inicio: "08:00", termino: "08:45" },
]);
const thresholds = buildOperationalAgenda({ ...input, agendas: [bauru, bauru], reportAvailability: true });
assert.equal(thresholds.availability[0].firstDate, "2026-11-17");
assert.equal(thresholds.availability[0].firstWaitDays, 1);
assert.equal(thresholds.availability[0].threeDate, "2026-11-19");
assert.equal(thresholds.availability[0].threeWaitDays, 3);
assert.deepEqual(thresholds.availability[0].nextDates, ["2026-11-17", "2026-11-18", "2026-11-19"]);
assert.equal(thresholds.availability[0].weeks[0], 5);
assert.equal(thresholds.horizonEnd, "2027-01-11");
const january = buildOperationalAgenda({ ...input, agendas: [bauru], start: "2027-01-01", end: "2027-02-01", reportAvailability: true });
assert.equal(january.slots.at(-1)?.date, "2027-01-07");
const booked = buildOperationalAgenda({ ...input, agendas: [bauru], reportAvailability: true, appointments: [{
    id: "new-booking", unit_id: "unit", doctor_id: "doctor", status: "confirmed",
    starts_at: "2026-11-19T08:45:00-03:00", ends_at: "2026-11-19T09:30:00-03:00",
}] });
assert.equal(booked.availability[0].threeDate, null);
const secondDoctor = { ...bauru, doctor_id: "second", availability_snapshot: { ...bauru.availability_snapshot, slots: [bauru.availability_snapshot.slots[1]] } };
const thirdDoctor = { ...secondDoctor, doctor_id: "third" };
const combined = buildOperationalAgenda({ ...input, agendas: [bauru, secondDoctor, thirdDoctor], reportAvailability: true });
assert.equal(combined.availability[0].threeDate, "2026-11-18");
console.log("PASS: 1+ versus 3+ distinct consultations, later dates, overlapping alternatives, duplicate agendas, multiple doctors, new bookings and full horizon.");

const procedurePeriods = [
    // Periods retained in the 13 November API cache behind the reported examples.
    consultationAgenda("São Paulo", "Dr. Thais Manzione", [
        { data: "16/11/2026", inicio: "10:30", termino: "11:15" },
    ]),
    consultationAgenda("São Paulo", "Dr. Carolina Yumi", [
        { data: "15/11/2026", inicio: "08:00", termino: "12:00" },
        { data: "16/11/2026", inicio: "14:30", termino: "15:15" },
        { data: "16/11/2026", inicio: "15:00", termino: "15:45" },
    ]),
    consultationAgenda("Vitória", "Dr. Brenda Battestin", [
        { data: "17/11/2026", inicio: "08:30", termino: "09:15" },
        { data: "17/11/2026", inicio: "09:15", termino: "10:00" },
        { data: "17/11/2026", inicio: "10:45", termino: "11:30" },
    ]),
    consultationAgenda("Vitória", "Dr. Bruna Mendes", [
        { data: "16/11/2026", inicio: "08:00", termino: "08:45" },
        { data: "18/11/2026", inicio: "08:00", termino: "08:45" },
        { data: "18/11/2026", inicio: "08:45", termino: "09:30" },
        { data: "18/11/2026", inicio: "09:30", termino: "10:15" },
    ]),
    consultationAgenda("Salvador", "Dr. Joventina de Oliveira Araujo", [
        { data: "17/11/2026", inicio: "08:15", termino: "09:00" },
    ]),
];
for (const source of procedurePeriods) {
    const result = buildOperationalAgenda({ ...input, agendas: [source], reportDate: "2026-11-13", reportAvailability: true });
    assert.equal(result.slots.length, 0, `${source.unit_name}: procedure-only periods must not enter the report`);
    assert.equal(result.availability[0].firstDate, null);
    assert.equal(result.availability[0].threeDate, null);
    assert.deepEqual(result.availability[0].weeks, [0, 0, 0, 0]);
}
const sundayOpening = { ...specialSaturday, exceptions: [{ ...specialSaturday.exceptions[0], date: "2026-11-22" }], availability_snapshot: {
    ...specialSaturday.availability_snapshot, slots: [{ data: "22/11/2026", inicio: "08:00", termino: "12:00" }],
} };
assert.deepEqual(buildOperationalAgenda({ ...input, agendas: [sundayOpening], reportAvailability: true }).availability[0].weeks, [0, 0, 0, 0]);
console.log("PASS: São Paulo, Vitória and Salvador procedure periods and Sunday openings excluded from all availability metrics.");
