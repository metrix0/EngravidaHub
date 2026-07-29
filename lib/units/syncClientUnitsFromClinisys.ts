// lib/units/syncClientUnitsFromClinisys.ts
import { supabase } from "@/lib";
import { withSupabaseRetry } from "@/lib/supabase/retry";
import { findOrCreateUnitByName } from "@/lib/units/findOrCreateUnitByName";

export type ClinisysUnitAssignment = {
    clientId: string;
    unitName: string | null;
    scheduledFor: string;
    createdInSourceAt: string | null;
};

const QUERY_BATCH_SIZE = 100;

export async function syncClientUnitsFromClinisys(
    assignments: ClinisysUnitAssignment[],
) {
    const latestByClient = selectLatestAssignmentByClient(assignments);
    const clientIds = [...latestByClient.keys()];

    if (clientIds.length === 0) {
        return {
            considered: 0,
            resolved: 0,
            updated: 0,
        };
    }

    const unitByName = await resolveUnits(
        [...latestByClient.values()].map((assignment) => assignment.unitName),
    );
    const clientIdsByUnit = new Map<string | null, string[]>();
    let resolved = 0;

    for (const [clientId, assignment] of latestByClient) {
        const normalizedUnitName = normalizeUnitName(assignment.unitName);
        if (!unitByName.has(normalizedUnitName)) continue;

        resolved += 1;
        const targetUnitId = unitByName.get(normalizedUnitName)?.id ?? null;
        const ids = clientIdsByUnit.get(targetUnitId) ?? [];
        ids.push(clientId);
        clientIdsByUnit.set(targetUnitId, ids);
    }

    const updatedAt = new Date().toISOString();
    let updated = 0;

    for (const [unitId, ids] of clientIdsByUnit) {
        for (const batch of chunk(ids, QUERY_BATCH_SIZE)) {
            const { data, error } = await withSupabaseRetry(
                () => {
                    let query = supabase
                        .from("clients")
                        .update({
                            unit_id: unitId,
                            updated_at: updatedAt,
                        })
                        .in("id", batch);

                    query =
                        unitId === null
                            ? query.not("unit_id", "is", null)
                            : query.or(
                                  `unit_id.is.null,unit_id.neq.${unitId}`,
                              );

                    return query.select("id");
                },
                {
                    attempts: 3,
                    label: "clinisys unit assignment",
                },
            );

            if (error) throw error;
            updated += data?.length ?? 0;
        }
    }

    return {
        considered: latestByClient.size,
        resolved,
        updated,
    };
}

function selectLatestAssignmentByClient(
    assignments: ClinisysUnitAssignment[],
) {
    const latest = new Map<string, ClinisysUnitAssignment>();

    for (const assignment of assignments) {
        if (!assignment.clientId || !normalizeUnitName(assignment.unitName)) {
            continue;
        }

        const current = latest.get(assignment.clientId);
        if (
            !current ||
            assignmentSortKey(assignment) > assignmentSortKey(current)
        ) {
            latest.set(assignment.clientId, assignment);
        }
    }

    return latest;
}

async function resolveUnits(unitNames: Array<string | null>) {
    const normalizedNames = new Map<string, string>();

    for (const unitName of unitNames) {
        const normalized = normalizeUnitName(unitName);
        if (normalized && unitName && !normalizedNames.has(normalized)) {
            normalizedNames.set(normalized, unitName);
        }
    }

    const units = new Map<
        string,
        { id: string; name: string } | null
    >();

    for (const [normalized, sourceName] of normalizedNames) {
        const unit = await findOrCreateUnitByName(sourceName);
        units.set(normalized, unit);
    }

    return units;
}

function assignmentSortKey(assignment: ClinisysUnitAssignment) {
    return [
        assignment.scheduledFor,
        assignment.createdInSourceAt ?? "",
    ].join("|");
}

function normalizeUnitName(value: string | null) {
    return (value ?? "")
        .trim()
        .toLocaleLowerCase("pt-BR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}
