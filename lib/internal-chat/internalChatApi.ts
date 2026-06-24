// lib/internal-chat/internalChatApi.ts
import type {
    InternalChatUser,
    InternalConversationDetail,
    InternalConversationSummary,
    InternalMessage,
} from "@/types/internalChat";

export async function heartbeatInternalPresence() {
    const response = await fetch("/api/internal-chat/presence", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
    });

    if (!response.ok) {
        const json = await safeJson(response);
        throw new Error(json?.error ?? "Failed to update presence");
    }
}

export async function fetchInternalUsers() {
    const response = await fetch("/api/internal-chat/users", {
        credentials: "include",
        cache: "no-store",
    });
    const json = await safeJson(response);

    if (!response.ok) {
        throw new Error(json?.error ?? "Failed to load internal users");
    }

    return (json?.users ?? []) as InternalChatUser[];
}

export async function fetchInternalConversations() {
    const response = await fetch("/api/internal-chat/conversations", {
        credentials: "include",
        cache: "no-store",
    });
    const json = await safeJson(response);

    if (!response.ok) {
        throw new Error(json?.error ?? "Failed to load internal conversations");
    }

    return (json?.conversations ?? []) as InternalConversationSummary[];
}

export async function openInternalConversation(peerUserId: string) {
    const response = await fetch("/api/internal-chat/conversations", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peer_user_id: peerUserId }),
    });
    const json = await safeJson(response);

    if (!response.ok) {
        throw new Error(json?.error ?? "Failed to open internal conversation");
    }

    return json as {
        conversation: InternalConversationDetail["conversation"];
        peer: InternalChatUser;
    };
}

export async function fetchInternalMessages(conversationId: string) {
    const response = await fetch(
        `/api/internal-chat/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
            credentials: "include",
            cache: "no-store",
        },
    );
    const json = await safeJson(response);

    if (!response.ok) {
        throw new Error(json?.error ?? "Failed to load internal messages");
    }

    return json as InternalConversationDetail;
}

export async function sendInternalMessage(
    conversationId: string,
    text: string,
) {
    const response = await fetch(
        `/api/internal-chat/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        },
    );
    const json = await safeJson(response);

    if (!response.ok) {
        throw new Error(json?.error ?? "Failed to send internal message");
    }

    return json?.message as InternalMessage;
}

export async function markInternalConversationRead(conversationId: string) {
    const response = await fetch(
        `/api/internal-chat/conversations/${encodeURIComponent(conversationId)}/read`,
        {
            method: "POST",
            credentials: "include",
            cache: "no-store",
        },
    );

    if (!response.ok) {
        const json = await safeJson(response);
        throw new Error(json?.error ?? "Failed to mark internal chat as read");
    }
}

async function safeJson(response: Response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}
