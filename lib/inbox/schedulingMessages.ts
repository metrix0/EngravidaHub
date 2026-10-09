// lib/inbox/schedulingMessages.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchedulingThread } from "@/lib/inbox/schedulingData";

export type SchedulingMessage = {
    sender_type: string | null;
    sender_name: string | null;
    text: string | null;
    sent_at: string | null;
};

export async function loadSchedulingMessages(supabase: SupabaseClient, thread: SchedulingThread) {
    const messages: SchedulingMessage[] = [];
    const snapshot = new Date().toISOString();
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
        let query = supabase.from("messages")
            .select("sender_type, sender_name, text, sent_at, sequence_index, id")
            .lte("sent_at", snapshot)
            .order("sent_at", { ascending: true })
            .order("sequence_index", { ascending: true })
            .order("id", { ascending: true });
        // Social history belongs to the social identity, even after CRM linkage.
        query = thread.instagram_user_id
            ? query.eq("instagram_user_id", thread.instagram_user_id)
            : thread.client_id
              ? query.eq("client_id", thread.client_id)
              : query.eq("thread_id", thread.id);
        const { data, error } = await query.range(offset, offset + pageSize - 1);
        if (error) throw error;
        messages.push(...(data ?? []));
        if ((data?.length ?? 0) < pageSize) break;
    }
    return messages;
}
