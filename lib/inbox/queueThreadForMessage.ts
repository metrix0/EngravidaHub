// lib/inbox/queueThreadForMessage.ts
import type { SenderType } from "@/types/message";
import { supabase } from "../";

type InboxChannel = "WhatsApp" | "Instagram" | "Facebook";

type QueueThreadForMessageParams = {
    clientId: string;
    source: string;
    channel: InboxChannel;
    senderType: SenderType;
};

type ThreadRow = {
    id: string;
    client_id: string;
    latest_conversation_id: string | null;
    assigned_attendant_id: string | null;
    status: "open" | "closed";
};

export async function queueThreadForMessage({
    clientId,
    source,
    channel,
    senderType,
}: QueueThreadForMessageParams) {
    const existingThread = await findExistingThread(clientId);

    if (existingThread) {
        return updateExistingThread({
            thread: existingThread,
            source,
            channel,
        });
    }

    return createThread({
        clientId,
        source,
        channel,
        senderType,
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
            status
        `)
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data as ThreadRow | null;
}

async function updateExistingThread({
    thread,
    source,
    channel,
}: {
    thread: ThreadRow;
    source: string;
    channel: InboxChannel;
}) {
    const { data, error } = await supabase
        .from("thread")
        .update({
            source,
            channel,
            updated_at: new Date().toISOString(),
        })
        .eq("id", thread.id)
        .select(`
            id,
            client_id,
            latest_conversation_id,
            assigned_attendant_id,
            status
        `)
        .single();

    if (error) {
        throw error;
    }

    return data as ThreadRow;
}

async function createThread({
    clientId,
    source,
    channel,
    senderType,
}: {
    clientId: string;
    source: string;
    channel: InboxChannel;
    senderType: SenderType;
}) {
    const isClientMessage = senderType === "client";

    const { data, error } = await supabase
        .from("thread")
        .insert({
            id: globalThis.crypto.randomUUID(),
            client_id: clientId,
            latest_conversation_id: null,
            status: isClientMessage ? "open" : "closed",
            channel,
            source,
            assigned_attendant_id: null,
            unread_count: 0,
            queued_at: isClientMessage ? new Date().toISOString() : null,
            closed_at: isClientMessage ? null : new Date().toISOString(),
        })
        .select(`
            id,
            client_id,
            latest_conversation_id,
            assigned_attendant_id,
            status
        `)
        .single();

    if (!error) {
        return data as ThreadRow;
    }

    if (error.code !== "23505") {
        throw error;
    }

    const retryThread = await findExistingThread(clientId);

    if (!retryThread) {
        throw error;
    }

    return retryThread;
}
