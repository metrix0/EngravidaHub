// app/src/app/api/clientes/conversation-panel/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@engravida/lib";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    const conversationId = searchParams.get("conversation_id");
    const threadId = searchParams.get("thread_id");

    if (!conversationId && !threadId) {
        return NextResponse.json(
            { error: "conversation_id or thread_id is required" },
            { status: 400 },
        );
    }

    if (threadId) {
        return fetchThreadPanel(threadId);
    }

    return fetchConversationPanel(conversationId as string);
}

async function fetchConversationPanel(conversationId: string) {
    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();

    if (conversationError) {
        return NextResponse.json(
            { error: conversationError.message },
            { status: 500 },
        );
    }

    if (!conversation) {
        return NextResponse.json(
            { error: "Conversation not found" },
            { status: 404 },
        );
    }

    const [client, analysis, messages] = await Promise.all([
        fetchClient(conversation.client_id),
        fetchAnalysis(conversation.conversation_analysis_id),
        fetchMessagesByConversationId(conversation.id),
    ]);

    return NextResponse.json({
        type: "conversation",
        conversation,
        thread: null,
        client,
        analysis,
        messages,
    });
}

async function fetchThreadPanel(threadId: string) {
    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select("*")
        .eq("id", threadId)
        .maybeSingle();

    if (threadError) {
        return NextResponse.json({ error: threadError.message }, { status: 500 });
    }

    if (!thread) {
        return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const [client, conversation, messages] = await Promise.all([
        fetchClient(thread.client_id),
        thread.latest_conversation_id
            ? fetchConversation(thread.latest_conversation_id)
            : Promise.resolve(null),
        fetchMessagesByThreadId(thread.id),
    ]);

    const analysis = conversation?.conversation_analysis_id
        ? await fetchAnalysis(conversation.conversation_analysis_id)
        : null;

    return NextResponse.json({
        type: "thread",
        conversation,
        thread,
        client,
        analysis,
        messages,
    });
}

async function fetchClient(clientId: string) {
    const { data, error } = await supabase
        .from("clients")
        .select(
            `
            id,
            name,
            phone,
            email,
            first_seen_at,
            last_interaction_at,
            unit_id,
            pipeline_stage_id,
            utm_source,
            utm_medium,
            utm_campaign
            `,
        )
        .eq("id", clientId)
        .maybeSingle();

    if (error) throw error;

    return data ?? null;
}

async function fetchConversation(conversationId: string) {
    const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
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

async function fetchMessagesByConversationId(conversationId: string) {
    const { data, error } = await supabase
        .from("messages")
        .select(
            `
            id,
            client_id,
            conversation_id,
            thread_id,
            sender_type,
            sender_name,
            text,
            sent_at,
            sequence_index,
            external_id,
            external_contact_id,
            external_thread_id,
            external_attendant_id,
            interactive_option_id
            `,
        )
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (error) throw error;

    return data ?? [];
}

async function fetchMessagesByThreadId(threadId: string) {
    const { data, error } = await supabase
        .from("messages")
        .select(
            `
            id,
            client_id,
            conversation_id,
            thread_id,
            sender_type,
            sender_name,
            text,
            sent_at,
            sequence_index,
            external_id,
            external_contact_id,
            external_thread_id,
            external_attendant_id,
            interactive_option_id
            `,
        )
        .eq("thread_id", threadId)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (error) throw error;

    return data ?? [];
}
