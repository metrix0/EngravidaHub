// app/api/inbox/threads/[threadId]/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import type {
    ClientNote,
    InboxChannel,
    InboxItemType,
    InboxMessage,
    InboxNote,
    InboxThreadDetail,
    InboxThreadDetailResponse,
} from "@/types/inbox";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(
    request: Request,
    { params }: { params: Promise<{ threadId: string }> },
) {
    const { threadId: itemId } = await params;
    const { searchParams } = new URL(request.url);
    const itemType = normalizeItemType(searchParams.get("item_type"));

    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.is_online) {
        return NextResponse.json(
            { ok: false, error: "Not allowed" },
            { status: 403 },
        );
    }

    return itemType === "conversation"
        ? loadConversationDetail({
            conversationId: itemId,
            attendantId: attendant.id,
        })
        : loadThreadDetail({
            threadId: itemId,
            attendantId: attendant.id,
        });
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ threadId: string }> },
) {
    const { threadId } = await params;
    const body = await request.json();

    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.is_online) {
        return NextResponse.json(
            { ok: false, error: "Not allowed" },
            { status: 403 },
        );
    }

    if (body.read === true) {
        const { error } = await supabase
            .from("thread")
            .update({ unread_count: 0 })
            .eq("id", threadId)
            .eq("assigned_attendant_id", attendant.id);

        if (error) {
            return NextResponse.json(
                { ok: false, error: error.message },
                { status: 500 },
            );
        }
    }

    if (body.funnel_stage_id) {
        const result = await moveClientToStage({
            threadId,
            toStageId: body.funnel_stage_id,
            attendantId: attendant.id,
        });

        if (!result.ok) {
            return NextResponse.json(
                { ok: false, error: result.error },
                { status: 500 },
            );
        }
    }

    if (body.stage_action === "previous" || body.stage_action === "next") {
        const result = await moveClientByDirection({
            threadId,
            direction: body.stage_action,
            attendantId: attendant.id,
        });

        if (!result.ok) {
            return NextResponse.json(
                { ok: false, error: result.error },
                { status: 500 },
            );
        }
    }

    return NextResponse.json({ ok: true });
}

async function loadThreadDetail({
    threadId,
    attendantId,
}: {
    threadId: string;
    attendantId: string;
}) {
    const { data: thread, error: threadError } = await supabase
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
                utm_source,
                utm_campaign,
                funnel_stage_id,
                notes,
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
        .eq("id", threadId)
        .eq("status", "open")
        .eq("assigned_attendant_id", attendantId)
        .maybeSingle();

    if (threadError) {
        return NextResponse.json(
            { ok: false, error: threadError.message },
            { status: 500 },
        );
    }

    if (!thread) {
        return NextResponse.json(
            { ok: false, error: "Thread not found" },
            { status: 404 },
        );
    }

    const { data: messages, error: messagesError } = await supabase
        .from("messages")
        .select("*")
        .eq("thread_id", thread.id)
        .is("conversation_id", null)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (messagesError) {
        return NextResponse.json(
            { ok: false, error: messagesError.message },
            { status: 500 },
        );
    }

    await supabase
        .from("thread")
        .update({ unread_count: 0 })
        .eq("id", thread.id)
        .eq("assigned_attendant_id", attendantId);

    const mappedMessages = (messages ?? []).map(mapMessage);
    const historyBefore =
        mappedMessages[0]?.sent_at ?? new Date().toISOString();
    const hasOlder = await hasOlderConversations(
        thread.client_id,
        historyBefore,
    );
    const replyState = getReplyState(thread.last_client_message_at);

    const response: InboxThreadDetailResponse = {
        item: {
            ...mapThreadBase(thread),
            item_type: "thread",
            id: thread.id,
            thread_id: thread.id,
            conversation_id: null,
            status: "open",
            messages: mappedMessages,
            notes: mapClientNotes(thread.clients?.notes),
            can_reply: replyState.canReply,
            reply_window_ends_at: replyState.windowEndsAt,
            has_older_conversations: hasOlder,
            history_before: historyBefore,
        },
    };

    return NextResponse.json(response);
}

async function loadConversationDetail({
    conversationId,
    attendantId,
}: {
    conversationId: string;
    attendantId: string;
}) {
    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select(`
            id,
            client_id,
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
                utm_source,
                utm_campaign,
                funnel_stage_id,
                notes,
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
        .eq("id", conversationId)
        .eq("attendant_id", attendantId)
        .maybeSingle();

    if (conversationError) {
        return NextResponse.json(
            { ok: false, error: conversationError.message },
            { status: 500 },
        );
    }

    if (!conversation) {
        return NextResponse.json(
            { ok: false, error: "Conversation not found" },
            { status: 404 },
        );
    }

    const { data: messages, error: messagesError } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversation.id)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (messagesError) {
        return NextResponse.json(
            { ok: false, error: messagesError.message },
            { status: 500 },
        );
    }

    const thread = await findThreadForConversation(conversation);
    const historyBefore = conversation.started_at;
    const hasOlder = await hasOlderConversations(
        conversation.client_id,
        historyBefore,
    );
    const replyState = getReplyState(thread?.last_client_message_at ?? null);
    const canReply =
        Boolean(thread) &&
        thread?.status === "closed" &&
        thread?.assigned_attendant_id === attendantId &&
        replyState.canReply;

    const mappedMessages = (messages ?? []).map(mapMessage);

    if (mappedMessages[0]) {
        mappedMessages[0] = {
            ...mappedMessages[0],
            conversation_boundary_label: formatConversationLabel(
                conversation.started_at,
                conversation.ended_at,
            ),
        };
    }

    const response: InboxThreadDetailResponse = {
        item: {
            ...mapConversationBase(conversation, thread),
            item_type: "conversation",
            id: conversation.id,
            thread_id: thread?.id ?? conversation.thread_id ?? null,
            conversation_id: conversation.id,
            status: "closed",
            messages: mappedMessages,
            notes: mapClientNotes(conversation.clients?.notes),
            can_reply: canReply,
            reply_window_ends_at: replyState.windowEndsAt,
            has_older_conversations: hasOlder,
            history_before: historyBefore,
        },
    };

    return NextResponse.json(response);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findThreadForConversation(conversation: any) {
    let query = supabase
        .from("thread")
        .select("*")
        .limit(1);

    query = conversation.thread_id
        ? query.eq("id", conversation.thread_id)
        : query.eq("client_id", conversation.client_id);

    const { data, error } = await query.maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

async function hasOlderConversations(clientId: string, before: string) {
    const { data, error } = await supabase
        .from("conversations")
        .select("id")
        .eq("client_id", clientId)
        .lt("started_at", before)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return Boolean(data);
}

async function moveClientByDirection({
    threadId,
    direction,
    attendantId,
}: {
    threadId: string;
    direction: "previous" | "next";
    attendantId: string;
}) {
    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select(`
            id,
            client_id,
            assigned_attendant_id,
            clients (
                id,
                funnel_stage_id,
                funnel_stages (
                    id,
                    funnel_id,
                    position
                )
            )
        `)
        .eq("id", threadId)
        .eq("assigned_attendant_id", attendantId)
        .maybeSingle();

    if (threadError) {
        return { ok: false, error: threadError.message };
    }

    if (!thread) {
        return { ok: false, error: "Thread not found" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = thread.clients as any;
    const currentStage = client?.funnel_stages;

    if (!client?.funnel_stage_id || !currentStage?.funnel_id) {
        return { ok: false, error: "Client has no current funnel stage" };
    }

    let query = supabase
        .from("funnel_stages")
        .select("*")
        .eq("funnel_id", currentStage.funnel_id)
        .order("position", { ascending: direction === "next" })
        .limit(1);

    query =
        direction === "next"
            ? query.gt("position", currentStage.position)
            : query.lt("position", currentStage.position);

    const { data: stages, error: stageError } = await query;

    if (stageError) {
        return { ok: false, error: stageError.message };
    }

    const nextStage = stages?.[0];

    if (!nextStage) {
        return { ok: true };
    }

    return moveClientToStage({
        threadId,
        toStageId: nextStage.id,
        attendantId,
    });
}

async function moveClientToStage({
    threadId,
    toStageId,
    attendantId,
}: {
    threadId: string;
    toStageId: string;
    attendantId: string;
}) {
    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select(`
            id,
            client_id,
            assigned_attendant_id,
            clients (
                id,
                funnel_stage_id
            )
        `)
        .eq("id", threadId)
        .eq("assigned_attendant_id", attendantId)
        .maybeSingle();

    if (threadError) {
        return { ok: false, error: threadError.message };
    }

    if (!thread) {
        return { ok: false, error: "Thread not found" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = thread.clients as any;
    const fromStageId = client?.funnel_stage_id ?? null;

    const { data: toStage, error: toStageError } = await supabase
        .from("funnel_stages")
        .select("id, funnel_id")
        .eq("id", toStageId)
        .maybeSingle();

    if (toStageError) {
        return { ok: false, error: toStageError.message };
    }

    if (!toStage) {
        return { ok: false, error: "Funnel stage not found" };
    }

    const { error: updateError } = await supabase
        .from("clients")
        .update({ funnel_stage_id: toStageId })
        .eq("id", thread.client_id);

    if (updateError) {
        return { ok: false, error: updateError.message };
    }

    await supabase.from("funnel_history").insert({
        client_id: thread.client_id,
        funnel_id: toStage.funnel_id,
        from_stage_id: fromStageId,
        to_stage_id: toStageId,
        moved_by_attendant_id: thread.assigned_attendant_id ?? null,
        note: "Movido pelo Inbox",
    });

    return { ok: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapThreadBase(row: any): Omit<
    InboxThreadDetail,
    | "id"
    | "item_type"
    | "thread_id"
    | "conversation_id"
    | "status"
    | "messages"
    | "notes"
    | "can_reply"
    | "reply_window_ends_at"
    | "has_older_conversations"
    | "history_before"
> {
    const client = row.clients;
    const attendant = row.attendants;
    const latestConversation = row.conversations;
    const analysis = latestConversation?.analysis;
    const stage = client?.funnel_stages;
    const funnel = stage?.funnels;
    const name = client?.name ?? "Cliente sem nome";

    return {
        client_id: row.client_id,
        name,
        initials: getInitials(name),
        phone: client?.phone ?? null,
        channel: normalizeChannel(row.channel),
        preview: cleanMessageText(row.last_message_text ?? "Sem mensagens"),
        time: formatTimeAgo(row.last_message_at ?? row.updated_at),
        unread: row.unread_count ?? 0,
        city: client?.state ?? null,
        unit_name: getUnitName(client?.units),
        funnel: funnel?.name ?? "Sem funil",
        funnelStage: stage?.name ?? "Sem etapa",
        funnel_stage_id: client?.funnel_stage_id ?? null,
        intent:
            analysis?.customer_start_intent ??
            analysis?.conversation_goal ??
            null,
        origin: latestConversation?.origin ?? client?.utm_source ?? null,
        campaign: client?.utm_campaign ?? null,
        responsible: attendant?.name ?? null,
        lastContact: formatTimeAgo(row.last_message_at ?? row.updated_at),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapConversationBase(
    conversation: any,
    thread: any,
): Omit<
    InboxThreadDetail,
    | "id"
    | "item_type"
    | "thread_id"
    | "conversation_id"
    | "status"
    | "messages"
    | "notes"
    | "can_reply"
    | "reply_window_ends_at"
    | "has_older_conversations"
    | "history_before"
> {
    const client = conversation.clients;
    const attendant = conversation.attendants;
    const analysis = conversation.analysis;
    const stage = client?.funnel_stages;
    const funnel = stage?.funnels;
    const name = client?.name ?? "Cliente sem nome";
    const lastActivity =
        conversation.last_message_at ??
        conversation.ended_at ??
        conversation.started_at;

    return {
        client_id: conversation.client_id,
        name,
        initials: getInitials(name),
        phone: client?.phone ?? null,
        channel: normalizeChannel(conversation.channel ?? thread?.channel),
        preview: cleanMessageText(
            conversation.last_message_text ??
            analysis?.short_label ??
            "Conversa finalizada",
        ),
        time: formatTimeAgo(lastActivity),
        unread: 0,
        city: client?.state ?? null,
        unit_name: getUnitName(client?.units),
        funnel: funnel?.name ?? "Sem funil",
        funnelStage: stage?.name ?? "Sem etapa",
        funnel_stage_id: client?.funnel_stage_id ?? null,
        intent:
            analysis?.customer_start_intent ??
            analysis?.conversation_goal ??
            null,
        origin: conversation.source ?? client?.utm_source ?? null,
        campaign: client?.utm_campaign ?? null,
        responsible:
            attendant?.name ?? conversation.attendant_chat_name ?? null,
        lastContact: formatTimeAgo(lastActivity),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMessage(message: any): InboxMessage {
    return {
        id: message.id,
        from: message.sender_type === "client" ? "client" : "attendant",
        sender_type: message.sender_type,
        sender_name: message.sender_name ?? null,
        text: cleanMessageText(message.text),
        time: formatMessageTime(message.sent_at),
        sent_at: message.sent_at,
        sequence_index: message.sequence_index ?? null,
    };
}

function mapClientNotes(value: unknown): InboxNote[] {
    if (!Array.isArray(value)) return [];

    return (value as ClientNote[])
        .map((note) => ({
            id: note.id,
            author: note.author_name ?? "Atendente",
            time: formatTimeAgo(note.created_at),
            text: note.text,
            created_at: note.created_at,
        }))
        .sort(
            (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
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

function normalizeItemType(value: string | null): InboxItemType {
    return value === "conversation" ? "conversation" : "thread";
}

function normalizeChannel(value: string | null): InboxChannel {
    if (value === "Instagram" || value === "Facebook" || value === "WhatsApp") {
        return value;
    }

    return "WhatsApp";
}

function getReplyState(lastClientMessageAt: string | null) {
    if (!lastClientMessageAt) {
        return {
            canReply: false,
            windowEndsAt: null,
        };
    }

    const windowEndsAt = new Date(
        new Date(lastClientMessageAt).getTime() + WHATSAPP_WINDOW_MS,
    );

    return {
        canReply: windowEndsAt.getTime() > Date.now(),
        windowEndsAt: windowEndsAt.toISOString(),
    };
}

function formatConversationLabel(startedAt: string, endedAt: string | null) {
    const start = new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(new Date(startedAt));

    if (!endedAt) return `Conversa de ${start}`;

    const end = new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(new Date(endedAt));

    return start === end
        ? `Conversa de ${start}`
        : `Conversa de ${start} a ${end}`;
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

function formatMessageTime(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function cleanMessageText(text: string) {
    return text
        .replace(/<\/?b>/gi, "")
        .replace(/<\/?strong>/gi, "")
        .trim();
}
