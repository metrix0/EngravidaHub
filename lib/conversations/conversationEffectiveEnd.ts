// lib/conversations/conversationEffectiveEnd.ts
import type { Message } from "@/types";

const MINIMUM_TRAILING_BOT_GAP_MS = 15 * 60 * 1000;

export function getConversationEffectiveEndMessage<T extends Pick<Message, "sender_type" | "sent_at">>(
    messages: T[],
): T {
    const last = messages.at(-1);
    if (!last) throw new Error("Cannot determine the end of an empty conversation");

    const previous = messages.at(-2);
    if (
        last.sender_type === "bot" &&
        previous?.sender_type === "attendant" &&
        timestamp(last.sent_at) - timestamp(previous.sent_at) >= MINIMUM_TRAILING_BOT_GAP_MS
    ) {
        return previous;
    }

    return last;
}

function timestamp(value: string) {
    const result = new Date(value).getTime();
    return Number.isFinite(result) ? result : 0;
}
