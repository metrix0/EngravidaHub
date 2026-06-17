// app/src/app/api/dashboard/mensagens/[conversationId]/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@engravida/lib";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ conversationId: string }> }
) {
    const { conversationId } = await params;

    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

    if (conversationError) {
        return NextResponse.json(
            { error: conversationError.message },
            { status: 500 }
        );
    }

    const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("id", conversation.client_id)
        .single();

    if (clientError) {
        return NextResponse.json(
            { error: clientError.message },
            { status: 500 }
        );
    }

    const { data: messages, error: messagesError } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (messagesError) {
        return NextResponse.json(
            { error: messagesError.message },
            { status: 500 }
        );
    }

    let analysis = null;

    if (conversation.conversation_analysis_id) {
        const { data, error } = await supabase
            .from("conversation_analysis")
            .select("*")
            .eq("id", conversation.conversation_analysis_id)
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        analysis = data;
    }

    return NextResponse.json({
        conversation,
        client,
        messages: (messages ?? []).map((message) => ({
            ...message,
            text: cleanMessageText(message.text),
        })),
        analysis,
    });
}

function cleanMessageText(text: string) {
    return text
        .replace(/<\/?b>/gi, "")
        .replace(/<\/?strong>/gi, "");
}