// lib/inbox/queueThreadForMessage.ts
import type { SenderType } from "@/types/message";
import { supabase } from "../";

type InboxChannel = "WhatsApp" | "Instagram" | "Facebook";

type QueueThreadForMessageParams = {
    clientId: string;
    source: string;
    channel: InboxChannel;
    senderType: SenderType;
    sentAt?: string | null;
};

type ThreadRow = {
    id: string;
    client_id: string;
    latest_conversation_id: string | null;
    assigned_attendant_id: string | null;
    status: "open" | "closed";
    last_client_message_at?: string | null;
};

export async function queueThreadForMessage({
    clientId,
    source,
    channel,
    senderType,
    sentAt,
}: QueueThreadForMessageParams) {
    const receivedAt = normalizeSentAt(sentAt);
    const isClientMessage = senderType === "client";

    console.info("[inbox-queue] Processing message for thread", {
        client_id: clientId,
        source,
        channel,
        sender_type: senderType,
        sent_at_received: sentAt ?? null,
        sent_at_normalized: receivedAt,
        will_update_24h_window: isClientMessage,
    });

    const existingThread = await findExistingThread(clientId);

    if (existingThread) {
        return updateExistingThread({
            thread: existingThread,
            source,
            channel,
            senderType,
            receivedAt,
        });
    }

    return createThread({
        clientId,
        source,
        channel,
        senderType,
        receivedAt,
    });
}

async function findExistingThread(clientId: string) {
    const { data, error } = await supabase
        .from("thread")
        .select(`
            id,
            client_id,
            latest_conversation_id,
            assigned_attendant_id,
            status,
            last_client_message_at
        `)
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("[inbox-queue] Failed to find existing thread", {
            client_id: clientId,
            error,
        });
        throw error;
    }

    console.info("[inbox-queue] Existing thread lookup complete", {
        client_id: clientId,
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
}: {
    thread: ThreadRow;
    source: string;
    channel: InboxChannel;
    senderType: SenderType;
    receivedAt: string;
}) {
    const isClientMessage = senderType === "client";

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

    console.info("[inbox-queue] Updating existing thread", {
        thread_id: thread.id,
        sender_type: senderType,
        updates,
    });

    const { data, error } = await supabase
        .from("thread")
        .update(updates)
        .eq("id", thread.id)
        .select(`
            id,
            client_id,
            latest_conversation_id,
            assigned_attendant_id,
            status,
            last_client_message_at
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
        last_client_message_at: data.last_client_message_at ?? null,
    });

    return data as ThreadRow;
}

async function createThread({
    clientId,
    source,
    channel,
    senderType,
    receivedAt,
}: {
    clientId: string;
    source: string;
    channel: InboxChannel;
    senderType: SenderType;
    receivedAt: string;
}) {
    const isClientMessage = senderType === "client";

    const insert = {
        id: globalThis.crypto.randomUUID(),
        client_id: clientId,
        latest_conversation_id: null,
        status: isClientMessage ? "open" : "closed",
        channel,
        source,
        assigned_attendant_id: null,
        unread_count: 0,
        queued_at: isClientMessage ? receivedAt : null,
        closed_at: isClientMessage ? null : receivedAt,
        last_client_message_at: isClientMessage ? receivedAt : null,
    };

    console.info("[inbox-queue] Creating thread", insert);

    const { data, error } = await supabase
        .from("thread")
        .insert(insert)
        .select(`
            id,
            client_id,
            latest_conversation_id,
            assigned_attendant_id,
            status,
            last_client_message_at
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
        { client_id: clientId },
    );

    const retryThread = await findExistingThread(clientId);

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
    });
}

function normalizeSentAt(value: string | null | undefined) {
    if (!value) return new Date().toISOString();

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? new Date().toISOString()
        : parsed.toISOString();
}
