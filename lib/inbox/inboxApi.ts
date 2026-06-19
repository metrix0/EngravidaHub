// lib/inbox/inboxApi.ts
import type {
    ClientNote,
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

const threadDetailCache = new Map<string, InboxThreadDetailResponse>();
const pendingNoteIdsByThread = new Map<string, Set<string>>();

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
    const cachedThread = threadDetailCache.get(threadId);

    if (cachedThread && hasPendingNotes(threadId)) {
        return cloneThreadResponse(cachedThread);
    }

    const response = await fetch(`/api/inbox/threads/${threadId}`);
    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to load inbox thread");
    }

    const threadResponse = json as InboxThreadDetailResponse;

    threadDetailCache.set(threadId, threadResponse);

    return cloneThreadResponse(threadResponse);
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
}): Promise<AddClientNoteResponse | OptimisticAddClientNoteResponse> {
    const normalizedText = text.trim();
    const cachedThread = threadDetailCache.get(threadId);

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

    threadDetailCache.set(threadId, {
        ...cachedThread,
        item: {
            ...cachedThread.item,
            notes: [optimisticNote, ...cachedThread.item.notes],
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
                                             status,
                                             read,
                                             stageAction,
                                             funnelStageId,
                                         }: {
    threadId: string;
    status?: InboxStatus;
    read?: boolean;
    stageAction?: "previous" | "next";
    funnelStageId?: string;
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

function replaceOptimisticNote(
    threadId: string,
    optimisticId: string,
    savedNote: InboxNote,
) {
    const cachedThread = threadDetailCache.get(threadId);

    if (!cachedThread) return;

    threadDetailCache.set(threadId, {
        ...cachedThread,
        item: {
            ...cachedThread.item,
            notes: cachedThread.item.notes.map((note) =>
                note.id === optimisticId ? savedNote : note,
            ),
        },
    });
}

function removeOptimisticNote(threadId: string, optimisticId: string) {
    const cachedThread = threadDetailCache.get(threadId);

    if (!cachedThread) return;

    threadDetailCache.set(threadId, {
        ...cachedThread,
        item: {
            ...cachedThread.item,
            notes: cachedThread.item.notes.filter(
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
