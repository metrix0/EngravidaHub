// lib/conversations/matchConversationOriginMap.ts
import { GoogleAuth } from "google-auth-library";

import { supabase } from "@/lib";

const SPREADSHEET_ID =
    process.env.SPREADSHEET_ID ??
    "1gjGb6MAJVZGRLbK_EVEXcY9Ijam-pptLvnd2yDSgFI4";
const ORIGIN_MAP_SHEET_NAME =
    process.env.ORIGIN_MAP_SHEET_NAME ?? "Mapa de Origens";
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

const GOOGLE_SHEETS_SCOPE =
    "https://www.googleapis.com/auth/spreadsheets.readonly";
const QUERY_BATCH_SIZE = 100;
const WRITE_CONCURRENCY = 8;
const CLOSING_TAG_RPC_BATCH_SIZE = 500;
const ORIGIN_MAP_MAX_ROWS = 5_000;
const GOOGLE_SHEETS_MAX_ATTEMPTS = 3;
const GOOGLE_SHEETS_RETRY_BASE_MS = 500;
const GOOGLE_SHEETS_RETRYABLE_STATUSES = new Set([
    408,
    429,
    500,
    502,
    503,
    504,
]);

const NO_SCHEDULE_TAG = "Não agendou 1ª Avaliação";
const NO_RETURN_TAG = "Sem retorno da paciente";

type ClosingTag = typeof NO_SCHEDULE_TAG | typeof NO_RETURN_TAG;

const CLOSING_TAG_MESSAGE_ENTRIES: Array<readonly [string, ClosingTag]> = [
    [
        "Informo que o agendamento de sua avaliação NÃO FOI concluído. Caso tenha interesse em agendar, solicitamos que retorne o contato neste canal.",
        NO_SCHEDULE_TAG,
    ],
    [
        "Avaliação não agendada no momento. Ficamos no aguardo do seu retorno para realizarmos o agendamento futuramente.",
        NO_SCHEDULE_TAG,
    ],
    [
        "Avaliação não agendada, aguardo o seu retorno para agendarmos.",
        NO_SCHEDULE_TAG,
    ],
    [
        "Agendamento não realizado. Aguardo seu retorno para agendarmos.",
        NO_SCHEDULE_TAG,
    ],
    [
        "Atendimento não agendado. Aguardo o seu retorno para seguirmos com o seu agendamento.",
        NO_SCHEDULE_TAG,
    ],
    [
        "valiação não agendada, aguardo o seu retorno para agendarmos.",
        NO_SCHEDULE_TAG,
    ],
    ["Por falta de retorno, a conversa será finalizada", NO_RETURN_TAG],
];

const CLOSING_TAG_BY_MESSAGE = new Map<string, ClosingTag>(
    CLOSING_TAG_MESSAGE_ENTRIES.map(([message, closingTag]) => [
        normalizeMessage(message)!,
        closingTag,
    ]),
);

type GoogleValuesResponse = {
    values?: string[][];
};

type OriginMapEntry = {
    message: string;
    origin: string | null;
    tunnel: string | null;
    row_number: number;
};

type ConversationRow = {
    id: string;
    client_id: string | null;
    origin: string | null;
    tunnel: string | null;
};

type MessageRow = {
    id: string;
    conversation_id: string | null;
    text: string | null;
    sent_at: string;
    sequence_index: number;
};

type AttributionUpdate = {
    conversation_id: string;
    origin: string | null;
    tunnel: string | null;
    origin_changed: boolean;
    tunnel_changed: boolean;
    matched_message_id: string;
    matched_sheet_row: number;
};

type ClientClosingTagUpdate = {
    client_id: string;
    closing_tag: ClosingTag;
    closing_tag_at: string;
};

export async function matchConversationOriginMap({
    conversationIds,
}: {
    conversationIds: string[];
}) {
    const uniqueConversationIds = Array.from(
        new Set(conversationIds.filter(Boolean)),
    );

    if (uniqueConversationIds.length === 0) {
        return emptyResult();
    }

    validateEnvironment();

    // The map is loaded once for this pipeline run. The same bounded request is
    // retried only when Google returns a transient service/transport failure.
    const sheetFetch = await fetchOriginMapRows();
    const sheetRows = sheetFetch.rows;
    const originMap = parseOriginMap(sheetRows);
    const [conversations, clientMessages, attendantMessages] = await Promise.all([
        loadConversations(uniqueConversationIds),
        loadMessages(uniqueConversationIds, "client"),
        loadMessages(uniqueConversationIds, "attendant"),
    ]);

    const conversationsById = new Map(
        conversations.map((conversation) => [conversation.id, conversation]),
    );
    const clientMessagesByConversationId =
        groupMessagesByConversation(clientMessages);
    const attendantMessagesByConversationId =
        groupMessagesByConversation(attendantMessages);
    const closingTagByClientId = new Map<string, ClientClosingTagUpdate>();
    const updates: AttributionUpdate[] = [];
    let matchedConversations = 0;
    let matchedClosingTagMessages = 0;
    let skippedWithoutMatch = 0;
    let skippedAlreadyAttributed = 0;

    for (const conversationId of uniqueConversationIds) {
        const conversation = conversationsById.get(conversationId);
        if (!conversation) {
            skippedWithoutMatch += 1;
            continue;
        }

        if (conversation.client_id) {
            const closingTagMatch = findLatestClosingTagMatch(
                attendantMessagesByConversationId.get(conversationId) ?? [],
            );

            if (closingTagMatch) {
                matchedClosingTagMessages += 1;
                const current = closingTagByClientId.get(conversation.client_id);
                if (
                    !current ||
                    new Date(closingTagMatch.message.sent_at).getTime() >=
                        new Date(current.closing_tag_at).getTime()
                ) {
                    closingTagByClientId.set(conversation.client_id, {
                        client_id: conversation.client_id,
                        closing_tag: closingTagMatch.closingTag,
                        closing_tag_at: closingTagMatch.message.sent_at,
                    });
                }
            }
        }

        const match = findConversationMatch(
            clientMessagesByConversationId.get(conversationId) ?? [],
            originMap.entries,
        );

        if (!match) {
            skippedWithoutMatch += 1;
            continue;
        }

        matchedConversations += 1;

        const nextOrigin = conversation.origin ?? match.entry.origin;
        const nextTunnel = conversation.tunnel ?? match.entry.tunnel;
        const originChanged =
            !conversation.origin && Boolean(match.entry.origin);
        const tunnelChanged =
            !conversation.tunnel && Boolean(match.entry.tunnel);

        if (!originChanged && !tunnelChanged) {
            skippedAlreadyAttributed += 1;
            continue;
        }

        updates.push({
            conversation_id: conversationId,
            origin: nextOrigin,
            tunnel: nextTunnel,
            origin_changed: originChanged,
            tunnel_changed: tunnelChanged,
            matched_message_id: match.message.id,
            matched_sheet_row: match.entry.row_number,
        });
    }

    await runWithConcurrency(updates, WRITE_CONCURRENCY, async (update) => {
        const { error } = await supabase
            .from("conversations")
            .update({
                origin: update.origin,
                tunnel: update.tunnel,
            })
            .eq("id", update.conversation_id);

        if (error) {
            throw new Error(
                `Failed to update conversation attribution ${update.conversation_id}: ${error.message}`,
            );
        }
    });

    const closingTagSync = await syncClientClosingTags(
        [...closingTagByClientId.values()],
    );

    const result = {
        sheet_name: ORIGIN_MAP_SHEET_NAME,
        sheet_fetch_attempts: sheetFetch.attempts,
        sheet_rows_read: Math.max(sheetRows.length - 1, 0),
        usable_map_entries: originMap.entries.size,
        ambiguous_map_messages: originMap.ambiguousMessages,
        checked_conversations: uniqueConversationIds.length,
        matched_conversations: matchedConversations,
        updated_conversations: updates.length,
        updated_origins: updates.filter((update) => update.origin_changed).length,
        updated_tunnels: updates.filter((update) => update.tunnel_changed).length,
        matched_closing_tag_messages: matchedClosingTagMessages,
        matched_clients_for_closing_tag: closingTagSync.matched_clients,
        updated_client_closing_tags: closingTagSync.updated_clients,
        skipped_without_match: skippedWithoutMatch,
        skipped_already_attributed: skippedAlreadyAttributed,
    };

    console.log("[origin-map-attribution] completed", result);
    return result;
}

function emptyResult() {
    return {
        sheet_name: ORIGIN_MAP_SHEET_NAME,
        sheet_fetch_attempts: 0,
        sheet_rows_read: 0,
        usable_map_entries: 0,
        ambiguous_map_messages: 0,
        checked_conversations: 0,
        matched_conversations: 0,
        updated_conversations: 0,
        updated_origins: 0,
        updated_tunnels: 0,
        matched_closing_tag_messages: 0,
        matched_clients_for_closing_tag: 0,
        updated_client_closing_tags: 0,
        skipped_without_match: 0,
        skipped_already_attributed: 0,
    };
}

async function fetchOriginMapRows() {
    const accessToken = await getGoogleAccessToken();
    const range =
        `${quoteSheetName(ORIGIN_MAP_SHEET_NAME)}!` +
        `A1:C${ORIGIN_MAP_MAX_ROWS}`;
    const encodedRange = encodeURIComponent(range);
    const params = new URLSearchParams({
        majorDimension: "ROWS",
        valueRenderOption: "FORMATTED_VALUE",
        fields: "values",
    });
    const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}` +
        `/values/${encodedRange}?${params.toString()}`;

    for (
        let attempt = 1;
        attempt <= GOOGLE_SHEETS_MAX_ATTEMPTS;
        attempt += 1
    ) {
        let response: Response;

        try {
            response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                cache: "no-store",
            });
        } catch (error) {
            if (
                !isTransientGoogleSheetsTransportError(error) ||
                attempt === GOOGLE_SHEETS_MAX_ATTEMPTS
            ) {
                throw new Error(
                    `Google Sheets request failed while reading ${ORIGIN_MAP_SHEET_NAME}: ${errorText(error)}`,
                );
            }

            console.warn(
                "[origin-map-attribution] transient Google Sheets transport failure; retrying",
                {
                    attempt,
                    max_attempts: GOOGLE_SHEETS_MAX_ATTEMPTS,
                    sheet_name: ORIGIN_MAP_SHEET_NAME,
                    error: errorText(error),
                },
            );

            await wait(getGoogleRetryDelay(attempt));
            continue;
        }

        if (response.ok) {
            const payload = (await response.json()) as GoogleValuesResponse;
            return {
                rows: payload.values ?? [],
                attempts: attempt,
            };
        }

        const responseText = await response.text();
        const responseError =
            `Google Sheets error while reading ${ORIGIN_MAP_SHEET_NAME}: ` +
            `${response.status} - ${responseText}`;

        if (
            !GOOGLE_SHEETS_RETRYABLE_STATUSES.has(response.status) ||
            attempt === GOOGLE_SHEETS_MAX_ATTEMPTS
        ) {
            throw new Error(responseError);
        }

        console.warn(
            "[origin-map-attribution] transient Google Sheets response; retrying",
            {
                attempt,
                max_attempts: GOOGLE_SHEETS_MAX_ATTEMPTS,
                status: response.status,
                sheet_name: ORIGIN_MAP_SHEET_NAME,
            },
        );

        await wait(getGoogleRetryDelay(attempt, response.headers));
    }

    throw new Error("Google Sheets request failed after retries.");
}

function parseOriginMap(rows: string[][]) {
    const headerRowIndex = rows.findIndex((row) => {
        const headers = row.map(normalizeHeader);
        return (
            headers.includes("mensagem") &&
            headers.includes("origem") &&
            (headers.includes("tunnel") || headers.includes("tunel"))
        );
    });

    if (headerRowIndex < 0) {
        throw new Error(
            `The ${ORIGIN_MAP_SHEET_NAME} sheet must contain the columns Mensagem, Origem and Tunnel.`,
        );
    }

    const headers = rows[headerRowIndex]!.map(normalizeHeader);
    const messageColumn = headers.indexOf("mensagem");
    const originColumn = headers.indexOf("origem");
    const tunnelColumn = Math.max(
        headers.indexOf("tunnel"),
        headers.indexOf("tunel"),
    );
    const entries = new Map<string, OriginMapEntry>();
    const ambiguousKeys = new Set<string>();

    for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
        const row = rows[index] ?? [];
        const message = cleanCell(row[messageColumn]);
        const origin = cleanCell(row[originColumn]);
        const tunnel = cleanCell(row[tunnelColumn]);
        const normalizedMessage = normalizeMessage(message);

        if (!normalizedMessage || (!origin && !tunnel)) continue;
        if (ambiguousKeys.has(normalizedMessage)) continue;

        const entry: OriginMapEntry = {
            message: message!,
            origin,
            tunnel,
            row_number: index + 1,
        };
        const existing = entries.get(normalizedMessage);

        if (!existing) {
            entries.set(normalizedMessage, entry);
            continue;
        }

        if (
            normalizeNullable(existing.origin) === normalizeNullable(origin) &&
            normalizeNullable(existing.tunnel) === normalizeNullable(tunnel)
        ) {
            continue;
        }

        entries.delete(normalizedMessage);
        ambiguousKeys.add(normalizedMessage);
    }

    return {
        entries,
        ambiguousMessages: ambiguousKeys.size,
    };
}

async function loadConversations(ids: string[]) {
    const rows: ConversationRow[] = [];

    for (const batch of chunk(ids, QUERY_BATCH_SIZE)) {
        const { data, error } = await supabase
            .from("conversations")
            .select("id, client_id, origin, tunnel")
            .in("id", batch)
            .not("ended_at", "is", null);

        if (error) {
            throw new Error(
                `Failed to load conversations for origin attribution: ${error.message}`,
            );
        }

        rows.push(...((data ?? []) as ConversationRow[]));
    }

    return rows;
}

async function loadMessages(
    ids: string[],
    senderType: "client" | "attendant",
) {
    const rows: MessageRow[] = [];

    for (const batch of chunk(ids, QUERY_BATCH_SIZE)) {
        const { data, error } = await supabase
            .from("messages")
            .select("id, conversation_id, text, sent_at, sequence_index")
            .in("conversation_id", batch)
            .eq("sender_type", senderType)
            .order("sent_at", { ascending: true })
            .order("sequence_index", { ascending: true })
            .order("id", { ascending: true });

        if (error) {
            throw new Error(
                `Failed to load ${senderType} messages for attribution: ${error.message}`,
            );
        }

        rows.push(...((data ?? []) as MessageRow[]));
    }

    return rows;
}

function groupMessagesByConversation(messages: MessageRow[]) {
    const grouped = new Map<string, MessageRow[]>();

    for (const message of messages) {
        if (!message.conversation_id) continue;
        const current = grouped.get(message.conversation_id) ?? [];
        current.push(message);
        grouped.set(message.conversation_id, current);
    }

    return grouped;
}

function findConversationMatch(
    messages: MessageRow[],
    entries: Map<string, OriginMapEntry>,
) {
    for (const message of messages) {
        const normalizedText = normalizeMessage(message.text);
        if (!normalizedText) continue;

        const entry = entries.get(normalizedText);
        if (entry) return { message, entry };
    }

    return null;
}

function findLatestClosingTagMatch(messages: MessageRow[]) {
    let latest:
        | {
              message: MessageRow;
              closingTag: ClosingTag;
          }
        | null = null;

    for (const message of messages) {
        const normalizedText = normalizeMessage(message.text);
        if (!normalizedText) continue;

        const closingTag = CLOSING_TAG_BY_MESSAGE.get(normalizedText);
        if (!closingTag) continue;

        latest = { message, closingTag };
    }

    return latest;
}

async function syncClientClosingTags(items: ClientClosingTagUpdate[]) {
    let updatedClients = 0;
    let matchedClients = 0;

    for (const batch of chunk(items, CLOSING_TAG_RPC_BATCH_SIZE)) {
        const { data, error } = await supabase.rpc(
            "sync_client_last_closing_tags",
            {
                p_items: batch,
            },
        );

        if (error) {
            throw new Error(
                `Failed to sync client closing tags: ${error.message}`,
            );
        }

        const row = Array.isArray(data) ? data[0] : data;
        updatedClients += Number(row?.updated_clients ?? 0);
        matchedClients += Number(row?.matched_clients ?? 0);
    }

    return {
        updated_clients: updatedClients,
        matched_clients: matchedClients,
    };
}

async function getGoogleAccessToken() {
    const auth = new GoogleAuth({
        credentials: {
            client_email: GOOGLE_CLIENT_EMAIL,
            private_key: GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
        },
        scopes: [GOOGLE_SHEETS_SCOPE],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    if (!token.token) {
        throw new Error("Google Sheets access token was not returned.");
    }

    return token.token;
}

function validateEnvironment() {
    const missing = [
        ["GOOGLE_CLIENT_EMAIL", GOOGLE_CLIENT_EMAIL],
        ["GOOGLE_PRIVATE_KEY", GOOGLE_PRIVATE_KEY],
    ]
        .filter(([, value]) => !value)
        .map(([name]) => name);

    if (missing.length > 0) {
        throw new Error(
            `Missing Google Sheets environment variables: ${missing.join(", ")}`,
        );
    }
}

function normalizeMessage(value: string | null | undefined) {
    const cleaned = cleanCell(value);
    if (!cleaned) return null;

    return cleaned
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeHeader(value: string | null | undefined) {
    return (
        normalizeMessage(value)
            ?.replace(/[^a-z0-9]+/g, " ")
            .trim() ?? ""
    );
}

function normalizeNullable(value: string | null) {
    return normalizeMessage(value) ?? "";
}

function cleanCell(value: string | null | undefined) {
    if (typeof value !== "string") return null;

    const cleaned = value
        // Strip transport metadata before whitespace normalization. U+FEFF is
        // both a format character and JavaScript whitespace; collapsing
        // whitespace first would turn an invisible payload inside a word into
        // a real space and prevent an otherwise exact map match.
        .replace(/\p{Cf}/gu, "")
        // U+FFFD is produced by malformed trailing bytes in some imported
        // campaign messages and is not a deliberate map discriminator.
        .replace(/\uFFFD/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return cleaned || null;
}

function quoteSheetName(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
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

function isTransientGoogleSheetsTransportError(error: unknown) {
    return /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|UND_ERR|socket hang up|network connection/i.test(
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

function getGoogleRetryDelay(attempt: number, headers?: Headers) {
    const retryAfter = headers?.get("retry-after");
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
        return Math.min(retryAfterSeconds * 1_000, 10_000);
    }

    return GOOGLE_SHEETS_RETRY_BASE_MS * 2 ** (attempt - 1);
}

function wait(milliseconds: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}
