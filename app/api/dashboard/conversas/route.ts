// app/api/dashboard/conversas/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getConversationGoalLabel } from "@/lib/conversationAnalysisLabels";

type ConversationResult =
    | "resolvida"
    | "parcial"
    | "nao_resolvida"
    | "pendente";

type ConversationRow = {
    id: string;
    client_id: string;
    started_at: string;
    ended_at: string | null;
    attendant_id: string | null;
    attendant_chat_name: string | null;
    service_id: string | null;
    conversation_analysis_id: string | null;
    tunnel: string | null;
    origin: string | null;
};

type ThreadRow = {
    id: string;
    client_id: string;
    assigned_attendant_id: string | null;
    last_message_at: string | null;
    queued_at: string | null;
    created_at: string;
    updated_at: string;
};

type ClientRow = {
    id: string;
    name: string | null;
    phone: string | null;
    unit_id: string | null;
    last_tunnel: string | null;
    last_origin: string | null;
};

type AnalysisRow = {
    id: string;
    conversation_goal: string | null;
    dropoff_moment: string | null;
    resolution_result: string | null;
    notable: boolean | null;
};

type AttendantRow = {
    id: string;
    name: string;
};

type InternalConversationRow = {
    id: string;
    item_type: "conversation" | "thread";
    attendant_name: string;
    phone: string;
    started_at: string;
    ended_at: string | null;
    client_name: string;
    objective: string;
    result: ConversationResult;
    notable: boolean;
    _sort_at: string;
    _unit_id: string | null;
    _tunnel: string | null;
    _origin: string | null;
    _conversation_goal: string | null;
    _dropoff_moment: string | null;
    _result: ConversationResult;
    _notable: boolean;
};

const PAGE_FETCH_SIZE = 1_000;
const RELATION_FILTER_BATCH_SIZE = 100;
const RELATION_QUERY_CONCURRENCY = 6;
const NULL_FILTER_VALUE = "__NULL__";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const page = Math.max(1, Number(searchParams.get("page") ?? 1));
        const pageSize = Math.max(
            1,
            Math.min(100, Number(searchParams.get("page_size") ?? 50)),
        );
        const days = Number(searchParams.get("days") ?? 7);
        const customStartDate = searchParams.get("start_date");
        const customEndDate = searchParams.get("end_date");
        const search =
            searchParams.get("search")?.trim().toLowerCase() ?? "";

        const unitIds = parseIds(searchParams.get("unit_ids"));
        const serviceIds = parseIds(searchParams.get("service_ids"));
        const attendantIds = parseIds(searchParams.get("attendant_ids"));
        const tunnelValues = parseIds(searchParams.get("tunnels"));
        const originValues = parseIds(searchParams.get("origins"));
        const conversationGoals = parseIds(
            searchParams.get("conversation_goals"),
        );
        const results = parseIds(searchParams.get("results"));
        const dropoffMoments = parseIds(
            searchParams.get("dropoff_moments"),
        );
        const notable = searchParams.get("notable");
        const dateRange = getDateRange({
            days,
            customStartDate,
            customEndDate,
        });

        const [conversations, threads] = await Promise.all([
            fetchConversations({
                dateRange,
                serviceIds,
                attendantIds,
            }),
            fetchLiveThreads({
                dateRange,
                serviceIds,
                attendantIds,
            }),
        ]);

        const clientIds = [
            ...new Set(
                [...conversations, ...threads]
                    .map((item) => item.client_id)
                    .filter(Boolean),
            ),
        ];
        const analysisIds = [
            ...new Set(
                conversations
                    .map((item) => item.conversation_analysis_id)
                    .filter((value): value is string => Boolean(value)),
            ),
        ];
        const liveAttendantIds = [
            ...new Set(
                threads
                    .map((item) => item.assigned_attendant_id)
                    .filter((value): value is string => Boolean(value)),
            ),
        ];

        const [clients, analyses, attendants] = await Promise.all([
            fetchClientsByIds(clientIds),
            fetchAnalysesByIds(analysisIds),
            fetchAttendantsByIds(liveAttendantIds),
        ]);

        const clientsById = new Map(
            clients.map((client) => [client.id, client]),
        );
        const analysesById = new Map(
            analyses.map((analysis) => [analysis.id, analysis]),
        );
        const attendantsById = new Map(
            attendants.map((attendant) => [attendant.id, attendant]),
        );

        const rows: InternalConversationRow[] = [
            ...conversations.map((conversation) => {
                const client = clientsById.get(conversation.client_id);
                const analysis = conversation.conversation_analysis_id
                    ? analysesById.get(
                          conversation.conversation_analysis_id,
                      )
                    : null;
                const result = getConversationResult(
                    analysis?.resolution_result,
                );
                const isNotable = Boolean(analysis?.notable);

                return {
                    id: conversation.id,
                    item_type: "conversation" as const,
                    attendant_name:
                        conversation.attendant_chat_name ?? "Sem atendente",
                    phone: client?.phone ?? "-",
                    started_at: conversation.started_at,
                    ended_at: conversation.ended_at,
                    client_name: client?.name ?? "Cliente sem nome",
                    objective: getConversationGoalLabel(
                        analysis?.conversation_goal,
                    ),
                    result,
                    notable: isNotable,
                    _sort_at: conversation.started_at,
                    _unit_id: client?.unit_id ?? null,
                    _tunnel: emptyToNull(conversation.tunnel),
                    _origin: emptyToNull(conversation.origin),
                    _conversation_goal:
                        analysis?.conversation_goal ?? null,
                    _dropoff_moment: analysis?.dropoff_moment ?? null,
                    _result: result,
                    _notable: isNotable,
                };
            }),
            ...threads.map((thread) => {
                const client = clientsById.get(thread.client_id);
                const attendant = thread.assigned_attendant_id
                    ? attendantsById.get(thread.assigned_attendant_id)
                    : null;
                const startedAt =
                    thread.queued_at ?? thread.created_at;
                const activityAt =
                    thread.last_message_at ?? thread.updated_at;

                return {
                    id: thread.id,
                    item_type: "thread" as const,
                    attendant_name: attendant?.name ?? "Sem atendente",
                    phone: client?.phone ?? "-",
                    started_at: startedAt,
                    ended_at: null,
                    client_name: client?.name ?? "Cliente sem nome",
                    objective: "Conversa ao vivo",
                    result: "pendente" as const,
                    notable: false,
                    _sort_at: activityAt,
                    _unit_id: client?.unit_id ?? null,
                    _tunnel: emptyToNull(client?.last_tunnel),
                    _origin: emptyToNull(client?.last_origin),
                    _conversation_goal: null,
                    _dropoff_moment: null,
                    _result: "pendente" as const,
                    _notable: false,
                };
            }),
        ];

        const filteredRows = rows
            .filter((row) => {
                if (search) {
                    const matchesSearch =
                        row.attendant_name.toLowerCase().includes(search) ||
                        row.phone.toLowerCase().includes(search) ||
                        row.client_name.toLowerCase().includes(search) ||
                        row.objective.toLowerCase().includes(search);
                    if (!matchesSearch) return false;
                }
                if (
                    unitIds.length > 0 &&
                    !unitIds.includes(row._unit_id ?? "")
                ) {
                    return false;
                }
                if (
                    tunnelValues.length > 0 &&
                    !tunnelValues.includes(
                        row._tunnel ?? NULL_FILTER_VALUE,
                    )
                ) {
                    return false;
                }
                if (
                    originValues.length > 0 &&
                    !originValues.includes(
                        row._origin ?? NULL_FILTER_VALUE,
                    )
                ) {
                    return false;
                }
                if (
                    conversationGoals.length > 0 &&
                    !conversationGoals.includes(
                        row._conversation_goal ?? "",
                    )
                ) {
                    return false;
                }
                if (
                    dropoffMoments.length > 0 &&
                    !dropoffMoments.includes(
                        row._dropoff_moment ?? "unknown",
                    )
                ) {
                    return false;
                }
                if (
                    results.length > 0 &&
                    !results.includes(row._result)
                ) {
                    return false;
                }
                if (notable === "true" && !row._notable) return false;
                if (notable === "false" && row._notable) return false;
                return true;
            })
            .sort(
                (first, second) =>
                    new Date(second._sort_at).getTime() -
                    new Date(first._sort_at).getTime(),
            );

        const total = filteredRows.length;
        const startIndex = (page - 1) * pageSize;
        const cleanRows = filteredRows.map(
            ({
                _sort_at,
                _unit_id,
                _tunnel,
                _origin,
                _conversation_goal,
                _dropoff_moment,
                _result,
                _notable,
                ...row
            }) => row,
        );

        return NextResponse.json({
            items: cleanRows.slice(startIndex, startIndex + pageSize),
            total,
            page,
            page_size: pageSize,
        });
    } catch (error) {
        console.error("[dashboard/conversas] failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar conversas.",
            },
            { status: 500 },
        );
    }
}

async function fetchConversations({
    dateRange,
    serviceIds,
    attendantIds,
}: {
    dateRange: { start: Date; end: Date };
    serviceIds: string[];
    attendantIds: string[];
}) {
    const rows: ConversationRow[] = [];

    for (let from = 0; ; from += PAGE_FETCH_SIZE) {
        let query = supabase
            .from("conversations")
            .select(
                [
                    "id",
                    "client_id",
                    "started_at",
                    "ended_at",
                    "attendant_id",
                    "attendant_chat_name",
                    "service_id",
                    "conversation_analysis_id",
                    "tunnel",
                    "origin",
                ].join(","),
            )
            .gte("started_at", dateRange.start.toISOString())
            .lte("started_at", dateRange.end.toISOString())
            .order("started_at", { ascending: false })
            .order("id", { ascending: true })
            .range(from, from + PAGE_FETCH_SIZE - 1);

        if (serviceIds.length > 0) {
            query = query.in("service_id", serviceIds);
        }
        if (attendantIds.length > 0) {
            query = query.in("attendant_id", attendantIds);
        }

        const { data, error } = await query;
        if (error) throw error;

        const page = (data ?? []) as unknown as ConversationRow[];
        rows.push(...page);
        if (page.length < PAGE_FETCH_SIZE) break;
    }

    return rows;
}

async function fetchLiveThreads({
    dateRange,
    serviceIds,
    attendantIds,
}: {
    dateRange: { start: Date; end: Date };
    serviceIds: string[];
    attendantIds: string[];
}) {
    if (serviceIds.length > 0) return [];

    const rows: ThreadRow[] = [];

    for (let from = 0; ; from += PAGE_FETCH_SIZE) {
        let query = supabase
            .from("thread")
            .select(
                [
                    "id",
                    "client_id",
                    "assigned_attendant_id",
                    "last_message_at",
                    "queued_at",
                    "created_at",
                    "updated_at",
                ].join(","),
            )
            .eq("status", "open")
            .order("last_message_at", {
                ascending: false,
                nullsFirst: false,
            })
            .order("id", { ascending: true })
            .range(from, from + PAGE_FETCH_SIZE - 1);

        if (attendantIds.length > 0) {
            query = query.in("assigned_attendant_id", attendantIds);
        }

        const { data, error } = await query;
        if (error) throw error;

        const page = (data ?? []) as unknown as ThreadRow[];
        rows.push(
            ...page.filter((thread) =>
                isWithinDateRange(
                    thread.last_message_at ?? thread.updated_at,
                    dateRange,
                ),
            ),
        );
        if (page.length < PAGE_FETCH_SIZE) break;
    }

    return rows;
}

async function fetchClientsByIds(ids: string[]) {
    return fetchRelationsInBatches<ClientRow>(ids, async (batch) => {
        const { data, error } = await supabase
            .from("clients")
            .select(
                "id, name, phone, unit_id, last_tunnel, last_origin",
            )
            .in("id", batch);
        if (error) throw error;
        return (data ?? []) as ClientRow[];
    });
}

async function fetchAnalysesByIds(ids: string[]) {
    return fetchRelationsInBatches<AnalysisRow>(ids, async (batch) => {
        const { data, error } = await supabase
            .from("conversation_analysis")
            .select(
                "id, conversation_goal, dropoff_moment, resolution_result, notable",
            )
            .in("id", batch);
        if (error) throw error;
        return (data ?? []) as AnalysisRow[];
    });
}

async function fetchAttendantsByIds(ids: string[]) {
    return fetchRelationsInBatches<AttendantRow>(ids, async (batch) => {
        const { data, error } = await supabase
            .from("attendants")
            .select("id, name")
            .in("id", batch);
        if (error) throw error;
        return (data ?? []) as AttendantRow[];
    });
}

async function fetchRelationsInBatches<T>(
    ids: string[],
    fetchBatch: (batch: string[]) => Promise<T[]>,
) {
    const batches = chunk(ids, RELATION_FILTER_BATCH_SIZE);
    const rows: T[] = [];

    for (
        let index = 0;
        index < batches.length;
        index += RELATION_QUERY_CONCURRENCY
    ) {
        const results = await Promise.all(
            batches
                .slice(index, index + RELATION_QUERY_CONCURRENCY)
                .map(fetchBatch),
        );
        rows.push(...results.flat());
    }

    return rows;
}

function getConversationResult(
    value: string | null | undefined,
): ConversationResult {
    if (value === "resolved") return "resolvida";
    if (value === "partial") return "parcial";
    if (value === "not_resolved") return "nao_resolvida";
    return "pendente";
}

function parseIds(value: string | null): string[] {
    if (!value) return [];
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function getDateRange({
    days,
    customStartDate,
    customEndDate,
}: {
    days: number;
    customStartDate: string | null;
    customEndDate: string | null;
}) {
    if (customStartDate) {
        return {
            start: new Date(`${customStartDate}T00:00:00.000`),
            end: new Date(
                `${customEndDate ?? customStartDate}T23:59:59.999`,
            ),
        };
    }

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { start, end };
}

function isWithinDateRange(
    value: string,
    range: { start: Date; end: Date },
) {
    const timestamp = new Date(value).getTime();
    return (
        Number.isFinite(timestamp) &&
        timestamp >= range.start.getTime() &&
        timestamp <= range.end.getTime()
    );
}

function emptyToNull(value: unknown) {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}
