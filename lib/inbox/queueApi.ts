// lib/inbox/queueApi.ts
export type InboxQueueCountResponse = {
    ok: true;
    count: number;
};

export type ClaimInboxConversationResponse = {
    ok: true;
    thread_id: string | null;
    count: number;
};

export async function fetchInboxQueueCount() {
    const response = await fetch("/api/inbox/queue", {
        credentials: "include",
        cache: "no-store",
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to load inbox queue");
    }

    return json as InboxQueueCountResponse;
}

export async function claimNextInboxConversation() {
    const response = await fetch("/api/inbox/queue", {
        method: "POST",
        credentials: "include",
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to claim inbox conversation");
    }

    return json as ClaimInboxConversationResponse;
}
