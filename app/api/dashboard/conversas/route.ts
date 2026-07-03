// app/api/dashboard/conversas/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib";
import { getConversationGoalLabel } from "@/lib/conversationAnalysisLabels";

type ConversationResult = "resolvida" | "parcial" | "nao_resolvida" | "pendente";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.max(1, Number(searchParams.get("page_size") ?? 50));
    const days = Number(searchParams.get("days") ?? 7);
    const customStartDate = searchParams.get("start_date");
    const customEndDate = searchParams.get("end_date");
    const search = searchParams.get("search")?.trim().toLowerCase() ?? "";

    const unitIds = parseIds(searchParams.get("unit_ids"));
    const serviceIds = parseIds(searchParams.get("service_ids"));
    const attendantIds = parseIds(searchParams.get("attendant_ids"));
    const tunnelValues = parseIds(searchParams.get("tunnels"));
    const originValues = parseIds(searchParams.get("origins"));
    const conversationGoals = parseIds(searchParams.get("conversation_goals"));
    const results = parseIds(searchParams.get("results"));
    const dropoffMoments = parseIds(searchParams.get("dropoff_moments"));
    const notable = searchParams.get("notable");

    const dateRange = getDateRange({ days, customStartDate, customEndDate });

    let conversationsQuery = supabase
        .from("conversations")
        .select("*")
        .not("conversation_analysis_id", "is", null)
        .gte("started_at", dateRange.start.toISOString())
        .lte("started_at", dateRange.end.toISOString())
        .order("started_at", { ascending: false })
        .limit(5000);

    if (serviceIds.length > 0) conversationsQuery = conversationsQuery.in("service_id", serviceIds);
    if (attendantIds.length > 0) conversationsQuery = conversationsQuery.in("attendant_id", attendantIds);

    const { data: conversationsData, error: conversationsError } = await conversationsQuery;
    if (conversationsError) {
        return NextResponse.json({ error: conversationsError.message }, { status: 500 });
    }

    const conversations = filterByTunnelAndOrigin(conversationsData ?? [], {
        tunnelValues,
        originValues,
    });

    if (conversations.length === 0) {
        return NextResponse.json({ items: [], total: 0, page, page_size: pageSize });
    }

    const clientIds = [...new Set(conversations.map((item) => item.client_id).filter(Boolean))];
    const analysisIds = [
        ...new Set(conversations.map((item) => item.conversation_analysis_id).filter(Boolean)),
    ];

    const [{ data: clientsData, error: clientsError }, { data: analysesData, error: analysesError }] =
        await Promise.all([fetchClientsByIds(clientIds), fetchAnalysesByIds(analysisIds)]);

    if (clientsError) return NextResponse.json({ error: clientsError.message }, { status: 500 });
    if (analysesError) return NextResponse.json({ error: analysesError.message }, { status: 500 });

    const clientsById = new Map((clientsData ?? []).map((client) => [client.id, client]));
    const analysesById = new Map((analysesData ?? []).map((analysis) => [analysis.id, analysis]));

    const rows = conversations.map((conversation) => {
        const client = clientsById.get(conversation.client_id);
        const analysis = conversation.conversation_analysis_id
            ? analysesById.get(conversation.conversation_analysis_id)
            : null;
        const result = getConversationResult(analysis?.resolution_result);
        const isNotable = Boolean(analysis?.notable);

        return {
            id: conversation.id,
            attendant_name: conversation.attendant_chat_name ?? "Sem atendente",
            phone: client?.phone ?? "-",
            started_at: conversation.started_at,
            ended_at: conversation.ended_at,
            client_name: client?.name ?? "Cliente sem nome",
            objective: getConversationGoalLabel(analysis?.conversation_goal),
            result,
            notable: isNotable,
            _unit_id: client?.unit_id ?? null,
            _conversation_goal: analysis?.conversation_goal ?? null,
            _dropoff_moment: analysis?.dropoff_moment ?? null,
            _result: result,
            _notable: isNotable,
        };
    });

    const filteredRows = rows.filter((row) => {
        if (search) {
            const matchesSearch =
                row.attendant_name.toLowerCase().includes(search) ||
                row.phone.toLowerCase().includes(search) ||
                row.client_name.toLowerCase().includes(search) ||
                row.objective.toLowerCase().includes(search);
            if (!matchesSearch) return false;
        }
        if (unitIds.length > 0 && !unitIds.includes(row._unit_id ?? "")) return false;
        if (conversationGoals.length > 0 && !conversationGoals.includes(row._conversation_goal ?? "")) return false;
        if (dropoffMoments.length > 0 && !dropoffMoments.includes(row._dropoff_moment ?? "unknown")) return false;
        if (results.length > 0 && !results.includes(row._result)) return false;
        if (notable === "true" && !row._notable) return false;
        if (notable === "false" && row._notable) return false;
        return true;
    });

    const total = filteredRows.length;
    const startIndex = (page - 1) * pageSize;
    const cleanRows = filteredRows.map(
        ({ _unit_id, _conversation_goal, _dropoff_moment, _result, _notable, ...row }) => row,
    );

    return NextResponse.json({
        items: cleanRows.slice(startIndex, startIndex + pageSize),
        total,
        page,
        page_size: pageSize,
    });
}

function getConversationResult(value: string | null | undefined): ConversationResult {
    if (value === "resolved") return "resolvida";
    if (value === "partial") return "parcial";
    if (value === "not_resolved") return "nao_resolvida";
    return "pendente";
}

function parseIds(value: string | null): string[] {
    if (!value) return [];
    return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function getDateRange({ days, customStartDate, customEndDate }: {
    days: number;
    customStartDate: string | null;
    customEndDate: string | null;
}) {
    if (customStartDate) {
        return {
            start: new Date(`${customStartDate}T00:00:00.000`),
            end: new Date(`${customEndDate ?? customStartDate}T23:59:59.999`),
        };
    }
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { start, end };
}

async function fetchClientsByIds(ids: string[]) {
    const rows: any[] = [];
    for (const batch of chunk(ids, 100)) {
        const { data, error } = await supabase.from("clients").select("*").in("id", batch);
        if (error) return { data: rows, error };
        rows.push(...(data ?? []));
    }
    return { data: rows, error: null };
}

async function fetchAnalysesByIds(ids: string[]) {
    const rows: any[] = [];
    if (ids.length === 0) return { data: rows, error: null };
    for (const batch of chunk(ids, 100)) {
        const { data, error } = await supabase.from("conversation_analysis").select("*").in("id", batch);
        if (error) return { data: rows, error };
        rows.push(...(data ?? []));
    }
    return { data: rows, error: null };
}

const NULL_FILTER_VALUE = "__NULL__";

function filterByTunnelAndOrigin(conversations: any[], {
    tunnelValues,
    originValues,
}: {
    tunnelValues: string[];
    originValues: string[];
}) {
    return conversations.filter((conversation) => {
        const tunnel = emptyToNull(conversation.tunnel);
        const origin = emptyToNull(conversation.origin);
        return (
            (tunnelValues.length === 0 || tunnelValues.includes(tunnel ?? NULL_FILTER_VALUE)) &&
            (originValues.length === 0 || originValues.includes(origin ?? NULL_FILTER_VALUE))
        );
    });
}

function emptyToNull(value: unknown) {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
}
