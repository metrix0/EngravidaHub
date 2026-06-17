// app/src/lib/conversations/messagesToConversations.ts
import { supabase } from "@engravida/lib";
import type { AnalyzeConversationInput, Message } from "@engravida/types";

export async function messageToConversations({
                                                 inactivityHours = 6,
                                                 limit = 1000,
                                             }: {
    inactivityHours?: number;
    limit?: number;
} = {}): Promise<AnalyzeConversationInput[]> {
    const cutoff = new Date(Date.now() - inactivityHours * 60 * 60 * 1000);
    const oldestAllowed = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
        .from("messages")
        .select("*")
        .is("conversation_id", null)
        .gte("sent_at", oldestAllowed.toISOString())
        .lte("sent_at", cutoff.toISOString())
        .order("sent_at", { ascending: true })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to fetch pending messages: ${error.message}`);
    }

    const pendingMessages = (data ?? []) as Message[];

    console.log("[messageToConversations] Gathered non-analyzed messages", {
        pending_messages_found: pendingMessages.length,
        inactivity_hours: inactivityHours,
        cutoff: cutoff.toISOString(),
    });

    const endedGroups = getEndedMessageGroups(
        pendingMessages,
        cutoff,
        inactivityHours
    );

    console.log("[messageToConversations] Ended message groups found", {
        ended_groups_found: endedGroups.length,
    });

    const analysisInputs: AnalyzeConversationInput[] = [];

    for (const messages of endedGroups) {
        const conversationMessages = await removeIgnoredFinalBotMessage(messages);

        if (shouldDeleteInvalidGroup(conversationMessages)) {
            console.log("[messageToConversations] Deleting group: invalid one-sided/bot-only conversation", {
                messages_count: conversationMessages.length,
                client_id: conversationMessages[0]?.client_id,
                sender_types: Array.from(new Set(conversationMessages.map((message) => message.sender_type))),
            });

            await deleteMessages(conversationMessages);
            continue;
        }

        const analysisInput = await createConversationAndAttachMessages(conversationMessages);
        analysisInputs.push(analysisInput);
    }

    console.log("[messageToConversations] Conversations saved to Supabase", {
        conversations_created: analysisInputs.length,
    });

    return analysisInputs;
}

function getEndedMessageGroups(
    messages: Message[],
    cutoff: Date,
    inactivityHours: number
): Message[][] {
    const messagesByClient = new Map<string, Message[]>();

    for (const message of messages) {
        const clientMessages = messagesByClient.get(message.client_id) ?? [];
        clientMessages.push(message);
        messagesByClient.set(message.client_id, clientMessages);
    }

    const endedGroups: Message[][] = [];

    for (const clientMessages of messagesByClient.values()) {
        const sortedMessages = [...clientMessages].sort(
            (a, b) =>
                new Date(a.sent_at).getTime() -
                new Date(b.sent_at).getTime()
        );

        let currentGroup: Message[] = [];

        for (const message of sortedMessages) {
            const previousMessage = currentGroup.at(-1);

            if (!previousMessage) {
                currentGroup.push(message);
                continue;
            }

            const gapHours =
                (new Date(message.sent_at).getTime() -
                    new Date(previousMessage.sent_at).getTime()) /
                1000 /
                60 /
                60;

            if (gapHours >= inactivityHours) {
                if (isEnded(currentGroup, cutoff)) {
                    endedGroups.push(currentGroup);
                }

                currentGroup = [message];
                continue;
            }

            currentGroup.push(message);
        }

        if (isEnded(currentGroup, cutoff)) {
            endedGroups.push(currentGroup);
        }
    }

    return endedGroups;
}

function isEnded(messages: Message[], cutoff: Date): boolean {
    const lastMessage = messages.at(-1);

    if (!lastMessage) return false;

    return new Date(lastMessage.sent_at).getTime() <= cutoff.getTime();
}

async function createConversationAndAttachMessages(
    messages: Message[]
): Promise<AnalyzeConversationInput> {
    const sortedMessages = [...messages].sort(
        (a, b) =>
            new Date(a.sent_at).getTime() -
            new Date(b.sent_at).getTime()
    );

    const firstMessage = sortedMessages[0];
    const lastMessage = sortedMessages.at(-1);

    if (!firstMessage || !lastMessage) {
        throw new Error("Cannot create conversation from empty messages array");
    }

    const attendantMessage = sortedMessages.find(
        (message) => message.sender_type === "attendant"
    );

    const attendant = attendantMessage?.external_attendant_id
        ? await getAttendantByExternalId(attendantMessage.external_attendant_id)
        : null;

    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .insert({
            client_id: firstMessage.client_id,
            source: "blip",

            started_at: firstMessage.sent_at,
            ended_at: lastMessage.sent_at,

            attendant_id: attendant?.id ?? null,
            attendant_chat_name:
                attendant?.name ?? attendantMessage?.sender_name ?? null,

            unit_id: null,
            service_id: null,
        })
        .select("id")
        .single();

    if (conversationError) {
        throw new Error(
            `Failed to create conversation: ${conversationError.message}`
        );
    }

    for (let index = 0; index < sortedMessages.length; index++) {
        const message = sortedMessages[index];

        const { error: updateMessageError } = await supabase
            .from("messages")
            .update({
                conversation_id: conversation.id,
                sequence_index: index + 1,
            })
            .eq("id", message.id);

        if (updateMessageError) {
            throw new Error(
                `Failed to attach message to conversation: ${updateMessageError.message}`
            );
        }
    }

    return {
        conversation_id: conversation.id,
        client_id: firstMessage.client_id,

        started_at: firstMessage.sent_at,
        ended_at: lastMessage.sent_at,

        attendant_id: attendant?.id ?? null,
        unit_id: null,
        service_id: null,

        conversationText: buildConversationText(sortedMessages),
    };
}

function buildConversationText(messages: Message[]): string {
    return messages
        .map((message) => {
            const date = new Date(message.sent_at).toLocaleString("pt-BR");
            const sender = getSenderLabel(message);

            return `[${date}] ${sender}: ${message.text}`;
        })
        .join("\n");
}

function getSenderLabel(message: Message): string {
    if (message.sender_type === "client") return "Cliente";

    if (message.sender_type === "attendant") {
        return message.sender_name ?? "Atendente";
    }

    if (message.sender_type === "bot") return "Bot";

    return "Sistema";
}

function shouldDeleteInvalidGroup(messages: Message[]): boolean {
    if (messages.length === 0) return true;

    const hasClient = messages.some(
        (message) => message.sender_type === "client"
    );

    const hasAttendant = messages.some(
        (message) => message.sender_type === "attendant"
    );

    return !hasClient || !hasAttendant;
}

async function deleteMessages(messages: Message[]) {
    const messageIds = messages.map((message) => message.id);

    const { error } = await supabase
        .from("messages")
        .delete()
        .in("id", messageIds);

    if (error) {
        throw new Error(
            `Failed to delete only-attendant messages: ${error.message}`
        );
    }
}

async function removeIgnoredFinalBotMessage(messages: Message[]): Promise<Message[]> {
    const sortedMessages = [...messages].sort(
        (a, b) =>
            new Date(a.sent_at).getTime() -
            new Date(b.sent_at).getTime()
    );

    const lastMessage = sortedMessages.at(-1);

    if (!lastMessage || lastMessage.sender_type !== "bot") {
        return sortedMessages;
    }

    const previousFourMessages = sortedMessages.slice(-5, -1);

    const hasAttendantInPreviousFourMessages = previousFourMessages.some(
        (message) => message.sender_type === "attendant"
    );

    if (!hasAttendantInPreviousFourMessages) {
        return sortedMessages;
    }

    console.log("[messageToConversations] Deleting ignored final bot message", {
        message_id: lastMessage.id,
        client_id: lastMessage.client_id,
        text: lastMessage.text,
    });

    await deleteMessages([lastMessage]);

    return sortedMessages.slice(0, -1);
}

async function getAttendantByExternalId(externalAttendantId: string) {
    const { data, error } = await supabase
        .from("attendants")
        .select("id, name")
        .eq("external_attendant_id", externalAttendantId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to fetch attendant: ${error.message}`);
    }

    return data;
}