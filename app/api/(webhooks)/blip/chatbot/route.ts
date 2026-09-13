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

const INITIAL_CHATBOT_MESSAGE = "__initial__";
const INITIAL_PROMPT_MESSAGE =
    "Olá sou a Assistente Virtual da Engravida! 😊 Nosso time técnico está fora do horário de atendimento, mas posso adiantar seu atendimento agora. Sobre qual assunto você quer falar?";
const PRICE_DISCLAIMER =
    "Consulte e confirme os valores mencionados com nosso time no horário de atendimento.";

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

    const stage = normalizeChatbotStage(parsed.data.stage);
    const isInitialPrompt = parsed.data.message === INITIAL_CHATBOT_MESSAGE;

    if (!isInitialPrompt && isEndConversationRequest(parsed.data.message)) {
        return NextResponse.json(buildEndConversationResponse(stage), {
            headers: { "Cache-Control": "no-store" },
        });
    }

    const response = await routeOutOfHoursChatbot({
        message: isInitialPrompt
            ? "menu"
            : normalizeMessageForRouting(parsed.data.message, stage),
        stage,
        signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(25_000),
        ]),
    });

    const normalizedResponse = isInitialPrompt
        ? buildInitialPromptResponse(response)
        : response.action === "queue_human" && response.route !== "deterministic"
          ? buildContinueConversationResponse(response)
          : response;
    const finalResponse = normalizedResponse.ai_used
        ? addAiEmoji(normalizedResponse)
        : normalizedResponse;
    const responseWithPriceDisclaimer = addPriceDisclaimer(finalResponse);

    return NextResponse.json(responseWithPriceDisclaimer, {
        headers: { "Cache-Control": "no-store" },
    });
}

function buildInitialPromptResponse<
    T extends { blip_message: { content: string } },
>(response: T) {
    return {
        ...response,
        reply: INITIAL_PROMPT_MESSAGE,
        initial_prompt: true,
        blip_message: {
            ...response.blip_message,
            content: INITIAL_PROMPT_MESSAGE,
        },
    };
}

function buildContinueConversationResponse(
    response: Awaited<ReturnType<typeof routeOutOfHoursChatbot>>,
) {
    const baseReply = stripHandoffMessage(response.reply);
    const isMenuStage = response.stage === "menu";
    const reply = [
        baseReply,
        isMenuStage
            ? "Você pode explicar de outra forma ou escolher uma das opções abaixo."
            : "Posso te ajudar a agendar uma consulta com um especialista. Quer agendar?",
    ]
        .filter(Boolean)
        .join("\n\n");
    const options = isMenuStage
        ? [
              { id: "topic:lgbtqia", label: "Casais LGBTQIA+" },
              { id: "topic:laqueadura", label: "Laqueadura" },
              { id: "topic:infertilidade", label: "Não consigo engravidar" },
              { id: "topic:congelamento", label: "Congelamento de óvulos" },
              { id: "topic:other", label: "Outra dúvida" },
          ]
        : [
              { id: "common:schedule", label: "Sim, quero agendar" },
              { id: "common:other", label: "Outra dúvida" },
          ];

    return {
        ...response,
        action: "reply" as const,
        reply,
        options,
        has_options: true,
        blip_message: {
            type: "text/plain" as const,
            content: reply,
        },
        blip_menu_content: {
            text: "Escolha uma opção ou escreva sua dúvida:",
            options: options.map((option, index) => ({
                text: option.label,
                previewText: option.label,
                value: option.id,
                index,
                type: "text/plain" as const,
            })),
            limitMenu: false as const,
        },
    };
}

function buildEndConversationResponse(stage: string) {
    const reply = "Certo! 😊";

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

function stripHandoffMessage(reply: string) {
    return reply
        .replace(
            /\n\nVou encaminhar sua conversa para nosso time continuar o atendimento assim que estiver disponível\.?$/i,
            "",
        )
        .replace(
            /\n\nNosso time continuará o atendimento assim que estiver disponível\.?$/i,
            "",
        )
        .trim();
}

function normalizeMessageForRouting(message: string, stage: string) {
    const normalized = normalizeMessage(message);

    if (
        stage === "infertilidade" &&
        /^(nao sei|nao sei ainda|ainda nao sei|nao sabemos|nao sabemos ainda|ainda nao sabemos|nao conheco|nao conheco a causa|nao conhecemos|nao conhecemos a causa)$/.test(
            normalized,
        )
    ) {
        return "Ainda não sei";
    }

    return message;
}

function normalizeMessage(message: string) {
    return message
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[!?.,;:]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
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

function addPriceDisclaimer<
    T extends { reply: string; blip_message: { content: string } },
>(response: T) {
    if (!/(?:R\$|\breais\b)/iu.test(response.reply)) {
        return response;
    }

    const reply = `${response.reply}\n\n${PRICE_DISCLAIMER}`;

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
    const normalized = normalizeMessage(message);

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
