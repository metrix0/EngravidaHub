// app/api/inbox/history/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import type {
    InboxHistoryResponse,
    InboxMessage,
} from "@/types/inbox";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("client_id")?.trim() ?? "";
    const before = searchParams.get("before")?.trim() ?? "";

    if (!clientId || !before || Number.isNaN(new Date(before).getTime())) {
        return NextResponse.json(
            { ok: false, error: "client_id and a valid before date are required" },
            { status: 400 },
        );
    }

    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.is_online) {
        return NextResponse.json(
            { ok: false, error: "Not allowed" },
            { status: 403 },
        );
    }

    const hasAccess = await attendantCanAccessClient(
        attendant.id,
        clientId,
    );

    if (!hasAccess) {
        return NextResponse.json(
            { ok: false, error: "Client history not available" },
            { status: 403 },
        );
    }

    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("id, started_at, ended_at")
        .eq("client_id", clientId)
        .lt("started_at", before)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (conversationError) {
        return NextResponse.json(
            { ok: false, error: conversationError.message },
            { status: 500 },
        );
    }

    if (!conversation) {
        const response: InboxHistoryResponse = {
            item: null,
            has_more: false,
            next_before: null,
        };

        return NextResponse.json(response);
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

    const { data: olderConversation, error: olderConversationError } =
        await supabase
            .from("conversations")
            .select("id")
            .eq("client_id", clientId)
            .lt("started_at", conversation.started_at)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

    if (olderConversationError) {
        return NextResponse.json(
            { ok: false, error: olderConversationError.message },
            { status: 500 },
        );
    }

    const response: InboxHistoryResponse = {
        item: {
            id: conversation.id,
            started_at: conversation.started_at,
            ended_at: conversation.ended_at,
            label: formatConversationLabel(
                conversation.started_at,
                conversation.ended_at,
            ),
            messages: mappedMessages,
        },
        has_more: Boolean(olderConversation),
        next_before: conversation.started_at,
    };

    return NextResponse.json(response);
}

async function attendantCanAccessClient(
    attendantId: string,
    clientId: string,
) {
    const [{ data: assignedThread, error: threadError }, { data: ownConversation, error: conversationError }] =
        await Promise.all([
            supabase
                .from("thread")
                .select("id")
                .eq("client_id", clientId)
                .eq("assigned_attendant_id", attendantId)
                .limit(1)
                .maybeSingle(),
            supabase
                .from("conversations")
                .select("id")
                .eq("client_id", clientId)
                .eq("attendant_id", attendantId)
                .limit(1)
                .maybeSingle(),
        ]);

    if (threadError) throw threadError;
    if (conversationError) throw conversationError;

    return Boolean(assignedThread || ownConversation);
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
