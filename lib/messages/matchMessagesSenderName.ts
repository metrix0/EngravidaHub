// lib/messages/matchMessagesSenderName.ts
import { supabase } from "@/lib";
import type { SenderType } from "@/types/message";

type MatchMessagesSenderNameInput = {
    limit: number;
};

type PendingConversation = {
    id: string;
};

type MessageRow = {
    id: string;
    conversation_id: string | null;
    client_id: string | null;
    instagram_user_id: string | null;
    sender_type: SenderType;
    sender_name: string | null;
    external_contact_id: string | null;
    external_attendant_id: string | null;
};

type ClientRow = {
    id: string;
    name: string | null;
    external_contact_id: string | null;
};

type AttendantRow = {
    id: string;
    name: string;
    external_attendant_id: string | null;
};

type InstagramUserRow = {
    id: string;
    display_name: string | null;
    username: string | null;
};

const QUERY_BATCH_SIZE = 100;
const WRITE_CONCURRENCY = 8;
const SUPABASE_REQUEST_ATTEMPTS = 3;
const SUPABASE_RETRY_BASE_MS = 500;

export async function matchMessagesSenderName({
    limit,
}: MatchMessagesSenderNameInput) {
    const { data: conversations, error: conversationsError } =
        await withSupabaseRetry(() =>
            supabase
                .from("conversations")
                .select("id")
                .is("conversation_analysis_id", null)
                .order("ended_at", {
                    ascending: false,
                    nullsFirst: false,
                })
                .limit(limit),
        );

    if (conversationsError) {
        throw conversationsError;
    }

    const pendingConversations = (conversations ?? []) as PendingConversation[];

    if (pendingConversations.length === 0) {
        return {
            updated_messages: 0,
            ready_conversation_ids: [],
            skipped_conversation_ids: [],
        };
    }

    const conversationIds = pendingConversations.map(
        (conversation) => conversation.id,
    );

    const messages = await fetchMessagesByConversationIds(conversationIds);

    const clientIds = Array.from(
        new Set(
            messages
                .map((message) => message.client_id)
                .filter((value): value is string => Boolean(value)),
        ),
    );
    const instagramUserIds = Array.from(
        new Set(
            messages
                .map((message) => message.instagram_user_id)
                .filter((value): value is string => Boolean(value)),
        ),
    );

    const externalContactIds = Array.from(
        new Set(
            messages
                .map((message) => message.external_contact_id)
                .filter(Boolean) as string[],
        ),
    );

    const externalAttendantIds = Array.from(
        new Set(
            messages
                .map((message) => message.external_attendant_id)
                .filter(Boolean) as string[],
        ),
    );

    const clients = await fetchClients({
        clientIds,
        externalContactIds,
    });

    const [instagramUsers, attendants] = await Promise.all([
        fetchInstagramUsers(instagramUserIds),
        fetchAttendants(externalAttendantIds),
    ]);

    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const clientsByExternalContactId = new Map(
        clients
            .filter((client) => client.external_contact_id)
            .map((client) => [client.external_contact_id, client]),
    );

    const attendantsByExternalId = new Map(
        attendants
            .filter((attendant) => attendant.external_attendant_id)
            .map((attendant) => [attendant.external_attendant_id, attendant]),
    );
    const instagramUsersById = new Map(
        instagramUsers.map((user) => [user.id, user]),
    );

    const skippedConversationIds = new Set<string>();
    const updates: { id: string; sender_name: string }[] = [];

    for (const message of messages) {
        if (!message.conversation_id) continue;

        const senderName = getSenderNameForMessage({
            message,
            clientsById,
            clientsByExternalContactId,
            instagramUsersById,
            attendantsByExternalId,
        });

        if (!senderName) {
            skippedConversationIds.add(message.conversation_id);
            continue;
        }

        if (message.sender_name !== senderName) {
            updates.push({
                id: message.id,
                sender_name: senderName,
            });
        }
    }

    await runWithConcurrency(updates, WRITE_CONCURRENCY, async (update) => {
        const { error } = await withSupabaseRetry(() =>
            supabase
                .from("messages")
                .update({
                    sender_name: update.sender_name,
                })
                .eq("id", update.id),
        );

        if (error) {
            throw error;
        }
    });

    await updateConversationAttendantNames({
        messages,
        attendantsByExternalId,
    });

    const readyConversationIds = conversationIds.filter(
        (conversationId) => !skippedConversationIds.has(conversationId),
    );

    return {
        updated_messages: updates.length,
        ready_conversation_ids: readyConversationIds,
        skipped_conversation_ids: Array.from(skippedConversationIds),
    };
}

async function fetchMessagesByConversationIds(
    conversationIds: string[],
): Promise<MessageRow[]> {
    const messages: MessageRow[] = [];

    for (const ids of chunk(conversationIds, QUERY_BATCH_SIZE)) {
        const { data, error } = await withSupabaseRetry(() =>
            supabase
                .from("messages")
                .select(
                    "id, conversation_id, client_id, instagram_user_id, sender_type, sender_name, external_contact_id, external_attendant_id",
                )
                .in("conversation_id", ids)
                .is("sender_name", null)
                .order("sent_at", { ascending: true }),
        );

        if (error) {
            throw error;
        }

        messages.push(...((data ?? []) as MessageRow[]));
    }

    return messages;
}

async function fetchClients({
    clientIds,
    externalContactIds,
}: {
    clientIds: string[];
    externalContactIds: string[];
}): Promise<ClientRow[]> {
    const clientsById = new Map<string, ClientRow>();

    for (const ids of chunk(clientIds, QUERY_BATCH_SIZE)) {
        const { data, error } = await withSupabaseRetry(() =>
            supabase
                .from("clients")
                .select("id, name, external_contact_id")
                .in("id", ids),
        );

        if (error) {
            throw error;
        }

        for (const client of (data ?? []) as ClientRow[]) {
            clientsById.set(client.id, client);
        }
    }

    for (const ids of chunk(externalContactIds, QUERY_BATCH_SIZE)) {
        const { data, error } = await withSupabaseRetry(() =>
            supabase
                .from("clients")
                .select("id, name, external_contact_id")
                .in("external_contact_id", ids),
        );

        if (error) {
            throw error;
        }

        for (const client of (data ?? []) as ClientRow[]) {
            clientsById.set(client.id, client);
        }
    }

    return Array.from(clientsById.values());
}

async function fetchInstagramUsers(ids: string[]): Promise<InstagramUserRow[]> {
    const users: InstagramUserRow[] = [];

    for (const chunkIds of chunk(ids, QUERY_BATCH_SIZE)) {
        const { data, error } = await withSupabaseRetry(() =>
            supabase
                .from("instagram_users")
                .select("id, display_name, username")
                .in("id", chunkIds),
        );

        if (error) throw error;
        users.push(...((data ?? []) as InstagramUserRow[]));
    }

    return users;
}

async function fetchAttendants(
    externalAttendantIds: string[],
): Promise<AttendantRow[]> {
    const attendantsById = new Map<string, AttendantRow>();

    for (const ids of chunk(externalAttendantIds, QUERY_BATCH_SIZE)) {
        const { data, error } = await withSupabaseRetry(() =>
            supabase
                .from("attendants")
                .select("id, name, external_attendant_id")
                .in("external_attendant_id", ids),
        );

        if (error) {
            throw error;
        }

        for (const attendant of (data ?? []) as AttendantRow[]) {
            attendantsById.set(attendant.id, attendant);
        }
    }

    return Array.from(attendantsById.values());
}

function getSenderNameForMessage({
    message,
    clientsById,
    clientsByExternalContactId,
    instagramUsersById,
    attendantsByExternalId,
}: {
    message: MessageRow;
    clientsById: Map<string, ClientRow>;
    clientsByExternalContactId: Map<string | null, ClientRow>;
    instagramUsersById: Map<string, InstagramUserRow>;
    attendantsByExternalId: Map<string | null, AttendantRow>;
}) {
    if (message.sender_type === "client") {
        if (message.instagram_user_id) {
            const user = instagramUsersById.get(message.instagram_user_id);
            return (
                user?.display_name?.trim() ||
                (user?.username
                    ? `@${user.username.replace(/^@+/, "")}`
                    : null) ||
                "Usuário do Instagram"
            );
        }

        const client =
            (message.client_id
                ? clientsById.get(message.client_id)
                : null) ??
            clientsByExternalContactId.get(message.external_contact_id);

        return client?.name?.trim() || "Cliente";
    }

    if (message.sender_type === "attendant") {
        const attendant = attendantsByExternalId.get(
            message.external_attendant_id,
        );

        return attendant?.name ?? message.sender_name?.trim() ?? "Atendente";
    }

    if (message.sender_type === "bot") {
        return "Bot";
    }

    if (message.sender_type === "system") {
        return "Sistema";
    }

    return "Sistema";
}

async function updateConversationAttendantNames({
    messages,
    attendantsByExternalId,
}: {
    messages: MessageRow[];
    attendantsByExternalId: Map<string | null, AttendantRow>;
}) {
    const attendantNameByConversationId = new Map<string, string>();

    for (const message of messages) {
        if (!message.conversation_id) continue;
        if (message.sender_type !== "attendant") continue;
        if (!message.external_attendant_id) continue;

        const attendant = attendantsByExternalId.get(
            message.external_attendant_id,
        );

        if (!attendant?.name) continue;

        if (!attendantNameByConversationId.has(message.conversation_id)) {
            attendantNameByConversationId.set(
                message.conversation_id,
                attendant.name,
            );
        }
    }

    await runWithConcurrency(
        Array.from(attendantNameByConversationId.entries()),
        WRITE_CONCURRENCY,
        async ([conversationId, attendantName]) => {
            const { error } = await withSupabaseRetry(() =>
                supabase
                    .from("conversations")
                    .update({
                        attendant_chat_name: attendantName,
                    })
                    .eq("id", conversationId),
            );

            if (error) {
                throw error;
            }
        },
    );
}

async function withSupabaseRetry<T extends { data: unknown; error: unknown }>(
    operation: () => PromiseLike<T>,
): Promise<T> {
    let lastResult: T | null = null;
    let lastThrownError: unknown = null;

    for (
        let attempt = 1;
        attempt <= SUPABASE_REQUEST_ATTEMPTS;
        attempt += 1
    ) {
        try {
            const result = await operation();

            if (
                !result.error ||
                !isTransientSupabaseError(result.error) ||
                attempt === SUPABASE_REQUEST_ATTEMPTS
            ) {
                return result;
            }

            lastResult = result;
            console.warn("[sender-name-match] transient Supabase error; retrying", {
                attempt,
                error: errorText(result.error),
            });
        } catch (error) {
            if (
                !isTransientSupabaseError(error) ||
                attempt === SUPABASE_REQUEST_ATTEMPTS
            ) {
                throw error;
            }

            lastThrownError = error;
            console.warn("[sender-name-match] transient Supabase error; retrying", {
                attempt,
                error: errorText(error),
            });
        }

        await wait(SUPABASE_RETRY_BASE_MS * 2 ** (attempt - 1));
    }

    if (lastResult) return lastResult;
    throw lastThrownError ?? new Error("Supabase request failed after retries");
}

function isTransientSupabaseError(error: unknown) {
    return /ECONNRESET|fetch failed|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|UND_ERR|socket hang up|network connection/i.test(
        errorText(error),
    );
}

function errorText(error: unknown): string {
    if (error instanceof Error) {
        return [
            error.name,
            error.message,
            error.cause ? errorText(error.cause) : "",
        ]
            .filter(Boolean)
            .join(" ");
    }

    if (typeof error === "string") return error;

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
) {
    for (let index = 0; index < items.length; index += concurrency) {
        await Promise.all(items.slice(index, index + concurrency).map(worker));
    }
}

function wait(milliseconds: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}
