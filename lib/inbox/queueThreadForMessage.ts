// lib/inbox/queueThreadForMessage.ts
import type { SenderType } from "@/types/message";
import { supabase } from "../";

type InboxChannel = "WhatsApp" | "Instagram" | "Facebook";

type QueueThreadForMessageParams = {
    clientId?: string | null;
    instagramUserId?: string | null;
    source: string;
    channel: InboxChannel;
    senderType: SenderType;
    sentAt?: string | null;
    externalThreadId?: string | null;
    externalAccountId?: string | null;
};

type ThreadRow = {
    id: string;
    client_id: string | null;
    instagram_user_id: string | null;
    latest_conversation_id: string | null;
    assigned_attendant_id: string | null;
    status: "open" | "closed";
    last_client_message_at?: string | null;
    external_thread_id?: string | null;
    external_account_id?: string | null;
};

export async function queueThreadForMessage({
    clientId,
    instagramUserId,
    source,
    channel,
    senderType,
    sentAt,
    externalThreadId,
    externalAccountId,
}: QueueThreadForMessageParams) {
    const identity = normalizeIdentity({ clientId, instagramUserId });
    const receivedAt = normalizeSentAt(sentAt);
    const isClientMessage = senderType === "client";

    console.info("[inbox-queue] Processing message for thread", {
        client_id: identity.clientId,
        instagram_user_id: identity.instagramUserId,
        source,
        channel,
        sender_type: senderType,
        sent_at_received: sentAt ?? null,
        sent_at_normalized: receivedAt,
        will_update_24h_window: isClientMessage,
    });

    const existingThread = await findExistingThread(identity);

    if (existingThread) {
        return updateExistingThread({
            thread: existingThread,
            source,
            channel,
            senderType,
            receivedAt,
            externalThreadId,
            externalAccountId,
        });
    }

    return createThread({
        ...identity,
        source,
        channel,
        senderType,
        receivedAt,
        externalThreadId,
        externalAccountId,
    });
}

async function findExistingThread(identity: InboxIdentity) {
    let query = supabase
        .from("thread")
        .select(`
            id,
            client_id,
            instagram_user_id,
            latest_conversation_id,
            assigned_attendant_id,
            status,
            last_client_message_at,
            external_thread_id,
            external_account_id
        `);

    query = identity.clientId
        ? query.eq("client_id", identity.clientId)
        : query.eq("instagram_user_id", identity.instagramUserId!);

    const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("[inbox-queue] Failed to find existing thread", {
            client_id: identity.clientId,
            instagram_user_id: identity.instagramUserId,
            error,
        });
        throw error;
    }

    console.info("[inbox-queue] Existing thread lookup complete", {
        client_id: identity.clientId,
        instagram_user_id: identity.instagramUserId,
        found: Boolean(data),
        thread_id: data?.id ?? null,
        status: data?.status ?? null,
        previous_last_client_message_at: data?.last_client_message_at ?? null,
    });

    return data as ThreadRow | null;
}

async function updateExistingThread({
    thread,
    source,
    channel,
    senderType,
    receivedAt,
    externalThreadId,
    externalAccountId,
}: {
    thread: ThreadRow;
    source: string;
    channel: InboxChannel;
    senderType: SenderType;
    receivedAt: string;
    externalThreadId?: string | null;
    externalAccountId?: string | null;
}) {
    const isClientMessage = senderType === "client";
    const shouldRequeue = isClientMessage && thread.status === "closed";

    const updates: Record<string, unknown> = {
        source,
        channel,
        updated_at: receivedAt,
    };

    // This field is what the Inbox UI and send route use to determine whether
    // WhatsApp's 24-hour reply window is open. It was previously never updated.
    if (isClientMessage) {
        updates.last_client_message_at = receivedAt;
    }
    if (externalThreadId) {
        updates.external_thread_id = externalThreadId;
    }
    if (externalAccountId) {
        updates.external_account_id = externalAccountId;
    }

    // A returning client must start a new queue cycle. Finalized threads keep
    // their previous attendant for history, so clear that ownership here and
    // place the thread back in the unassigned queue before saving the message.
    if (shouldRequeue) {
        updates.status = "open";
        updates.assigned_attendant_id = null;
        updates.queued_at = receivedAt;
        updates.claimed_at = null;
        updates.closed_at = null;
        updates.unread_count = 0;
    }

    console.info("[inbox-queue] Updating existing thread", {
        thread_id: thread.id,
        sender_type: senderType,
        should_requeue: shouldRequeue,
        previous_status: thread.status,
        previous_assigned_attendant_id: thread.assigned_attendant_id,
        updates,
    });

    const { data, error } = await supabase
        .from("thread")
        .update(updates)
        .eq("id", thread.id)
        .select(`
            id,
            client_id,
            instagram_user_id,
            latest_conversation_id,
            assigned_attendant_id,
            status,
            last_client_message_at,
            external_thread_id,
            external_account_id
        `)
        .single();

    if (error) {
        console.error("[inbox-queue] Failed to update existing thread", {
            thread_id: thread.id,
            error,
        });
        throw error;
    }

    console.info("[inbox-queue] Existing thread updated", {
        thread_id: data.id,
        status: data.status,
        assigned_attendant_id: data.assigned_attendant_id ?? null,
        last_client_message_at: data.last_client_message_at ?? null,
    });

    return data as ThreadRow;
}

async function createThread({
    clientId,
    instagramUserId,
    source,
    channel,
    senderType,
    receivedAt,
    externalThreadId,
    externalAccountId,
}: {
    clientId: string | null;
    instagramUserId: string | null;
    source: string;
    channel: InboxChannel;
    senderType: SenderType;
    receivedAt: string;
    externalThreadId?: string | null;
    externalAccountId?: string | null;
}) {
    const isClientMessage = senderType === "client";

    const insert = {
        id: globalThis.crypto.randomUUID(),
        client_id: clientId,
        instagram_user_id: instagramUserId,
        latest_conversation_id: null,
        status: isClientMessage ? "open" : "closed",
        channel,
        source,
        assigned_attendant_id: null,
        unread_count: 0,
        queued_at: isClientMessage ? receivedAt : null,
        closed_at: isClientMessage ? null : receivedAt,
        last_client_message_at: isClientMessage ? receivedAt : null,
        external_thread_id: externalThreadId ?? null,
        external_account_id: externalAccountId ?? null,
    };

    console.info("[inbox-queue] Creating thread", insert);

    const { data, error } = await supabase
        .from("thread")
        .insert(insert)
        .select(`
            id,
            client_id,
            instagram_user_id,
            latest_conversation_id,
            assigned_attendant_id,
            status,
            last_client_message_at,
            external_thread_id,
            external_account_id
        `)
        .single();

    if (!error) {
        console.info("[inbox-queue] Thread created", {
            thread_id: data.id,
            status: data.status,
            last_client_message_at: data.last_client_message_at ?? null,
        });
        return data as ThreadRow;
    }

    if (error.code !== "23505") {
        console.error("[inbox-queue] Failed to create thread", error);
        throw error;
    }

    console.warn(
        "[inbox-queue] Thread creation raced with another request; loading existing thread",
        {
            client_id: clientId,
            instagram_user_id: instagramUserId,
        },
    );

    const retryThread = await findExistingThread({
        clientId,
        instagramUserId,
    });

    if (!retryThread) {
        throw error;
    }

    // Make sure the winning thread still receives the client timestamp.
    return updateExistingThread({
        thread: retryThread,
        source,
        channel,
        senderType,
        receivedAt,
        externalThreadId,
        externalAccountId,
    });
}

type InboxIdentity = {
    clientId: string | null;
    instagramUserId: string | null;
};

function normalizeIdentity({
    clientId,
    instagramUserId,
}: {
    clientId?: string | null;
    instagramUserId?: string | null;
}): InboxIdentity {
    const normalizedClientId = clientId?.trim() || null;
    const normalizedInstagramUserId = instagramUserId?.trim() || null;

    if (Boolean(normalizedClientId) === Boolean(normalizedInstagramUserId)) {
        throw new Error(
            "Inbox messages require exactly one client or Instagram user identity.",
        );
    }

    return {
        clientId: normalizedClientId,
        instagramUserId: normalizedInstagramUserId,
    };
}

function normalizeSentAt(value: string | null | undefined) {
    if (!value) return new Date().toISOString();

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? new Date().toISOString()
        : parsed.toISOString();
}
