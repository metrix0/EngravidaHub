// lib/analysis/buildConversationText.ts
import type { Message } from "@/types";

export function buildConversationText(messages: Message[]): string {
    return messages
        .sort((a, b) => {
            if (a.sequence_index !== b.sequence_index) {
                return a.sequence_index - b.sequence_index;
            }

            return new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime();
        })
        .map((message) => {
            const senderLabel = getSenderLabel(message);
            const sentAt = formatDate(message.sent_at);

            return `[${sentAt}] ${senderLabel}: ${message.text}`;
        })
        .join("\n");
}

function getSenderLabel(message: Message): string {
    if (message.sender_type === "client") {
        return "Cliente";
    }

    if (message.sender_type === "attendant") {
        return message.sender_name
            ? `Atendente (${message.sender_name})`
            : "Atendente";
    }

    if (message.sender_type === "bot") {
        return "Bot";
    }

    return "Sistema";
}

function formatDate(date: string): string {
    return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
    }).format(new Date(date));
}
