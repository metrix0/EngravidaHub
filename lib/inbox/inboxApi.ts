// lib/inbox/inboxApi.ts
import type {
    ClientNote,
    InboxHistoryResponse,
    InboxItemType,
    InboxNote,
    InboxStatus,
    InboxThreadDetailResponse,
    InboxThreadsResponse,
} from "@/types/inbox";

export const INBOX_THREAD_CACHE_CHANGED_EVENT =
    "inbox-thread-cache-changed";

type AddClientNoteResponse = {
    ok: boolean;
    note: ClientNote;
};

type OptimisticAddClientNoteResponse = {
    ok: true;
    optimistic: true;
};

type SendInboxMessageResponse = {
    ok: true;
    message: unknown;
    thread_id: string;
    reopened: boolean;
};

type FinalizeInboxThreadResponse = {
    ok: true;
    conversation_id: string | null;
};

const threadDetailCache = new Map<string, InboxThreadDetailResponse>();
const pendingNoteIdsByThread = new Map<string, Set<string>>();

function getDetailCacheKey(itemId: string, itemType: InboxItemType) {
    return `${itemType}:${itemId}`;
}

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

    const response = await fetch(`/api/inbox/threads?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
    });
    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to load inbox items");
    }

    return json as InboxThreadsResponse;
}

export async function fetchInboxThread(
    itemId: string,
    itemType: InboxItemType = "thread",
) {
    const cacheKey = getDetailCacheKey(itemId, itemType);
    const cachedThread = threadDetailCache.get(cacheKey);

    if (
        cachedThread &&
        cachedThread.item.thread_id &&
        hasPendingNotes(cachedThread.item.thread_id)
    ) {
        return cloneThreadResponse(cachedThread);
    }

    const params = new URLSearchParams({ item_type: itemType });
    const response = await fetch(
        `/api/inbox/threads/${itemId}?${params.toString()}`,
        {
            credentials: "include",
            cache: "no-store",
        },
    );
    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to load inbox item");
    }

    const threadResponse = json as InboxThreadDetailResponse;

    threadDetailCache.set(cacheKey, threadResponse);

    return cloneThreadResponse(threadResponse);
}

export async function sendInboxMessage({
    itemId,
    itemType,
    text,
}: {
    itemId: string;
    itemType: InboxItemType;
    text: string;
}) {
    const response = await fetch(`/api/inbox/threads/${itemId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            text,
            item_type: itemType,
        }),
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to send message");
    }

    return json as SendInboxMessageResponse;
}

export async function finalizeInboxThread(threadId: string) {
    const response = await fetch(
        `/api/inbox/threads/${threadId}/finalize`,
        {
            method: "POST",
            credentials: "include",
        },
    );

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to finalize conversation");
    }

    return json as FinalizeInboxThreadResponse;
}

export async function fetchPreviousInboxConversation({
    clientId,
    before,
}: {
    clientId: string;
    before: string;
}) {
    const params = new URLSearchParams({
        client_id: clientId,
        before,
    });

    const response = await fetch(`/api/inbox/history?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
    });
    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to load conversation history");
    }

    return json as InboxHistoryResponse;
}

export async function addClientNote({
    threadId,
    text,
    authorName,
}: {
    threadId: string;
    text: string;
    authorName?: string;
}): Promise<AddClientNoteResponse | OptimisticAddClientNoteResponse> {
    const normalizedText = text.trim();
    const cachedThread = findCachedThreadByThreadId(threadId);

    if (!cachedThread) {
        return persistClientNote({
            threadId,
            text: normalizedText,
            authorName,
        });
    }

    const optimisticId = createOptimisticNoteId();
    const createdAt = new Date().toISOString();

    const optimisticNote: InboxNote = {
        id: optimisticId,
        author:
            authorName ??
            cachedThread.item.responsible ??
            "Atendente",
        time: "agora",
        text: normalizedText,
        created_at: createdAt,
    };

    replaceCachedThread(cachedThread.cacheKey, {
        ...cachedThread.response,
        item: {
            ...cachedThread.response.item,
            notes: [optimisticNote, ...cachedThread.response.item.notes],
        },
    });

    markNotePending(threadId, optimisticId);

    void persistClientNote({
        threadId,
        text: normalizedText,
        authorName,
    })
        .then((result) => {
            replaceOptimisticNote(
                threadId,
                optimisticId,
                mapClientNote(result.note),
            );
        })
        .catch((error) => {
            removeOptimisticNote(threadId, optimisticId);
            console.error("[inbox] failed to persist optimistic note", error);
        })
        .finally(() => {
            unmarkNotePending(threadId, optimisticId);
            notifyThreadCacheChanged(threadId);
        });

    return {
        ok: true,
        optimistic: true,
    };
}

export async function updateInboxThread({
    threadId,
    read,
    stageAction,
    funnelStageId,
}: {
    threadId: string;
    read?: boolean;
    stageAction?: "previous" | "next";
    funnelStageId?: string;
}) {
    const response = await fetch(`/api/inbox/threads/${threadId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            read,
            stage_action: stageAction,
            funnel_stage_id: funnelStageId,
        }),
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to update thread");
    }

    return json;
}

async function persistClientNote({
    threadId,
    text,
    authorName,
}: {
    threadId: string;
    text: string;
    authorName?: string;
}): Promise<AddClientNoteResponse> {
    const response = await fetch(`/api/inbox/threads/${threadId}/notes`, {
        method: "POST",
        credentials: "include",
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

    return json as AddClientNoteResponse;
}

function cloneThreadResponse(
    response: InboxThreadDetailResponse,
): InboxThreadDetailResponse {
    return {
        ...response,
        item: {
            ...response.item,
            messages: [...response.item.messages],
            notes: [...response.item.notes],
        },
    };
}

function mapClientNote(note: ClientNote): InboxNote {
    return {
        id: note.id,
        author: note.author_name ?? "Atendente",
        time: "agora",
        text: note.text,
        created_at: note.created_at,
    };
}

function findCachedThreadByThreadId(threadId: string) {
    for (const [cacheKey, response] of threadDetailCache.entries()) {
        if (response.item.thread_id === threadId) {
            return {
                cacheKey,
                response,
                item: response.item,
            };
        }
    }

    return null;
}

function replaceCachedThread(
    cacheKey: string,
    response: InboxThreadDetailResponse,
) {
    threadDetailCache.set(cacheKey, response);
}

function replaceOptimisticNote(
    threadId: string,
    optimisticId: string,
    savedNote: InboxNote,
) {
    const cachedThread = findCachedThreadByThreadId(threadId);
    if (!cachedThread) return;

    replaceCachedThread(cachedThread.cacheKey, {
        ...cachedThread.response,
        item: {
            ...cachedThread.response.item,
            notes: cachedThread.response.item.notes.map((note) =>
                note.id === optimisticId ? savedNote : note,
            ),
        },
    });
}

function removeOptimisticNote(threadId: string, optimisticId: string) {
    const cachedThread = findCachedThreadByThreadId(threadId);
    if (!cachedThread) return;

    replaceCachedThread(cachedThread.cacheKey, {
        ...cachedThread.response,
        item: {
            ...cachedThread.response.item,
            notes: cachedThread.response.item.notes.filter(
                (note) => note.id !== optimisticId,
            ),
        },
    });
}

function markNotePending(threadId: string, noteId: string) {
    const pendingIds = pendingNoteIdsByThread.get(threadId) ?? new Set<string>();

    pendingIds.add(noteId);
    pendingNoteIdsByThread.set(threadId, pendingIds);
}

function unmarkNotePending(threadId: string, noteId: string) {
    const pendingIds = pendingNoteIdsByThread.get(threadId);

    if (!pendingIds) return;

    pendingIds.delete(noteId);

    if (pendingIds.size === 0) {
        pendingNoteIdsByThread.delete(threadId);
    }
}

function hasPendingNotes(threadId: string) {
    return (pendingNoteIdsByThread.get(threadId)?.size ?? 0) > 0;
}

function notifyThreadCacheChanged(threadId: string) {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent(INBOX_THREAD_CACHE_CHANGED_EVENT, {
            detail: { threadId },
        }),
    );
}

function createOptimisticNoteId() {
    const randomId = globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return `optimistic-note-${randomId}`;
}
