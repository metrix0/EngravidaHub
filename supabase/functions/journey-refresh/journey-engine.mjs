var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/journey-worker-stubs.cjs
var require_journey_worker_stubs = __commonJS({
  "scripts/journey-worker-stubs.cjs"(exports) {
    exports.supabase = new Proxy({}, { get() {
      throw new Error("Preparation must use its supplied source batch");
    } });
    exports.NextResponse = void 0;
  }
});

// lib/schedules/status.ts
function normalizeScheduleStatus(value) {
  const normalized = normalizeStatusText(value);
  switch (normalized) {
    case "nao":
      return "pending";
    case "sim":
      return "arrived";
    case "em_atendimento":
      return "in_service";
    case "atendido":
    case "atendida":
      return "attended";
    case "desmarcou":
    case "cancelado":
    case "cancelada":
      return "cancelled";
    case "faltou":
    case "nao_compareceu":
      return "no_show";
    case "remarcou":
    case "remarcado":
    case "remarcada":
    case "reagendado":
    case "reagendada":
      return "rescheduled";
    default:
      return "unknown";
  }
}
function scheduleShowedUp(status) {
  return ["arrived", "in_service", "attended"].includes(status);
}
function normalizeStatusText(value) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// lib/funnel/clinisysJourney.ts
var FIV_STAGE_IDS = {
  evaluationScheduled: "21111111-1111-1111-1111-111111111111",
  evaluationCompleted: "22222222-1111-1111-1111-111111111111",
  procedureScheduled: "23333333-1111-1111-1111-111111111111",
  procedureCompleted: "24444444-1111-1111-1111-111111111111"
};
var FIV_STAGE_ID_SET = new Set(Object.values(FIV_STAGE_IDS));
function classifyClinisysJourneyProcedure(procedureName) {
  const normalized = normalizeProcedureText(procedureName);
  if (!normalized) return null;
  if (isFirstEvaluationProcedure(procedureName)) return "evaluation";
  return "procedure";
}
function isFirstEvaluationProcedure(procedureName) {
  const normalized = normalizeProcedureText(procedureName);
  return /\b(?:1|1a|1o|primeira)\s+avaliacao\b/.test(normalized);
}
function normalizeProcedureText(value) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[ªº°]/g, " ").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

// lib/funnel/fullJourney.ts
function journeyProcedureKind(event) {
  if (event.event_kind === "evaluation" || event.event_kind === "procedure") return event.event_kind;
  return classifyClinisysJourneyProcedure(event.procedure_name) ?? "procedure";
}

// lib/dashboard/journeyEngine.ts
var import_server = __toESM(require_journey_worker_stubs());
var import_lib = __toESM(require_journey_worker_stubs());

// lib/ads/paidMediaAttribution.ts
var GOOGLE_PAID_ORIGIN_FAMILIES = [
  "google conta 1",
  "google conta 2"
];
var META_PAID_ORIGIN_FAMILIES = [
  "meta que passa pela lp",
  "meta clique para whatsapp",
  "direct meta para whatsapp"
];
function paidMediaPlatformFromOrigin(value) {
  const origin = normalizeAttributionText(value);
  if (!origin) return null;
  if (GOOGLE_PAID_ORIGIN_FAMILIES.some(
    (family) => belongsToOriginFamily(origin, family)
  )) {
    return "google_ads";
  }
  if (META_PAID_ORIGIN_FAMILIES.some(
    (family) => belongsToOriginFamily(origin, family)
  )) {
    return "meta_ads";
  }
  return null;
}
function paidMediaPlatformFromTrackingSource(value) {
  const source = normalizeAttributionText(value);
  if (!source) return null;
  if (/(^| )(google|adwords|gads|youtube)( |$)/.test(source)) {
    return "google_ads";
  }
  if (/(^| )(meta|facebook|instagram|fb|ig)( |$)/.test(source)) {
    return "meta_ads";
  }
  return null;
}
function resolvePaidMediaAttribution(client) {
  if (!client) return null;
  const originPlatform = paidMediaPlatformFromOrigin(client.last_origin);
  if (originPlatform) {
    return { platform: originPlatform, evidence: "origin" };
  }
  const sourcePlatform = paidMediaPlatformFromTrackingSource(
    client.utm_source
  );
  if (sourcePlatform) {
    return { platform: sourcePlatform, evidence: "utm_source" };
  }
  const hasGoogleClick = Boolean(
    client.gclid || client.gbraid || client.wbraid
  );
  const hasMetaClick = Boolean(
    client.fbclid || client.fbc || client.ctwa_clid
  );
  if (hasGoogleClick && !hasMetaClick) {
    return { platform: "google_ads", evidence: "click_id" };
  }
  if (hasMetaClick && !hasGoogleClick) {
    return { platform: "meta_ads", evidence: "click_id" };
  }
  return null;
}
function belongsToOriginFamily(origin, family) {
  return origin === family || origin.startsWith(`${family} `);
}
function normalizeAttributionText(value) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// lib/dashboard/metrics.ts
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var SAO_PAULO_OFFSET = "-03:00";
function resolveDashboardDateRange(searchParams) {
  const requestedDays = Number(searchParams.get("days") ?? 7);
  const days = Number.isFinite(requestedDays) ? Math.min(3650, Math.max(1, Math.trunc(requestedDays))) : 7;
  const requestedStart = normalizeDate(searchParams.get("start_date"));
  const requestedEnd = normalizeDate(searchParams.get("end_date"));
  let start;
  let end;
  let startDate = null;
  let endDate = null;
  if (requestedStart) {
    startDate = requestedStart;
    endDate = requestedEnd ?? requestedStart;
    const orderedStart = requestedStart <= endDate ? requestedStart : endDate;
    const orderedEnd = requestedStart <= endDate ? endDate : requestedStart;
    startDate = orderedStart;
    endDate = orderedEnd;
    start = localDateStart(orderedStart);
    end = localDateStart(addCalendarDays(orderedEnd, 1));
  } else {
    end = /* @__PURE__ */ new Date();
    start = new Date(end.getTime() - days * 24 * 60 * 60 * 1e3);
  }
  const durationMs = Math.max(1, end.getTime() - start.getTime());
  const previousEnd = new Date(start.getTime());
  const previousStart = new Date(start.getTime() - durationMs);
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    previousStartAt: previousStart.toISOString(),
    previousEndAt: previousEnd.toISOString(),
    days,
    startDate,
    endDate
  };
}
function normalizeDate(value) {
  if (!value || !DATE_PATTERN.test(value)) return null;
  const parsed = localDateStart(value);
  return Number.isNaN(parsed.getTime()) ? null : value;
}
function localDateStart(date) {
  return /* @__PURE__ */ new Date(`${date}T00:00:00${SAO_PAULO_OFFSET}`);
}
function addCalendarDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day + days));
  return cursor.toISOString().slice(0, 10);
}

// lib/tintim/attribution.ts
import { createHash } from "node:crypto";
function paidMediaPlatformFromTintimSource(value) {
  const source = normalize(value);
  if (!source) return null;
  if (/(^| )(google ads|google adwords|adwords|gads)( |$)/.test(source)) {
    return "google_ads";
  }
  if (/(^| )(meta ads|facebook ads|instagram ads|fb ads|ig ads)( |$)/.test(
    source
  )) {
    return "meta_ads";
  }
  return null;
}
function isTrackedTintimSource(value) {
  const source = normalize(value);
  if (!source) return false;
  return ![
    "nao rastreada",
    "nao rastreado",
    "nao identificada",
    "nao identificado",
    "sem rastreamento",
    "not tracked",
    "untracked",
    "unknown"
  ].includes(source);
}
function normalize(value) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// lib/dashboard/journeyEngine.ts
var PAGE_SIZE = 1e3;
var ID_FILTER_BATCH_SIZE = 100;
var CLINISYS_QUERY_CONCURRENCY = 2;
async function loadFullJourneyPipeline(range, filters, signal, paidMedia, whatsappData, options) {
  const startDate = range.startDate ?? saoPauloDate(range.startAt);
  const endDate = range.endDate ?? saoPauloDate(
    new Date(new Date(range.endAt).getTime() - 1).toISOString()
  );
  const whatsappEntries = whatsappData.paidEntries;
  const cohort = options?.cohort ?? paidJourneyCohort(whatsappEntries);
  const clientIds = [...cohort.keys()];
  const [procedureEventLoad, invoices] = options?.sources ? [options.sources.procedureEventLoad, options.sources.invoices] : await Promise.all([
    loadPipelineProcedureEvents(
      clientIds,
      "1900-01-01",
      saoPauloDate((/* @__PURE__ */ new Date()).toISOString()),
      signal
    ),
    loadPipelineInvoices(clientIds, signal)
  ]);
  const procedureEvents = procedureEventLoad.events;
  const eligibleProcedureEvents = procedureEvents.flatMap((event) => {
    const clientId = normalizeClientId(event.client_id);
    if (!clientId) return [];
    const cohortEntry = cohort.get(clientId);
    if (!cohortEntry) return [];
    if (!procedureEventBelongsToCohort(event, cohortEntry)) return [];
    return [{
      ...event,
      client_id: clientId,
      event_kind: journeyProcedureKind(event),
      status: event.scheduled_for > saoPauloDate((/* @__PURE__ */ new Date()).toISOString()) ? "N\xE3o" : event.status
    }];
  });
  const scheduledClients = new Set(
    eligibleProcedureEvents.flatMap(
      (event) => event.client_id ? [event.client_id] : []
    )
  );
  const attendedAtByClient = /* @__PURE__ */ new Map();
  let attendedProcedureEvents = 0;
  for (const event of eligibleProcedureEvents) {
    const clientId = event.client_id;
    if (!clientId || !scheduleShowedUp(normalizeScheduleStatus(event.status))) {
      continue;
    }
    attendedProcedureEvents += 1;
    const current = attendedAtByClient.get(clientId);
    if (!current || event.scheduled_for < current) {
      attendedAtByClient.set(clientId, event.scheduled_for);
    }
  }
  const procedureBranches = buildProcedureBranches(
    eligibleProcedureEvents
  );
  assertProcedurePipelineIntegrity({
    trackedClients: cohort.size,
    scheduledClients: scheduledClients.size,
    attendedClients: attendedAtByClient.size,
    scheduledProcedureEvents: eligibleProcedureEvents.length,
    attendedProcedureEvents,
    procedureBranches
  });
  const consultationEvents = eligibleProcedureEvents.filter((event) => event.event_kind === "evaluation");
  const treatmentEvents = eligibleProcedureEvents.filter((event) => event.event_kind === "procedure");
  const consultationClients = new Set(consultationEvents.map((event) => event.client_id));
  const treatmentClients = new Set(treatmentEvents.map((event) => event.client_id));
  const attendedConsultations = new Set(consultationEvents.filter((event) => scheduleShowedUp(normalizeScheduleStatus(event.status))).map((event) => event.client_id));
  const attendedTreatments = new Set(treatmentEvents.filter((event) => scheduleShowedUp(normalizeScheduleStatus(event.status))).map((event) => event.client_id));
  const revenueByKind = { evaluation: { clients: /* @__PURE__ */ new Set(), amount: 0 }, procedure: { clients: /* @__PURE__ */ new Set(), amount: 0 } };
  const attendanceByClient = /* @__PURE__ */ new Map();
  for (const event of eligibleProcedureEvents) {
    if (!scheduleShowedUp(normalizeScheduleStatus(event.status))) continue;
    const events = attendanceByClient.get(event.client_id) ?? [];
    events.push(event);
    attendanceByClient.set(event.client_id, events);
  }
  for (const events of attendanceByClient.values()) events.sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for) || (a.event_kind === "procedure" ? -1 : 1));
  const countedInvoices = /* @__PURE__ */ new Set();
  const invoicedClients = /* @__PURE__ */ new Set();
  const authorizedClients = /* @__PURE__ */ new Set();
  let invoicedAmount = 0;
  let authorizedAmount = 0;
  for (const invoice of invoices) {
    const clientId = invoice.client_id;
    if (!clientId) continue;
    if (!attendedAtByClient.has(clientId) || !cohort.has(clientId)) {
      continue;
    }
    const invoiceId = String(invoice.source_invoice_id);
    if (countedInvoices.has(invoiceId)) continue;
    const invoiceDate = saoPauloDate(invoice.issued_at);
    if (invoiceDate > saoPauloDate((/* @__PURE__ */ new Date()).toISOString())) continue;
    const attendance = attendanceByClient.get(clientId)?.find((event) => event.scheduled_for <= invoiceDate);
    if (!attendance || invoiceDate < pipelineCalendarDate(cohort.get(clientId).enteredAt)) continue;
    countedInvoices.add(invoiceId);
    const amount = numeric(invoice.amount);
    invoicedClients.add(clientId);
    invoicedAmount += amount;
    if (invoiceStatusIsAuthorized(invoice.status)) {
      authorizedClients.add(clientId);
      authorizedAmount += amount;
      const branch = revenueByKind[attendance.event_kind];
      branch.clients.add(clientId);
      branch.amount += amount;
    }
  }
  const platformBreakdown = buildPlatformBreakdown({
    paidMedia,
    cohort,
    scheduledClients,
    attendedClients: new Set(attendedAtByClient.keys()),
    invoices: [...new Map(invoices.filter((invoice) => countedInvoices.has(String(invoice.source_invoice_id))).map((invoice) => [String(invoice.source_invoice_id), invoice])).values()]
  });
  return buildFullJourneyPipeline({
    available: true,
    adsAvailable: paidMedia.available,
    filtersApplied: hasOperationalFilters(filters),
    startDate,
    endDate,
    impressions: paidMedia.impressions,
    clicks: paidMedia.clicks,
    platformWhatsappConversations: paidMedia.whatsappConversations,
    whatsappClients: options?.entryClientIds?.size ?? cohort.size,
    measurementReady: paidMedia.measurementReady,
    measurementNote: paidMedia.measurementNote,
    trackedByEvidence: buildEvidenceBreakdown(cohort),
    trackedSources: buildTrackedSourceBreakdown(cohort, scheduledClients, new Set(attendedAtByClient.keys())),
    whatsappCoverage: whatsappData.coverage,
    whatsappOrigins: buildWhatsappOriginBreakdown(whatsappEntries),
    procedureLinkage: {
      tracked_clients: cohort.size,
      raw_events_read: procedureEventLoad.scheduleRowsRead + procedureEventLoad.funnelEventRowsRead,
      schedule_rows_read: procedureEventLoad.scheduleRowsRead,
      funnel_event_rows_read: procedureEventLoad.funnelEventRowsRead,
      deduped_source_events: procedureEventLoad.dedupedSourceEvents,
      eligible_source_events: eligibleProcedureEvents.length,
      linked_unique_clients: scheduledClients.size,
      attended_unique_clients: attendedAtByClient.size,
      scheduled_branch_total: procedureBranches.reduce(
        (sum, branch) => sum + branch.scheduled_appointments,
        0
      ),
      attended_branch_total: procedureBranches.reduce(
        (sum, branch) => sum + branch.attended_appointments,
        0
      ),
      invariant_ok: true
    },
    entryClientsTotal: cohort.size,
    whatsappToConsultationClients: options?.entryClientIds ? [...consultationClients].filter((id) => options.entryClientIds.has(id)).length : consultationClients.size,
    scheduledClients: consultationClients.size,
    attendedClients: attendedConsultations.size,
    procedureScheduledClients: treatmentClients.size,
    procedureAttendedClients: attendedTreatments.size,
    consultationToProcedureClients: [...attendedConsultations].filter((id) => treatmentClients.has(id)).length,
    revenueBranches: ["evaluation", "procedure"].map((kind) => ({
      kind,
      clients: revenueByKind[kind].clients.size,
      amount: roundMoney(revenueByKind[kind].amount)
    })),
    invoicedClients: invoicedClients.size,
    authorizedClients: authorizedClients.size,
    invoicedAmount,
    authorizedAmount,
    procedureBranches,
    platformBreakdown,
    error: null
  });
}
function procedureEventBelongsToCohort(event, cohortEntry) {
  const effectiveCreatedAt = procedureEventCreatedAt(event) ?? event.scheduled_for;
  if (!effectiveCreatedAt) return false;
  return pipelineCalendarDate(effectiveCreatedAt) >= pipelineCalendarDate(cohortEntry.enteredAt) && event.scheduled_for >= pipelineCalendarDate(cohortEntry.enteredAt);
}
function pipelineCalendarDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : saoPauloDate(value);
}
function procedureEventCreatedAt(event) {
  return event.created_in_source_at ?? event.created_at;
}
function buildProcedureBranches(events) {
  const outcomes = /* @__PURE__ */ new Map();
  for (const event of events) {
    const clientId = normalizeClientId(event.client_id);
    if (!clientId) continue;
    const procedureName = pipelineProcedureName(event);
    const key = normalizeText(procedureName);
    const outcome = outcomes.get(key) ?? {
      key,
      procedureName,
      eventKind: event.event_kind?.trim() || "procedure",
      scheduledAppointments: 0,
      attendedAppointments: 0
    };
    outcome.scheduledAppointments += 1;
    if (scheduleShowedUp(normalizeScheduleStatus(event.status))) {
      outcome.attendedAppointments += 1;
    }
    outcomes.set(key, outcome);
  }
  return [...outcomes.values()].map((outcome) => ({
    key: outcome.key,
    procedure_name: outcome.procedureName,
    event_kind: outcome.eventKind,
    scheduled_appointments: outcome.scheduledAppointments,
    attended_appointments: outcome.attendedAppointments,
    schedule_to_attendance_rate: percentage(
      outcome.attendedAppointments,
      outcome.scheduledAppointments
    ),
    lost_appointments: Math.max(
      0,
      outcome.scheduledAppointments - outcome.attendedAppointments
    )
  })).sort(
    (first, second) => second.scheduled_appointments - first.scheduled_appointments || first.procedure_name.localeCompare(second.procedure_name, "pt-BR")
  );
}
function assertProcedurePipelineIntegrity({
  trackedClients,
  scheduledClients,
  attendedClients,
  scheduledProcedureEvents,
  attendedProcedureEvents,
  procedureBranches
}) {
  const branchScheduled = procedureBranches.reduce(
    (sum, branch) => sum + branch.scheduled_appointments,
    0
  );
  const branchAttended = procedureBranches.reduce(
    (sum, branch) => sum + branch.attended_appointments,
    0
  );
  const invalidBranch = procedureBranches.some(
    (branch) => branch.attended_appointments > branch.scheduled_appointments
  );
  if (scheduledClients > trackedClients || attendedClients > scheduledClients || scheduledProcedureEvents < scheduledClients || attendedProcedureEvents < attendedClients || attendedProcedureEvents > scheduledProcedureEvents || branchScheduled !== scheduledProcedureEvents || branchAttended !== attendedProcedureEvents || invalidBranch) {
    throw new Error(
      [
        "Inconsistent procedure pipeline",
        `tracked_clients=${trackedClients}`,
        `scheduled_clients=${scheduledClients}`,
        `attended_clients=${attendedClients}`,
        `scheduled_procedure_events=${scheduledProcedureEvents}`,
        `attended_procedure_events=${attendedProcedureEvents}`,
        `branch_scheduled=${branchScheduled}`,
        `branch_attended=${branchAttended}`
      ].join("; ")
    );
  }
}
function normalizeClientId(value) {
  const normalized = value?.trim().toLocaleLowerCase("en-US");
  return normalized || null;
}
function classifyWhatsappRows(rows, tintimByConversation, filters) {
  const selectedOrigins = new Set(filters.origins.map(normalizeText));
  const paidEntries = [];
  const acceptedRows = [];
  const organicClientIds = /* @__PURE__ */ new Set();
  const organicConversationIds = /* @__PURE__ */ new Set();
  const coverageByConversation = /* @__PURE__ */ new Map();
  const identifiedClientIds = /* @__PURE__ */ new Set();
  const paidClientIds = /* @__PURE__ */ new Set();
  for (const conversation of rows) {
    const conversationOrigin = conversation.origin?.trim();
    const client = Array.isArray(conversation.clients) ? conversation.clients[0] : conversation.clients;
    if (filters.unitIds.length > 0 && !filters.unitIds.includes(conversation.unit_id ?? "")) continue;
    if (filters.serviceIds.length > 0 && !filters.serviceIds.includes(conversation.service_id ?? "")) continue;
    if (filters.attendantIds.length > 0 && !filters.attendantIds.includes(conversation.attendant_id ?? "")) continue;
    if (filters.tunnels.length > 0 && !filters.tunnels.includes(conversation.tunnel?.trim() || "__NULL__")) continue;
    const directPlatform = paidMediaPlatformFromOrigin(conversationOrigin) ?? paidMediaPlatformFromTintimSource(conversationOrigin);
    const tintimAttribution = tintimByConversation.get(conversation.id) ?? null;
    const clientAttribution = resolvePaidMediaAttribution(client);
    const trackingIsNear = trackingIsNearConversation(
      client?.tracking_updated_at,
      conversation.started_at
    );
    const attribution = directPlatform ? { platform: directPlatform, evidence: "origin" } : tintimAttribution?.platform ? { platform: tintimAttribution.platform, evidence: "tintim" } : tintimAttribution ? null : trackingIsNear ? clientAttribution : null;
    const clientOrigin = client?.last_origin?.trim();
    const origin = (attribution ? (directPlatform ? conversationOrigin : attribution.evidence === "tintim" && tintimAttribution ? tintimAttributionSource(tintimAttribution) : (paidMediaPlatformFromOrigin(clientOrigin) ?? paidMediaPlatformFromTintimSource(clientOrigin)) === attribution.platform ? clientOrigin : null) ?? attributionEvidenceLabel(attribution) : conversationOrigin ?? clientOrigin ?? client?.utm_source?.trim()) ?? null;
    if (selectedOrigins.size > 0 && !selectedOrigins.has(normalizeText(origin ?? ""))) continue;
    if (conversation.client_id) identifiedClientIds.add(conversation.client_id);
    const coverageKey = conversation.thread_id ?? conversation.client_id ?? conversation.id;
    const coverageCategory = attribution?.platform ?? (hasTintimTrackingEvidence(tintimAttribution) || hasConversationTrackingEvidence({
      conversationOrigin,
      client,
      trackingIsNear
    }) ? "other" : "untracked");
    coverageByConversation.set(
      coverageKey,
      mergeCoverageCategory(
        coverageByConversation.get(coverageKey),
        coverageCategory
      )
    );
    acceptedRows.push({ ...conversation, origin });
    if (coverageCategory === "other" && conversation.client_id && !/^(?:|sem origem|nao informado|nao identificad[ao]|desconhecid[ao]|unknown|untracked|n a)$/.test(normalizeText(origin))) {
      organicClientIds.add(conversation.client_id);
      organicConversationIds.add(conversation.id);
    }
    if (!attribution) continue;
    const attributionSource = resolveAttributionSource({
      directPlatform,
      conversationOrigin,
      client,
      tintimAttribution,
      attribution
    });
    if (!attributionSource) continue;
    if (conversation.client_id) paidClientIds.add(conversation.client_id);
    paidEntries.push({
      ...conversation,
      origin,
      platform: attribution.platform,
      evidence: attribution.evidence,
      source_field: attributionSource.field,
      source_value: attributionSource.value
    });
  }
  return {
    rows,
    acceptedRows,
    organicClientIds: [...organicClientIds],
    organicConversationIds: [...organicConversationIds],
    paidEntries,
    coverage: buildWhatsappCoverage(coverageByConversation, identifiedClientIds.size, paidClientIds.size)
  };
}
function nonPaidEntry(enteredAt) {
  return { enteredAt, platform: null, evidence: "origin", sourceField: "conversation_origin", sourceValue: "Org\xE2nica ou n\xE3o rastreada" };
}
function paidJourneyCohort(entries) {
  const cohort = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const id = normalizeClientId(entry.client_id);
    if (!id || cohort.has(id) && cohort.get(id).enteredAt <= entry.started_at) continue;
    cohort.set(id, { enteredAt: entry.started_at, platform: entry.platform, evidence: entry.evidence, sourceField: entry.source_field, sourceValue: entry.source_value });
  }
  return cohort;
}
async function loadHubAppointmentRows(clientIds, signal) {
  const rows = [];
  const { data: clients, error: clientError } = await import_lib.supabase.from("clients").select("id,phone,phone_identity").in("id", clientIds).abortSignal(signal);
  if (clientError) throw clientError;
  const byPhone = /* @__PURE__ */ new Map();
  const normalize2 = (value) => (value ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  for (const client of clients ?? []) for (const value of [client.phone, client.phone_identity]) {
    const phone = normalize2(value);
    if (!phone) continue;
    byPhone.set(phone, byPhone.has(phone) && byPhone.get(phone) !== client.id ? null : client.id);
  }
  const phones = [...byPhone.keys()].flatMap((phone) => [phone, "55" + phone, "+55" + phone]);
  const seen = /* @__PURE__ */ new Set();
  for (const phoneBatch of [null, ...chunk(phones, ID_FILTER_BATCH_SIZE)]) {
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = import_lib.supabase.from("appointments").select("id,client_id,source_external_id,created_at,starts_at,status,procedure_name,patient_phone,units(name)");
      query = phoneBatch ? query.is("client_id", null).in("patient_phone", phoneBatch) : query.in("client_id", clientIds);
      const { data, error } = await query.order("id").range(from, from + PAGE_SIZE - 1).abortSignal(signal);
      if (error) throw error;
      for (const row of data ?? []) {
        if (seen.has(row.id)) continue;
        const clientId = row.client_id ?? byPhone.get(normalize2(row.patient_phone));
        if (!clientId) continue;
        seen.add(row.id);
        const unit = Array.isArray(row.units) ? row.units[0] : row.units;
        rows.push({
          source_table: "appointments",
          source_external_id: row.source_external_id,
          source_hash: row.source_external_id ? null : `hub:${row.id}`,
          client_id: clientId,
          created_in_source_at: null,
          created_at: row.created_at,
          scheduled_for: saoPauloDate(row.starts_at),
          status: { completed: "Atendido", confirmed: "N\xE3o", scheduled: "N\xE3o", cancelled: "Desmarcou", no_show: "Faltou" }[row.status] ?? row.status,
          procedure_name: row.procedure_name,
          event_kind: null,
          unit_name: unit?.name ?? null
        });
      }
      if ((data?.length ?? 0) < PAGE_SIZE) break;
    }
  }
  return rows;
}
async function loadPipelineProcedureEvents(clientIds, startDate, endDate, signal) {
  if (clientIds.length === 0) {
    return {
      events: [],
      scheduleRowsRead: 0,
      funnelEventRowsRead: 0,
      dedupedSourceEvents: 0
    };
  }
  const endExclusiveDate = addDaysToDateString(endDate, 1);
  const sourceBatches = await mapWithConcurrency(
    chunk(clientIds, ID_FILTER_BATCH_SIZE),
    CLINISYS_QUERY_CONCURRENCY,
    async (ids) => {
      const [scheduleRows2, funnelEventRows2, appointmentRows] = await Promise.all([
        loadScheduleProcedureRows(
          ids,
          startDate,
          endExclusiveDate,
          signal
        ),
        loadFunnelProcedureRows(
          ids,
          startDate,
          endExclusiveDate,
          signal
        ),
        loadHubAppointmentRows(ids, signal)
      ]);
      return { scheduleRows: [...scheduleRows2, ...appointmentRows], funnelEventRows: funnelEventRows2 };
    }
  );
  const scheduleRows = sourceBatches.flatMap(
    (batch) => batch.scheduleRows
  );
  const funnelEventRows = sourceBatches.flatMap(
    (batch) => batch.funnelEventRows
  );
  const events = dedupePipelineProcedureEvents([
    ...scheduleRows,
    ...funnelEventRows
  ]);
  return {
    events,
    scheduleRowsRead: scheduleRows.length,
    funnelEventRowsRead: funnelEventRows.length,
    dedupedSourceEvents: events.length
  };
}
async function loadScheduleProcedureRows(clientIds, startDate, endExclusiveDate, signal) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await import_lib.supabase.from("schedules").select(
      "source_external_id, source_hash, client_id, created_in_source_at, created_at, scheduled_for, status, procedure_name, unit_name"
    ).in("client_id", clientIds).or(
      procedureCreationDateFilter(startDate, endExclusiveDate)
    ).order("created_at", { ascending: true }).order("source_hash", { ascending: true }).range(from, from + PAGE_SIZE - 1).abortSignal(signal);
    if (error) throw error;
    const rawPage = data ?? [];
    const page = rawPage.map((row) => ({
      ...row,
      source_table: "schedules",
      event_kind: null
    }));
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}
async function loadFunnelProcedureRows(clientIds, startDate, endExclusiveDate, signal) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await import_lib.supabase.from("funnel_clinisys_events").select(
      "source_external_id, source_hash, client_id, created_in_source_at, created_at, scheduled_for, status, procedure_name, event_kind, unit_name"
    ).in("client_id", clientIds).or(
      procedureCreationDateFilter(startDate, endExclusiveDate)
    ).order("created_at", { ascending: true }).order("source_hash", { ascending: true }).range(from, from + PAGE_SIZE - 1).abortSignal(signal);
    if (error) throw error;
    const rawPage = data ?? [];
    const page = rawPage.map((row) => ({
      ...row,
      source_table: "funnel_clinisys_events"
    }));
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}
function procedureCreationDateFilter(startDate, endExclusiveDate) {
  return [
    `and(created_in_source_at.gte.${startDate},created_in_source_at.lt.${endExclusiveDate})`,
    `and(created_in_source_at.is.null,created_at.gte.${startDate},created_at.lt.${endExclusiveDate})`
  ].join(",");
}
function addDaysToDateString(value, days) {
  const date = /* @__PURE__ */ new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function dedupePipelineProcedureEvents(events) {
  const deduped = [];
  const indexByIdentity = /* @__PURE__ */ new Map();
  for (const event of events) {
    const identities = pipelineProcedureEventIdentities(event);
    const existingIndex = identities.map((identity) => indexByIdentity.get(identity)).find((index) => index !== void 0);
    if (existingIndex === void 0) {
      const index = deduped.length;
      deduped.push(event);
      for (const identity of identities) {
        indexByIdentity.set(identity, index);
      }
      continue;
    }
    const merged = mergePipelineProcedureEvents(
      deduped[existingIndex],
      event
    );
    deduped[existingIndex] = merged;
    for (const identity of [
      ...pipelineProcedureEventIdentities(merged),
      ...identities
    ]) {
      indexByIdentity.set(identity, existingIndex);
    }
  }
  return deduped;
}
function pipelineProcedureEventIdentities(event) {
  const identities = [];
  const externalId = nullableText(event.source_external_id);
  const sourceHash = nullableText(event.source_hash);
  const clientId = normalizeClientId(event.client_id);
  const procedureName = normalizeText(event.procedure_name);
  const unitName = normalizeText(event.unit_name);
  const effectiveCreatedAt = procedureEventCreatedAt(event);
  const createdDate = effectiveCreatedAt ? pipelineCalendarDate(effectiveCreatedAt) : "";
  if (externalId) identities.push(`external:${externalId}`);
  if (sourceHash) identities.push(`hash:${sourceHash}`);
  if (clientId && event.scheduled_for) {
    identities.push(
      [
        "fallback",
        clientId,
        event.scheduled_for,
        procedureName,
        unitName,
        createdDate
      ].join(":")
    );
  }
  if (identities.length === 0) {
    identities.push(
      [
        "row",
        event.source_table,
        event.scheduled_for,
        procedureName,
        createdDate
      ].join(":")
    );
  }
  return identities;
}
function mergePipelineProcedureEvents(current, candidate) {
  const currentAttended = scheduleShowedUp(
    normalizeScheduleStatus(current.status)
  );
  const candidateAttended = scheduleShowedUp(
    normalizeScheduleStatus(candidate.status)
  );
  const preferredStatus = candidateAttended && !currentAttended ? candidate.status : current.status ?? candidate.status;
  const preferredProcedureName = chooseProcedureName(
    current.procedure_name,
    candidate.procedure_name
  );
  return {
    source_table: current.source_table === "funnel_clinisys_events" || candidate.source_table !== "funnel_clinisys_events" ? current.source_table : candidate.source_table,
    source_external_id: current.source_external_id ?? candidate.source_external_id,
    source_hash: current.source_hash ?? candidate.source_hash,
    client_id: current.client_id ?? candidate.client_id,
    created_in_source_at: earlierNullableDate(
      current.created_in_source_at,
      candidate.created_in_source_at
    ),
    created_at: earlierNullableDate(
      current.created_at,
      candidate.created_at
    ),
    scheduled_for: current.scheduled_for <= candidate.scheduled_for ? current.scheduled_for : candidate.scheduled_for,
    status: preferredStatus,
    procedure_name: preferredProcedureName,
    event_kind: current.event_kind ?? candidate.event_kind,
    booking_channel: current.booking_channel ?? candidate.booking_channel,
    booking_social_id: current.booking_social_id ?? candidate.booking_social_id,
    unit_name: current.unit_name ?? candidate.unit_name
  };
}
function chooseProcedureName(current, candidate) {
  const currentName = current?.trim() ?? "";
  const candidateName = candidate?.trim() ?? "";
  if (!currentName) return candidateName || null;
  if (!candidateName) return currentName;
  return candidateName.length > currentName.length ? candidateName : currentName;
}
function earlierNullableDate(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;
  return current <= candidate ? current : candidate;
}
async function loadPipelineInvoices(clientIds, signal) {
  if (clientIds.length === 0) return [];
  const pages = await mapWithConcurrency(
    chunk(clientIds, ID_FILTER_BATCH_SIZE),
    CLINISYS_QUERY_CONCURRENCY,
    async (ids) => {
      const rows = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await import_lib.supabase.from("clinisys_invoices").select(
          "source_invoice_id, client_id, issued_at, amount, status"
        ).in("client_id", ids).order("issued_at", { ascending: true }).range(from, from + PAGE_SIZE - 1).abortSignal(signal);
        if (error) throw error;
        const page = data ?? [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      return rows;
    }
  );
  return pages.flat();
}
function pipelineProcedureName(event) {
  const name = event.procedure_name?.trim().replace(/\s+/g, " ");
  if (name) return name;
  return event.event_kind === "evaluation" ? "Avalia\xE7\xE3o" : "Procedimento n\xE3o informado";
}
function buildFullJourneyPipeline(values) {
  const stages = [
    stage("tracked_whatsapp", "WhatsApp rastreado", values.whatsappClients),
    stage("scheduled", "Agendaram Consulta", values.scheduledClients),
    stage("attended", "Compareceram", values.attendedClients),
    stage("procedure_scheduled", "Agendaram Procedimento", values.procedureScheduledClients ?? 0),
    stage("procedure_attended", "Compareceram", values.procedureAttendedClients ?? 0),
    stage(
      "authorized",
      "Liberados",
      values.authorizedClients,
      roundMoney(values.authorizedAmount),
      "currency",
      "autorizados"
    )
  ];
  return {
    available: values.available,
    ads_available: values.adsAvailable,
    ads_scope_global: true,
    filters_applied: values.filtersApplied,
    currency_code: "BRL",
    stages,
    acquisition_branches: values.platformBreakdown.map((platform) => ({
      platform: platform.platform,
      label: platform.label,
      impressions: platform.impressions,
      clicks: platform.whatsapp_clicks,
      click_through_rate: percentage(
        platform.whatsapp_clicks,
        platform.impressions
      ),
      tracked_clients: platform.tracked_clients,
      click_to_tracked_rate: percentage(
        platform.tracked_clients,
        platform.whatsapp_clicks
      )
    })),
    procedure_branches: values.procedureBranches,
    revenue_branches: values.revenueBranches ?? [],
    platform_breakdown: values.platformBreakdown,
    transitions: [
      transition("whatsapp_to_schedule", "Rastreado \u2192 agenda", values.whatsappClients, values.whatsappToConsultationClients ?? values.scheduledClients, false, true),
      transition("schedule_to_attendance", "Agenda \u2192 presen\xE7a", values.scheduledClients, values.attendedClients, false, true),
      transition("consultation_to_procedure", "Consulta \u2192 procedimento", values.attendedClients, values.consultationToProcedureClients ?? 0, false, true),
      transition("procedure_to_attendance", "Procedimento \u2192 presen\xE7a", values.procedureScheduledClients ?? 0, values.procedureAttendedClients ?? 0, false, true)
    ],
    audit: {
      entry_clients_total: values.entryClientsTotal ?? values.whatsappClients,
      platform_whatsapp_conversations: values.platformWhatsappConversations,
      tracked_whatsapp_clients: values.whatsappClients,
      measurement_ready: values.measurementReady,
      measurement_note: values.measurementNote,
      tracked_by_evidence: values.trackedByEvidence,
      tracked_sources: values.trackedSources,
      whatsapp_coverage: values.whatsappCoverage,
      whatsapp_origins: values.whatsappOrigins,
      procedure_linkage: values.procedureLinkage,
      cohort_start_date: values.startDate,
      cohort_end_date: values.endDate,
      matured_through: saoPauloDate((/* @__PURE__ */ new Date()).toISOString()),
      error: values.error
    }
  };
}
function stage(key, label, value, secondaryValue = null, secondaryKind = null, secondaryLabel = null) {
  return {
    key,
    label,
    value,
    secondary_value: secondaryValue,
    secondary_kind: secondaryKind,
    secondary_label: secondaryLabel
  };
}
function transition(key, label, fromValue, toValue, estimated, samePopulation) {
  return {
    key,
    label,
    rate: percentage(toValue, fromValue),
    from_value: fromValue,
    to_value: toValue,
    lost: samePopulation && fromValue > 0 ? Math.max(0, fromValue - toValue) : null,
    estimated
  };
}
function invoiceStatusIsAuthorized(status) {
  const normalized = normalizeText(status).replace(/\s+/g, "");
  return normalized.startsWith("autorizada") || normalized.includes("cancelamentonegado") || normalized.includes("cancelamentorejeitado");
}
function buildWhatsappOriginBreakdown(conversations) {
  const origins = /* @__PURE__ */ new Map();
  for (const conversation of conversations) {
    const origin = conversation.origin?.trim();
    if (!origin) continue;
    const key = normalizeText(origin);
    const current = origins.get(key) ?? {
      origin,
      conversations: 0,
      clients: /* @__PURE__ */ new Set()
    };
    current.conversations += 1;
    if (conversation.client_id) current.clients.add(conversation.client_id);
    origins.set(key, current);
  }
  return [...origins.values()].map((origin) => ({
    origin: origin.origin,
    conversations: origin.conversations,
    clients: origin.clients.size
  })).sort(
    (first, second) => second.clients - first.clients || second.conversations - first.conversations || first.origin.localeCompare(second.origin, "pt-BR")
  );
}
function buildEvidenceBreakdown(cohort) {
  const counts = /* @__PURE__ */ new Map();
  for (const entry of cohort.values()) {
    counts.set(entry.evidence, (counts.get(entry.evidence) ?? 0) + 1);
  }
  return ["tintim", "origin", "utm_source", "click_id"].map((evidence) => ({
    evidence,
    clients: counts.get(evidence) ?? 0
  })).filter((item) => item.clients > 0);
}
function hasConversationTrackingEvidence({
  conversationOrigin,
  client,
  trackingIsNear
}) {
  if (conversationOrigin?.trim()) return true;
  if (!trackingIsNear || !client) return false;
  return Boolean(
    client.last_origin?.trim() || client.utm_source?.trim() || client.utm_medium?.trim() || client.utm_campaign?.trim() || client.utm_content?.trim() || client.utm_term?.trim() || client.gclid || client.gbraid || client.wbraid || client.fbclid || client.fbc || client.ctwa_clid
  );
}
function mergeCoverageCategory(current, next) {
  if (!current) return next;
  if (current === "google_ads" || current === "meta_ads") return current;
  if (next === "google_ads" || next === "meta_ads") return next;
  if (current === "other" || next === "other") return "other";
  return "untracked";
}
function buildWhatsappCoverage(coverageByConversation, identifiedClients, paidClients) {
  let googleConversations = 0;
  let metaConversations = 0;
  let otherConversations = 0;
  let untrackedConversations = 0;
  for (const category of coverageByConversation.values()) {
    if (category === "google_ads") googleConversations += 1;
    else if (category === "meta_ads") metaConversations += 1;
    else if (category === "other") otherConversations += 1;
    else untrackedConversations += 1;
  }
  const trackedConversations = googleConversations + metaConversations + otherConversations;
  const totalConversations = coverageByConversation.size;
  return {
    total_conversations: totalConversations,
    tracked_conversations: trackedConversations,
    identified_clients: identifiedClients,
    paid_clients: paidClients,
    tracking_rate: percentage(trackedConversations, totalConversations),
    google_conversations: googleConversations,
    meta_conversations: metaConversations,
    other_conversations: otherConversations,
    untracked_conversations: untrackedConversations
  };
}
function buildTrackedSourceBreakdown(cohort, scheduledClients, attendedClients) {
  const sources = /* @__PURE__ */ new Map();
  for (const [clientId, entry] of cohort) {
    if (!entry.platform) continue;
    const key = [entry.platform, entry.sourceField, normalizeText(entry.sourceValue)].join(":");
    const current = sources.get(key) ?? {
      platform: entry.platform,
      field: entry.sourceField,
      source: entry.sourceValue,
      clients: 0,
      scheduled_clients: 0,
      attended_clients: 0
    };
    current.clients += 1;
    if (scheduledClients.has(clientId)) current.scheduled_clients += 1;
    if (attendedClients.has(clientId)) current.attended_clients += 1;
    sources.set(key, current);
  }
  return [...sources.values()].map((source) => ({
    ...source,
    percentage: percentage(source.clients, cohort.size) ?? 0,
    schedule_rate: percentage(source.scheduled_clients, source.clients),
    attendance_rate: percentage(source.attended_clients, source.clients)
  })).sort(
    (first, second) => second.clients - first.clients || first.source.localeCompare(second.source, "pt-BR")
  );
}
function buildPlatformBreakdown({
  paidMedia,
  cohort,
  scheduledClients,
  attendedClients,
  invoices
}) {
  const outcomes = new Map(
    ["google_ads", "meta_ads"].map((platform) => [
      platform,
      {
        tracked: /* @__PURE__ */ new Set(),
        scheduled: /* @__PURE__ */ new Set(),
        attended: /* @__PURE__ */ new Set(),
        invoiced: /* @__PURE__ */ new Set(),
        authorized: /* @__PURE__ */ new Set(),
        authorizedRevenue: 0
      }
    ])
  );
  for (const [clientId, entry] of cohort) {
    const outcome = entry.platform ? outcomes.get(entry.platform) : null;
    if (!outcome) continue;
    outcome.tracked.add(clientId);
    if (scheduledClients.has(clientId)) outcome.scheduled.add(clientId);
    if (attendedClients.has(clientId)) outcome.attended.add(clientId);
  }
  for (const invoice of invoices) {
    const clientId = invoice.client_id;
    if (!clientId || !attendedClients.has(clientId)) continue;
    const entry = cohort.get(clientId);
    if (!entry) continue;
    const outcome = entry.platform ? outcomes.get(entry.platform) : null;
    if (!outcome) continue;
    outcome.invoiced.add(clientId);
    if (invoiceStatusIsAuthorized(invoice.status)) {
      outcome.authorized.add(clientId);
      outcome.authorizedRevenue += numeric(invoice.amount);
    }
  }
  return ["google_ads", "meta_ads"].map((platform) => {
    const media = paidMedia.byPlatform.get(platform);
    const outcome = outcomes.get(platform);
    return {
      platform,
      label: platform === "google_ads" ? "Google Ads" : "Meta Ads",
      spend: roundMoney(media.spend),
      impressions: Math.trunc(media.impressions),
      whatsapp_clicks: Math.trunc(media.clicks),
      platform_whatsapp_conversations: roundMetric(media.whatsappConversations),
      tracked_clients: outcome.tracked.size,
      scheduled_clients: outcome.scheduled.size,
      attended_clients: outcome.attended.size,
      invoiced_clients: outcome.invoiced.size,
      authorized_clients: outcome.authorized.size,
      authorized_revenue: roundMoney(outcome.authorizedRevenue)
    };
  });
}
function emptyPaidMediaTotals(available) {
  return {
    available,
    measurementReady: false,
    measurementNote: null,
    impressions: 0,
    clicks: 0,
    whatsappConversations: 0,
    byPlatform: /* @__PURE__ */ new Map([
      ["google_ads", { spend: 0, impressions: 0, clicks: 0, whatsappConversations: 0 }],
      ["meta_ads", { spend: 0, impressions: 0, clicks: 0, whatsappConversations: 0 }]
    ])
  };
}
function normalizeTintimAttribution(value) {
  const platform = value.platform === "google_ads" || value.platform === "meta_ads" ? value.platform : null;
  return {
    conversation_id: String(value.conversation_id),
    source: nullableText(value.source),
    platform
  };
}
function tintimAttributionSource(attribution) {
  return attribution.source ?? (attribution.platform === "google_ads" ? "Google Ads" : "Meta Ads");
}
function hasTintimTrackingEvidence(attribution) {
  return Boolean(
    attribution?.platform || isTrackedTintimSource(attribution?.source)
  );
}
function trackingIsNearConversation(trackingUpdatedAt, conversationStartedAt) {
  if (!trackingUpdatedAt) return false;
  const trackingTime = new Date(trackingUpdatedAt).getTime();
  const conversationTime = new Date(conversationStartedAt).getTime();
  if (!Number.isFinite(trackingTime) || !Number.isFinite(conversationTime)) {
    return false;
  }
  return Math.abs(trackingTime - conversationTime) <= 7 * 864e5;
}
function resolveAttributionSource({
  directPlatform,
  conversationOrigin,
  client,
  tintimAttribution,
  attribution
}) {
  if (directPlatform && conversationOrigin?.trim()) {
    return { field: "conversation_origin", value: conversationOrigin.trim() };
  }
  if (attribution.evidence === "tintim" && tintimAttribution) {
    return { field: "tintim_source", value: tintimAttributionSource(tintimAttribution) };
  }
  if (attribution.evidence === "origin" && client?.last_origin?.trim()) {
    return { field: "client_origin", value: client.last_origin.trim() };
  }
  if (attribution.evidence === "utm_source" && client?.utm_source?.trim()) {
    return { field: "utm_source", value: client.utm_source.trim() };
  }
  if (attribution.evidence !== "click_id" || !client) return null;
  const identifiers = attribution.platform === "google_ads" ? [
    ["gclid", client.gclid],
    ["gbraid", client.gbraid],
    ["wbraid", client.wbraid]
  ] : [
    ["ctwa_clid", client.ctwa_clid],
    ["fbclid", client.fbclid],
    ["fbc", client.fbc]
  ];
  const availableIdentifiers = identifiers.filter(([, value]) => Boolean(value)).map(([field]) => field);
  return availableIdentifiers.length > 0 ? { field: "click_id", value: availableIdentifiers.join(" + ") } : null;
}
function attributionEvidenceLabel(attribution) {
  const platform = attribution.platform === "google_ads" ? "Google" : "Meta";
  const evidence = attribution.evidence === "tintim" ? "TinTim" : attribution.evidence === "utm_source" ? "UTM" : attribution.evidence === "click_id" ? "ID de clique" : "Origem";
  return `${platform} \xB7 ${evidence}`;
}
function hasOperationalFilters(filters) {
  return filters.unitIds.length > 0 || filters.serviceIds.length > 0 || filters.attendantIds.length > 0 || filters.tunnels.length > 0 || filters.origins.length > 0;
}
function percentage(value, total) {
  if (total <= 0) return null;
  return Number((value / total * 100).toFixed(1));
}
function numeric(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function roundMoney(value) {
  return Number(value.toFixed(2));
}
function roundMetric(value) {
  return Number(value.toFixed(4));
}
function nullableText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
function normalizeText(value) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
var journeyDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
function saoPauloDate(value) {
  const parts = journeyDateFormatter.formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      worker
    )
  );
  return results;
}
var preparationFilters = { unitIds: [], serviceIds: [], attendantIds: [], tunnels: [], origins: [] };
async function prepareJourneyPatients(source) {
  const nearestTintim = /* @__PURE__ */ new Map();
  const tintimByClient = Map.groupBy(source.tintim, (row) => row.client_id);
  for (const row of source.conversations) {
    const at = Date.parse(row.started_at);
    const match = (tintimByClient.get(row.client_id ?? "") ?? []).map((event) => ({ event, distance: Math.abs(Date.parse(event.occurred_at) - at) })).filter((item) => item.distance <= 2 * 864e5).sort((a, b) => a.distance - b.distance || b.event.id.localeCompare(a.event.id))[0];
    if (match) nearestTintim.set(row.id, normalizeTintimAttribution({ ...match.event, conversation_id: row.id }));
  }
  const history = classifyWhatsappRows(source.conversations, nearestTintim, preparationFilters);
  const paidByConversation = new Map(history.paidEntries.map((row) => [row.id, row]));
  const organicByConversation = new Set(history.organicConversationIds);
  const events = dedupePipelineProcedureEvents([...source.outcomes.schedule_rows, ...source.outcomes.funnel_rows]);
  const eventsByClient = Map.groupBy(events, (row) => row.client_id);
  const rawScheduleByClient = Map.groupBy(source.outcomes.schedule_rows, (row) => row.client_id);
  const rawFunnelByClient = Map.groupBy(source.outcomes.funnel_rows, (row) => row.client_id);
  const invoicesByClient = Map.groupBy(source.outcomes.invoices, (row) => row.client_id);
  const conversationsByClient = Map.groupBy(history.acceptedRows, (row) => row.client_id);
  const socialByClient = Map.groupBy(source.social, (row) => row.client_id);
  const today = saoPauloDate((/* @__PURE__ */ new Date()).toISOString());
  const range = resolveDashboardDateRange(new URLSearchParams({ start_date: "1900-01-01", end_date: today }));
  const result = [];
  for (const client of source.clients) {
    const clientEvents = eventsByClient.get(client.id) ?? [];
    const invoices = invoicesByClient.get(client.id) ?? [];
    const conversations = conversationsByClient.get(client.id) ?? [];
    const activity = /* @__PURE__ */ new Set();
    const entryDates = [];
    const remember = (value, candidate = true) => {
      if (value) {
        const date = pipelineCalendarDate(value);
        entryDates.push(value);
        if (candidate) activity.add(date);
      }
    };
    for (const row of conversations) remember(row.started_at);
    for (const row of [...rawScheduleByClient.get(client.id) ?? [], ...rawFunnelByClient.get(client.id) ?? []]) {
      for (const value of [procedureEventCreatedAt(row), row.scheduled_for]) if (value) activity.add(pipelineCalendarDate(value));
    }
    for (const row of clientEvents) {
      remember(procedureEventCreatedAt(row), false);
      remember(row.scheduled_for, false);
    }
    for (const row of invoices) remember(row.issued_at);
    const base = entryDates.sort((a, b) => pipelineCalendarDate(a).localeCompare(pipelineCalendarDate(b)) || a.localeCompare(b))[0] ?? today;
    const contacts = conversations.map((row) => {
      const paid = paidByConversation.get(row.id);
      return {
        id: row.id,
        client_id: client.id,
        channel: "WhatsApp",
        started_at: row.started_at,
        paid_at: null,
        anchor_key: pipelineCalendarDate(row.started_at),
        platform: paid?.platform ?? null,
        evidence: paid?.evidence ?? "origin",
        source_field: paid?.source_field ?? "conversation_origin",
        source_value: paid?.source_value ?? "Org\xE2nica ou n\xE3o rastreada",
        origin_key: normalizeText(row.origin),
        organic: organicByConversation.has(row.id),
        unit_id: row.unit_id,
        service_id: row.service_id,
        attendant_id: row.attendant_id,
        tunnel: row.tunnel?.trim() || "__NULL__"
      };
    });
    for (const row of socialByClient.get(client.id) ?? []) {
      if (!row.paid_at) continue;
      const enteredAt = row.paid_at > row.started_at ? row.paid_at : row.started_at;
      contacts.push({
        id: `instagram:${client.id}:${row.id}`,
        client_id: client.id,
        channel: "Instagram",
        started_at: row.started_at,
        paid_at: row.paid_at,
        anchor_key: pipelineCalendarDate(enteredAt),
        platform: "meta_ads",
        evidence: "origin",
        source_field: "conversation_origin",
        source_value: "Meta Ads \xB7 Instagram",
        origin_key: normalizeText(row.origin),
        organic: false,
        unit_id: row.unit_id,
        service_id: row.service_id,
        attendant_id: row.attendant_id,
        tunnel: row.tunnel?.trim() || "__NULL__"
      });
    }
    const anchors = [];
    for (const date of /* @__PURE__ */ new Set([pipelineCalendarDate(base), ...contacts.map((row) => row.anchor_key)])) {
      const cohort = /* @__PURE__ */ new Map([[client.id, nonPaidEntry(date)]]);
      const sources = { clients: [client], invoices, procedureEventLoad: {
        events: clientEvents,
        scheduleRowsRead: rawScheduleByClient.get(client.id)?.length ?? 0,
        funnelEventRowsRead: rawFunnelByClient.get(client.id)?.length ?? 0,
        dedupedSourceEvents: clientEvents.length
      } };
      const pipeline = await loadFullJourneyPipeline(
        range,
        preparationFilters,
        new AbortController().signal,
        emptyPaidMediaTotals(false),
        { ...history, rows: [], acceptedRows: [], paidEntries: [] },
        { cohort, sources }
      );
      const stageValue = (key) => pipeline.stages.find((stage2) => stage2.key === key)?.value ?? 0;
      const branchValue = (kind, key) => pipeline.revenue_branches?.find((branch) => branch.kind === kind)?.[key] ?? 0;
      const linkage = pipeline.audit.procedure_linkage;
      const metrics = {
        scheduled: stageValue("scheduled"),
        attended: stageValue("attended"),
        procedure_scheduled: stageValue("procedure_scheduled"),
        procedure_attended: stageValue("procedure_attended"),
        authorized: stageValue("authorized"),
        authorized_amount: pipeline.stages.find((stage2) => stage2.key === "authorized")?.secondary_value ?? 0,
        consultation_to_procedure: pipeline.transitions.find((item) => item.key === "consultation_to_procedure")?.to_value ?? 0,
        evaluation_revenue: branchValue("evaluation", "amount"),
        evaluation_revenue_clients: branchValue("evaluation", "clients"),
        procedure_revenue: branchValue("procedure", "amount"),
        procedure_revenue_clients: branchValue("procedure", "clients"),
        any_scheduled: Number(linkage.linked_unique_clients > 0),
        any_attended: Number(linkage.attended_unique_clients > 0),
        raw_schedule: linkage.schedule_rows_read,
        raw_funnel: linkage.funnel_event_rows_read,
        deduped: linkage.deduped_source_events,
        eligible: linkage.eligible_source_events,
        instagram_direct: Number(clientEvents.some((event) => event.booking_channel === "Instagram" && journeyProcedureKind(event) === "evaluation" && procedureEventBelongsToCohort(event, nonPaidEntry(date))))
      };
      anchors.push({ anchor_key: date, metrics, procedures: pipeline.procedure_branches });
    }
    result.push({
      client_id: client.id,
      unit_id: client.unit_id,
      origin_key: normalizeText(client.last_origin),
      base_anchor: pipelineCalendarDate(base),
      activity: [...activity],
      contacts,
      anchors
    });
  }
  return result;
}
export {
  prepareJourneyPatients
};
