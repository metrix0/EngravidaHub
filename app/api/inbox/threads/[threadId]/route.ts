// app/api/inbox/threads/[threadId]/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib/supabase/client";
import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import type {
    ClientNote,
    InboxChannel,
    InboxMessage,
    InboxNote,
    InboxStatus,
    InboxThreadDetail,
    InboxThreadDetailResponse,
} from "@/types/inbox";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ threadId: string }> }
) {
    const { threadId } = await params;

    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.is_online) {
        return NextResponse.json(
            { ok: false, error: "Not allowed" },
            { status: 403 }
        );
    }

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
        .eq("assigned_attendant_id", attendant.id)
        .maybeSingle();

    if (threadError) {
        return NextResponse.json(
            { ok: false, error: threadError.message },
            { status: 500 }
        );
    }

    if (!thread) {
        return NextResponse.json(
            { ok: false, error: "Thread not found" },
            { status: 404 }
        );
    }

    const { data: messages, error: messagesError } = await supabase
        .from("messages")
        .select("*")
        .eq("thread_id", thread.id)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (messagesError) {
        return NextResponse.json(
            { ok: false, error: messagesError.message },
            { status: 500 }
        );
    }

    await supabase
        .from("thread")
        .update({ unread_count: 0 })
        .eq("id", thread.id)
        .eq("assigned_attendant_id", attendant.id);

    const response: InboxThreadDetailResponse = {
        item: {
            ...mapThreadBase(thread),
            messages: (messages ?? []).map(mapMessage),
            notes: mapClientNotes(thread.clients?.notes),
        },
    };

    return NextResponse.json(response);
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ threadId: string }> }
) {
    const { threadId } = await params;
    const body = await request.json();

    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.is_online) {
        return NextResponse.json(
            { ok: false, error: "Not allowed" },
            { status: 403 }
        );
    }

    if (body.status) {
        const status = normalizeStatus(body.status);

        if (!status) {
            return NextResponse.json(
                { ok: false, error: "Invalid status" },
                { status: 400 }
            );
        }

        const { error } = await supabase
            .from("thread")
            .update({ status })
            .eq("id", threadId)
            .eq("assigned_attendant_id", attendant.id);

        if (error) {
            return NextResponse.json(
                { ok: false, error: error.message },
                { status: 500 }
            );
        }
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
                { status: 500 }
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
                { status: 500 }
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
                { status: 500 }
            );
        }
    }

    return NextResponse.json({ ok: true });
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

function mapThreadBase(row: any): Omit<InboxThreadDetail, "messages" | "notes"> {
    const client = row.clients;
    const attendant = row.attendants;
    const conversation = row.conversations;
    const analysis = conversation?.analysis;
    const stage = client?.funnel_stages;
    const funnel = stage?.funnels;

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

        funnel: funil?.name ?? "Sem funil",
        funnelStage: stage?.name ?? "Sem etapa",
        funnel_stage_id: client?.funnel_stage_id ?? null,

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

function mapMessage(message: any): InboxMessage {
    return {
        id: message.id,
        from: message.sender_type === "client" ? "client" : "attendant",
        sender_type: message.sender_type,
        text: cleanMessageText(message.text),
        time: formatMessageTime(message.sent_at),
        sent_at: message.sent_at,
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
                new Date(a.created_at).getTime()
        );
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