// lib/inbox/inboxApi.ts
import type {
    ClientNote,
    InboxHistoryResponse,
    InboxItemType,
    InboxMessage,
    InboxNote,
    InboxStatus,
    InboxThreadDetailResponse,
    InboxThreadListItem,
    InboxThreadsResponse,
} from "@/types/inbox";

export const INBOX_THREAD_CACHE_CHANGED_EVENT =
    "inbox-thread-cache-changed";

const OPTIMISTIC_CACHE_TTL_MS = 5_000;

type AddClientNoteResponse = {
    ok: boolean;
    note: ClientNote;
};

type OptimisticAddClientNoteResponse = {
    ok: true;
    optimistic: true;
};

type PersistedInboxMessageRow = {
    id: string;
    sender_type?: string | null;
    sender_name?: string | null;
    text?: string | null;
    sent_at?: string | null;
    sequence_index?: number | null;
};

type SendInboxMessageResponse = {
    ok: true;
    message: PersistedInboxMessageRow | null;
    thread_id: string;
    reopened: boolean;
    persisted?: boolean;
    blip_message_id?: string;
};

type FinalizeInboxThreadResponse = {
    ok: true;
    conversation_id: string | null;
};

type ThreadListCacheEntry = {
    response: InboxThreadsResponse;
    freshUntil: number;
};

type ThreadListOptimisticSnapshot = {
    cacheKey: string;
    item: InboxThreadListItem;
};

type OptimisticMessageContext = {
    cacheKey: string;
    optimisticId: string;
    threadId: string;
    previousDetail: InboxThreadDetailResponse | null;
    listSnapshots: ThreadListOptimisticSnapshot[];
};

const threadDetailCache = new Map<string, InboxThreadDetailResponse>();
const threadDetailFreshUntil = new Map<string, number>();
const threadListCache = new Map<string, ThreadListCacheEntry>();
const pendingNoteIdsByThread = new Map<string, Set<string>>();
const pendingMessageIdsByThread = new Map<string, Set<string>>();

function getDetailCacheKey(itemId: string, itemType: InboxItemType) {
    return `${itemType}:${itemId}`;
}

function getThreadListCacheKey(params: URLSearchParams) {
    return params.toString();
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

    const cacheKey = getThreadListCacheKey(params);
    const cached = threadListCache.get(cacheKey);

    if (cached && cached.freshUntil > Date.now()) {
        return cloneThreadsResponse(cached.response);
    }

    const response = await fetch(`/api/inbox/threads?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
    });
    const json = await response.json();

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to load inbox items");
    }

    const threadsResponse = json as InboxThreadsResponse;

    threadListCache.set(cacheKey, {
        response: threadsResponse,
        freshUntil: 0,
    });

    return cloneThreadsResponse(threadsResponse);
}

export async function fetchInboxThread(
    itemId: string,
    itemType: InboxItemType = "thread",
) {
    const cacheKey = getDetailCacheKey(itemId, itemType);
    const cachedThread = threadDetailCache.get(cacheKey);
    const cachedThreadId = cachedThread?.item.thread_id ?? null;
    const freshUntil = threadDetailFreshUntil.get(cacheKey) ?? 0;

    if (
        cachedThread &&
        ((cachedThreadId && hasPendingNotes(cachedThreadId)) ||
            (cachedThreadId && hasPendingMessages(cachedThreadId)) ||
            freshUntil > Date.now())
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
    threadDetailFreshUntil.delete(cacheKey);

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
    const normalizedText = text.trim();

    if (!normalizedText) {
        throw new Error("Failed to send empty message");
    }

    const optimisticContext = addOptimisticMessage({
        itemId,
        itemType,
        text: normalizedText,
    });

    try {
        const response = await fetch(`/api/inbox/threads/${itemId}/messages`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                text: normalizedText,
                item_type: itemType,
            }),
        });

        const json = await response.json();

        if (!response.ok) {
            throw new Error(json.error ?? "Failed to send message");
        }

        const result = json as SendInboxMessageResponse;

        if (result.reopened) {
            finishOptimisticMessage(optimisticContext, {
                invalidate: true,
            });
            return result;
        }

        confirmOptimisticMessage(optimisticContext, result.message);
        finishOptimisticMessage(optimisticContext);

        return result;
    } catch (error) {
        rollbackOptimisticMessage(optimisticContext);
        throw error;
    }
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

export function isInboxOptimisticSendPending(
    threadId: string | null | undefined,
) {
    if (!threadId) return false;
    return (pendingMessageIdsByThread.get(threadId)?.size ?? 0) > 0;
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

function addOptimisticMessage({
    itemId,
    itemType,
    text,
}: {
    itemId: string;
    itemType: InboxItemType;
    text: string;
}): OptimisticMessageContext {
    const cacheKey = getDetailCacheKey(itemId, itemType);
    const cachedThread = threadDetailCache.get(cacheKey) ?? null;
    const previousDetail = cachedThread
        ? cloneThreadResponse(cachedThread)
        : null;
    const optimisticId = createOptimisticMessageId();
    const sentAt = new Date().toISOString();
    const threadId = cachedThread?.item.thread_id ?? itemId;

    if (cachedThread) {
        const lastSequenceIndex = cachedThread.item.messages.reduce(
            (highest, message) =>
                Math.max(highest, message.sequence_index ?? -1),
            -1,
        );

        const optimisticMessage: InboxMessage = {
            id: optimisticId,
            from: "attendant",
            sender_type: "attendant",
            sender_name: cachedThread.item.responsible ?? "Atendente",
            text,
            time: formatMessageTime(sentAt),
            sent_at: sentAt,
            sequence_index: lastSequenceIndex + 1,
        };

        replaceCachedThread(cacheKey, {
            ...cachedThread,
            item: {
                ...cachedThread.item,
                preview: text,
                time: "agora",
                lastContact: "agora",
                messages: [...cachedThread.item.messages, optimisticMessage],
            },
        });

        threadDetailFreshUntil.set(
            cacheKey,
            Date.now() + OPTIMISTIC_CACHE_TTL_MS,
        );
    }

    const listSnapshots = updateCachedThreadListsOptimistically(itemId, text);

    markMessagePending(threadId, optimisticId);
    notifyThreadCacheChanged(threadId);

    return {
        cacheKey,
        optimisticId,
        threadId,
        previousDetail,
        listSnapshots,
    };
}

function confirmOptimisticMessage(
    context: OptimisticMessageContext,
    savedMessage: PersistedInboxMessageRow | null,
) {
    const cachedThread = threadDetailCache.get(context.cacheKey);
    if (!cachedThread) return;

    const messages = cachedThread.item.messages.map((message) => {
        if (message.id !== context.optimisticId || !savedMessage) {
            return message;
        }

        const sentAt = savedMessage.sent_at ?? message.sent_at;

        return {
            ...message,
            id: savedMessage.id,
            sender_name: savedMessage.sender_name ?? message.sender_name,
            text: savedMessage.text ?? message.text,
            sent_at: sentAt,
            time: formatMessageTime(sentAt),
            sequence_index:
                savedMessage.sequence_index ?? message.sequence_index ?? null,
        } satisfies InboxMessage;
    });

    replaceCachedThread(context.cacheKey, {
        ...cachedThread,
        item: {
            ...cachedThread.item,
            messages,
        },
    });

    threadDetailFreshUntil.set(
        context.cacheKey,
        Date.now() + OPTIMISTIC_CACHE_TTL_MS,
    );
}

function finishOptimisticMessage(
    context: OptimisticMessageContext,
    { invalidate = false }: { invalidate?: boolean } = {},
) {
    unmarkMessagePending(context.threadId, context.optimisticId);

    if (invalidate) {
        threadDetailFreshUntil.delete(context.cacheKey);
        invalidateThreadListFreshness(context.listSnapshots);
    } else {
        threadDetailFreshUntil.set(
            context.cacheKey,
            Date.now() + OPTIMISTIC_CACHE_TTL_MS,
        );
        extendThreadListFreshness(context.listSnapshots);
    }

    notifyThreadCacheChanged(context.threadId);
}

function rollbackOptimisticMessage(context: OptimisticMessageContext) {
    unmarkMessagePending(context.threadId, context.optimisticId);

    if (context.previousDetail) {
        replaceCachedThread(context.cacheKey, context.previousDetail);
        threadDetailFreshUntil.set(
            context.cacheKey,
            Date.now() + OPTIMISTIC_CACHE_TTL_MS,
        );
    } else {
        threadDetailCache.delete(context.cacheKey);
        threadDetailFreshUntil.delete(context.cacheKey);
    }

    restoreCachedThreadLists(context.listSnapshots);
    notifyThreadCacheChanged(context.threadId);
}

function updateCachedThreadListsOptimistically(
    itemId: string,
    text: string,
): ThreadListOptimisticSnapshot[] {
    const snapshots: ThreadListOptimisticSnapshot[] = [];
    const freshUntil = Date.now() + OPTIMISTIC_CACHE_TTL_MS;

    for (const [cacheKey, entry] of threadListCache.entries()) {
        const existingItem = entry.response.items.find(
            (item) => item.id === itemId,
        );

        if (!existingItem) continue;

        snapshots.push({
            cacheKey,
            item: { ...existingItem },
        });

        threadListCache.set(cacheKey, {
            response: {
                ...entry.response,
                items: entry.response.items.map((item) =>
                    item.id === itemId
                        ? {
                              ...item,
                              preview: text,
                              time: "agora",
                              lastContact: "agora",
                          }
                        : item,
                ),
            },
            freshUntil,
        });
    }

    return snapshots;
}

function restoreCachedThreadLists(
    snapshots: ThreadListOptimisticSnapshot[],
) {
    for (const snapshot of snapshots) {
        const entry = threadListCache.get(snapshot.cacheKey);
        if (!entry) continue;

        threadListCache.set(snapshot.cacheKey, {
            response: {
                ...entry.response,
                items: entry.response.items.map((item) =>
                    item.id === snapshot.item.id
                        ? { ...snapshot.item }
                        : item,
                ),
            },
            freshUntil: Date.now() + OPTIMISTIC_CACHE_TTL_MS,
        });
    }
}

function extendThreadListFreshness(
    snapshots: ThreadListOptimisticSnapshot[],
) {
    const freshUntil = Date.now() + OPTIMISTIC_CACHE_TTL_MS;

    for (const snapshot of snapshots) {
        const entry = threadListCache.get(snapshot.cacheKey);
        if (!entry) continue;

        threadListCache.set(snapshot.cacheKey, {
            ...entry,
            freshUntil,
        });
    }
}

function invalidateThreadListFreshness(
    snapshots: ThreadListOptimisticSnapshot[],
) {
    for (const snapshot of snapshots) {
        const entry = threadListCache.get(snapshot.cacheKey);
        if (!entry) continue;

        threadListCache.set(snapshot.cacheKey, {
            ...entry,
            freshUntil: 0,
        });
    }
}

function cloneThreadsResponse(
    response: InboxThreadsResponse,
): InboxThreadsResponse {
    return {
        ...response,
        items: response.items.map((item) => ({ ...item })),
    };
}

function cloneThreadResponse(
    response: InboxThreadDetailResponse,
): InboxThreadDetailResponse {
    return {
        ...response,
        item: {
            ...response.item,
            messages: response.item.messages.map((message) => ({ ...message })),
            notes: response.item.notes.map((note) => ({ ...note })),
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

function markMessagePending(threadId: string, messageId: string) {
    const pendingIds =
        pendingMessageIdsByThread.get(threadId) ?? new Set<string>();

    pendingIds.add(messageId);
    pendingMessageIdsByThread.set(threadId, pendingIds);
}

function unmarkMessagePending(threadId: string, messageId: string) {
    const pendingIds = pendingMessageIdsByThread.get(threadId);

    if (!pendingIds) return;

    pendingIds.delete(messageId);

    if (pendingIds.size === 0) {
        pendingMessageIdsByThread.delete(threadId);
    }
}

function hasPendingMessages(threadId: string) {
    return (pendingMessageIdsByThread.get(threadId)?.size ?? 0) > 0;
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

function createOptimisticMessageId() {
    const randomId = globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return `optimistic-message-${randomId}`;
}

function formatMessageTime(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}
