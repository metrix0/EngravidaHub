// lib/funnel/syncClinisysJourney.ts
import crypto from "crypto";

import { supabase } from "@/lib";
import {
    classifyClinisysJourneyProcedure,
    resolveFunnelMilestone,
    type ClinisysJourneyEvent,
    type ClinisysJourneyKind,
} from "@/lib/funnel/clinisysJourney";
import {
    getBigquerySchedules,
    type BigqueryScheduleRow,
} from "@/lib/schedules/getBigquerySchedules";
import {
    isTransientSupabaseError,
    withSupabaseRetry,
} from "@/lib/supabase/retry";
import { findOrCreateUnitByName } from "@/lib/units/findOrCreateUnitByName";
import { syncClientUnitsFromClinisys } from "@/lib/units/syncClientUnitsFromClinisys";

const BATCH_SIZE = 100;
const UPSERT_BATCH_SIZE = 300;
const CLINISYS_SOURCE = "bigquery";

type NormalizedJourneyEvent = {
    source_external_id: string | null;
    source_hash: string;
    client_id: string | null;
    scheduled_for: string;
    created_in_source_at: string | null;
    patient_name: string | null;
    phone: string | null;
    normalized_phone: string | null;
    unit_name: string | null;
    procedure_name: string | null;
    status: string | null;
    event_kind: ClinisysJourneyKind;
};

type JourneyClient = {
    id: string;
    phone: string | null;
    phone_identity: string | null;
};

export async function syncClinisysFunnelJourney({
    daysBack = 180,
    daysForward = 365,
    limit = 25_000,
    dryRun = false,
}: {
    daysBack?: number;
    daysForward?: number;
    limit?: number;
    dryRun?: boolean;
} = {}) {
    const rows = await getBigquerySchedules({
        daysBack,
        daysForward,
        limit,
        scope: "funnel",
    });

    const ignoredProcedureNames = new Map<string, number>();
    const normalized = rows.flatMap((row) => {
        const event = normalizeJourneyEvent(row);
        if (event) return [event];

        const procedureName = cleanText(row.procedimentos_procedimento);
        if (procedureName) {
            ignoredProcedureNames.set(
                procedureName,
                (ignoredProcedureNames.get(procedureName) ?? 0) + 1,
            );
        }
        return [];
    });

    const deduped = [
        ...new Map(
            normalized.map((event) => [
                event.source_external_id
                    ? `external:${event.source_external_id}`
                    : `hash:${event.source_hash}`,
                event,
            ]),
        ).values(),
    ];

    const procedureSummary = summarizeProcedures(deduped);
    const ignoredSummary = [...ignoredProcedureNames.entries()]
        .map(([procedure_name, count]) => ({ procedure_name, count }))
        .sort((left, right) => right.count - left.count);

    if (dryRun) {
        return {
            ok: true,
            dry_run: true,
            fetched: rows.length,
            eligible: deduped.length,
            ignored: rows.length - normalized.length,
            procedures: procedureSummary,
            ignored_procedures: ignoredSummary,
        };
    }

    const clientsByPhone = await loadClientsByPhone(deduped);
    const resolvedEvents: NormalizedJourneyEvent[] = [];
    let skippedMissingPhone = 0;

    for (const event of deduped) {
        if (!event.normalized_phone) {
            skippedMissingPhone += 1;
            continue;
        }

        let client = clientsByPhone.get(event.normalized_phone) ?? null;
        if (!client) {
            client = await findOrCreateJourneyClient(event);
            clientsByPhone.set(event.normalized_phone, client);
        }

        resolvedEvents.push({ ...event, client_id: client.id });
    }

    const now = new Date().toISOString();
    for (const batch of chunk(resolvedEvents, UPSERT_BATCH_SIZE)) {
        const { error } = await withSupabaseRetry(
            () =>
                supabase
                    .from("funnel_clinisys_events")
                    .upsert(
                        batch.map((event) => ({
                            source: CLINISYS_SOURCE,
                            source_external_id: event.source_external_id,
                            source_hash: event.source_hash,
                            client_id: event.client_id,
                            scheduled_for: event.scheduled_for,
                            created_in_source_at: event.created_in_source_at,
                            patient_name: event.patient_name,
                            phone: event.phone,
                            normalized_phone: event.normalized_phone,
                            unit_name: event.unit_name,
                            procedure_name: event.procedure_name,
                            status: event.status,
                            event_kind: event.event_kind,
                            updated_at: now,
                        })),
                        { onConflict: "source_hash" },
                    ),
            {
                attempts: 3,
                label: "clinisys funnel event upsert",
            },
        );

        if (error) throw error;
    }

    const unitSync = await syncClientUnitsFromClinisys(
        resolvedEvents.flatMap((event) =>
            event.client_id
                ? [
                      {
                          clientId: event.client_id,
                          unitName: event.unit_name,
                          scheduledFor: event.scheduled_for,
                          createdInSourceAt: event.created_in_source_at,
                      },
                  ]
                : [],
        ),
    );
    const affectedClientIds = [
        ...new Set(
            resolvedEvents
                .map((event) => event.client_id)
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    const moves = await buildFunnelMoves(affectedClientIds);
    let moved = 0;

    for (const batch of chunk(moves, UPSERT_BATCH_SIZE)) {
        const { data, error } = await withSupabaseRetry(
            () =>
                supabase.rpc("apply_clinisys_funnel_moves", {
                    p_moves: batch,
                }),
            {
                attempts: 3,
                label: "clinisys funnel moves",
            },
        );

        if (error) throw error;
        moved += getUpdatedCount(data);
    }

    console.log("[syncClinisysFunnelJourney] completed", {
        fetched: rows.length,
        eligible: deduped.length,
        upserted: resolvedEvents.length,
        affected_clients: affectedClientIds.length,
        moved,
        clinisys_units_updated: unitSync.updated,
        skipped_missing_phone: skippedMissingPhone,
    });

    return {
        ok: true,
        dry_run: false,
        fetched: rows.length,
        eligible: deduped.length,
        upserted: resolvedEvents.length,
        affected_clients: affectedClientIds.length,
        moved,
        clinisys_units_considered: unitSync.considered,
        clinisys_units_updated: unitSync.updated,
        skipped_missing_phone: skippedMissingPhone,
        procedures: procedureSummary,
        ignored_procedures: ignoredSummary,
    };
}

function normalizeJourneyEvent(
    row: BigqueryScheduleRow,
): NormalizedJourneyEvent | null {
    const scheduledFor = normalizeDate(row.data);
    const procedureName = cleanText(row.procedimentos_procedimento);
    const eventKind = classifyClinisysJourneyProcedure(procedureName);
    if (!scheduledFor || !eventKind) return null;

    const createdInSourceAt = normalizeDate(row.agendamento_criado_em);
    const phone = cleanText(row.agenda_celular);
    const normalizedPhone = normalizeBrazilPhone(phone);
    const patientName = cleanText(row.agenda_paciente);
    const unitName = cleanText(row.unidade);
    const sourceExternalId = cleanSourceId(row.source_schedule_id);
    const sourceHash = sourceExternalId
        ? createExternalScheduleHash(sourceExternalId)
        : createFallbackHash({
              scheduledFor,
              createdInSourceAt,
              normalizedPhone,
              patientName,
              unitName,
              procedureName,
          });

    return {
        source_external_id: sourceExternalId,
        source_hash: sourceHash,
        client_id: null,
        scheduled_for: scheduledFor,
        created_in_source_at: createdInSourceAt,
        patient_name: patientName,
        phone,
        normalized_phone: normalizedPhone,
        unit_name: unitName,
        procedure_name: procedureName,
        status: cleanText(row.agenda_chegou),
        event_kind: eventKind,
    };
}

async function loadClientsByPhone(events: NormalizedJourneyEvent[]) {
    const normalizedPhones = [
        ...new Set(
            events
                .map((event) => event.normalized_phone)
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    const result = new Map<string, JourneyClient>();

    for (const phoneBatch of chunk(normalizedPhones, BATCH_SIZE)) {
        const phoneVariants = phoneBatch.flatMap(buildPhoneSearchOptions);
        const [
            { data: byPhone, error: phoneError },
            { data: byIdentity, error: identityError },
        ] = await Promise.all([
            withSupabaseRetry(
                () =>
                    supabase
                        .from("clients")
                        .select("id, phone, phone_identity")
                        .in("phone", phoneVariants),
                {
                    attempts: 3,
                    label: "clinisys clients by phone",
                },
            ),
            withSupabaseRetry(
                () =>
                    supabase
                        .from("clients")
                        .select("id, phone, phone_identity")
                        .in("phone_identity", phoneBatch),
                {
                    attempts: 3,
                    label: "clinisys clients by identity",
                },
            ),
        ]);

        if (phoneError) throw phoneError;
        if (identityError) throw identityError;

        for (const row of [...(byPhone ?? []), ...(byIdentity ?? [])]) {
            const client = row as JourneyClient;
            const key =
                normalizeBrazilPhone(client.phone_identity) ??
                normalizeBrazilPhone(client.phone);
            if (key && !result.has(key)) result.set(key, client);
        }
    }

    return result;
}

async function findOrCreateJourneyClient(
    event: NormalizedJourneyEvent,
    retryInsert = true,
): Promise<JourneyClient> {
    const existing = await lookupJourneyClient(event);
    if (existing) return existing;

    const unit = await findOrCreateUnitByName(event.unit_name);
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from("clients")
        .insert({
            name: normalizeClientName(event.patient_name),
            phone: event.normalized_phone ?? event.phone,
            unit_id: unit?.id ?? null,
            first_seen_at: now,
            last_interaction_at: now,
        })
        .select("id, phone, phone_identity")
        .single();

    if (error) {
        if (
            isTransientSupabaseError(error) ||
            (typeof error === "object" &&
                error !== null &&
                (error as { code?: string }).code === "23505")
        ) {
            const recovered = await lookupJourneyClient(event);
            if (recovered) return recovered;

            if (retryInsert && isTransientSupabaseError(error)) {
                return findOrCreateJourneyClient(event, false);
            }
        }

        throw error;
    }
    return data as JourneyClient;
}

async function lookupJourneyClient(
    event: NormalizedJourneyEvent,
): Promise<JourneyClient | null> {
    const phoneOptions = buildPhoneSearchOptions(event.normalized_phone);
    const { data: matches, error } = await withSupabaseRetry(
        () =>
            supabase
                .from("clients")
                .select("id, phone, phone_identity")
                .or(
                    [
                        ...phoneOptions.map((phone) => `phone.eq.${phone}`),
                        event.normalized_phone
                            ? `phone_identity.eq.${event.normalized_phone}`
                            : "",
                    ]
                        .filter(Boolean)
                        .join(","),
                )
                .limit(1),
        {
            attempts: 3,
            label: "clinisys client lookup",
        },
    );

    if (error) throw error;
    return matches?.[0] ? (matches[0] as JourneyClient) : null;
}

async function buildFunnelMoves(clientIds: string[]) {
    const events = await loadJourneyEvents(clientIds);
    const byClient = new Map<string, ClinisysJourneyEvent[]>();

    for (const event of events) {
        const current = byClient.get(event.client_id) ?? [];
        current.push(event);
        byClient.set(event.client_id, current);
    }

    return [...byClient.entries()].flatMap(([clientId, clientEvents]) => {
        const milestone = resolveFunnelMilestone(clientEvents);
        if (!milestone) return [];

        return [
            {
                client_id: clientId,
                to_stage_id: milestone.stageId,
                note: `CliniSys: ${milestone.event.procedure_name ?? "procedimento"} · ${
                    milestone.event.status ?? "sem status"
                } · ${milestone.event.scheduled_for}`,
            },
        ];
    });
}

async function loadJourneyEvents(clientIds: string[]) {
    const events: ClinisysJourneyEvent[] = [];

    for (const clientBatch of chunk(clientIds, BATCH_SIZE)) {
        let page = 0;

        while (true) {
            const from = page * 1_000;
            const { data, error } = await withSupabaseRetry(
                () =>
                    supabase
                        .from("funnel_clinisys_events")
                        .select(
                            "id, client_id, scheduled_for, procedure_name, status, event_kind",
                        )
                        .in("client_id", clientBatch)
                        .range(from, from + 999),
                {
                    attempts: 3,
                    label: "clinisys funnel event read",
                },
            );

            if (error) throw error;
            const rows = (data ?? []) as ClinisysJourneyEvent[];
            events.push(...rows);
            if (rows.length < 1_000) break;
            page += 1;
        }
    }

    return events;
}

function summarizeProcedures(events: NormalizedJourneyEvent[]) {
    const counts = new Map<string, { kind: ClinisysJourneyKind; count: number }>();

    for (const event of events) {
        const name = event.procedure_name ?? "(sem nome)";
        const current = counts.get(name);
        counts.set(name, {
            kind: event.event_kind,
            count: (current?.count ?? 0) + 1,
        });
    }

    return [...counts.entries()]
        .map(([procedure_name, value]) => ({ procedure_name, ...value }))
        .sort((left, right) => right.count - left.count);
}

function getUpdatedCount(data: unknown) {
    if (typeof data === "number") return data;
    if (Array.isArray(data) && typeof data[0]?.updated_count === "number") {
        return data[0].updated_count;
    }
    if (
        data &&
        typeof data === "object" &&
        typeof (data as { updated_count?: unknown }).updated_count === "number"
    ) {
        return (data as { updated_count: number }).updated_count;
    }
    return 0;
}

function createExternalScheduleHash(sourceExternalId: string) {
    return crypto
        .createHash("sha256")
        .update(`${CLINISYS_SOURCE}|agenda_id|${sourceExternalId}`)
        .digest("hex");
}

function createFallbackHash({
    scheduledFor,
    createdInSourceAt,
    normalizedPhone,
    patientName,
    unitName,
    procedureName,
}: {
    scheduledFor: string;
    createdInSourceAt: string | null;
    normalizedPhone: string | null;
    patientName: string | null;
    unitName: string | null;
    procedureName: string | null;
}) {
    return crypto
        .createHash("sha256")
        .update(
            [
                scheduledFor,
                createdInSourceAt ?? "",
                normalizedPhone ?? "",
                normalizeText(patientName),
                normalizeText(unitName),
                normalizeText(procedureName),
            ].join("|"),
        )
        .digest("hex");
}

function normalizeDate(value: string | { value: string } | null) {
    const raw = typeof value === "object" ? value?.value : value;
    return raw ? String(raw).slice(0, 10) : null;
}

function cleanText(value: string | null) {
    const cleaned = value?.trim().replace(/\s+/g, " ") ?? null;
    return cleaned || null;
}

function cleanSourceId(value: string | number | null) {
    if (value === null || value === undefined) return null;
    return String(value).trim() || null;
}

function normalizeBrazilPhone(value: string | null) {
    const digits = value?.replace(/\D/g, "") ?? "";
    if (!digits) return null;
    if (digits.startsWith("55")) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
}

function buildPhoneSearchOptions(value: string | null) {
    if (!value) return [];
    const withoutCountry = value.startsWith("55") ? value.slice(2) : value;
    return [...new Set([value, `+${value}`, withoutCountry])];
}

function normalizeText(value: string | null) {
    return (value ?? "")
        .trim()
        .toLocaleLowerCase("pt-BR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
}

function normalizeClientName(value: string | null) {
    const cleaned = value?.trim().replace(/\s+/g, " ");
    if (!cleaned) return null;

    const lowercaseWords = new Set(["da", "de", "do", "das", "dos", "e"]);
    return cleaned
        .toLocaleLowerCase("pt-BR")
        .split(" ")
        .map((part, index) =>
            index > 0 && lowercaseWords.has(part)
                ? part
                : part.charAt(0).toUpperCase() + part.slice(1),
        )
        .join(" ");
}

function chunk<T>(items: T[], size: number) {
    return Array.from(
        { length: Math.ceil(items.length / size) },
        (_, index) => items.slice(index * size, (index + 1) * size),
    );
}
