// lib/conversations/repairConversationsSheetAttribution.ts
import { GoogleAuth } from "google-auth-library";

import { supabase } from "@/lib";

type ConversationRow = {
    id: string;
    client_id: string;
    started_at: string | null;
    ended_at: string | null;
    clients:
        | { phone: string | null }
        | Array<{ phone: string | null }>
        | null;
};

type SheetColumns = {
    phone: number;
    date: number;
    tunnel: number;
    origin: number;
    closingTag: number | null;
    firstRequired: number;
    lastRequired: number;
};

type SheetIndex = {
    columns: SheetColumns;
    phoneRows: string[][];
};

type SheetCandidate = {
    rowNumber: number;
    phone: string;
    date: Date;
    tunnel: string | null;
    origin: string | null;
    closingTag: string | null;
};

type SyncItem = {
    conversation_id: string;
    matched: boolean;
    tunnel: string | null;
    origin: string | null;
};

type GoogleValuesResponse = {
    values?: string[][];
};

type GoogleBatchValuesResponse = {
    valueRanges?: Array<{
        range?: string;
        values?: string[][];
    }>;
};

const SPREADSHEET_ID =
    process.env.SPREADSHEET_ID ??
    "1gjGb6MAJVZGRLbK_EVEXcY9Ijam-pptLvnd2yDSgFI4";
const SHEET_NAME = process.env.SHEET_NAME ?? "Página1";
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

const HEADER_ROW_NUMBER = 2;
const DATA_START_ROW_NUMBER = 3;
const SHEET_INDEX_CACHE_MS = 5 * 60 * 1000;
const MAX_ROWS_PER_PHONE = 250;
const MAX_MATCHED_ROWS_PER_RUN = 10_000;
const BATCH_GET_RANGES_PER_REQUEST = 100;
const SYNC_CHUNK_SIZE = 500;
const BACKLOG_CURSOR_KEY = "conversation_sheet_attribution_backlog_v2";

let sheetIndexCache:
    | {
          expiresAt: number;
          value: SheetIndex;
      }
    | null = null;
let sheetIndexPromise: Promise<SheetIndex> | null = null;

export async function repairConversationsSheetAttribution({
    limit = 2500,
    conversationIds = [],
}: {
    limit?: number;
    conversationIds?: string[];
} = {}) {
    validateEnv();

    const normalizedLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    const uniqueConversationIds = [
        ...new Set(conversationIds.filter(Boolean)),
    ].slice(0, 5000);

    const [targetedConversations, backlogPage] = await Promise.all([
        loadConversationsByIds(uniqueConversationIds),
        loadBacklogPage(normalizedLimit),
    ]);

    const conversations = deduplicateConversations([
        ...targetedConversations,
        ...backlogPage.conversations,
    ]);

    if (conversations.length === 0) {
        await saveBacklogCursor(backlogPage.nextOffset);

        return {
            ...emptyResult(),
            backlog_offset: backlogPage.offset,
            next_backlog_offset: backlogPage.nextOffset,
        };
    }

    const targets = conversations.flatMap((conversation) => {
        const client = normalizeNested(conversation.clients);
        const phone = normalizePhone(client?.phone);

        return phone
            ? [{ conversation, phone }]
            : [];
    });

    if (targets.length === 0) {
        const items = conversations.map<SyncItem>((conversation) => ({
            conversation_id: conversation.id,
            matched: false,
            tunnel: null,
            origin: null,
        }));
        const sync = await syncItems(items);

        await saveBacklogCursor(backlogPage.nextOffset);

        return {
            ...emptyResult(),
            checked_conversations: sync.checked,
            skipped_without_phone: conversations.length,
            backlog_offset: backlogPage.offset,
            next_backlog_offset: backlogPage.nextOffset,
        };
    }

    const accessToken = await getGoogleAccessToken();
    const sheetIndex = await getSheetIndex(accessToken);
    const matchedRows = findMatchedSheetRows({
        phoneRows: sheetIndex.phoneRows,
        targetPhones: targets.map((target) => target.phone),
    });
    const candidates = await getSheetCandidates({
        accessToken,
        columns: sheetIndex.columns,
        rowNumbers: matchedRows.rowNumbers,
    });
    const candidatesByPhone = indexCandidatesByPhone(candidates);
    const closingTagSync = await syncClientClosingTags({
        targets: deduplicateClientTargets(targets),
        candidatesByPhone,
    });
    const targetByConversationId = new Map(
        targets.map((target) => [target.conversation.id, target]),
    );
    const items: SyncItem[] = [];
    let skippedWithoutPhone = 0;
    let skippedWithoutDates = 0;
    let skippedWithoutMatch = 0;
    let matchedConversations = 0;

    for (const conversation of conversations) {
        const target = targetByConversationId.get(conversation.id);

        if (!target) {
            skippedWithoutPhone++;
            items.push({
                conversation_id: conversation.id,
                matched: false,
                tunnel: null,
                origin: null,
            });
            continue;
        }

        const startedAt = parseDate(conversation.started_at);
        const endedAt = parseDate(
            conversation.ended_at ?? conversation.started_at,
        );

        if (!startedAt || !endedAt) {
            skippedWithoutDates++;
            items.push({
                conversation_id: conversation.id,
                matched: false,
                tunnel: null,
                origin: null,
            });
            continue;
        }

        const match = findBestMatch({
            phone: target.phone,
            startedAt,
            endedAt,
            candidatesByPhone,
        });

        if (!match) {
            skippedWithoutMatch++;
            items.push({
                conversation_id: conversation.id,
                matched: false,
                tunnel: null,
                origin: null,
            });
            continue;
        }

        matchedConversations++;
        items.push({
            conversation_id: conversation.id,
            matched: true,
            tunnel: match.tunnel,
            origin: match.origin,
        });
    }

    const sync = await syncItems(items);
    await saveBacklogCursor(backlogPage.nextOffset);

    return {
        checked_conversations: sync.checked,
        updated_conversations: sync.updated,
        matched_conversations: matchedConversations,
        skipped_without_phone: skippedWithoutPhone,
        skipped_without_dates: skippedWithoutDates,
        skipped_without_match: skippedWithoutMatch,
        sheet_phone_rows_read: sheetIndex.phoneRows.length,
        sheet_matched_rows_read: candidates.length,
        sheet_matched_rows_truncated: matchedRows.truncated,
        backlog_offset: backlogPage.offset,
        next_backlog_offset: backlogPage.nextOffset,
        ...closingTagSync,
    };
}

async function loadConversationsByIds(conversationIds: string[]) {
    if (conversationIds.length === 0) {
        return [] as ConversationRow[];
    }

    const conversations: ConversationRow[] = [];

    for (const ids of chunk(conversationIds, 100)) {
        const { data, error } = await supabase
            .from("conversations")
            .select(`
                id,
                client_id,
                started_at,
                ended_at,
                clients!inner (
                    phone
                )
            `)
            .in("id", ids)
            .not("ended_at", "is", null);

        if (error) {
            throw new Error(
                `Failed to load new conversations for spreadsheet attribution: ${error.message}`,
            );
        }

        conversations.push(...((data ?? []) as ConversationRow[]));
    }

    return conversations;
}

async function loadBacklogPage(limit: number) {
    let offset = await loadBacklogCursor();
    let conversations = await loadBacklogRange({ offset, limit });

    if (conversations.length === 0 && offset > 0) {
        offset = 0;
        conversations = await loadBacklogRange({ offset, limit });
    }

    return {
        conversations,
        offset,
        nextOffset:
            conversations.length < limit
                ? 0
                : offset + conversations.length,
    };
}

async function loadBacklogRange({
    offset,
    limit,
}: {
    offset: number;
    limit: number;
}) {
    const { data, error } = await supabase
        .from("conversations")
        .select(`
            id,
            client_id,
            started_at,
            ended_at,
            clients!inner (
                phone
            )
        `)
        .not("ended_at", "is", null)
        .order("ended_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + limit - 1);

    if (error) {
        throw new Error(
            `Failed to load spreadsheet attribution backlog: ${error.message}`,
        );
    }

    return (data ?? []) as ConversationRow[];
}

async function loadBacklogCursor() {
    const { data, error } = await supabase
        .from("integration_sync_state")
        .select("details")
        .eq("key", BACKLOG_CURSOR_KEY)
        .maybeSingle();

    if (error) {
        throw new Error(
            `Failed to load spreadsheet attribution cursor: ${error.message}`,
        );
    }

    const details =
        data?.details &&
        typeof data.details === "object" &&
        !Array.isArray(data.details)
            ? (data.details as Record<string, unknown>)
            : {};
    const parsed = Number(details.offset ?? 0);

    return Number.isFinite(parsed) && parsed >= 0
        ? Math.floor(parsed)
        : 0;
}

async function saveBacklogCursor(offset: number) {
    const now = new Date().toISOString();
    const { error } = await supabase
        .from("integration_sync_state")
        .upsert(
            {
                key: BACKLOG_CURSOR_KEY,
                status: "completed",
                started_at: now,
                completed_at: now,
                details: {
                    offset: Math.max(0, Math.floor(offset)),
                },
                updated_at: now,
            },
            {
                onConflict: "key",
            },
        );

    if (error) {
        throw new Error(
            `Failed to save spreadsheet attribution cursor: ${error.message}`,
        );
    }
}

function deduplicateConversations(conversations: ConversationRow[]) {
    const byId = new Map<string, ConversationRow>();

    for (const conversation of conversations) {
        byId.set(conversation.id, conversation);
    }

    return [...byId.values()];
}

async function syncItems(items: SyncItem[]) {
    let checked = 0;
    let updated = 0;

    for (const batch of chunk(items, SYNC_CHUNK_SIZE)) {
        const { data, error } = await supabase.rpc(
            "sync_conversation_sheet_attribution",
            { p_items: batch },
        );

        if (error) {
            throw new Error(
                `Failed to persist spreadsheet attribution repair: ${error.message}`,
            );
        }

        const row = Array.isArray(data) ? data[0] : data;
        checked += Number(row?.checked_conversations ?? 0);
        updated += Number(row?.updated_conversations ?? 0);
    }

    return { checked, updated };
}

async function getGoogleAccessToken() {
    const auth = new GoogleAuth({
        credentials: {
            client_email: GOOGLE_CLIENT_EMAIL,
            private_key: GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
        },
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    if (!token.token) {
        throw new Error("Google Sheets access token was not returned.");
    }

    return token.token;
}

async function getSheetIndex(accessToken: string): Promise<SheetIndex> {
    if (sheetIndexCache && sheetIndexCache.expiresAt > Date.now()) {
        return sheetIndexCache.value;
    }

    if (sheetIndexPromise) return sheetIndexPromise;

    sheetIndexPromise = (async () => {
        const headerRange = `${quoteSheetName(SHEET_NAME)}!A${HEADER_ROW_NUMBER}:AZ${HEADER_ROW_NUMBER}`;
        const headerResponse = await getGoogleValues({
            accessToken,
            range: headerRange,
        });
        const headers = headerResponse.values?.[0] ?? [];
        const columns = resolveSheetColumns(headers);
        const phoneColumn = columnIndexToA1(columns.phone);
        const phoneRange = `${quoteSheetName(SHEET_NAME)}!${phoneColumn}${DATA_START_ROW_NUMBER}:${phoneColumn}`;
        const phoneResponse = await getGoogleValues({
            accessToken,
            range: phoneRange,
        });
        const value: SheetIndex = {
            columns,
            phoneRows: phoneResponse.values ?? [],
        };

        sheetIndexCache = {
            expiresAt: Date.now() + SHEET_INDEX_CACHE_MS,
            value,
        };

        return value;
    })().finally(() => {
        sheetIndexPromise = null;
    });

    return sheetIndexPromise;
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
        `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}` +
        `/values/${encodedRange}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(
            `Google Sheets error: ${response.status} - ${await response.text()}`,
        );
    }

    return (await response.json()) as GoogleValuesResponse;
}

function resolveSheetColumns(headers: string[]): SheetColumns {
    const phone = findHeaderIndex(headers, [
        "Telefone",
        "Phone",
        "Whatsapp",
        "WhatsApp",
        "Celular",
    ]);
    const date = findHeaderIndex(headers, [
        "Data Fim",
        "Data Final",
        "Finalizado em",
        "Encerrado em",
        "Data Inicio",
        "Data Início",
        "Criado em",
        "Created At",
        "created_at",
        "Data",
    ]);
    const tunnel = findHeaderIndex(headers, [
        "Tunnel",
        "Túnel",
        "Tunel",
        "Funil",
        "Funnel",
    ]);
    const origin = findHeaderIndex(headers, [
        "Origem",
        "Origin",
        "Fonte",
        "Origem do contato",
    ]);
    const closingTag = findOptionalHeaderIndex(headers, [
        "Tag de fechamento",
        "Tag fechamento",
        "Closing Tag",
    ]);
    const required = [phone, date, tunnel, origin, closingTag].filter(
        (value): value is number => value !== null,
    );

    return {
        phone,
        date,
        tunnel,
        origin,
        closingTag,
        firstRequired: Math.min(...required),
        lastRequired: Math.max(...required),
    };
}

function findHeaderIndex(headers: string[], candidates: string[]) {
    const normalizedHeaders = headers.map(normalizeHeader);

    for (const candidate of candidates) {
        const index = normalizedHeaders.indexOf(normalizeHeader(candidate));
        if (index >= 0) return index;
    }

    const keywords = candidates.map(normalizeHeader);

    for (const candidate of keywords) {
        const fuzzyIndex = normalizedHeaders.findIndex(
            (header) =>
                header.length > 0 &&
                (header.includes(candidate) || candidate.includes(header)),
        );

        if (fuzzyIndex >= 0) return fuzzyIndex;
    }

    throw new Error(
        `Google Sheets column not found. Expected one of: ${candidates.join(", ")}. Available headers: ${headers.join(", ")}`,
    );
}

function findOptionalHeaderIndex(headers: string[], candidates: string[]) {
    try {
        return findHeaderIndex(headers, candidates);
    } catch {
        return null;
    }
}

function findMatchedSheetRows({
    phoneRows,
    targetPhones,
}: {
    phoneRows: string[][];
    targetPhones: string[];
}) {
    const targetPhoneByVariant = new Map<string, string>();
    const rowsByPhone = new Map<string, number[]>();

    for (const phone of new Set(targetPhones)) {
        rowsByPhone.set(phone, []);
        for (const variant of getPhoneVariants(phone)) {
            targetPhoneByVariant.set(variant, phone);
        }
    }

    let totalMatchedRows = 0;
    let truncated = false;

    for (let index = phoneRows.length - 1; index >= 0; index--) {
        const sheetPhone = normalizePhone(phoneRows[index]?.[0]);
        if (!sheetPhone) continue;

        const targetPhone = getPhoneVariants(sheetPhone)
            .map((variant) => targetPhoneByVariant.get(variant))
            .find(Boolean);
        if (!targetPhone) continue;

        const currentRows = rowsByPhone.get(targetPhone)!;
        if (currentRows.length >= MAX_ROWS_PER_PHONE) {
            truncated = true;
            continue;
        }
        if (totalMatchedRows >= MAX_MATCHED_ROWS_PER_RUN) {
            truncated = true;
            if (currentRows.length > 0) continue;
        }

        currentRows.push(DATA_START_ROW_NUMBER + index);
        totalMatchedRows++;
    }

    return {
        rowNumbers: [...new Set([...rowsByPhone.values()].flat())].sort(
            (first, second) => first - second,
        ),
        truncated,
    };
}

async function getSheetCandidates({
    accessToken,
    columns,
    rowNumbers,
}: {
    accessToken: string;
    columns: SheetColumns;
    rowNumbers: number[];
}) {
    const candidates: SheetCandidate[] = [];

    for (const rowNumberChunk of chunk(
        rowNumbers,
        BATCH_GET_RANGES_PER_REQUEST,
    )) {
        const params = new URLSearchParams({
            majorDimension: "ROWS",
            valueRenderOption: "FORMATTED_VALUE",
        });

        for (const rowNumber of rowNumberChunk) {
            params.append(
                "ranges",
                `${quoteSheetName(SHEET_NAME)}!${columnIndexToA1(columns.firstRequired)}${rowNumber}:${columnIndexToA1(columns.lastRequired)}${rowNumber}`,
            );
        }

        const response = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${params.toString()}`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                cache: "no-store",
            },
        );

        if (!response.ok) {
            throw new Error(
                `Google Sheets batch error: ${response.status} - ${await response.text()}`,
            );
        }

        const json = (await response.json()) as GoogleBatchValuesResponse;
        const valueRanges = json.valueRanges ?? [];

        for (let index = 0; index < rowNumberChunk.length; index++) {
            const values = valueRanges[index]?.values?.[0] ?? [];
            const read = (columnIndex: number | null) =>
                columnIndex === null
                    ? ""
                    : String(values[columnIndex - columns.firstRequired] ?? "");
            const phone = normalizePhone(read(columns.phone));
            const date = parseSheetDate(read(columns.date));

            if (!phone || !date) continue;

            candidates.push({
                rowNumber: rowNumberChunk[index],
                phone,
                date,
                tunnel: emptyToNull(read(columns.tunnel)),
                origin: emptyToNull(read(columns.origin)),
                closingTag: emptyToNull(read(columns.closingTag)),
            });
        }
    }

    return candidates;
}

function indexCandidatesByPhone(candidates: SheetCandidate[]) {
    const index = new Map<string, SheetCandidate[]>();

    for (const candidate of candidates) {
        for (const variant of getPhoneVariants(candidate.phone)) {
            const rows = index.get(variant) ?? [];
            rows.push(candidate);
            index.set(variant, rows);
        }
    }

    return index;
}

function deduplicateClientTargets(
    targets: Array<{ conversation: ConversationRow; phone: string }>,
) {
    const byClientId = new Map<
        string,
        { clientId: string; phone: string }
    >();

    for (const target of targets) {
        if (!byClientId.has(target.conversation.client_id)) {
            byClientId.set(target.conversation.client_id, {
                clientId: target.conversation.client_id,
                phone: target.phone,
            });
        }
    }

    return [...byClientId.values()];
}

async function syncClientClosingTags({
    targets,
    candidatesByPhone,
}: {
    targets: Array<{ clientId: string; phone: string }>;
    candidatesByPhone: Map<string, SheetCandidate[]>;
}) {
    const updates: Array<{
        client_id: string;
        closing_tag: string | null;
        closing_tag_at: string;
    }> = [];

    for (const target of targets) {
        const latest = getPhoneVariants(target.phone)
            .flatMap((variant) => candidatesByPhone.get(variant) ?? [])
            .sort((first, second) =>
                first.date.getTime() !== second.date.getTime()
                    ? second.date.getTime() - first.date.getTime()
                    : second.rowNumber - first.rowNumber,
            )[0];

        if (!latest) continue;

        updates.push({
            client_id: target.clientId,
            closing_tag: latest.closingTag,
            closing_tag_at: latest.date.toISOString(),
        });
    }

    let updatedClients = 0;

    for (const batch of chunk(updates, SYNC_CHUNK_SIZE)) {
        const { data, error } = await supabase.rpc(
            "sync_client_last_closing_tags",
            { p_items: batch },
        );

        if (error) {
            throw new Error(
                `Failed to sync client closing tags during attribution repair: ${error.message}`,
            );
        }

        const row = Array.isArray(data) ? data[0] : data;
        updatedClients += Number(row?.updated_clients ?? 0);
    }

    return {
        updated_client_closing_tags: updatedClients,
        checked_clients_for_closing_tag: targets.length,
    };
}

function findBestMatch({
    phone,
    startedAt,
    endedAt,
    candidatesByPhone,
}: {
    phone: string;
    startedAt: Date;
    endedAt: Date;
    candidatesByPhone: Map<string, SheetCandidate[]>;
}) {
    const windowStart = addDays(startedAt, -1);
    const windowEnd = addDays(endedAt, 1);
    const possibleByRow = new Map<number, SheetCandidate>();

    for (const variant of getPhoneVariants(phone)) {
        for (const candidate of candidatesByPhone.get(variant) ?? []) {
            if (candidate.date >= windowStart && candidate.date <= windowEnd) {
                possibleByRow.set(candidate.rowNumber, candidate);
            }
        }
    }

    return [...possibleByRow.values()].sort((first, second) => {
        const firstScore = dateDistance(first.date, startedAt, endedAt);
        const secondScore = dateDistance(second.date, startedAt, endedAt);

        return firstScore !== secondScore
            ? firstScore - secondScore
            : second.rowNumber - first.rowNumber;
    })[0] ?? null;
}

function dateDistance(candidate: Date, start: Date, end: Date) {
    const value = candidate.getTime();
    const startValue = start.getTime();
    const endValue = end.getTime();

    if (value >= startValue && value <= endValue) return 0;
    return Math.min(Math.abs(value - startValue), Math.abs(value - endValue));
}

function parseSheetDate(value: string | null | undefined) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return null;

    if (/^\d+(?:[.,]\d+)?$/.test(trimmed)) {
        const numericValue = Number(trimmed.replace(",", "."));

        if (Number.isFinite(numericValue)) {
            if (numericValue > 1_000_000_000_000) {
                return new Date(numericValue);
            }

            if (numericValue > 1_000_000_000) {
                return new Date(numericValue * 1000);
            }

            if (numericValue > 20_000 && numericValue < 100_000) {
                const epoch = Date.UTC(1899, 11, 30);
                return new Date(epoch + numericValue * 86_400_000);
            }
        }
    }

    const brazilian = trimmed.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );

    if (brazilian) {
        const [, day, month, year, hour = "0", minute = "0", second = "0"] =
            brazilian;
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

    const nativeDate = new Date(trimmed);
    return Number.isNaN(nativeDate.getTime()) ? null : nativeDate;
}

function normalizePhone(value: string | null | undefined) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (!digits) return null;
    if (digits.startsWith("55")) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
}

function getPhoneVariants(phone: string) {
    const variants = new Set([phone]);

    if (phone.startsWith("55")) variants.add(phone.slice(2));
    else variants.add(`55${phone}`);

    const withoutCountry = phone.startsWith("55") ? phone.slice(2) : phone;
    if (withoutCountry.length === 11 && withoutCountry[2] === "9") {
        variants.add(`55${withoutCountry.slice(0, 2)}${withoutCountry.slice(3)}`);
        variants.add(`${withoutCountry.slice(0, 2)}${withoutCountry.slice(3)}`);
    } else if (withoutCountry.length === 10) {
        variants.add(`55${withoutCountry.slice(0, 2)}9${withoutCountry.slice(2)}`);
        variants.add(`${withoutCountry.slice(0, 2)}9${withoutCountry.slice(2)}`);
    }

    return [...variants];
}

function normalizeHeader(value: string) {
    return String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .trim()
        .toLocaleLowerCase("pt-BR");
}

function quoteSheetName(value: string) {
    return `'${value.replaceAll("'", "''")}'`;
}

function columnIndexToA1(index: number) {
    let value = index + 1;
    let result = "";

    while (value > 0) {
        const remainder = (value - 1) % 26;
        result = String.fromCharCode(65 + remainder) + result;
        value = Math.floor((value - 1) / 26);
    }

    return result;
}

function parseDate(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number) {
    const copy = new Date(date);
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
}

function emptyToNull(value: string | null | undefined) {
    const normalized = String(value ?? "").trim();
    return normalized || null;
}

function normalizeNested<T>(value: T | T[] | null | undefined) {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function chunk<T>(values: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

function emptyResult() {
    return {
        checked_conversations: 0,
        updated_conversations: 0,
        matched_conversations: 0,
        skipped_without_phone: 0,
        skipped_without_dates: 0,
        skipped_without_match: 0,
        sheet_phone_rows_read: 0,
        sheet_matched_rows_read: 0,
        sheet_matched_rows_truncated: false,
        updated_client_closing_tags: 0,
        checked_clients_for_closing_tag: 0,
        backlog_offset: 0,
        next_backlog_offset: 0,
    };
}

function validateEnv() {
    const missing = [
        ["GOOGLE_CLIENT_EMAIL", GOOGLE_CLIENT_EMAIL],
        ["GOOGLE_PRIVATE_KEY", GOOGLE_PRIVATE_KEY],
    ]
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missing.length > 0) {
        throw new Error(
            `Missing Google Sheets environment variables: ${missing.join(", ")}`,
        );
    }
}
