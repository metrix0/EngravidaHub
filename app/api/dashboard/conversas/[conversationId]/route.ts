// app/api/dashboard/conversas/[conversationId]/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";

type ThreadDetailRow = {
    id: string;
    client_id: string | null;
    instagram_user_id: string | null;
    status: string;
    source: string | null;
    channel: string | null;
    assigned_attendant_id: string | null;
    queued_at: string | null;
    created_at: string;
    updated_at: string;
    last_message_at: string | null;
};

export async function GET(
    request: Request,
    { params }: { params: Promise<{ conversationId: string }> },
) {
    const { conversationId: itemId } = await params;
    const itemType =
        new URL(request.url).searchParams.get("item_type") === "thread"
            ? "thread"
            : "conversation";

    try {
        return itemType === "thread"
            ? await fetchThreadDetail(itemId)
            : await fetchConversationDetail(itemId);
    } catch (error) {
        console.error("[dashboard/conversas/detail] failed", {
            item_id: itemId,
            item_type: itemType,
            error,
        });
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar a conversa.",
            },
            { status: 500 },
        );
    }
}

async function fetchConversationDetail(conversationId: string) {
    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();

    if (conversationError) throw conversationError;
    if (!conversation) {
        return NextResponse.json(
            { error: "Conversation not found" },
            { status: 404 },
        );
    }

    const [identity, messages, analysis] = await Promise.all([
        fetchConversationIdentity(conversation),
        fetchConversationMessages(conversationId),
        fetchAnalysis(conversation.conversation_analysis_id),
    ]);

    if (!identity) {
        return NextResponse.json(
            { error: "Conversation identity not found" },
            { status: 404 },
        );
    }

    return NextResponse.json({
        item_type: "conversation",
        conversation,
        client: identity,
        messages: cleanMessages(messages),
        analysis,
    });
}

async function fetchThreadDetail(threadId: string) {
    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select(
            [
                "id",
                "client_id",
                "instagram_user_id",
                "status",
                "source",
                "channel",
                "assigned_attendant_id",
                "queued_at",
                "created_at",
                "updated_at",
                "last_message_at",
            ].join(","),
        )
        .eq("id", threadId)
        .eq("status", "open")
        .maybeSingle();

    if (threadError) throw threadError;
    if (!thread) {
        return NextResponse.json(
            { error: "Thread not found" },
            { status: 404 },
        );
    }
    const typedThread = thread as unknown as ThreadDetailRow;

    const [identity, attendant, messages] = await Promise.all([
        fetchConversationIdentity(typedThread),
        fetchAttendant(typedThread.assigned_attendant_id),
        fetchThreadMessages(typedThread.id),
    ]);

    if (!identity) {
        return NextResponse.json(
            { error: "Conversation identity not found" },
            { status: 404 },
        );
    }

    const startedAt =
        typedThread.queued_at ??
        messages[0]?.sent_at ??
        typedThread.created_at;

    return NextResponse.json({
        item_type: "thread",
        conversation: {
            id: typedThread.id,
            client_id: typedThread.client_id,
            instagram_user_id: typedThread.instagram_user_id,
            source: typedThread.source,
            channel: typedThread.channel,
            started_at: startedAt,
            ended_at: null,
            attendant_id: typedThread.assigned_attendant_id,
            attendant_chat_name: attendant?.name ?? null,
            tunnel: identity.last_tunnel ?? null,
            origin: identity.last_origin ?? null,
            conversation_analysis_id: null,
            analysis_status: "pending",
        },
        client: identity,
        messages: cleanMessages(messages),
        analysis: null,
    });
}

async function fetchClient(clientId: string) {
    const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", clientId)
        .maybeSingle();

    if (error) throw error;
    return data
        ? {
              ...data,
              identity_type: "client" as const,
              is_clickable: true,
              instagram_username: null,
          }
        : null;
}

async function fetchInstagramUser(instagramUserId: string) {
    const { data, error } = await supabase
        .from("instagram_users")
        .select("id, username, display_name")
        .eq("id", instagramUserId)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
        id: data.id,
        name:
            data.display_name?.trim() ||
            (data.username
                ? `@${data.username.replace(/^@+/, "")}`
                : "Usuário do Instagram"),
        phone: null,
        identity_type: "instagram" as const,
        is_clickable: false,
        instagram_username: data.username ?? null,
        last_tunnel: null,
        last_origin: null,
    };
}

async function fetchConversationIdentity(row: {
    client_id?: string | null;
    instagram_user_id?: string | null;
}) {
    if (row.client_id) return fetchClient(row.client_id);
    if (row.instagram_user_id) {
        return fetchInstagramUser(row.instagram_user_id);
    }
    return null;
}

async function fetchAttendant(attendantId: string | null) {
    if (!attendantId) return null;

    const { data, error } = await supabase
        .from("attendants")
        .select("id, name")
        .eq("id", attendantId)
        .maybeSingle();

    if (error) throw error;
    return data ?? null;
}

async function fetchAnalysis(analysisId: string | null) {
    if (!analysisId) return null;

    const { data, error } = await supabase
        .from("conversation_analysis")
        .select("*")
        .eq("id", analysisId)
        .maybeSingle();

    if (error) throw error;
    return data ?? null;
}

async function fetchConversationMessages(conversationId: string) {
    const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (error) throw error;
    return data ?? [];
}

async function fetchThreadMessages(threadId: string) {
    const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("thread_id", threadId)
        .is("conversation_id", null)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (error) throw error;
    return data ?? [];
}

function cleanMessages(messages: Array<{ text: string | null }>) {
    return messages.map((message) => ({
        ...message,
        text: cleanMessageText(message.text),
    }));
}

function cleanMessageText(text: string | null) {
    return (text ?? "")
        .replace(/<\/?b>/gi, "")
        .replace(/<\/?strong>/gi, "");
}
