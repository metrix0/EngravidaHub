// lib/analysis/conversationEligibility.ts
import type { Message } from "@/types";

type AnalysisMessage = Pick<Message, "sender_type" | "text">;

export function filterAnalyzableMessages<T extends AnalysisMessage>(messages: T[]) {
    return messages.filter(
        (message) => !isInvisibleBlipControlText(message.text),
    );
}

export function getConversationAnalysisIneligibility(
    messages: AnalysisMessage[],
) {
    if (messages.length === 0) {
        return "Conversation is not eligible for analysis: no analyzable messages";
    }

    const hasClient = messages.some((message) => message.sender_type === "client");
    const hasAttendant = messages.some(
        (message) => message.sender_type === "attendant",
    );

    if (!hasClient && !hasAttendant) {
        return "Conversation is not eligible for analysis: no client or human attendant messages";
    }
    if (!hasClient) {
        return "Conversation is not eligible for analysis: no client messages";
    }
    if (!hasAttendant) {
        return "Conversation is not eligible for analysis: no human attendant messages";
    }

    return null;
}

function isInvisibleBlipControlText(value: string) {
    return /^\[Mensagem preservada:\s*(?:application\/vnd\.iris\.ticket\+json|application\/json)\]$/i.test(
        value.trim(),
    );
}
