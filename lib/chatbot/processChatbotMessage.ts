// lib/chatbot/processChatbotMessage.ts
import { normalizePhoneIdentity } from "@/lib/clients/phoneIdentity";
import {
    buildChatbotReply,
    normalizeChatbotStage,
    routeOutOfHoursChatbot,
    type ChatbotStage,
    type OutOfHoursChatbotReply,
} from "@/lib/chatbot/outOfHoursChatbot";
import {
    handleChatbotScheduling,
    hasActiveChatbotSchedulingSession,
    resetChatbotSchedulingSession,
    startChatbotScheduling,
} from "@/lib/chatbot/scheduling";

export const INITIAL_CHATBOT_MESSAGE = "__initial__";

const INITIAL_PROMPT_MESSAGE =
    "Olá sou a Assistente Virtual da Engravida! 😊 Nosso time técnico está fora do horário de atendimento, mas posso adiantar seu atendimento agora. Sobre qual assunto você quer falar?";

export async function processChatbotMessage({
    message,
    stage: rawStage,
    phone,
    sessionKey,
    signal,
}: {
    message: string;
    stage?: string | null;
    phone?: string | null;
    sessionKey?: string | null;
    signal?: AbortSignal;
}): Promise<OutOfHoursChatbotReply & Record<string, unknown>> {
    const stage = normalizeChatbotStage(rawStage);
    const isInitialPrompt = message === INITIAL_CHATBOT_MESSAGE;

    if (isInitialPrompt) {
        if (sessionKey) {
            await resetChatbotSchedulingSession(sessionKey);
        }

        const response = await routeOutOfHoursChatbot({
            message: "menu",
            stage,
            signal,
        });

        return buildInitialPromptResponse(response);
    }

    if (isEndConversationRequest(message)) {
        if (sessionKey) {
            await resetChatbotSchedulingSession(sessionKey);
        }
        return buildEndConversationResponse(stage);
    }

    if (sessionKey && (await hasActiveChatbotSchedulingSession(sessionKey))) {
        const schedulingResponse = await handleChatbotScheduling({
            sessionKey,
            message,
        });
        if (schedulingResponse) return schedulingResponse;
    }

    if (isSchedulingIntent(message)) {
        if (!sessionKey) {
            return buildChatbotReply({
                action: "queue_human",
                route: "deterministic",
                stage,
                reply:
                    "Não consegui identificar seu contato para manter o agendamento com segurança. Vou encaminhar para nosso time concluir com você.",
                options: [],
            });
        }

        return startChatbotScheduling({
            sessionKey,
            phone: normalizePhoneIdentity(phone),
            topicStage: stage,
        });
    }

    const response = await routeOutOfHoursChatbot({
        message: normalizeMessageForRouting(message, stage),
        stage,
        signal,
    });

    const normalizedResponse =
        response.action === "queue_human" && response.route !== "deterministic"
            ? buildContinueConversationResponse(response)
            : response;

    return normalizedResponse.ai_used
        ? addAiEmoji(normalizedResponse)
        : normalizedResponse;
}

export function buildChatbotSessionKey(phone: string | null | undefined) {
    const identity = normalizePhoneIdentity(phone);
    return identity ? `whatsapp:${identity}` : null;
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

function buildEndConversationResponse(stage: ChatbotStage) {
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

function normalizeMessageForRouting(message: string, stage: ChatbotStage) {
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

function isSchedulingIntent(message: string) {
    const normalized = normalizeMessage(message);
    return (
        normalized === "common schedule" ||
        /\b(agendar|agendamento|marcar horario|marcar consulta|quero agendar|quero marcar)\b/.test(
            normalized,
        )
    );
}

function isEndConversationRequest(message: string) {
    const normalized = normalizeMessage(message);

    return /\b(encerrar|encerra|encerro|encerrar conversa|finalizar|finaliza|finalizar atendimento|tchau|ate mais|pode encerrar|pode finalizar|quero sair|sair)\b/.test(
        normalized,
    );
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
