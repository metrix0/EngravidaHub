// app/api/inbox/threads/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import type {
    InboxChannel,
    InboxStatus,
    InboxThreadListItem,
    InboxThreadsResponse,
} from "@/types/inbox";

const PAGE_SIZE_DEFAULT = 10;
const MAX_FETCH = 5000;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.max(
        1,
        Math.min(100, Number(searchParams.get("page_size") ?? PAGE_SIZE_DEFAULT)),
    );
    const status = normalizeStatus(searchParams.get("status")) ?? "open";
    const search = searchParams.get("search")?.trim().toLowerCase() ?? "";
    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.is_online) {
        return NextResponse.json({
            items: [],
            total: 0,
            page,
            page_size: pageSize,
        });
    }

    const result =
        status === "closed"
            ? await loadClosedConversations(attendant.id)
            : await loadOpenThreads(attendant.id);

    if (!result.ok) return result.response;

    const filtered = search
        ? result.items.filter((item) =>
              [
                  item.name,
                  item.phone,
                  item.preview,
                  item.city,
                  item.unit_name,
                  item.origin,
                  item.campaign,
                  item.responsible,
                  item.funnel,
                  item.funnelStage,
              ]
                  .filter(Boolean)
                  .some((value) =>
                      String(value).toLowerCase().includes(search),
                  ),
          )
        : result.items;
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

async function loadOpenThreads(attendantId: string) {
    const { data, error } = await supabase
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
                unit_id,
                units (
                    id,
                    name
                ),
                last_origin,
                last_tunnel,
                utm_campaign,
                funnel_stage_id,
                funnel_stages (
                    id,
                    name,
                    position,
                    color,
                    funnels (
                        id,
                        name
                    )
                )
            ),
            instagram_user:instagram_users!thread_instagram_user_id_fkey (
                id,
                username,
                display_name
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
        .eq("status", "open")
        .eq("assigned_attendant_id", attendantId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(MAX_FETCH);

    if (error) {
        return {
            ok: false as const,
            response: NextResponse.json(
                { ok: false, error: error.message },
                { status: 500 },
            ),
        };
    }

    return {
        ok: true as const,
        items: (data ?? []).map(mapOpenThread),
    };
}

async function loadClosedConversations(attendantId: string) {
    const { data, error } = await supabase
        .from("conversations")
        .select(`
            id,
            client_id,
            instagram_user_id,
            thread_id,
            source,
            channel,
            started_at,
            ended_at,
            attendant_id,
            attendant_chat_name,
            last_message_text,
            last_message_at,
            conversation_analysis_id,
            tunnel,
            origin,
            clients (
                id,
                name,
                phone,
                email,
                state,
                country,
                unit_id,
                units (
                    id,
                    name
                ),
                last_origin,
                last_tunnel,
                utm_campaign,
                funnel_stage_id,
                funnel_stages (
                    id,
                    name,
                    position,
                    color,
                    funnels (
                        id,
                        name
                    )
                )
            ),
            instagram_user:instagram_users!conversations_instagram_user_id_fkey (
                id,
                username,
                display_name
            ),
            attendants (
                id,
                name
            ),
            analysis:conversation_analysis!conversations_conversation_analysis_id_fkey (
                id,
                conversation_goal,
                customer_start_intent,
                customer_final_state,
                short_label
            )
        `)
        .eq("attendant_id", attendantId)
        .not("ended_at", "is", null)
        .order("ended_at", { ascending: false, nullsFirst: false })
        .limit(MAX_FETCH);

    if (error) {
        return {
            ok: false as const,
            response: NextResponse.json(
                { ok: false, error: error.message },
                { status: 500 },
            ),
        };
    }

    return {
        ok: true as const,
        items: (data ?? []).map(mapClosedConversation),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOpenThread(row: any): InboxThreadListItem {
    const client = normalizeRelation(row.clients);
    const instagramUser = normalizeRelation(row.instagram_user);
    const attendant = row.attendants;
    const latestConversation = normalizeRelation(row.conversations);
    const analysis = normalizeRelation(latestConversation?.analysis);
    const stage = normalizeRelation(client?.funnel_stages);
    const funnel = normalizeRelation(stage?.funnels);
    const channel = normalizeChannel(row.channel);
    const isInstagram = channel === "Instagram";
    const name = getIdentityName(client, instagramUser);

    return {
        id: row.id,
        item_type: "thread",
        thread_id: row.id,
        client_id: row.client_id ?? null,
        instagram_user_id: row.instagram_user_id ?? null,
        identity_type: isInstagram ? "instagram" : "client",
        instagram_username: instagramUser?.username ?? null,
        conversation_id: null,
        name,
        initials: getInitials(name),
        phone: client?.phone ?? null,
        channel,
        preview: cleanMessageText(row.last_message_text ?? "Sem mensagens"),
        time: formatTimeAgo(row.last_message_at ?? row.updated_at),
        unread: row.unread_count ?? 0,
        status: "open",
        city: client?.state ?? null,
        unit_name: getUnitName(client?.units),
        funnel: isInstagram ? "Não se aplica" : funnel?.name ?? "Sem funil",
        funnelStage: isInstagram
            ? "Usuário do Instagram"
            : stage?.name ?? "Sem etapa",
        funnel_stage_id: client?.funnel_stage_id ?? null,
        intent:
            analysis?.customer_start_intent ??
            analysis?.conversation_goal ??
            null,
        origin: isInstagram
            ? null
            : latestConversation?.origin ?? client?.last_origin ?? null,
        campaign: isInstagram ? null : client?.utm_campaign ?? null,
        responsible: attendant?.name ?? null,
        lastContact: formatTimeAgo(row.last_message_at ?? row.updated_at),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapClosedConversation(row: any): InboxThreadListItem {
    const client = normalizeRelation(row.clients);
    const instagramUser = normalizeRelation(row.instagram_user);
    const attendant = row.attendants;
    const analysis = row.analysis;
    const stage = normalizeRelation(client?.funnel_stages);
    const funnel = normalizeRelation(stage?.funnels);
    const channel = normalizeChannel(row.channel);
    const isInstagram = channel === "Instagram" || row.source === "zernio";
    const name = getIdentityName(client, instagramUser);
    const lastActivity = row.last_message_at ?? row.ended_at ?? row.started_at;

    return {
        id: row.id,
        item_type: "conversation",
        thread_id: row.thread_id ?? null,
        client_id: row.client_id ?? null,
        instagram_user_id: row.instagram_user_id ?? null,
        identity_type: isInstagram ? "instagram" : "client",
        instagram_username: instagramUser?.username ?? null,
        conversation_id: row.id,
        name,
        initials: getInitials(name),
        phone: client?.phone ?? null,
        channel,
        preview: cleanMessageText(
            row.last_message_text ?? analysis?.short_label ?? "Conversa finalizada",
        ),
        time: formatTimeAgo(lastActivity),
        unread: 0,
        status: "closed",
        city: client?.state ?? null,
        unit_name: getUnitName(client?.units),
        funnel: isInstagram ? "Não se aplica" : funnel?.name ?? "Sem funil",
        funnelStage: isInstagram
            ? "Usuário do Instagram"
            : stage?.name ?? "Sem etapa",
        funnel_stage_id: client?.funnel_stage_id ?? null,
        intent:
            analysis?.customer_start_intent ??
            analysis?.conversation_goal ??
            null,
        origin: isInstagram ? null : row.origin ?? client?.last_origin ?? null,
        campaign: isInstagram ? null : client?.utm_campaign ?? null,
        responsible: attendant?.name ?? row.attendant_chat_name ?? null,
        lastContact: formatTimeAgo(lastActivity),
    };
}

function normalizeRelation<T>(value: T | T[] | null | undefined) {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function getIdentityName(
    client: { name?: string | null } | null,
    instagramUser: {
        display_name?: string | null;
        username?: string | null;
    } | null,
) {
    return (
        instagramUser?.display_name?.trim() ||
        (instagramUser?.username
            ? `@${instagramUser.username.replace(/^@+/, "")}`
            : null) ||
        client?.name?.trim() ||
        (instagramUser ? "Usuário do Instagram" : "Cliente sem nome")
    );
}

function getUnitName(value: unknown) {
    if (Array.isArray(value)) {
        const first = value[0] as { name?: unknown } | undefined;
        return typeof first?.name === "string" ? first.name : null;
    }

    if (value && typeof value === "object") {
        const name = (value as { name?: unknown }).name;
        return typeof name === "string" ? name : null;
    }

    return null;
}

function normalizeStatus(value: string | null): InboxStatus | null {
    if (value === "open" || value === "closed") return value;
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
