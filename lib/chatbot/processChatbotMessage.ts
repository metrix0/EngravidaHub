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
    loadChatbotConversationState,
    resetChatbotConversationState,
    saveChatbotConversationState,
} from "@/lib/chatbot/conversationState";
import {
    handleChatbotScheduling,
    hasActiveChatbotSchedulingSession,
    resetChatbotSchedulingSession,
    startChatbotScheduling,
} from "@/lib/chatbot/scheduling";

export const INITIAL_CHATBOT_MESSAGE = "__initial__";

const INITIAL_PROMPT_MESSAGE =
    "Olá sou a Assistente Virtual da Engravida! 😊 Nosso time técnico está fora do horário de atendimento, mas posso adiantar seu atendimento agora. Sobre qual assunto você quer falar?";

type ProcessedChatbotReply = Omit<OutOfHoursChatbotReply, "action"> & {
    action: OutOfHoursChatbotReply["action"] | "end_conversation";
} & Record<string, unknown>;

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
}): Promise<ProcessedChatbotReply> {
    const stage = normalizeChatbotStage(rawStage);
    const isInitialPrompt = message === INITIAL_CHATBOT_MESSAGE;
    const conversationState = await loadChatbotConversationState(sessionKey);

    if (isInitialPrompt) {
        if (sessionKey) {
            await Promise.all([
                resetChatbotSchedulingSession(sessionKey),
                resetChatbotConversationState(sessionKey),
            ]);
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
            await Promise.all([
                resetChatbotSchedulingSession(sessionKey),
                resetChatbotConversationState(sessionKey),
            ]);
        }
        return buildEndConversationResponse(stage);
    }

    if (conversationState.awaiting_schedule_interest) {
        if (isPositiveScheduleResponse(message)) {
            await saveChatbotConversationState(sessionKey, {
                clarification_pending: false,
                awaiting_schedule_interest: false,
            });

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

        if (isNegativeScheduleResponse(message)) {
            await saveChatbotConversationState(sessionKey, {
                clarification_pending: false,
                awaiting_schedule_interest: false,
            });
            return buildScheduleDeclinedResponse(stage);
        }

        await saveChatbotConversationState(sessionKey, {
            clarification_pending: false,
            awaiting_schedule_interest: false,
        });
    }

    if (sessionKey && (await hasActiveChatbotSchedulingSession(sessionKey))) {
        const schedulingResponse = await handleChatbotScheduling({
            sessionKey,
            message,
        });
        if (schedulingResponse) return schedulingResponse;
    }

    if (isSchedulingIntent(message)) {
        await saveChatbotConversationState(sessionKey, {
            clarification_pending: false,
            awaiting_schedule_interest: false,
        });

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

    if (
        response.action === "queue_human" &&
        response.route !== "deterministic"
    ) {
        if (response.handoff_reason === "technical") {
            await saveChatbotConversationState(sessionKey, {
                clarification_pending: false,
                awaiting_schedule_interest: false,
            });
            return response.ai_used ? addAiEmoji(response) : response;
        }

        if (conversationState.clarification_pending) {
            await saveChatbotConversationState(sessionKey, {
                clarification_pending: false,
                awaiting_schedule_interest: false,
            });
            return buildUnresolvedHandoffResponse(stage);
        }

        await saveChatbotConversationState(sessionKey, {
            clarification_pending: true,
            awaiting_schedule_interest: false,
        });
        return buildClarificationResponse(stage);
    }

    const awaitingScheduleInterest = /tem interesse em agendar uma consulta\?/iu.test(
        response.reply,
    );
    await saveChatbotConversationState(sessionKey, {
        clarification_pending: false,
        awaiting_schedule_interest: awaitingScheduleInterest,
    });

    return response.ai_used ? addAiEmoji(response) : response;
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

function buildClarificationResponse(stage: ChatbotStage) {
    return buildChatbotReply({
        action: "reply",
        route: "fallback",
        stage,
        reply: "Não entendi bem. Você pode me explicar de outra forma?",
        options: [],
    });
}

function buildUnresolvedHandoffResponse(stage: ChatbotStage) {
    return buildChatbotReply({
        action: "queue_human",
        route: "fallback",
        stage,
        reply:
            "Ainda não consegui entender sua dúvida com segurança. Vou encaminhar sua conversa para nosso time continuar o atendimento assim que estiver disponível.",
        options: [],
    });
}

function buildScheduleDeclinedResponse(stage: ChatbotStage) {
    return buildChatbotReply({
        action: "show_menu",
        route: "deterministic",
        stage,
        reply: "Tudo bem 😊 Se quiser, posso tirar outra dúvida.",
        options:
            stage === "menu"
                ? [{ id: "common:menu", label: "Voltar ao menu" }]
                : [
                      { id: "common:other", label: "Outra dúvida" },
                      { id: "common:menu", label: "Voltar ao menu" },
                  ],
    });
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

function isPositiveScheduleResponse(message: string) {
    const normalized = normalizeMessage(message);
    return /^(sim|sim quero|quero|tenho interesse|tenho sim|pode ser|claro|gostaria|vamos|bora|quero agendar|quero marcar)$/.test(
        normalized,
    );
}

function isNegativeScheduleResponse(message: string) {
    const normalized = normalizeMessage(message);
    return /^(nao|acho que nao|agora nao|nao agora|nao quero|nao tenho interesse|sem interesse|prefiro nao|talvez depois|melhor nao)$/.test(
        normalized,
    );
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
