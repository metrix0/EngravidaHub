// app/api/assistente/feedback/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const access = await getServerTabAccess("assistente");
    if (access.ok === false) {
        return NextResponse.json(
            { ok: false, error: access.error },
            { status: access.status },
        );
    }

    let body: { message_id?: string; rating?: "up" | "down" | null };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { ok: false, error: "Corpo inválido." },
            { status: 400 },
        );
    }

    if (!body.message_id || !isUuid(body.message_id)) {
        return NextResponse.json(
            { ok: false, error: "Mensagem inválida." },
            { status: 400 },
        );
    }
    if (body.rating !== null && !["up", "down"].includes(body.rating ?? "")) {
        return NextResponse.json(
            { ok: false, error: "Avaliação inválida." },
            { status: 400 },
        );
    }

    const { data: message, error: messageError } = await supabase
        .from("assistant_chat_messages")
        .select("id, session_id, role")
        .eq("id", body.message_id)
        .maybeSingle();
    if (messageError) {
        return NextResponse.json(
            { ok: false, error: messageError.message },
            { status: 500 },
        );
    }
    if (!message || message.role !== "assistant") {
        return NextResponse.json(
            { ok: false, error: "Resposta não encontrada." },
            { status: 404 },
        );
    }

    const { data: session, error: sessionError } = await supabase
        .from("assistant_chat_sessions")
        .select("id")
        .eq("id", message.session_id)
        .eq("auth_user_id", access.user.id)
        .maybeSingle();
    if (sessionError) {
        return NextResponse.json(
            { ok: false, error: sessionError.message },
            { status: 500 },
        );
    }
    if (!session) {
        return NextResponse.json(
            { ok: false, error: "Resposta não encontrada." },
            { status: 404 },
        );
    }

    const operation = body.rating
        ? supabase.from("assistant_message_feedback").upsert(
              {
                  assistant_message_id: message.id,
                  auth_user_id: access.user.id,
                  rating: body.rating,
                  updated_at: new Date().toISOString(),
              },
              { onConflict: "assistant_message_id" },
          )
        : supabase
              .from("assistant_message_feedback")
              .delete()
              .eq("assistant_message_id", message.id)
              .eq("auth_user_id", access.user.id);
    const { error } = await operation;

    if (error) {
        return NextResponse.json(
            { ok: false, error: error.message },
            { status: 500 },
        );
    }

    return NextResponse.json({ ok: true, rating: body.rating ?? null });
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}
