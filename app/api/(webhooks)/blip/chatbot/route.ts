// app/api/(webhooks)/blip/chatbot/route.ts
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
    normalizeChatbotStage,
    routeOutOfHoursChatbot,
} from "@/lib/chatbot/outOfHoursChatbot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const requestSchema = z
    .object({
        message: z.string().trim().min(1).max(2_000),
        stage: z.string().trim().max(40).optional().nullable(),
        phone: z.string().trim().max(40).optional().nullable(),
    })
    .strict();

const END_CONVERSATION_MESSAGE =
    "Estamos encerrando a conversa! Se desejar, pode entrar em contato conosco novamente quando quiser!";

export async function POST(request: Request) {
    const expectedSecret = process.env.BLIP_CHATBOT_WEBHOOK_SECRET?.trim();
    const receivedSecret = request.headers.get("x-chatbot-secret")?.trim();

    if (!expectedSecret) {
        return NextResponse.json(
            { ok: false, error: "Chatbot webhook is not configured" },
            { status: 503 },
        );
    }

    if (!receivedSecret || !secretsMatch(receivedSecret, expectedSecret)) {
        return NextResponse.json(
            { ok: false, error: "Invalid chatbot secret" },
            { status: 401 },
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
            {
                ok: false,
                error: "Invalid chatbot payload",
                issues: parsed.error.issues,
            },
            { status: 400 },
        );
    }

    const phone = (parsed.data.phone ?? "").replace(/\D/g, "");
    if (phone !== "19988760900" && phone !== "5519988760900") {
        return NextResponse.json(
            { ok: true, action: "continue_flow" },
            { headers: { "Cache-Control": "no-store" } },
        );
    }

    const stage = normalizeChatbotStage(parsed.data.stage);
    if (isEndConversationRequest(parsed.data.message)) {
        return NextResponse.json(buildEndConversationResponse(stage), {
            headers: { "Cache-Control": "no-store" },
        });
    }

    const response = await routeOutOfHoursChatbot({
        message: parsed.data.message,
        stage,
        signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(25_000),
        ]),
    });

    const normalizedResponse =
        response.action === "queue_human" && response.route !== "deterministic"
            ? buildEndConversationResponse(stage, response.reply)
            : response.ai_used
              ? addAiEmoji(response)
              : response;

    return NextResponse.json(normalizedResponse, {
        headers: { "Cache-Control": "no-store" },
    });
}

function buildEndConversationResponse(stage: string, previousReply?: string) {
    const replyWithoutHandoff = (previousReply ?? "")
        .replace(
            /\n\nVou encaminhar sua conversa para nosso time continuar o atendimento assim que estiver disponível\.?$/i,
            "",
        )
        .replace(
            /\n\nNosso time continuará o atendimento assim que estiver disponível\.?$/i,
            "",
        )
        .trim();
    const reply = [replyWithoutHandoff, END_CONVERSATION_MESSAGE]
        .filter(Boolean)
        .join("\n\n");

    return {
        ok: true as const,
        action: "end_conversation" as const,
        route: "deterministic" as const,
        stage,
        reply,
        options: [],
        has_options: false,
        ai_used: false,
        knowledge_ids: [],
        blip_message: {
            type: "text/plain" as const,
            content: reply,
        },
        blip_menu_content: null,
    };
}

function addAiEmoji<T extends { reply: string; blip_message: { content: string } }>(
    response: T,
) {
    const reply = /[✨💙😊📌💬]/u.test(response.reply)
        ? response.reply
        : `✨ ${response.reply}`;

    return {
        ...response,
        reply,
        blip_message: {
            ...response.blip_message,
            content: reply,
        },
    };
}

function isEndConversationRequest(message: string) {
    const normalized = message
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[!?.,;:]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return /\b(encerrar|encerra|encerro|encerrar conversa|finalizar|finaliza|finalizar atendimento|tchau|ate mais|pode encerrar|pode finalizar|quero sair|sair)\b/.test(
        normalized,
    );
}

function secretsMatch(received: string, expected: string) {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    return (
        receivedBuffer.length === expectedBuffer.length &&
        timingSafeEqual(receivedBuffer, expectedBuffer)
    );
}
