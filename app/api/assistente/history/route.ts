// app/api/assistente/history/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import type {
    AssistantCard,
    AssistantChatMessage,
    AssistantChatSession,
} from "@/types/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SESSIONS = 30;
const MAX_MESSAGES_PER_SESSION = 100;

export async function GET() {
    const access = await getServerTabAccess("assistente");

    if (!access.ok) {
        return NextResponse.json(
            { ok: false, error: access.error },
            { status: access.status },
        );
    }

    const { data: sessionRows, error: sessionsError } = await supabase
        .from("assistant_chat_sessions")
        .select("id, title, created_at, updated_at")
        .eq("auth_user_id", access.user.id)
        .order("updated_at", { ascending: false })
        .limit(MAX_SESSIONS);

    if (sessionsError) {
        return NextResponse.json(
            { ok: false, error: sessionsError.message },
            { status: 500 },
        );
    }

    const sessionIds = (sessionRows ?? []).map((session) => session.id);

    if (sessionIds.length === 0) {
        return NextResponse.json({
            ok: true,
            sessions: [],
        });
    }

    const { data: messageRows, error: messagesError } = await supabase
        .from("assistant_chat_messages")
        .select("id, session_id, role, content, cards, created_at")
        .in("session_id", sessionIds)
        .order("created_at", { ascending: true });

    if (messagesError) {
        return NextResponse.json(
            { ok: false, error: messagesError.message },
            { status: 500 },
        );
    }

    const messagesBySession = new Map<string, AssistantChatMessage[]>();

    for (const row of messageRows ?? []) {
        const current = messagesBySession.get(row.session_id) ?? [];

        if (current.length >= MAX_MESSAGES_PER_SESSION) continue;

        current.push({
            id: row.id,
            role: row.role === "assistant" ? "assistant" : "user",
            content: row.content,
            cards: normalizeCards(row.cards),
            created_at: row.created_at,
        });
        messagesBySession.set(row.session_id, current);
    }

    const sessions: AssistantChatSession[] = (sessionRows ?? []).map(
        (session) => ({
            id: session.id,
            title: session.title,
            messages: messagesBySession.get(session.id) ?? [],
            created_at: session.created_at,
            updated_at: session.updated_at,
        }),
    );

    return NextResponse.json({
        ok: true,
        sessions,
    });
}

export async function POST(request: Request) {
    const access = await getServerTabAccess("assistente");

    if (!access.ok) {
        return NextResponse.json(
            { ok: false, error: access.error },
            { status: access.status },
        );
    }

    let body: {
        session?: AssistantChatSession;
        message?: AssistantChatMessage;
    };

    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { ok: false, error: "Corpo inválido." },
            { status: 400 },
        );
    }

    const session = body.session;
    const message = body.message;

    if (
        !session ||
        !message ||
        !isUuid(session.id) ||
        !isUuid(message.id) ||
        !session.title.trim() ||
        !message.content.trim() ||
        !["user", "assistant"].includes(message.role)
    ) {
        return NextResponse.json(
            { ok: false, error: "Dados do chat inválidos." },
            { status: 400 },
        );
    }

    const { data: existingSession, error: existingSessionError } =
        await supabase
            .from("assistant_chat_sessions")
            .select("id, auth_user_id")
            .eq("id", session.id)
            .maybeSingle();

    if (existingSessionError) {
        return NextResponse.json(
            { ok: false, error: existingSessionError.message },
            { status: 500 },
        );
    }

    if (
        existingSession &&
        existingSession.auth_user_id !== access.user.id
    ) {
        return NextResponse.json(
            { ok: false, error: "Chat não encontrado." },
            { status: 404 },
        );
    }

    if (!existingSession) {
        const { error: insertSessionError } = await supabase
            .from("assistant_chat_sessions")
            .insert({
                id: session.id,
                auth_user_id: access.user.id,
                title: session.title.trim().slice(0, 120),
                created_at: session.created_at,
                updated_at: session.updated_at,
            });

        if (insertSessionError) {
            return NextResponse.json(
                { ok: false, error: insertSessionError.message },
                { status: 500 },
            );
        }
    } else {
        const { error: updateSessionError } = await supabase
            .from("assistant_chat_sessions")
            .update({
                title: session.title.trim().slice(0, 120),
                updated_at: session.updated_at,
            })
            .eq("id", session.id)
            .eq("auth_user_id", access.user.id);

        if (updateSessionError) {
            return NextResponse.json(
                { ok: false, error: updateSessionError.message },
                { status: 500 },
            );
        }
    }

    const { error: messageError } = await supabase
        .from("assistant_chat_messages")
        .upsert(
            {
                id: message.id,
                session_id: session.id,
                role: message.role,
                content: message.content.slice(0, 100_000),
                cards: normalizeCards(message.cards),
                created_at: message.created_at,
            },
            { onConflict: "id" },
        );

    if (messageError) {
        return NextResponse.json(
            { ok: false, error: messageError.message },
            { status: 500 },
        );
    }

    return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
    const access = await getServerTabAccess("assistente");

    if (!access.ok) {
        return NextResponse.json(
            { ok: false, error: access.error },
            { status: access.status },
        );
    }

    let body: { session_id?: string };

    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { ok: false, error: "Corpo inválido." },
            { status: 400 },
        );
    }

    if (!body.session_id || !isUuid(body.session_id)) {
        return NextResponse.json(
            { ok: false, error: "session_id inválido." },
            { status: 400 },
        );
    }

    const { error } = await supabase
        .from("assistant_chat_sessions")
        .delete()
        .eq("id", body.session_id)
        .eq("auth_user_id", access.user.id);

    if (error) {
        return NextResponse.json(
            { ok: false, error: error.message },
            { status: 500 },
        );
    }

    return NextResponse.json({ ok: true });
}

function normalizeCards(value: unknown): AssistantCard[] {
    return Array.isArray(value) ? (value as AssistantCard[]) : [];
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}
