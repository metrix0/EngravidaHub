// lib/inbox/inboxApi.ts
import type {
    InboxStatus,
    InboxThreadDetailResponse,
    InboxThreadsResponse,
} from "@/types/inbox";

export async function fetchInboxThreads({
                                            status,
                                            search,
                                            page,
                                            pageSize,
                                        }: {
    status: InboxStatus;
    search: string;
    page: number;
    pageSize: number;
}) {
    const params = new URLSearchParams();

    params.set("status", status);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));

    if (search.trim()) {
        params.set("search", search.trim());
    }

    const response = await fetch(`/api/inbox/threads?${params.toString()}`);
    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to load inbox threads");
    }

    return json as InboxThreadsResponse;
}

export async function fetchInboxThread(threadId: string) {
    const response = await fetch(`/api/inbox/threads/${threadId}`);
    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to load inbox thread");
    }

    return json as InboxThreadDetailResponse;
}

export async function sendInboxMessage({
                                           threadId,
                                           text,
                                       }: {
    threadId: string;
    text: string;
}) {
    const response = await fetch(`/api/inbox/threads/${threadId}/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to send message");
    }

    return json;
}

export async function addClientNote({
                                        threadId,
                                        text,
                                        authorName,
                                    }: {
    threadId: string;
    text: string;
    authorName?: string;
}) {
    const response = await fetch(`/api/inbox/threads/${threadId}/notes`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            text,
            author_name: authorName,
        }),
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to add note");
    }

    return json;
}

export async function updateInboxThread({
                                            threadId,
                                            status,
                                            read,
                                            stageAction,
                                            pipelineStageId,
                                        }: {
    threadId: string;
    status?: InboxStatus;
    read?: boolean;
    stageAction?: "previous" | "next";
    pipelineStageId?: string;
}) {
    const response = await fetch(`/api/inbox/threads/${threadId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            status,
            read,
            stage_action: stageAction,
            pipeline_stage_id: pipelineStageId,
        }),
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to update thread");
    }

    return json;
}
