import { supabase } from "../";

type InboxChannel = "WhatsApp" | "Instagram" | "Facebook";

type QueueThreadForMessageParams = {
    clientId: string;
    source: string;
    channel: InboxChannel;
};

type ThreadRow = {
    id: string;
    client_id: string;
    latest_conversation_id: string | null;
    assigned_attendant_id: string | null;
};

type AttendantRow = {
    id: string;
    name: string;
};

export async function queueThreadForMessage({
                                                clientId,
                                                source,
                                                channel,
                                            }: QueueThreadForMessageParams) {
    const existingThread = await findExistingThread(clientId);

    const assignedAttendant = await resolveAssignedAttendant(existingThread);

    if (existingThread) {
        return updateExistingThread({
            thread: existingThread,
            source,
            channel,
            assignedAttendantId: assignedAttendant?.id ?? null,
        });
    }

    return createQueuedThread({
        clientId,
        source,
        channel,
        assignedAttendantId: assignedAttendant?.id ?? null,
    });
}

async function findExistingThread(clientId: string) {
    const { data, error } = await supabase
        .from("thread")
        .select(`
            id,
            client_id,
            latest_conversation_id,
            assigned_attendant_id
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

async function resolveAssignedAttendant(existingThread: ThreadRow | null) {
    if (existingThread?.assigned_attendant_id) {
        const currentAssignedAttendant = await findActiveOnlineAttendantById(
            existingThread.assigned_attendant_id
        );

        if (currentAssignedAttendant) {
            return currentAssignedAttendant;
        }
    }

    return findLeastBusyActiveOnlineAttendant();
}

async function findActiveOnlineAttendantById(attendantId: string) {
    const { data, error } = await supabase
        .from("attendants")
        .select("id, name")
        .eq("id", attendantId)
        .eq("active", true)
        .eq("is_online", true)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data as AttendantRow | null;
}

async function findLeastBusyActiveOnlineAttendant() {
    const { data: attendants, error: attendantsError } = await supabase
        .from("attendants")
        .select("id, name")
        .eq("active", true)
        .eq("is_online", true)
        .order("name", { ascending: true });

    if (attendantsError) {
        throw attendantsError;
    }

    if (!attendants?.length) {
        return null;
    }

    const attendantIds = attendants.map((attendant) => attendant.id);

    const { data: openThreads, error: threadsError } = await supabase
        .from("thread")
        .select("assigned_attendant_id")
        .eq("status", "open")
        .in("assigned_attendant_id", attendantIds);

    if (threadsError) {
        throw threadsError;
    }

    const threadCountByAttendantId = new Map<string, number>();

    for (const attendant of attendants) {
        threadCountByAttendantId.set(attendant.id, 0);
    }

    for (const thread of openThreads ?? []) {
        if (!thread.assigned_attendant_id) continue;

        threadCountByAttendantId.set(
            thread.assigned_attendant_id,
            (threadCountByAttendantId.get(thread.assigned_attendant_id) ?? 0) + 1
        );
    }

    return attendants.reduce((leastBusy, attendant) => {
        const leastBusyCount = threadCountByAttendantId.get(leastBusy.id) ?? 0;
        const attendantCount = threadCountByAttendantId.get(attendant.id) ?? 0;

        if (attendantCount < leastBusyCount) {
            return attendant;
        }

        return leastBusy;
    });
}

async function updateExistingThread({
                                        thread,
                                        source,
                                        channel,
                                        assignedAttendantId,
                                    }: {
    thread: ThreadRow;
    source: string;
    channel: InboxChannel;
    assignedAttendantId: string | null;
}) {
    const { data, error } = await supabase
        .from("thread")
        .update({
            source,
            channel,
            status: "open",
            assigned_attendant_id: assignedAttendantId,
            updated_at: new Date().toISOString(),
        })
        .eq("id", thread.id)
        .select(`
            id,
            client_id,
            latest_conversation_id,
            assigned_attendant_id
        `)
        .single();

    if (error) {
        throw error;
    }

    return data as ThreadRow;
}

async function createQueuedThread({
                                      clientId,
                                      source,
                                      channel,
                                      assignedAttendantId,
                                  }: {
    clientId: string;
    source: string;
    channel: InboxChannel;
    assignedAttendantId: string | null;
}) {
    const { data, error } = await supabase
        .from("thread")
        .insert({
            id: globalThis.crypto.randomUUID(),
            client_id: clientId,
            latest_conversation_id: null,
            status: "open",
            channel,
            source,
            assigned_attendant_id: assignedAttendantId,
            unread_count: 0,
        })
        .select(`
            id,
            client_id,
            latest_conversation_id,
            assigned_attendant_id
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