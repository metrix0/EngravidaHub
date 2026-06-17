// app/src/lib/schedules/cliniSysSchedulesIntoSupabaseAndAds.ts
import crypto from "crypto";

import { supabase } from "@engravida/lib";

import type { DerivedAdEvent } from "@/lib/ads/deriveAdEventsFromAnalysis";
import { sendMetaEvents } from "@/lib/ads/meta/sendMetaEvents";
import { sendGoogleEvents } from "@/lib/ads/google/sendGoogleEvents";
import {
    getBigquerySchedules,
    type BigqueryScheduleRow,
} from "@/lib/schedules/getBigquerySchedules";
import { findOrCreateUnitByName } from "@/lib/units/findOrCreateUnitByName";

const FIRST_REPRODUCTION_EVALUATION_PIPELINE_ID =
    "22222222-2222-2222-2222-222222222222";
const FIRST_REPRODUCTION_EVALUATION_STAGE_ID =
    "21111111-1111-1111-1111-111111111111";

type NormalizedSchedule = {
    source_hash: string;

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

type ClientForSchedule = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    unit_id: string | null;
    pipeline_stage_id: string | null;
};

export async function syncBigquerySchedules({
                                                daysBack = 60,
                                                limit = 5000,
                                            }: {
    daysBack?: number;
    limit?: number;
} = {}) {
    const rows = await getBigquerySchedules({
        daysBack,
        limit,
    });

    console.log("[syncBigquerySchedules] FOUND schedules from BigQuery", {
        found: rows.length,
        daysBack,
        limit,
    });

    const schedules = rows
        .map(normalizeBigquerySchedule)
        .filter((schedule): schedule is NormalizedSchedule => Boolean(schedule));

    const dedupedSchedules = Array.from(
        new Map(
            schedules.map((schedule) => [schedule.source_hash, schedule])
        ).values()
    );

    console.log("[syncBigquerySchedules] DEDUPED schedules from BigQuery", {
        before: schedules.length,
        after: dedupedSchedules.length,
        removed: schedules.length - dedupedSchedules.length,
    });

    const existingHashes = await getExistingScheduleHashes(
        dedupedSchedules.map((schedule) => schedule.source_hash)
    );

    const newSchedules = dedupedSchedules.filter(
        (schedule) => !existingHashes.has(schedule.source_hash)
    );

    console.log("[syncBigquerySchedules] NEW schedules after duplicate check", {
        total_normalized: schedules.length,
        total_deduped: dedupedSchedules.length,
        existing: existingHashes.size,
        new: newSchedules.length,
    });

    const results = [];

    let savedToSupabase = 0;
    let metaSent = 0;
    let googleSent = 0;
    let fivPipelineStageUpdated = 0;

    for (const schedule of newSchedules) {
        const client = await findOrCreateClientFromSchedule(schedule);

        const { data: insertedSchedule, error: scheduleError } = await supabase
            .from("schedules")
            .insert({
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
            })
            .select("id")
            .single();

        if (scheduleError) {
            throw scheduleError;
        }

        savedToSupabase += 1;

        const pipelineMove =
            await moveClientToFirstReproductionEvaluationStageIfEmpty({
                client,
                schedule,
            });

        if (pipelineMove.updated) {
            fivPipelineStageUpdated += 1;
        }

        const eventTime = getScheduleEventTime(schedule.created_in_source_at);

        const event: DerivedAdEvent = {
            type: "schedule",
            meta_event_name: "Schedule",
            google_conversion_name: "book_appointment",
            occurred_at: eventTime,
            confidence: 0.95,
        };

        const meta = await sendMetaEvents({
            events: [event],
            phone: client.phone ?? schedule.phone,
            email: client.email,
            schedule_id: insertedSchedule.id,
            client_id: client.id,
        });

        if (meta.ok && !meta.skipped) {
            metaSent += 1;
        }

        const google = await sendGoogleEvents({
            events: [event],
            phone: client.phone ?? schedule.phone,
            email: client.email,
            name: client.name ?? schedule.patient_name,
            schedule_id: insertedSchedule.id,
            client_id: client.id,
        });

        if (google.ok && !google.skipped) {
            googleSent += 1;
        }

        await supabase
            .from("schedules")
            .update({
                meta_sent: Boolean(meta.ok && !meta.skipped),
                google_sent: Boolean(google.ok && !google.skipped),
                updated_at: new Date().toISOString(),
            })
            .eq("id", insertedSchedule.id);

        results.push({
            schedule_id: insertedSchedule.id,
            client_id: client.id,
            source_hash: schedule.source_hash,
            pipeline_move: pipelineMove,
            meta,
            google,
        });
    }

    console.log(`[syncBigquerySchedules] SAVED ${savedToSupabase} TO SUPABASE`);
    console.log("[syncBigquerySchedules] UPDATED FIV pipeline stages", {
        fiv_pipeline_stage_updated: fivPipelineStageUpdated,
    });
    console.log("[syncBigquerySchedules] SENT schedule events", {
        meta_sent: metaSent,
        google_sent: googleSent,
    });

    return {
        ok: true,
        fetched: rows.length,
        normalized: schedules.length,
        existing: existingHashes.size,
        inserted: newSchedules.length,
        saved_to_supabase: savedToSupabase,
        fiv_pipeline_stage_updated: fivPipelineStageUpdated,
        meta_sent: metaSent,
        google_sent: googleSent,
        results,
    };
}

function normalizeBigquerySchedule(
    row: BigqueryScheduleRow
): NormalizedSchedule | null {
    const scheduledFor = normalizeDate(row.data);

    if (!scheduledFor) {
        return null;
    }

    const createdInSourceAt = normalizeDate(row.agendamento_criado_em);
    const phone = cleanText(row.agenda_celular);
    const normalizedPhone = phone ? normalizeBrazilPhone(phone) : null;

    const patientName = cleanText(row.agenda_paciente);
    const unitName = cleanText(row.unidade);
    const procedureName = cleanText(row.procedimentos_procedimento);
    const attendantName = cleanText(row.agenda_autor_original);
    const status = cleanText(row.agenda_chegou);

    const sourceHash = createScheduleHash({
        scheduled_for: scheduledFor,
        created_in_source_at: createdInSourceAt,
        normalized_phone: normalizedPhone,
        patient_name: patientName,
        unit_name: unitName,
        procedure_name: procedureName,
    });

    return {
        source_hash: sourceHash,

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

async function getExistingScheduleHashes(hashes: string[]) {
    const existing = new Set<string>();

    for (const batch of chunk(hashes, 500)) {
        if (batch.length === 0) {
            continue;
        }

        const { data, error } = await supabase
            .from("schedules")
            .select("source_hash")
            .in("source_hash", batch);

        if (error) {
            throw error;
        }

        for (const row of data ?? []) {
            existing.add(row.source_hash);
        }
    }

    return existing;
}

async function findOrCreateClientFromSchedule(
    schedule: NormalizedSchedule
): Promise<ClientForSchedule> {
    const unit = await findOrCreateUnitByName(schedule.unit_name);
    const phoneOptions = buildPhoneSearchOptions(schedule.normalized_phone);

    if (phoneOptions.length > 0) {
        const { data: existingClient, error } = await supabase
            .from("clients")
            .select("id, name, phone, email, unit_id, pipeline_stage_id")
            .or(phoneOptions.map((phone) => `phone.eq.${phone}`).join(","))
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (existingClient) {
            const updates: Record<string, string> = {};

            const normalizedClientName = normalizeClientName(schedule.patient_name);

            if (normalizedClientName) {
                updates.name = normalizedClientName;
            }

            if (!existingClient.unit_id && unit?.id) {
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

                if (updateError) {
                    throw updateError;
                }

                return {
                    ...existingClient,
                    ...updates,
                } as ClientForSchedule;
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
        .select("id, name, phone, email, unit_id, pipeline_stage_id")
        .single();

    if (createError) {
        throw createError;
    }

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

    if (client.pipeline_stage_id) {
        return {
            updated: false,
            skipped_reason: "client_already_in_pipeline_stage" as const,
        };
    }

    const now = new Date().toISOString();

    const { data: updatedClient, error: updateError } = await supabase
        .from("clients")
        .update({
            pipeline_stage_id: FIRST_REPRODUCTION_EVALUATION_STAGE_ID,
            updated_at: now,
        })
        .eq("id", client.id)
        .is("pipeline_stage_id", null)
        .select("id, pipeline_stage_id")
        .maybeSingle();

    if (updateError) {
        throw updateError;
    }

    if (!updatedClient) {
        return {
            updated: false,
            skipped_reason: "client_already_in_pipeline_stage" as const,
        };
    }

    const { error: historyError } = await supabase
        .from("pipeline_history")
        .insert({
            client_id: client.id,
            pipeline_id: FIRST_REPRODUCTION_EVALUATION_PIPELINE_ID,
            from_stage_id: null,
            to_stage_id: FIRST_REPRODUCTION_EVALUATION_STAGE_ID,
            moved_by_attendant_id: null,
            moved_at: now,
            note: `Automatically moved from CliniSys schedule import for procedure: ${
                schedule.procedure_name ?? "unknown"
            }`,
        });

    if (historyError) {
        throw historyError;
    }

    client.pipeline_stage_id = FIRST_REPRODUCTION_EVALUATION_STAGE_ID;

    return {
        updated: true,
        pipeline_id: FIRST_REPRODUCTION_EVALUATION_PIPELINE_ID,
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
            ].join("|")
        )
        .digest("hex");
}

function normalizeDate(value: string | { value: string } | null) {
    const raw = typeof value === "object" ? value?.value : value;

    if (!raw) {
        return null;
    }

    return String(raw).slice(0, 10);
}

function cleanText(value: string | null) {
    const cleaned = value?.trim().replace(/\s+/g, " ") ?? null;

    return cleaned || null;
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

    if (!digits) {
        return null;
    }

    if (digits.startsWith("55")) {
        return digits;
    }

    if (digits.length === 10 || digits.length === 11) {
        return `55${digits}`;
    }

    return digits;
}

function stripBrazilPrefix(phone: string) {
    return phone.startsWith("55") ? phone.slice(2) : phone;
}

function buildPhoneSearchOptions(normalizedPhone: string | null) {
    if (!normalizedPhone) {
        return [];
    }

    return Array.from(
        new Set([
            normalizedPhone,
            `+${normalizedPhone}`,
            stripBrazilPrefix(normalizedPhone),
        ])
    );
}

function getScheduleEventTime(date: string | null) {
    const today = getTodayInSaoPaulo();

    if (!date || date === today) {
        return new Date().toISOString();
    }

    return new Date(`${date}T12:00:00-03:00`).toISOString();
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
            if (index > 0 && lowercaseWords.has(part)) {
                return part;
            }

            return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(" ");
}