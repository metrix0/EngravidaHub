// app/api/funnel/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib";

type FunnelStage = {
    id: string;
    funnel_id: string;
    name: string;
};

type Unit = {
    id: string;
    name: string;
    active: boolean;
};

type FunnelHistoryMove = {
    client_id: string;
    from_stage_id: string | null;
    to_stage_id: string | null;
};

type DateRange = {
    start: string;
    end: string;
};

const DEFAULT_FUNNEL_ID = "22222222-2222-2222-2222-222222222222";
const DEFAULT_DAYS = 30;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    const selectedFunnelId =
        searchParams.get("funnel_id") ?? DEFAULT_FUNNEL_ID;
    const unitIds = parseIds(searchParams.get("unit_ids"));

    const currentRange = getDateRange({
        days: Number(searchParams.get("days") ?? DEFAULT_DAYS),
        startDate: searchParams.get("start_date"),
        endDate: searchParams.get("end_date"),
    });

    const previousRange = getPreviousDateRange(currentRange);

    const [
        { data: funnels, error: funnelsError },
        { data: stages, error: stagesError },
        { data: units, error: unitsError },
        clientsResult,
        unitClientIdsResult,
    ] = await Promise.all([
        supabase
            .from("funnels")
            .select("id, name, active, created_at, updated_at")
            .eq("active", true)
            .order("created_at", { ascending: true }),

        supabase
            .from("funnel_stages")
            .select("id, funnel_id, name, position, color, created_at, updated_at")
            .order("position", { ascending: true }),

        supabase
            .from("units")
            .select("id, name, active")
            .eq("active", true)
            .order("name"),

        getFunnelClients({ unitIds }),

        getClientIdsForUnitFilter(unitIds),
    ]);

    if (
        funnelsError ||
        stagesError ||
        unitsError ||
        clientsResult.error ||
        unitClientIdsResult.error
    ) {
        return NextResponse.json(
            {
                error: "Failed to load funnel data",
                details: {
                    funnelsError,
                    stagesError,
                    unitsError,
                    clientsError: clientsResult.error,
                    unitClientIdsError: unitClientIdsResult.error,
                },
            },
            { status: 500 }
        );
    }

    const [currentHistoryResult, previousHistoryResult] = await Promise.all([
        getFunnelHistory({
            funnelId: selectedFunnelId,
            dateRange: currentRange,
            clientIds: unitClientIdsResult.clientIds,
        }),
        getFunnelHistory({
            funnelId: selectedFunnelId,
            dateRange: previousRange,
            clientIds: unitClientIdsResult.clientIds,
        }),
    ]);

    if (currentHistoryResult.error || previousHistoryResult.error) {
        return NextResponse.json(
            {
                error: "Failed to load funnel history",
                details: {
                    currentHistoryError: currentHistoryResult.error,
                    previousHistoryError: previousHistoryResult.error,
                },
            },
            { status: 500 }
        );
    }

    const funnelStages = (stages ?? []) as FunnelStage[];
    const currentMoves = currentHistoryResult.history;
    const previousMoves = previousHistoryResult.history;

    return NextResponse.json({
        funnels: funnels ?? [],
        stages: stages ?? [],
        units: units ?? [],
        clients: clientsResult.clients,

        kpis: buildFunnelKpis({
            history: currentMoves,
            stages: funnelStages,
            funnelId: selectedFunnelId,
        }),

        previous_kpis: buildFunnelKpis({
            history: previousMoves,
            stages: funnelStages,
            funnelId: selectedFunnelId,
        }),
    });
}

async function getFunnelClients({ unitIds }: { unitIds: string[] }) {
    let query = supabase
        .from("clients")
        .select(
            `
            id,
            name,
            phone,
            email,
            external_contact_id,
            first_seen_at,
            last_interaction_at,
            funnel_stage_id,
            unit_id,
            utm_source,
            utm_medium,
            utm_campaign,
            state,
            country,
            created_at,
            updated_at
            `
        )
        .not("funnel_stage_id", "is", null)
        .order("last_interaction_at", { ascending: false });

    if (unitIds.length > 0) {
        query = query.in("unit_id", unitIds);
    }

    const { data, error } = await query;

    return {
        clients: data ?? [],
        error,
    };
}

async function getClientIdsForUnitFilter(unitIds: string[]) {
    if (unitIds.length === 0) {
        return {
            clientIds: null,
            error: null,
        };
    }

    const { data, error } = await supabase
        .from("clients")
        .select("id")
        .in("unit_id", unitIds);

    return {
        clientIds: data?.map((client) => client.id) ?? [],
        error,
    };
}

async function getFunnelHistory({
                                      funnelId,
                                      dateRange,
                                      clientIds,
                                  }: {
    funnelId: string;
    dateRange: DateRange;
    clientIds: string[] | null;
}) {
    if (clientIds && clientIds.length === 0) {
        return {
            history: [] as FunnelHistoryMove[],
            error: null,
        };
    }

    const history: FunnelHistoryMove[] = [];
    const clientIdBatches = clientIds ? chunk(clientIds, 100) : [null];

    for (const clientIdBatch of clientIdBatches) {
        let query = supabase
            .from("funnel_history")
            .select("client_id, from_stage_id, to_stage_id")
            .eq("funnel_id", funnelId)
            .gte("moved_at", dateRange.start)
            .lte("moved_at", dateRange.end);

        if (clientIdBatch) {
            query = query.in("client_id", clientIdBatch);
        }

        const { data, error } = await query;

        if (error) {
            return {
                history,
                error,
            };
        }

        history.push(...((data ?? []) as FunnelHistoryMove[]));
    }

    return {
        history,
        error: null,
    };
}

function buildFunnelKpis({
                               history,
                               stages,
                               funnelId,
                           }: {
    history: FunnelHistoryMove[];
    stages: FunnelStage[];
    funnelId: string;
}) {
    const stageById = new Map(
        stages
            .filter((stage) => stage.funnel_id === funnelId)
            .map((stage) => [stage.id, stage])
    );

    const funnelEntries = countUniqueClients(
        history.filter((move) => move.from_stage_id === null && move.to_stage_id)
    );

    const evaluationsDoneMoves = history.filter((move) => {
        const toStageName = getStageName(move.to_stage_id, stageById);

        return toStageName.includes("avaliacao realizada");
    });

    const evaluationToProcedureMoves = history.filter((move) => {
        const fromStageName = getStageName(move.from_stage_id, stageById);
        const toStageName = getStageName(move.to_stage_id, stageById);

        return (
            fromStageName.includes("avaliacao realizada") &&
            toStageName.includes("procedimento agendado")
        );
    });

    const evaluationsDone = countUniqueClients(evaluationsDoneMoves);
    const proceduresScheduled = countUniqueClients(evaluationToProcedureMoves);

    return {
        funnel_entries: funnelEntries,
        evaluations_done: evaluationsDone,
        procedures_scheduled: proceduresScheduled,
        procedure_conversion_rate: percentage(
            proceduresScheduled,
            evaluationsDone
        ),
    };
}

function getStageName(
    stageId: string | null,
    stageById: Map<string, FunnelStage>
) {
    if (!stageId) return "";

    return normalize(stageById.get(stageId)?.name ?? "");
}

function countUniqueClients(history: FunnelHistoryMove[]) {
    return new Set(history.map((move) => move.client_id).filter(Boolean)).size;
}

function getDateRange({
                          days,
                          startDate,
                          endDate,
                      }: {
    days: number;
    startDate: string | null;
    endDate: string | null;
}): DateRange {
    if (startDate) {
        return {
            start: new Date(`${startDate}T00:00:00.000Z`).toISOString(),
            end: new Date(`${endDate ?? startDate}T23:59:59.999Z`).toISOString(),
        };
    }

    const end = new Date();

    const start = new Date();
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);

    return {
        start: start.toISOString(),
        end: end.toISOString(),
    };
}

function getPreviousDateRange(currentRange: DateRange): DateRange {
    const currentStart = new Date(currentRange.start);
    const currentEnd = new Date(currentRange.end);

    const durationMs = currentEnd.getTime() - currentStart.getTime();

    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - durationMs);

    return {
        start: previousStart.toISOString(),
        end: previousEnd.toISOString(),
    };
}

function percentage(value: number, total: number) {
    if (total === 0) return 0;

    return Math.round((value / total) * 1000) / 10;
}


function parseIds(value: string | null) {
    if (!value) return [];

    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

function normalize(value: string) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
}
