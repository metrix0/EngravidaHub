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
    client_id: string | null;
    instagram_user_id: string | null;
    started_at: string;
    ended_at: string | null;
    attendant_id: string | null;
    attendant_chat_name: string | null;
    service_id: string | null;
    conversation_analysis_id: string | null;
    tunnel: string | null;
    origin: string | null;
    source: string | null;
    channel: string | null;
    last_message_at: string | null;
    clients: Relation<ClientRow>;
    instagram_users: Relation<InstagramUserRow>;
    conversation_analysis: Relation<AnalysisRow>;
};

type ThreadRow = {
    id: string;
    client_id: string | null;
    instagram_user_id: string | null;
    assigned_attendant_id: string | null;
    last_message_at: string | null;
    queued_at: string | null;
    created_at: string;
    updated_at: string;
    source: string | null;
    channel: string | null;
    clients: Relation<ClientRow>;
    instagram_users: Relation<InstagramUserRow>;
    attendants: Relation<AttendantRow>;
};

type Relation<T> = T | T[] | null;

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

type InstagramUserRow = {
    id: string;
    username: string | null;
    display_name: string | null;
};

type AttendantRow = {
    id: string;
    name: string;
};

type InternalConversationRow = {
    id: string;
    client_id: string | null;
    item_type: "conversation" | "thread";
    attendant_name: string;
    phone: string;
    started_at: string;
    ended_at: string | null;
    client_name: string;
    channel: "WhatsApp" | "Instagram" | "Facebook";
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
    _analyzed: boolean;
};

const PAGE_FETCH_SIZE = 1_000;
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
        const platforms = parseIds(searchParams.get("platforms"));
        const notable = searchParams.get("notable");
        const analysisStatus = searchParams.get("analysis_status");
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
                signal: request.signal,
            }),
            fetchLiveThreads({
                dateRange,
                serviceIds,
                attendantIds,
                signal: request.signal,
            }),
        ]);

        const rows: InternalConversationRow[] = [
            ...conversations.map((conversation) => {
                const client = oneRelation(conversation.clients);
                const instagramUser = oneRelation(
                    conversation.instagram_users,
                );
                const analysis = oneRelation(
                    conversation.conversation_analysis,
                );
                const result = getConversationResult(
                    analysis?.resolution_result,
                );
                const isNotable = Boolean(analysis?.notable);
                const channel = normalizeConversationChannel(
                    conversation.channel,
                    conversation.source,
                );

                return {
                    id: conversation.id,
                    client_id: conversation.client_id ?? (conversation.instagram_user_id ? `social:${conversation.instagram_user_id}` : null),
                    item_type: "conversation" as const,
                    attendant_name:
                        conversation.attendant_chat_name ?? "Sem atendente",
                    phone: client?.phone ?? "-",
                    started_at: conversation.started_at,
                    ended_at: conversation.ended_at,
                    client_name: getIdentityName(client, instagramUser, channel),
                    channel,
                    objective: getConversationGoalLabel(
                        analysis?.conversation_goal,
                    ),
                    result,
                    notable: isNotable,
                    _sort_at:
                        conversation.last_message_at ??
                        conversation.ended_at ??
                        conversation.started_at,
                    _unit_id: client?.unit_id ?? null,
                    _tunnel: emptyToNull(conversation.tunnel),
                    _origin: emptyToNull(conversation.origin),
                    _conversation_goal:
                        analysis?.conversation_goal ?? null,
                    _dropoff_moment: analysis?.dropoff_moment ?? null,
                    _result: result,
                    _notable: isNotable,
                    _analyzed: Boolean(
                        conversation.conversation_analysis_id || analysis?.id,
                    ),
                };
            }),
            ...threads.map((thread) => {
                const client = oneRelation(thread.clients);
                const instagramUser = oneRelation(thread.instagram_users);
                const attendant = oneRelation(thread.attendants);
                const startedAt =
                    thread.queued_at ?? thread.created_at;
                const activityAt =
                    thread.last_message_at ?? thread.updated_at;
                const channel = normalizeConversationChannel(
                    thread.channel,
                    thread.source,
                );

                return {
                    id: thread.id,
                    client_id: thread.client_id ?? (thread.instagram_user_id ? `social:${thread.instagram_user_id}` : null),
                    item_type: "thread" as const,
                    attendant_name: attendant?.name ?? "Sem atendente",
                    phone: client?.phone ?? "-",
                    started_at: startedAt,
                    ended_at: null,
                    client_name: getIdentityName(client, instagramUser, channel),
                    channel,
                    objective: "—",
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
                    _analyzed: false,
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
                if (
                    platforms.length > 0 &&
                    !platforms.includes(row.channel)
                ) {
                    return false;
                }
                if (notable === "true" && !row._notable) return false;
                if (notable === "false" && row._notable) return false;
                if (analysisStatus === "analyzed" && !row._analyzed) {
                    return false;
                }
                if (analysisStatus === "not_analyzed" && row._analyzed) {
                    return false;
                }
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
                _analyzed,
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
    signal,
}: {
    dateRange: { start: Date; end: Date };
    serviceIds: string[];
    attendantIds: string[];
    signal: AbortSignal;
}) {
    const rows: ConversationRow[] = [];

    for (let from = 0; ; from += PAGE_FETCH_SIZE) {
        let query = supabase
            .from("conversations")
            .select(
                [
                    "id",
                    "client_id",
                    "instagram_user_id",
                    "started_at",
                    "ended_at",
                    "attendant_id",
                    "attendant_chat_name",
                    "service_id",
                    "conversation_analysis_id",
                    "tunnel",
                    "origin",
                    "source",
                    "channel",
                    "last_message_at",
                    "clients!conversations_client_id_fkey(id,name,phone,unit_id,last_tunnel,last_origin)",
                    "instagram_users!conversations_instagram_user_id_fkey(id,username,display_name)",
                    "conversation_analysis!conversations_conversation_analysis_id_fkey(id,conversation_goal,dropoff_moment,resolution_result,notable)",
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

        const { data, error } = await query.abortSignal(signal);
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
    signal,
}: {
    dateRange: { start: Date; end: Date };
    serviceIds: string[];
    attendantIds: string[];
    signal: AbortSignal;
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
                    "instagram_user_id",
                    "assigned_attendant_id",
                    "last_message_at",
                    "queued_at",
                    "created_at",
                    "updated_at",
                    "source",
                    "channel",
                    "clients!thread_client_id_fkey(id,name,phone,unit_id,last_tunnel,last_origin)",
                    "instagram_users!thread_instagram_user_id_fkey(id,username,display_name)",
                    "attendants!thread_assigned_attendant_id_fkey(id,name)",
                ].join(","),
            )
            .eq("status", "open")
            .or(
                `and(last_message_at.gte.${dateRange.start.toISOString()},last_message_at.lte.${dateRange.end.toISOString()}),and(last_message_at.is.null,updated_at.gte.${dateRange.start.toISOString()},updated_at.lte.${dateRange.end.toISOString()})`,
            )
            .order("last_message_at", {
                ascending: false,
                nullsFirst: false,
            })
            .order("id", { ascending: true })
            .range(from, from + PAGE_FETCH_SIZE - 1);

        if (attendantIds.length > 0) {
            query = query.in("assigned_attendant_id", attendantIds);
        }

        const { data, error } = await query.abortSignal(signal);
        if (error) throw error;

        const page = (data ?? []) as unknown as ThreadRow[];
        rows.push(...page);
        if (page.length < PAGE_FETCH_SIZE) break;
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

function normalizeConversationChannel(
    channel: string | null | undefined,
    source: string | null | undefined,
): "WhatsApp" | "Instagram" | "Facebook" {
    if (channel === "Facebook") return "Facebook";
    if (channel === "Instagram" || source === "zernio") {
        return "Instagram";
    }

    return "WhatsApp";
}

function getIdentityName(
    client: ClientRow | null | undefined,
    instagramUser: InstagramUserRow | null | undefined,
    channel: "WhatsApp" | "Instagram" | "Facebook",
) {
    return (
        instagramUser?.display_name?.trim() ||
        (instagramUser?.username
            ? `@${instagramUser.username.replace(/^@+/, "")}`
            : null) ||
        client?.name?.trim() ||
        (instagramUser
            ? channel === "Facebook"
                ? "Usuário do Facebook"
                : "Usuário do Instagram"
            : "Cliente sem nome")
    );
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

function emptyToNull(value: unknown) {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
}

function oneRelation<T>(value: Relation<T>) {
    return Array.isArray(value) ? (value[0] ?? null) : value;
}
