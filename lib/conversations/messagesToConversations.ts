// lib/conversations/messagesToConversations.ts
import { supabase } from "@/lib";
import { getConversationEffectiveEndMessage } from "@/lib/conversations/conversationEffectiveEnd";
import type { AnalyzeConversationInput, Message } from "@/types";

const BATCH_SIZE = 100;

export async function messageToConversations({ inactivityHours = 6, limit = 1000 }: { inactivityHours?: number; limit?: number } = {}): Promise<AnalyzeConversationInput[]> {
    const cutoff = new Date(Date.now() - inactivityHours * 3_600_000);
    const oldestAllowed = new Date(Date.now() - 7 * 24 * 3_600_000);
    const candidates = await supabase.from("messages").select("client_id")
        .is("conversation_id", null).is("thread_id", null)
        .gte("sent_at", oldestAllowed.toISOString()).lte("sent_at", cutoff.toISOString())
        .order("sent_at", { ascending: true }).limit(limit);
    if (candidates.error) throw new Error(`Failed to fetch pending message clients: ${candidates.error.message}`);

    const clientIds = Array.from(
        new Set(
            (candidates.data ?? [])
                .map((row) => row.client_id)
                .filter((value): value is string => Boolean(value)),
        ),
    );
    const pending: Message[] = [];
    for (const ids of chunk(clientIds, BATCH_SIZE)) {
        const result = await supabase.from("messages").select("*").in("client_id", ids)
            .is("conversation_id", null).is("thread_id", null)
            .gte("sent_at", oldestAllowed.toISOString())
            .order("sent_at", { ascending: true }).order("sequence_index", { ascending: true }).order("id", { ascending: true });
        if (result.error) throw new Error(`Failed to fetch pending messages: ${result.error.message}`);
        pending.push(...((result.data ?? []) as Message[]));
    }

    const inputs: AnalyzeConversationInput[] = [];
    for (const group of endedGroups(pending, cutoff, inactivityHours)) inputs.push(await createAndAttach(group));
    return inputs;
}

function endedGroups(messages: Message[], cutoff: Date, inactivityHours: number) {
    const byClient = new Map<string, Message[]>();
    for (const message of messages) {
        if (!message.client_id) continue;
        byClient.set(message.client_id, [
            ...(byClient.get(message.client_id) ?? []),
            message,
        ]);
    }
    const result: Message[][] = [];
    for (const clientMessages of byClient.values()) {
        let current: Message[] = [];
        for (const message of sortMessages(clientMessages)) {
            const previous = current.at(-1);
            if (previous && (new Date(message.sent_at).getTime() - new Date(previous.sent_at).getTime()) / 3_600_000 >= inactivityHours) {
                if (isEnded(current, cutoff)) result.push(current);
                current = [];
            }
            current.push(message);
        }
        if (isEnded(current, cutoff)) result.push(current);
    }
    return result;
}

function isEnded(messages: Message[], cutoff: Date) {
    const last = messages.at(-1);
    return Boolean(last && new Date(last.sent_at).getTime() <= cutoff.getTime());
}

async function createAndAttach(sourceMessages: Message[]): Promise<AnalyzeConversationInput> {
    const messages = sortMessages(sourceMessages);
    const first = messages[0];
    const last = messages.at(-1);
    if (!first || !last) throw new Error("Cannot create conversation from empty messages array");
    if (!first.client_id) {
        throw new Error("Legacy message conversion requires a CRM client");
    }
    const effectiveEnd = getConversationEffectiveEndMessage(messages);

    const attendantMessage = messages.find((message) => message.sender_type === "attendant");
    const attendant = attendantMessage?.external_attendant_id ? await getAttendant(attendantMessage.external_attendant_id) : null;
    const created = await supabase.from("conversations").insert({
        client_id: first.client_id, instagram_user_id: null, source: "blip", channel: "WhatsApp", started_at: first.sent_at, ended_at: effectiveEnd.sent_at,
        attendant_id: attendant?.id ?? null, attendant_chat_name: attendant?.name ?? attendantMessage?.sender_name ?? null,
        unit_id: null, service_id: null, last_message_text: last.text, last_message_at: last.sent_at,
    }).select("id").single();
    if (created.error) throw new Error(`Failed to create conversation: ${created.error.message}`);

    for (let index = 0; index < messages.length; index += 1) {
        const attached = await supabase.from("messages").update({ conversation_id: created.data.id, sequence_index: 1_000_000 + index })
            .eq("id", messages[index].id).is("conversation_id", null);
        if (attached.error) throw new Error(`Failed to attach message: ${attached.error.message}`);
    }
    for (let index = 0; index < messages.length; index += 1) {
        const normalized = await supabase.from("messages").update({ sequence_index: index + 1 })
            .eq("id", messages[index].id).eq("conversation_id", created.data.id);
        if (normalized.error) throw new Error(`Failed to normalize message order: ${normalized.error.message}`);
    }

    return {
        conversation_id: created.data.id, client_id: first.client_id, instagram_user_id: null, started_at: first.sent_at, ended_at: effectiveEnd.sent_at,
        attendant_id: attendant?.id ?? null, unit_id: null, service_id: null,
        conversationText: buildText(messages),
        messages: messages.map((message, index) => ({ id: message.id, sender_type: message.sender_type, sender_name: message.sender_name, text: message.text, sent_at: message.sent_at, sequence_index: index + 1 })),
    };
}

function buildText(messages: Message[]) {
    return messages.map((message) => `[${new Date(message.sent_at).toLocaleString("pt-BR")}] ${senderLabel(message)}: ${message.text}`).join("\n");
}
function senderLabel(message: Message) {
    if (message.sender_type === "client") return message.sender_name ?? "Cliente";
    if (message.sender_type === "attendant") return message.sender_name ?? "Atendente";
    if (message.sender_type === "bot") return "Bot";
    return "Sistema";
}
function sortMessages(messages: Message[]) {
    return [...messages].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime() || a.sequence_index - b.sequence_index || a.id.localeCompare(b.id));
}
async function getAttendant(externalId: string) {
    const result = await supabase.from("attendants").select("id, name").eq("external_attendant_id", externalId).maybeSingle();
    if (result.error) throw new Error(`Failed to fetch attendant: ${result.error.message}`);
    return result.data;
}
function chunk<T>(items: T[], size: number) {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
}
