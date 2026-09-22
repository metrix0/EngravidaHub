// app/api/dev/chatbot/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { resetChatbotConversationState } from "@/lib/chatbot/conversationState";
import {
    INITIAL_CHATBOT_MESSAGE,
    processChatbotMessage,
} from "@/lib/chatbot/processChatbotMessage";
import { resetChatbotSchedulingSession } from "@/lib/chatbot/scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const requestSchema = z
    .object({
        message: z.string().trim().min(1).max(2_000),
        stage: z.string().trim().max(40).optional().nullable(),
        phone: z.string().trim().max(40).optional().nullable(),
        session_id: z.string().trim().min(8).max(100),
    })
    .strict();

const resetSchema = z
    .object({
        session_id: z.string().trim().min(8).max(100),
    })
    .strict();

export async function POST(request: Request) {
    const access = await getServerTabAccess("usuarios");
    if (access.ok === false) {
        return NextResponse.json(
            { ok: false, error: access.error },
            { status: access.status },
        );
    }

    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json(
            { ok: false, error: "Invalid JSON payload" },
            { status: 400 },
        );
    }

    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) {
        return NextResponse.json(
            { ok: false, error: "Invalid dev chatbot payload", issues: parsed.error.issues },
            { status: 400 },
        );
    }

    try {
        const response = await processChatbotMessage({
            message: parsed.data.message || INITIAL_CHATBOT_MESSAGE,
            stage: parsed.data.stage,
            phone: parsed.data.phone,
            sessionKey: devSessionKey(parsed.data.session_id),
            signal: AbortSignal.any([
                request.signal,
                AbortSignal.timeout(25_000),
            ]),
        });

        return NextResponse.json(response, {
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        console.error("[dev-chatbot] failed", error);
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível executar o chatbot.",
            },
            { status: 500, headers: { "Cache-Control": "no-store" } },
        );
    }
}

export async function DELETE(request: Request) {
    const access = await getServerTabAccess("usuarios");
    if (access.ok === false) {
        return NextResponse.json(
            { ok: false, error: access.error },
            { status: access.status },
        );
    }

    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json(
            { ok: false, error: "Invalid JSON payload" },
            { status: 400 },
        );
    }

    const parsed = resetSchema.safeParse(payload);
    if (!parsed.success) {
        return NextResponse.json(
            { ok: false, error: "Invalid reset payload" },
            { status: 400 },
        );
    }

    const sessionKey = devSessionKey(parsed.data.session_id);
    await Promise.all([
        resetChatbotSchedulingSession(sessionKey),
        resetChatbotConversationState(sessionKey),
    ]);
    return NextResponse.json({ ok: true });
}

function devSessionKey(sessionId: string) {
    return `dev:${sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100)}`;
}
