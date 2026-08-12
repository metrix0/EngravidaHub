// lib/conversations/matchConversationsSheetAttribution.ts
import { GoogleAuth } from "google-auth-library";

import { supabase } from "@/lib";

const CLOSING_TAG_SPREADSHEET_ID =
    process.env.CLOSING_TAG_SPREADSHEET_ID ??
    "1mgAYbPE-Kvhv7Tl-MJGVaKKaaiCHRODvatzuSmHrGq8";
const CLOSING_TAG_SHEET_GID = Number(
    process.env.CLOSING_TAG_SHEET_GID ?? "0",
);
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const GOOGLE_SHEETS_SCOPE =
    "https://www.googleapis.com/auth/spreadsheets.readonly";

const HEADER_SCAN_ROWS = 10;
const DATA_PAGE_SIZE = 5_000;
const CLIENT_PAGE_SIZE = 1_000;
const RPC_BATCH_SIZE = 500;

type GoogleValuesResponse = {
    values?: string[][];
};

type GoogleSpreadsheetMetadata = {
    sheets?: Array<{
        properties?: {
            sheetId?: number;
            title?: string;
        };
    }>;
};

type ClosingTagColumns = {
    phone: number;
    closingTag: number;
    date: number | null;
};

type ClosingTagCandidate = {
    phone: string;
    closingTag: string;
    closingTagAt: string;
    rowNumber: number;
};

type ClientRow = {
    id: string;
    phone: string | null;
};

type ConversationClientRow = {
    id: string;
    client_id: string | null;
    clients:
        | {
              phone: string | null;
          }
        | {
              phone: string | null;
          }[]
        | null;
};

export async function syncClosingTagsForConversations({
    conversationIds,
}: {
    conversationIds: string[];
}) {
    const uniqueConversationIds = Array.from(
        new Set(conversationIds.filter(Boolean)),
    );

    if (uniqueConversationIds.length === 0) {
        return emptySyncResult();
    }

    const targets = await loadClientsFromConversations(uniqueConversationIds);

    if (targets.length === 0) {
        return {
            ...emptySyncResult(),
            checked_conversations: uniqueConversationIds.length,
        };
    }

    const candidates = await loadClosingTagCandidates();
    const latestCandidateByPhone = indexLatestCandidateByPhone(candidates);
    const updates = buildUpdatesForClients(targets, latestCandidateByPhone);
    const syncResult = await syncClientClosingTags(updates);

    return {
        spreadsheet_id: CLOSING_TAG_SPREADSHEET_ID,
        checked_conversations: uniqueConversationIds.length,
        checked_clients: targets.length,
        sheet_candidates: candidates.length,
        matched_clients: updates.length,
        updated_clients: syncResult.updated_clients,
    };
}

export async function backfillClosingTagsFromLastDays({
    days = 30,
}: {
    days?: number;
} = {}) {
    const normalizedDays = Math.max(1, Math.min(365, Math.floor(days)));
    const cutoff = new Date(
        Date.now() - normalizedDays * 24 * 60 * 60 * 1000,
    );
    const candidates = (await loadClosingTagCandidates()).filter(
        (candidate) => new Date(candidate.closingTagAt) >= cutoff,
    );
    const latestCandidateByPhone = indexLatestCandidateByPhone(candidates);

    let checkedClients = 0;
    let matchedClients = 0;
    let updatedClients = 0;

    for (let from = 0; ; from += CLIENT_PAGE_SIZE) {
        const { data, error } = await supabase
            .from("clients")
            .select("id, phone")
            .order("id", { ascending: true })
            .range(from, from + CLIENT_PAGE_SIZE - 1);

        if (error) {
            throw new Error(
                `Failed to load clients for closing-tag backfill: ${error.message}`,
            );
        }

        const clients = (data ?? []) as ClientRow[];
        checkedClients += clients.length;

        const updates = buildUpdatesForClients(
            clients,
            latestCandidateByPhone,
        );
        matchedClients += updates.length;

        const syncResult = await syncClientClosingTags(updates);
        updatedClients += syncResult.updated_clients;

        if (clients.length < CLIENT_PAGE_SIZE) {
            break;
        }
    }

    return {
        spreadsheet_id: CLOSING_TAG_SPREADSHEET_ID,
        days: normalizedDays,
        cutoff: cutoff.toISOString(),
        sheet_candidates: candidates.length,
        checked_clients: checkedClients,
        matched_clients: matchedClients,
        updated_clients: updatedClients,
    };
}

function emptySyncResult() {
    return {
        spreadsheet_id: CLOSING_TAG_SPREADSHEET_ID,
        checked_conversations: 0,
        checked_clients: 0,
        sheet_candidates: 0,
        matched_clients: 0,
        updated_clients: 0,
    };
}

async function loadClientsFromConversations(conversationIds: string[]) {
    const clientById = new Map<string, ClientRow>();

    for (const ids of chunk(conversationIds, 100)) {
        const { data, error } = await supabase
            .from("conversations")
            .select("id, client_id, clients!left(phone)")
            .in("id", ids);

        if (error) {
            throw new Error(
                `Failed to load conversation clients for closing-tag sync: ${error.message}`,
            );
        }

        for (const conversation of (data ?? []) as ConversationClientRow[]) {
            if (!conversation.client_id) continue;

            const client = normalizeNested(conversation.clients);

            if (!clientById.has(conversation.client_id)) {
                clientById.set(conversation.client_id, {
                    id: conversation.client_id,
                    phone: client?.phone ?? null,
                });
            }
        }
    }

    return [...clientById.values()];
}

async function loadClosingTagCandidates() {
    validateEnvironment();

    const accessToken = await getGoogleAccessToken();
    const sheetName = await resolveClosingTagSheetName(accessToken);
    const headerResponse = await getGoogleValues({
        accessToken,
        range: `${quoteSheetName(sheetName)}!A1:Z${HEADER_SCAN_ROWS}`,
    });
    const headerRows = headerResponse.values ?? [];
    const resolved = resolveHeaderRow(headerRows);
    const candidates: ClosingTagCandidate[] = [];

    for (
        let startRow = resolved.headerRowNumber + 1;
        ;
        startRow += DATA_PAGE_SIZE
    ) {
        const endRow = startRow + DATA_PAGE_SIZE - 1;
        const response = await getGoogleValues({
            accessToken,
            range: `${quoteSheetName(sheetName)}!A${startRow}:Z${endRow}`,
        });
        const rows = response.values ?? [];

        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index] ?? [];
            const phone = normalizePhone(row[resolved.columns.phone]);
            const closingTag = cleanCell(row[resolved.columns.closingTag]);

            if (!phone || !closingTag) continue;

            const dateValue =
                resolved.columns.date === null
                    ? null
                    : row[resolved.columns.date];
            const parsedDate = parseSheetDate(dateValue);

            if (!parsedDate) continue;

            candidates.push({
                phone,
                closingTag,
                closingTagAt: parsedDate.toISOString(),
                rowNumber: startRow + index,
            });
        }

        if (rows.length < DATA_PAGE_SIZE) {
            break;
        }
    }

    return candidates;
}

async function resolveClosingTagSheetName(accessToken: string) {
    const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${CLOSING_TAG_SPREADSHEET_ID}` +
        "?fields=sheets.properties(sheetId,title)";
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(
            `Google Sheets metadata error: ${response.status} - ${await response.text()}`,
        );
    }

    const metadata = (await response.json()) as GoogleSpreadsheetMetadata;
    const matchingSheet = metadata.sheets?.find(
        (sheet) => sheet.properties?.sheetId === CLOSING_TAG_SHEET_GID,
    );
    const title = matchingSheet?.properties?.title;

    if (!title) {
        throw new Error(
            `Closing-tag spreadsheet sheet gid ${CLOSING_TAG_SHEET_GID} was not found.`,
        );
    }

    return title;
}

function resolveHeaderRow(rows: string[][]) {
    for (let index = 0; index < rows.length; index += 1) {
        const headers = rows[index] ?? [];
        const columns = resolveClosingTagColumns(headers);

        if (columns) {
            return {
                headerRowNumber: index + 1,
                columns,
            };
        }
    }

    throw new Error(
        "Closing-tag spreadsheet must contain phone/telefone and closing-tag columns, plus a date column.",
    );
}

function resolveClosingTagColumns(
    headers: string[],
): ClosingTagColumns | null {
    const normalized = headers.map(normalizeHeader);
    const phone = findFirstHeader(normalized, [
        "telefone",
        "phone",
        "telefone cliente",
        "telefone do cliente",
        "numero",
        "número",
    ]);
    const closingTag = findFirstHeader(normalized, [
        "tag de fechamento",
        "tag fechamento",
        "closing tag",
        "closing_tag",
        "ultima tag de fechamento",
        "última tag de fechamento",
    ]);
    const date = findFirstHeader(normalized, [
        "data fim",
        "data final",
        "data de fechamento",
        "data fechamento",
        "closed at",
        "closed_at",
        "data",
        "criado em",
        "created at",
        "created_at",
    ]);

    if (phone === null || closingTag === null || date === null) {
        return null;
    }

    return {
        phone,
        closingTag,
        date,
    };
}

function indexLatestCandidateByPhone(candidates: ClosingTagCandidate[]) {
    const index = new Map<string, ClosingTagCandidate>();

    for (const candidate of candidates) {
        for (const variant of getPhoneVariants(candidate.phone)) {
            const current = index.get(variant);

            if (
                !current ||
                candidate.closingTagAt > current.closingTagAt ||
                (candidate.closingTagAt === current.closingTagAt &&
                    candidate.rowNumber > current.rowNumber)
            ) {
                index.set(variant, candidate);
            }
        }
    }

    return index;
}

function buildUpdatesForClients(
    clients: ClientRow[],
    candidatesByPhone: Map<string, ClosingTagCandidate>,
) {
    const updates: Array<{
        client_id: string;
        closing_tag: string;
        closing_tag_at: string;
    }> = [];

    for (const client of clients) {
        const phone = normalizePhone(client.phone);

        if (!phone) continue;

        const candidate = getPhoneVariants(phone)
            .map((variant) => candidatesByPhone.get(variant))
            .find(Boolean);

        if (!candidate) continue;

        updates.push({
            client_id: client.id,
            closing_tag: candidate.closingTag,
            closing_tag_at: candidate.closingTagAt,
        });
    }

    return updates;
}

async function syncClientClosingTags(
    updates: Array<{
        client_id: string;
        closing_tag: string;
        closing_tag_at: string;
    }>,
) {
    let updatedClients = 0;

    for (const updatesChunk of chunk(updates, RPC_BATCH_SIZE)) {
        const { data, error } = await supabase.rpc(
            "sync_client_last_closing_tags",
            {
                p_items: updatesChunk,
            },
        );

        if (error) {
            throw new Error(
                `Failed to sync client closing tags: ${error.message}`,
            );
        }

        const firstResult = Array.isArray(data) ? data[0] : data;
        updatedClients += Number(firstResult?.updated_clients ?? 0);
    }

    return {
        updated_clients: updatedClients,
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

async function getGoogleValues({
    accessToken,
    range,
}: {
    accessToken: string;
    range: string;
}) {
    const encodedRange = encodeURIComponent(range);
    const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${CLOSING_TAG_SPREADSHEET_ID}` +
        `/values/${encodedRange}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(
            `Google Sheets error: ${response.status} - ${await response.text()}`,
        );
    }

    return (await response.json()) as GoogleValuesResponse;
}

function parseSheetDate(value: string | null | undefined) {
    if (!value) return null;

    const trimmed = String(value).trim();

    if (!trimmed) return null;

    const nativeDate = new Date(trimmed);

    if (!Number.isNaN(nativeDate.getTime())) {
        return nativeDate;
    }

    const match = trimmed.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );

    if (!match) return null;

    const [
        ,
        day,
        month,
        year,
        hour = "0",
        minute = "0",
        second = "0",
    ] = match;
    const fullYear = year.length === 2 ? `20${year}` : year;

    return new Date(
        Date.UTC(
            Number(fullYear),
            Number(month) - 1,
            Number(day),
            Number(hour) + 3,
            Number(minute),
            Number(second),
        ),
    );
}

function normalizePhone(value: string | null | undefined) {
    if (!value) return null;

    const digits = String(value).replace(/\D/g, "");

    if (!digits) return null;
    if (digits.startsWith("55")) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;

    return digits;
}

function getPhoneVariants(phone: string) {
    const variants = new Set<string>([phone]);

    if (phone.startsWith("55")) {
        variants.add(phone.slice(2));
    } else {
        variants.add(`55${phone}`);
    }

    return [...variants];
}

function findFirstHeader(headers: string[], candidates: string[]) {
    for (const candidate of candidates) {
        const index = headers.indexOf(normalizeHeader(candidate));

        if (index >= 0) return index;
    }

    return null;
}

function normalizeHeader(value: string | null | undefined) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLocaleLowerCase("pt-BR");
}

function cleanCell(value: string | null | undefined) {
    if (typeof value !== "string") return null;

    const cleaned = value.replace(/\s+/g, " ").trim();
    return cleaned || null;
}

function normalizeNested<T>(value: T | T[] | null | undefined) {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

function quoteSheetName(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
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
