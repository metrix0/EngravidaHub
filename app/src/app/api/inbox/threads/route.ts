// app/src/app/api/inbox/threads/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@engravida/lib/supabase/client";
import type {
    InboxChannel,
    InboxStatus,
    InboxThreadListItem,
    InboxThreadsResponse,
} from "@/types/inbox";
import {getCurrentAttendantFromRequest} from "@/lib/attendants/getCurrentAttendantFromRequest";

const PAGE_SIZE_DEFAULT = 10;
const MAX_FETCH = 5000;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.max(
        1,
        Math.min(100, Number(searchParams.get("page_size") ?? PAGE_SIZE_DEFAULT))
    );

    const status = normalizeStatus(searchParams.get("status"));
    const search = searchParams.get("search")?.trim().toLowerCase() ?? "";

    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant) {
        return NextResponse.json({
            items: [],
            total: 0,
            page,
            page_size: pageSize,
        });
    }

    if (!attendant.is_online) {
        return NextResponse.json({
            items: [],
            total: 0,
            page,
            page_size: pageSize,
        });
    }

    let query = supabase
        .from("thread")
        .select(`
            *,
            clients (
                id,
                name,
                phone,
                email,
                state,
                country,
                utm_source,
                utm_campaign,
                pipeline_stage_id,
                pipeline_stages (
                    id,
                    name,
                    position,
                    color,
                    pipelines (
                        id,
                        name
                    )
                )
            ),
            attendants (
                id,
                name
            ),
            conversations (
                id,
                tunnel,
                origin,
                conversation_analysis_id,
                analysis:conversation_analysis!conversations_conversation_analysis_id_fkey (
                    id,
                    conversation_goal,
                    customer_start_intent,
                    customer_final_state,
                    short_label
                )
            )
        `)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .eq("assigned_attendant_id", attendant.id)
        .limit(MAX_FETCH);

    if (status) {
        query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
        return NextResponse.json(
            { ok: false, error: error.message },
            { status: 500 }
        );
    }

    const mapped = (data ?? []).map(mapThreadRow);

    const filtered = search
        ? mapped.filter((item) => {
            return [
                item.name,
                item.phone,
                item.preview,
                item.city,
                item.origin,
                item.campaign,
                item.responsible,
                item.funnel,
                item.funnelStage,
            ]
                .filter(Boolean)
                .some((value) =>
                    String(value).toLowerCase().includes(search)
                );
        })
        : mapped;

    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const response: InboxThreadsResponse = {
        items: filtered.slice(start, end),
        total: filtered.length,
        page,
        page_size: pageSize,
    };

    return NextResponse.json(response);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapThreadRow(row: any): InboxThreadListItem {
    const client = row.clients;
    const attendant = row.attendants;
    const conversation = row.conversations;
    const analysis = conversation?.analysis;
    const stage = client?.pipeline_stages;
    const pipeline = stage?.pipelines;

    const name = client?.name ?? "Cliente sem nome";

    return {
        id: row.id,

        client_id: row.client_id,
        conversation_id: row.latest_conversation_id,

        name,
        initials: getInitials(name),
        phone: client?.phone ?? null,

        channel: normalizeChannel(row.channel),
        preview: cleanMessageText(row.last_message_text ?? "Sem mensagens"),
        time: formatTimeAgo(row.last_message_at ?? row.updated_at),
        unread: row.unread_count ?? 0,
        status: normalizeStatus(row.status) ?? "open",

        city: client?.state ?? null,

        funnel: pipeline?.name ?? "Sem funil",
        funnelStage: stage?.name ?? "Sem etapa",
        pipeline_stage_id: client?.pipeline_stage_id ?? null,

        intent:
            analysis?.customer_start_intent ??
            analysis?.conversation_goal ??
            null,

        origin: conversation?.origin ?? client?.utm_source ?? null,
        campaign: client?.utm_campaign ?? null,

        responsible: attendant?.name ?? null,
        lastContact: formatTimeAgo(row.last_message_at ?? row.updated_at),
    };
}

function normalizeStatus(value: string | null): InboxStatus | null {
    if (value === "open" || value === "pending" || value === "closed") {
        return value;
    }

    return null;
}

function normalizeChannel(value: string | null): InboxChannel {
    if (value === "Instagram" || value === "Facebook" || value === "WhatsApp") {
        return value;
    }

    return "WhatsApp";
}

function getInitials(name: string) {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase())
        .join("");
}

function formatTimeAgo(value: string | null) {
    if (!value) return "-";

    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 30) return "agora";
    if (diffMinutes < 1) return "há menos de 1 min";
    if (diffMinutes === 1) return "1 min";
    if (diffMinutes < 60) return `${diffMinutes} min`;
    if (diffHours === 1) return "1 h";
    if (diffHours < 24) return `${diffHours} h`;
    if (diffDays === 1) return "1 d";

    return `${diffDays} d`;
}

function cleanMessageText(text: string) {
    return text
        .replace(/<\/?b>/gi, "")
        .replace(/<\/?strong>/gi, "")
        .trim();
}