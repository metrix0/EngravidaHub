// lib/schedules/cliniSysSchedulesIntoSupabaseAndAds.ts
import crypto from "crypto";

import { supabase } from "@/lib";

import type { DerivedAdEvent } from "@/lib/ads/deriveAdEventsFromAnalysis";
import { sendMetaEvents } from "@/lib/ads/meta/sendMetaEvents";
import { sendGoogleEvents } from "@/lib/ads/google/sendGoogleEvents";
import {
    getBigquerySchedules,
    type BigqueryScheduleRow,
} from "@/lib/schedules/getBigquerySchedules";
import {
    normalizeScheduleStatus,
    scheduleIsInactive,
} from "@/lib/schedules/status";
import { findOrCreateUnitByName } from "@/lib/units/findOrCreateUnitByName";
import {
    syncClientUnitsFromClinisys,
    type ClinisysUnitAssignment,
} from "@/lib/units/syncClientUnitsFromClinisys";

const FIRST_REPRODUCTION_EVALUATION_FUNNEL_ID =
    "22222222-2222-2222-2222-222222222222";
const FIRST_REPRODUCTION_EVALUATION_STAGE_ID =
    "21111111-1111-1111-1111-111111111111";
const SUPABASE_IN_FILTER_BATCH_SIZE = 100;
const CLINISYS_SCHEDULE_SOURCE = "bigquery";
const CLINISYS_SCHEDULE_SOURCES = ["bigquery", "clinisys"];

type NormalizedSchedule = {
    source_external_id: string | null;
    source_hash: string;
    legacy_source_hash: string;
    scheduled_for: string;
    created_in_source_at: string | null;
    patient_name: string | null;
    phone: string | null;
    normalized_phone: string | null;
    unit_name: string | null;
    attendant_name: string | null;
    procedure_name: string | null;
    status: string | null;
};

type ExistingSchedule = {
    id: string;
    source_hash: string;
    source_external_id: string | null;
    client_id: string | null;
    scheduled_for: string;
    created_in_source_at: string | null;
    patient_name: string | null;
    phone: string | null;
    normalized_phone: string | null;
    unit_name: string | null;
    attendant_name: string | null;
    procedure_name: string | null;
    status: string | null;
};

type ExistingScheduleIndex = {
    rows: ExistingSchedule[];
    byExternalId: Map<string, ExistingSchedule>;
    byHash: Map<string, ExistingSchedule>;
    byFallbackKey: Map<string, ExistingSchedule[]>;
};

type ClientForSchedule = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    unit_id: string | null;
    funnel_stage_id: string | null;
};

export async function syncBigquerySchedules({
    daysBack = 1,
    limit = 9999,
}: {
    daysBack?: number;
    limit?: number;
} = {}) {
    const rows = await getBigquerySchedules({ daysBack, limit });
    return syncScheduleRows(rows, daysBack, limit);
}

async function syncScheduleRows(rows: BigqueryScheduleRow[], daysBack: number, limit: number) {
    console.log("[syncBigquerySchedules] FOUND schedules from BigQuery", {
        found: rows.length,
        daysBack,
        limit,
    });

    const schedules = rows
        .map(normalizeBigquerySchedule)
        .filter((schedule): schedule is NormalizedSchedule => Boolean(schedule));

    const dedupedByIdentity = new Map<string, NormalizedSchedule>();
    for (const schedule of schedules) {
        const key = schedule.source_external_id
            ? `external:${schedule.source_external_id}`
            : `hash:${schedule.source_hash}`;
        if (!dedupedByIdentity.has(key)) dedupedByIdentity.set(key, schedule);
    }
    const dedupedSchedules = [...dedupedByIdentity.values()];

    console.log("[syncBigquerySchedules] DEDUPED schedules from BigQuery", {
        before: schedules.length,
        after: dedupedSchedules.length,
        removed: schedules.length - dedupedSchedules.length,
    });

    const existing = await getExistingSchedules(dedupedSchedules);
    const newSchedules: NormalizedSchedule[] = [];
    const clinisysUnitAssignments: ClinisysUnitAssignment[] = [];
    const changedSchedules: Array<{
        existing: ExistingSchedule;
        schedule: NormalizedSchedule;
        persistedSourceHash: string;
    }> = [];
    let unchangedSchedules = 0;
    let statusUpdated = 0;

    const schedulesInMatchOrder = [...dedupedSchedules].sort((left, right) => {
        const leftHasExactMatch = Boolean(
            left.source_external_id &&
                existing.byExternalId.has(left.source_external_id),
        );
        const rightHasExactMatch = Boolean(
            right.source_external_id &&
                existing.byExternalId.has(right.source_external_id),
        );
        return Number(rightHasExactMatch) - Number(leftHasExactMatch);
    });
    const claimedExistingIds = new Set<string>();
    let existingMatchCollisions = 0;

    for (const schedule of schedulesInMatchOrder) {
        const match = findExistingSchedule(existing, schedule);
        const existingSchedule =
            match && !claimedExistingIds.has(match.id) ? match : null;

        if (match && !existingSchedule) existingMatchCollisions += 1;

        if (!existingSchedule) {
            newSchedules.push(schedule);
            continue;
        }

        claimedExistingIds.add(existingSchedule.id);
        if (existingSchedule.client_id) {
            clinisysUnitAssignments.push({
                clientId: existingSchedule.client_id,
                unitName: schedule.unit_name,
                scheduledFor: schedule.scheduled_for,
                createdInSourceAt: schedule.created_in_source_at,
            });
        }

        const hashOwner = existing.byHash.get(schedule.source_hash);
        const persistedSourceHash =
            hashOwner && hashOwner.id !== existingSchedule.id
                ? existingSchedule.source_hash
                : schedule.source_hash;

        if (
            hasScheduleChanged(
                existingSchedule,
                schedule,
                persistedSourceHash,
            )
        ) {
            if (existingSchedule.status !== schedule.status) statusUpdated += 1;
            changedSchedules.push({
                existing: existingSchedule,
                schedule,
                persistedSourceHash,
            });
        } else {
            unchangedSchedules += 1;
        }
    }

    console.log("[syncBigquerySchedules] schedule sync plan", {
        total_normalized: schedules.length,
        total_deduped: dedupedSchedules.length,
        existing: existing.rows.length,
        new: newSchedules.length,
        updated: changedSchedules.length,
        status_updated: statusUpdated,
        unchanged: unchangedSchedules,
        existing_match_collisions: existingMatchCollisions,
    });

    await updateExistingSchedules(changedSchedules);

    const results = [];
    let insertedToSupabase = 0;
    let metaSent = 0;
    let googleSent = 0;
    let fivFunnelStageUpdated = 0;

    for (const schedule of newSchedules) {
        const client = await findOrCreateClientFromSchedule(schedule);
        clinisysUnitAssignments.push({
            clientId: client.id,
            unitName: schedule.unit_name,
            scheduledFor: schedule.scheduled_for,
            createdInSourceAt: schedule.created_in_source_at,
        });

        const { data: insertedSchedule, error: scheduleError } = await supabase
            .from("schedules")
            .upsert({
                source: CLINISYS_SCHEDULE_SOURCE,
                source_external_id: schedule.source_external_id,
                source_hash: schedule.source_hash,
                client_id: client.id,
                scheduled_for: schedule.scheduled_for,
                created_in_source_at: schedule.created_in_source_at,
                patient_name: schedule.patient_name,
                phone: schedule.phone,
                normalized_phone: schedule.normalized_phone,
                unit_name: schedule.unit_name,
                attendant_name: schedule.attendant_name,
                procedure_name: schedule.procedure_name,
                status: schedule.status,
                updated_at: new Date().toISOString(),
            }, { onConflict: "source_hash", ignoreDuplicates: true })
            .select("id")
            .maybeSingle();

        if (scheduleError) throw scheduleError;
        // Another worker (or the creation webhook) won the same appointment ID.
        if (!insertedSchedule) continue;
        insertedToSupabase += 1;

        const inactive = scheduleIsInactive(
            normalizeScheduleStatus(schedule.status),
        );
        const funnelMove = inactive
            ? {
                  updated: false,
                  skipped_reason: "inactive_schedule_status" as const,
              }
            : await moveClientToFirstReproductionEvaluationStageIfEmpty({
                  client,
                  schedule,
              });

        if (funnelMove.updated) fivFunnelStageUpdated += 1;

        const { meta, google } = await sendScheduleConversion({
            schedule,
            client,
            scheduleId: insertedSchedule.id,
        });
        if (isSuccessfulDelivery(meta)) metaSent += 1;
        if (isSuccessfulDelivery(google)) googleSent += 1;

        // Meta and Google delivery state is stored only in public.ad_events.
        results.push({
            schedule_id: insertedSchedule.id,
            client_id: client.id,
            source_hash: schedule.source_hash,
            funnel_move: funnelMove,
            meta,
            google,
        });
    }

    const unitSync = await syncClientUnitsFromClinisys(
        clinisysUnitAssignments,
    );

    console.log("[syncBigquerySchedules] SAVED schedules to Supabase", {
        inserted: insertedToSupabase,
        updated: changedSchedules.length,
        status_updated: statusUpdated,
        unchanged: unchangedSchedules,
        existing_match_collisions: existingMatchCollisions,
    });
    console.log("[syncBigquerySchedules] SYNCED client units from CliniSys", {
        considered: unitSync.considered,
        resolved: unitSync.resolved,
        updated: unitSync.updated,
    });
    console.log("[syncBigquerySchedules] UPDATED FIV funnel stages", {
        fiv_funnel_stage_updated: fivFunnelStageUpdated,
    });
    console.log("[syncBigquerySchedules] SENT schedule events", {
        meta_sent: metaSent,
        google_sent: googleSent,
    });

    return {
        ok: true,
        fetched: rows.length,
        normalized: schedules.length,
        existing: existing.rows.length,
        inserted: insertedToSupabase,
        updated: changedSchedules.length,
        status_updated: statusUpdated,
        unchanged: unchangedSchedules,
        saved_to_supabase:
            insertedToSupabase + changedSchedules.length,
        clinisys_units_considered: unitSync.considered,
        clinisys_units_updated: unitSync.updated,
        fiv_funnel_stage_updated: fivFunnelStageUpdated,
        meta_sent: metaSent,
        google_sent: googleSent,
        results,
    };
}


type ClinisysCreatedAppointment = {
    externalId: string;
    clientId: string;
    startsAt: string;
    status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
    patientName: string;
    patientPhone: string | null;
    unitName: string;
    procedureName: string;
};

const APPOINTMENT_STATUS_TO_SCHEDULE: Record<ClinisysCreatedAppointment["status"], string> = {
    scheduled: "Não",
    confirmed: "Sim",
    completed: "Atendido",
    cancelled: "Desmarcou",
    no_show: "Faltou",
};

// BigQuery imports only first reproduction evaluations. Keep exactly that
// conversion scope when processing the earlier creation webhook.
export async function processClinisysAppointmentCreated(appointment: ClinisysCreatedAppointment) {
    if (!appointment.procedureName.includes("1ª Avaliação de Reprodução Humana") ||
        appointment.status === "cancelled") {
        return { ok: true, skipped: true, reason: "not_an_active_first_evaluation" };
    }

    const schedule = normalizeBigquerySchedule({
        source_schedule_id: appointment.externalId,
        data: saoPauloDate(new Date(appointment.startsAt)),
        agendamento_criado_em: saoPauloDate(new Date()),
        agenda_autor_original: null,
        agenda_paciente: appointment.patientName,
        agenda_celular: appointment.patientPhone,
        unidade: appointment.unitName,
        procedimentos_procedimento: appointment.procedureName,
        agenda_chegou: APPOINTMENT_STATUS_TO_SCHEDULE[appointment.status],
    });
    if (!schedule) throw new Error("Invalid schedule date from creation webhook");

    const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id, name, phone, email, unit_id, funnel_stage_id")
        .eq("id", appointment.clientId)
        .single();
    if (clientError) throw clientError;

    // The external ID is the same Clinisys agenda ID supplied to BigQuery.
    // Both paths use the same source_hash (unique in schedules) and therefore
    // the same schedule ID / Meta event_id / Google orderId.
    const { data: existing, error: existingError } = await supabase
        .from("schedules")
        .select("id, client_id")
        .in("source", CLINISYS_SCHEDULE_SOURCES)
        .eq("source_external_id", appointment.externalId)
        .limit(1)
        .maybeSingle();
    if (existingError) throw existingError;

    let scheduleId = existing?.id ?? null;
    let linkedClientId = existing?.client_id ?? client.id;
    let inserted = false;
    if (!scheduleId) {
        const { data, error } = await supabase.from("schedules")
            .upsert({
                source: "clinisys",
                source_external_id: schedule.source_external_id,
                source_hash: schedule.source_hash,
                client_id: client.id,
                scheduled_for: schedule.scheduled_for,
                created_in_source_at: schedule.created_in_source_at,
                patient_name: schedule.patient_name,
                phone: schedule.phone,
                normalized_phone: schedule.normalized_phone,
                unit_name: schedule.unit_name,
                attendant_name: schedule.attendant_name,
                procedure_name: schedule.procedure_name,
                status: schedule.status,
                updated_at: new Date().toISOString(),
            }, { onConflict: "source_hash", ignoreDuplicates: true })
            .select("id")
            .maybeSingle();
        if (error) throw error;
        scheduleId = data?.id ?? null;
        inserted = Boolean(data);
    }
    if (!scheduleId) {
        // A concurrent BigQuery/webhook insert won the unique source_hash.
        const { data, error } = await supabase.from("schedules")
            .select("id, client_id")
            .eq("source_hash", schedule.source_hash)
            .single();
        if (error) throw error;
        scheduleId = data.id;
        linkedClientId = data.client_id;
    }

    if (linkedClientId !== client.id) {
        const { error } = await supabase.from("schedules")
            .update({ client_id: client.id, updated_at: new Date().toISOString() })
            .eq("id", scheduleId);
        if (error) throw error;
    }

    if (inserted) {
        await moveClientToFirstReproductionEvaluationStageIfEmpty({
            client: client as ClientForSchedule,
            schedule,
        });
        await syncClientUnitsFromClinisys([{
            clientId: client.id,
            unitName: schedule.unit_name,
            scheduledFor: schedule.scheduled_for,
            createdInSourceAt: schedule.created_in_source_at,
        }]);
    }

    // Repeated webhook deliveries and BigQuery-first deliveries must not
    // emit a second conversion for this same appointment.
    const { meta, google } = await sendScheduleConversion({
        schedule,
        client: client as ClientForSchedule,
        scheduleId,
        checkAlreadySent: true,
    });

    const failed = [meta, google].some((result) =>
        typeof result === "object" && result !== null &&
        (result as { ok?: boolean; skipped?: boolean }).ok === false &&
        (result as { skipped?: boolean }).skipped !== true,
    );
    return { ok: !failed, skipped: false, scheduleId, meta, google };
}

export async function markClinisysScheduleCancelled(externalId: string) {
    const { error } = await supabase.from("schedules")
        .update({ status: "Desmarcou", updated_at: new Date().toISOString() })
        .in("source", CLINISYS_SCHEDULE_SOURCES)
        .eq("source_external_id", externalId);
    if (error) throw error;
}

async function sendScheduleConversion({
    schedule,
    client,
    scheduleId,
    checkAlreadySent = false,
}: {
    schedule: NormalizedSchedule;
    client: ClientForSchedule;
    scheduleId: string;
    checkAlreadySent?: boolean;
}) {
    const inactive = scheduleIsInactive(normalizeScheduleStatus(schedule.status));
    const skipped = { ok: true, skipped: true, reason: "inactive_schedule_status" };
    if (inactive) return { meta: skipped, google: skipped };

    const alreadySent = new Set<string>();
    if (checkAlreadySent) {
        const { data, error } = await supabase.from("ad_events")
            .select("platform")
            .eq("schedule_id", scheduleId)
            .eq("event_type", "schedule")
            .eq("status", "sent");
        if (error) throw error;
        for (const row of data ?? []) alreadySent.add(row.platform);
    }

    const event: DerivedAdEvent = {
        type: "schedule",
        meta_event_name: "Schedule",
        google_conversion_name: "book_appointment",
        occurred_at: getScheduleEventTime(schedule.created_in_source_at),
        confidence: 0.95,
    };
    const meta = alreadySent.has("Meta Ads")
        ? { ok: true, skipped: true, reason: "already_sent_for_appointment" }
        : await sendMetaEvents({
            events: [event],
            phone: client.phone ?? schedule.phone,
            email: client.email,
            schedule_id: scheduleId,
            client_id: client.id,
        });
    const google = alreadySent.has("Google Ads")
        ? { ok: true, skipped: true, reason: "already_sent_for_appointment" }
        : await sendGoogleEvents({
            events: [event],
            phone: client.phone ?? schedule.phone,
            email: client.email,
            name: client.name ?? schedule.patient_name,
            schedule_id: scheduleId,
            client_id: client.id,
        });
    return { meta, google };
}

function saoPauloDate(value: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizeBigquerySchedule(
    row: BigqueryScheduleRow,
): NormalizedSchedule | null {
    const scheduledFor = normalizeDate(row.data);
    if (!scheduledFor) return null;

    const createdInSourceAt = normalizeDate(row.agendamento_criado_em);
    const phone = cleanText(row.agenda_celular);
    const normalizedPhone = phone ? normalizeBrazilPhone(phone) : null;
    const patientName = cleanText(row.agenda_paciente);
    const unitName = cleanText(row.unidade);
    const procedureName = cleanText(row.procedimentos_procedimento);
    const attendantName = cleanText(row.agenda_autor_original);
    const status = cleanText(row.agenda_chegou);
    const sourceExternalId = cleanSourceId(row.source_schedule_id);

    const legacySourceHash = createScheduleHash({
        scheduled_for: scheduledFor,
        created_in_source_at: createdInSourceAt,
        normalized_phone: normalizedPhone,
        patient_name: patientName,
        unit_name: unitName,
        procedure_name: procedureName,
    });
    const sourceHash = sourceExternalId
        ? createExternalScheduleHash(sourceExternalId)
        : legacySourceHash;

    return {
        source_external_id: sourceExternalId,
        source_hash: sourceHash,
        legacy_source_hash: legacySourceHash,
        scheduled_for: scheduledFor,
        created_in_source_at: createdInSourceAt,
        patient_name: patientName,
        phone,
        normalized_phone: normalizedPhone,
        unit_name: unitName,
        attendant_name: attendantName,
        procedure_name: procedureName,
        status,
    };
}

async function getExistingSchedules(
    schedules: NormalizedSchedule[],
): Promise<ExistingScheduleIndex> {
    const byId = new Map<string, ExistingSchedule>();
    const externalIds = schedules
        .map((schedule) => schedule.source_external_id)
        .filter((value): value is string => Boolean(value));
    const hashes = schedules.flatMap((schedule) => [
        schedule.source_hash,
        schedule.legacy_source_hash,
    ]);

    // PostgREST serializes `.in(...)` values into the request URL and also
    // returns that URL in response headers. Keep batches small enough for
    // Node/Undici's header limit; 300 SHA-256 values exceeds 20 KB.
    for (const batch of chunk(
        [...new Set(externalIds)],
        SUPABASE_IN_FILTER_BATCH_SIZE,
    )) {
        if (batch.length === 0) continue;

        const { data, error } = await supabase
            .from("schedules")
            .select(EXISTING_SCHEDULE_SELECT)
            .in("source", CLINISYS_SCHEDULE_SOURCES)
            .in("source_external_id", batch);

        if (error) throw error;
        for (const row of data ?? []) {
            const schedule = row as unknown as ExistingSchedule;
            byId.set(schedule.id, schedule);
        }
    }

    for (const batch of chunk(
        [...new Set(hashes)],
        SUPABASE_IN_FILTER_BATCH_SIZE,
    )) {
        if (batch.length === 0) continue;

        const { data, error } = await supabase
            .from("schedules")
            .select(EXISTING_SCHEDULE_SELECT)
            .in("source_hash", batch);

        if (error) throw error;
        for (const row of data ?? []) {
            const schedule = row as unknown as ExistingSchedule;
            byId.set(schedule.id, schedule);
        }
    }

    // This fallback is used only when the BigQuery view does not expose a
    // permanent appointment ID. It safely matches a mutable date/status row
    // only when the client + creation date + procedure combination is unique.
    const fallbackKeys = new Set(
        schedules
            .map(createScheduleFallbackKey)
            .filter((value): value is string => Boolean(value)),
    );
    const fallbackCreatedDates = [
        ...new Set(
            [...fallbackKeys]
                .map((key) => key.split("|")[0])
                .filter(Boolean),
        ),
    ];

    for (const createdDates of chunk(
        fallbackCreatedDates,
        SUPABASE_IN_FILTER_BATCH_SIZE,
    )) {
        if (createdDates.length === 0) continue;

        const { data, error } = await supabase
            .from("schedules")
            .select(EXISTING_SCHEDULE_SELECT)
            .in("source", CLINISYS_SCHEDULE_SOURCES)
            .in("created_in_source_at", createdDates)
            .limit(5_000);

        if (error) throw error;
        for (const row of data ?? []) {
            const schedule = row as unknown as ExistingSchedule;
            const key = createScheduleFallbackKey(schedule);
            if (key && fallbackKeys.has(key)) {
                byId.set(schedule.id, schedule);
            }
        }
    }

    const rows = [...byId.values()];
    const byExternalId = new Map<string, ExistingSchedule>();
    const byHash = new Map<string, ExistingSchedule>();
    const byFallbackKey = new Map<string, ExistingSchedule[]>();

    for (const row of rows) {
        if (row.source_external_id) {
            byExternalId.set(row.source_external_id, row);
        }
        byHash.set(row.source_hash, row);

        const fallbackKey = createScheduleFallbackKey(row);
        if (fallbackKey) {
            const matches = byFallbackKey.get(fallbackKey) ?? [];
            matches.push(row);
            byFallbackKey.set(fallbackKey, matches);
        }
    }

    return { rows, byExternalId, byHash, byFallbackKey };
}

const EXISTING_SCHEDULE_SELECT = [
    "id",
    "source_hash",
    "source_external_id",
    "client_id",
    "scheduled_for",
    "created_in_source_at",
    "patient_name",
    "phone",
    "normalized_phone",
    "unit_name",
    "attendant_name",
    "procedure_name",
    "status",
].join(",");

function findExistingSchedule(
    index: ExistingScheduleIndex,
    schedule: NormalizedSchedule,
) {
    if (schedule.source_external_id) {
        const byExternalId = index.byExternalId.get(
            schedule.source_external_id,
        );
        if (byExternalId) return byExternalId;
    }

    const byHash =
        index.byHash.get(schedule.source_hash) ??
        index.byHash.get(schedule.legacy_source_hash);
    if (byHash && canUseLegacyScheduleMatch(byHash, schedule)) return byHash;

    const fallbackKey = createScheduleFallbackKey(schedule);
    if (!fallbackKey) return null;

    const fallbackMatches = (
        index.byFallbackKey.get(fallbackKey) ?? []
    ).filter((row) => canUseLegacyScheduleMatch(row, schedule));
    return fallbackMatches.length === 1 ? fallbackMatches[0] : null;
}

function canUseLegacyScheduleMatch(
    existing: ExistingSchedule,
    schedule: NormalizedSchedule,
) {
    return (
        !existing.source_external_id ||
        !schedule.source_external_id ||
        existing.source_external_id === schedule.source_external_id
    );
}

function hasScheduleChanged(
    existing: ExistingSchedule,
    schedule: NormalizedSchedule,
    persistedSourceHash: string,
) {
    return (
        existing.source_hash !== persistedSourceHash ||
        existing.source_external_id !== schedule.source_external_id ||
        existing.scheduled_for !== schedule.scheduled_for ||
        existing.created_in_source_at !== schedule.created_in_source_at ||
        existing.patient_name !== schedule.patient_name ||
        existing.phone !== schedule.phone ||
        existing.normalized_phone !== schedule.normalized_phone ||
        existing.unit_name !== schedule.unit_name ||
        existing.attendant_name !== schedule.attendant_name ||
        existing.procedure_name !== schedule.procedure_name ||
        existing.status !== schedule.status
    );
}

async function updateExistingSchedules(
    changes: Array<{
        existing: ExistingSchedule;
        schedule: NormalizedSchedule;
        persistedSourceHash: string;
    }>,
) {
    for (const batch of chunk(changes, 300)) {
        if (batch.length === 0) continue;

        const now = new Date().toISOString();
        const payload = batch.map(
            ({ existing, schedule, persistedSourceHash }) => ({
                id: existing.id,
                source: CLINISYS_SCHEDULE_SOURCE,
                source_external_id: schedule.source_external_id,
                source_hash: persistedSourceHash,
                client_id: existing.client_id,
                scheduled_for: schedule.scheduled_for,
                created_in_source_at: schedule.created_in_source_at,
                patient_name: schedule.patient_name,
                phone: schedule.phone,
                normalized_phone: schedule.normalized_phone,
                unit_name: schedule.unit_name,
                attendant_name: schedule.attendant_name,
                procedure_name: schedule.procedure_name,
                status: schedule.status,
                updated_at: now,
            }),
        );

        const { error } = await supabase
            .from("schedules")
            .upsert(payload, { onConflict: "id" });

        if (error) throw error;
    }
}

async function findOrCreateClientFromSchedule(
    schedule: NormalizedSchedule,
): Promise<ClientForSchedule> {
    const unit = await findOrCreateUnitByName(schedule.unit_name);
    const phoneOptions = buildPhoneSearchOptions(schedule.normalized_phone);

    if (phoneOptions.length > 0) {
        const { data: existingClient, error } = await supabase
            .from("clients")
            .select("id, name, phone, email, unit_id, funnel_stage_id")
            .or(phoneOptions.map((phone) => `phone.eq.${phone}`).join(","))
            .maybeSingle();

        if (error) throw error;

        if (existingClient) {
            const updates: Record<string, string> = {};
            const normalizedClientName = normalizeClientName(schedule.patient_name);

            if (normalizedClientName) updates.name = normalizedClientName;
            if (unit?.id && existingClient.unit_id !== unit.id) {
                updates.unit_id = unit.id;
            }

            if (Object.keys(updates).length > 0) {
                const { error: updateError } = await supabase
                    .from("clients")
                    .update({
                        ...updates,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", existingClient.id);

                if (updateError) throw updateError;
                return { ...existingClient, ...updates } as ClientForSchedule;
            }

            return existingClient as ClientForSchedule;
        }
    }

    const now = new Date().toISOString();
    const { data: newClient, error: createError } = await supabase
        .from("clients")
        .insert({
            name: normalizeClientName(schedule.patient_name),
            phone: schedule.normalized_phone ?? schedule.phone,
            unit_id: unit?.id ?? null,
            first_seen_at: now,
            last_interaction_at: now,
        })
        .select("id, name, phone, email, unit_id, funnel_stage_id")
        .single();

    if (createError) throw createError;
    return newClient as ClientForSchedule;
}

async function moveClientToFirstReproductionEvaluationStageIfEmpty({
    client,
    schedule,
}: {
    client: ClientForSchedule;
    schedule: NormalizedSchedule;
}) {
    if (!isFirstEvaluationProcedure(schedule.procedure_name)) {
        return {
            updated: false,
            skipped_reason: "procedure_not_matching" as const,
        };
    }

    if (client.funnel_stage_id) {
        return {
            updated: false,
            skipped_reason: "client_already_in_funnel_stage" as const,
        };
    }

    const now = new Date().toISOString();
    const { data: updatedClient, error: updateError } = await supabase
        .from("clients")
        .update({
            funnel_stage_id: FIRST_REPRODUCTION_EVALUATION_STAGE_ID,
            updated_at: now,
        })
        .eq("id", client.id)
        .is("funnel_stage_id", null)
        .select("id, funnel_stage_id")
        .maybeSingle();

    if (updateError) throw updateError;

    if (!updatedClient) {
        return {
            updated: false,
            skipped_reason: "client_already_in_funnel_stage" as const,
        };
    }

    const { error: historyError } = await supabase
        .from("funnel_history")
        .insert({
            client_id: client.id,
            funnel_id: FIRST_REPRODUCTION_EVALUATION_FUNNEL_ID,
            from_stage_id: null,
            to_stage_id: FIRST_REPRODUCTION_EVALUATION_STAGE_ID,
            moved_by_attendant_id: null,
            moved_at: now,
            note: `Automatically moved from CliniSys schedule import for procedure: ${
                schedule.procedure_name ?? "unknown"
            }`,
        });

    if (historyError) throw historyError;

    client.funnel_stage_id = FIRST_REPRODUCTION_EVALUATION_STAGE_ID;
    return {
        updated: true,
        funnel_id: FIRST_REPRODUCTION_EVALUATION_FUNNEL_ID,
        stage_id: FIRST_REPRODUCTION_EVALUATION_STAGE_ID,
    };
}

function isFirstEvaluationProcedure(procedureName: string | null) {
    const normalized = normalizeProcedureMatchText(procedureName);
    return /\b(?:1|1a|1o|primeira)\s+avaliacao\b/.test(normalized);
}

function normalizeProcedureMatchText(value: string | null) {
    return normalizeHashText(value)
        .replace(/[ªº°]/g, " ")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function createScheduleHash({
    scheduled_for,
    created_in_source_at,
    normalized_phone,
    patient_name,
    unit_name,
    procedure_name,
}: {
    scheduled_for: string;
    created_in_source_at: string | null;
    normalized_phone: string | null;
    patient_name: string | null;
    unit_name: string | null;
    procedure_name: string | null;
}) {
    return crypto
        .createHash("sha256")
        .update(
            [
                scheduled_for,
                created_in_source_at ?? "",
                normalized_phone ?? "",
                normalizeHashText(patient_name),
                normalizeHashText(unit_name),
                normalizeHashText(procedure_name),
            ].join("|"),
        )
        .digest("hex");
}

function createExternalScheduleHash(sourceExternalId: string) {
    return crypto
        .createHash("sha256")
        .update(`${CLINISYS_SCHEDULE_SOURCE}|agenda_id|${sourceExternalId}`)
        .digest("hex");
}

function normalizeDate(value: string | { value: string } | null) {
    const raw = typeof value === "object" ? value?.value : value;
    if (!raw) return null;
    return String(raw).slice(0, 10);
}

function cleanText(value: string | null) {
    const cleaned = value?.trim().replace(/\s+/g, " ") ?? null;
    return cleaned || null;
}

function cleanSourceId(value: string | number | null) {
    if (value === null || value === undefined) return null;
    const cleaned = String(value).trim();
    return cleaned || null;
}

function createScheduleFallbackKey(
    schedule: Pick<
        NormalizedSchedule,
        | "created_in_source_at"
        | "normalized_phone"
        | "patient_name"
        | "procedure_name"
    >,
) {
    if (!schedule.created_in_source_at) return null;

    const identity =
        schedule.normalized_phone ?? normalizeHashText(schedule.patient_name);
    if (!identity) return null;

    return [
        schedule.created_in_source_at,
        identity,
        normalizeHashText(schedule.procedure_name),
    ].join("|");
}

function normalizeHashText(value: string | null) {
    return (value ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
}

function normalizeBrazilPhone(phone: string) {
    const digits = phone.replace(/\D/g, "");
    if (!digits) return null;
    if (digits.startsWith("55")) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
}

function stripBrazilPrefix(phone: string) {
    return phone.startsWith("55") ? phone.slice(2) : phone;
}

function buildPhoneSearchOptions(normalizedPhone: string | null) {
    if (!normalizedPhone) return [];

    return Array.from(
        new Set([
            normalizedPhone,
            `+${normalizedPhone}`,
            stripBrazilPrefix(normalizedPhone),
        ]),
    );
}

function getScheduleEventTime(date: string | null) {
    const today = getTodayInSaoPaulo();
    if (!date || date === today) return new Date().toISOString();
    return new Date(`${date}T12:00:00-03:00`).toISOString();
}

function isSuccessfulDelivery(value: unknown) {
    if (!value || typeof value !== "object") return false;
    const result = value as { ok?: unknown; skipped?: unknown };
    return result.ok === true && result.skipped !== true;
}

function getTodayInSaoPaulo() {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());

    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    return `${year}-${month}-${day}`;
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function normalizeClientName(value: string | null | undefined) {
    const cleaned = value?.trim().replace(/\s+/g, " ");
    if (!cleaned) return null;

    const lowercaseWords = new Set(["da", "de", "do", "das", "dos", "e"]);

    return cleaned
        .toLowerCase()
        .split(" ")
        .map((part, index) => {
            if (index > 0 && lowercaseWords.has(part)) return part;
            return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(" ");
}
