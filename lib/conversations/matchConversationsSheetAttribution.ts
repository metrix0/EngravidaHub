// lib/conversations/matchConversationsSheetAttribution.ts
import { GoogleAuth } from "google-auth-library";

import { supabase } from "@/lib";

type MatchInput = {
    limit?: number;
    conversationIds?: string[];
};

type SheetRow = Record<string, string>;

type SheetCandidate = {
    row: SheetRow;
    phone: string;
    date: Date;
    tunnel: string | null;
    origin: string | null;
};

type ConversationToMatch = {
    id: string;
    started_at: string | null;
    ended_at: string | null;
    tunnel: string | null;
    origin: string | null;
    conversations?: never;
    clients:
        | {
        phone: string | null;
    }
        | {
        phone: string | null;
    }[]
        | null;
};

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

export async function matchConversationsSheetAttribution({
                                                             limit = 1000,
                                                             conversationIds,
                                                         }: MatchInput) {
    if (conversationIds && conversationIds.length === 0) {
        return {
            updated_conversations: 0,
            skipped_without_phone: 0,
            skipped_without_dates: 0,
            skipped_without_match: 0,
            checked_conversations: 0,
        };
    }

    validateEnv();

    console.log("[matchConversationsSheetAttribution] started", {
        limit,
        conversation_ids_count: conversationIds?.length ?? null,
    });

    const [rows, conversations] = await Promise.all([
        getSheetRows(),
        getConversationsToMatch({ limit, conversationIds }),
    ]);

    const candidates = buildSheetCandidates(rows);

    console.log("[matchConversationsSheetAttribution] loaded data", {
        sheet_rows: rows.length,
        sheet_candidates: candidates.length,
        conversations: conversations.length,
    });

    let updatedConversations = 0;
    let skippedWithoutPhone = 0;
    let skippedWithoutDates = 0;
    let skippedWithoutMatch = 0;

    for (const conversation of conversations) {
        const client = Array.isArray(conversation.clients)
            ? conversation.clients[0]
            : conversation.clients;

        const phone = normalizePhone(client?.phone ?? null);

        if (!phone) {
            skippedWithoutPhone++;
            continue;
        }

        const startedAt = parseDate(conversation.started_at);
        const endedAt = parseDate(conversation.ended_at ?? conversation.started_at);

        if (!startedAt || !endedAt) {
            skippedWithoutDates++;
            continue;
        }

        const match = findBestSheetMatch({
            phone,
            startedAt,
            endedAt,
            candidates,
        });

        if (!match) {
            skippedWithoutMatch++;
            continue;
        }

        const updatePayload: Record<string, string> = {};

        if (!conversation.tunnel && match.tunnel) {
            updatePayload.tunnel = match.tunnel;
        }

        if (!conversation.origin && match.origin) {
            updatePayload.origin = match.origin;
        }

        if (Object.keys(updatePayload).length === 0) {
            continue;
        }

        const { error } = await supabase
            .from("conversations")
            .update({
                ...updatePayload,
                updated_at: new Date().toISOString(),
            })
            .eq("id", conversation.id);

        if (error) {
            throw new Error(
                `Failed to update conversation sheet attribution: ${error.message}`
            );
        }

        updatedConversations++;

        console.log("[matchConversationsSheetAttribution] matched conversation", {
            conversation_id: conversation.id,
            phone,
            started_at: conversation.started_at,
            ended_at: conversation.ended_at,
            tunnel: updatePayload.tunnel ?? null,
            origin: updatePayload.origin ?? null,
            sheet_date: match.date.toISOString(),
            score_ms: getDateDistanceScore({
                candidateDate: match.date,
                startedAt,
                endedAt,
            }),
        });
    }

    const result = {
        updated_conversations: updatedConversations,
        skipped_without_phone: skippedWithoutPhone,
        skipped_without_dates: skippedWithoutDates,
        skipped_without_match: skippedWithoutMatch,
        checked_conversations: conversations.length,
    };

    console.log("[matchConversationsSheetAttribution] finished", result);

    return result;
}

async function getConversationsToMatch({
                                           limit,
                                           conversationIds,
                                       }: {
    limit: number;
    conversationIds?: string[];
}) {
    const chunks = conversationIds?.length
        ? chunk(conversationIds.slice(0, limit), 100)
        : [null];

    const result: ConversationToMatch[] = [];

    for (const idsChunk of chunks) {
        let query = supabase
            .from("conversations")
            .select(
                `
                id,
                started_at,
                ended_at,
                tunnel,
                origin,
                clients!inner (
                    phone
                )
            `
            )
            .not("ended_at", "is", null)
            .or("tunnel.is.null,origin.is.null")
            .order("ended_at", { ascending: true })
            .limit(limit);

        if (idsChunk) {
            query = query.in("id", idsChunk);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(
                `Failed to fetch conversations for sheet attribution: ${error.message}`
            );
        }

        result.push(...((data ?? []) as ConversationToMatch[]));
    }

    return result.slice(0, limit);
}

async function getSheetRows(): Promise<SheetRow[]> {
    const auth = new GoogleAuth({
        credentials: {
            client_email: GOOGLE_CLIENT_EMAIL,
            private_key: GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
        },
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const encodedRange = encodeURIComponent(`${SHEET_NAME}!A:Z`);

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token.token}`,
        },
    });

    if (!response.ok) {
        throw new Error(
            `Google Sheets error: ${response.status} - ${await response.text()}`
        );
    }

    const json = await response.json();

    const sheetRows = json.values ?? [];

    const headers = sheetRows[1];
    const rows = sheetRows.slice(2);

    if (!headers || rows.length === 0) {
        return [];
    }

    return rows.map((row: string[]) =>
        Object.fromEntries(
            headers.map((header: string, index: number) => [
                String(header).trim(),
                row[index] ?? "",
            ])
        )
    );
}

function buildSheetCandidates(rows: SheetRow[]): SheetCandidate[] {
    const candidates: SheetCandidate[] = [];

    for (const row of rows) {
        const phone = normalizePhone(getFirstColumnValue(row, ["Telefone", "Phone"]));

        if (!phone) continue;

        const date = parseSheetDate(
            getFirstColumnValue(row, [
                "Data Fim",
                "Data Final",
                "Data Inicio",
                "Data Início",
                "Data",
                "Criado em",
                "Created At",
                "created_at",
            ])
        );

        if (!date) continue;

        const tunnel = emptyToNull(
            getFirstColumnValue(row, ["Tunnel", "Túnel", "Funil"])
        );

        const origin = emptyToNull(
            getFirstColumnValue(row, ["Origem", "Origin", "Fonte", "Origem do contato"])
        );

        if (!tunnel && !origin) continue;

        candidates.push({
            row,
            phone,
            date,
            tunnel,
            origin,
        });
    }

    return candidates;
}

function findBestSheetMatch({
                                phone,
                                startedAt,
                                endedAt,
                                candidates,
                            }: {
    phone: string;
    startedAt: Date;
    endedAt: Date;
    candidates: SheetCandidate[];
}) {
    const windowStart = addDays(startedAt, -1);
    const windowEnd = addDays(endedAt, 1);

    const phoneVariants = getPhoneVariants(phone);

    const possibleMatches = candidates.filter((candidate) => {
        if (!phoneVariants.includes(candidate.phone)) return false;

        return candidate.date >= windowStart && candidate.date <= windowEnd;
    });

    if (possibleMatches.length === 0) {
        return null;
    }

    return possibleMatches.sort((a, b) => {
        const aScore = getDateDistanceScore({
            candidateDate: a.date,
            startedAt,
            endedAt,
        });

        const bScore = getDateDistanceScore({
            candidateDate: b.date,
            startedAt,
            endedAt,
        });

        return aScore - bScore;
    })[0];
}

function getDateDistanceScore({
                                  candidateDate,
                                  startedAt,
                                  endedAt,
                              }: {
    candidateDate: Date;
    startedAt: Date;
    endedAt: Date;
}) {
    const candidateMs = candidateDate.getTime();
    const startMs = startedAt.getTime();
    const endMs = endedAt.getTime();

    if (candidateMs >= startMs && candidateMs <= endMs) {
        return 0;
    }

    return Math.min(
        Math.abs(candidateMs - startMs),
        Math.abs(candidateMs - endMs)
    );
}

function getFirstColumnValue(row: SheetRow, columns: string[]) {
    for (const column of columns) {
        const value = row[column];

        if (value !== undefined && String(value).trim() !== "") {
            return String(value);
        }
    }

    return "";
}

function normalizePhone(value: string | null | undefined) {
    if (!value) return null;

    const digits = String(value).replace(/\D/g, "");

    if (!digits) return null;

    if (digits.startsWith("55")) {
        return digits;
    }

    if (digits.length === 10 || digits.length === 11) {
        return `55${digits}`;
    }

    return digits;
}

function getPhoneVariants(phone: string) {
    const variants = new Set<string>();

    variants.add(phone);

    if (phone.startsWith("55")) {
        variants.add(phone.slice(2));
    } else {
        variants.add(`55${phone}`);
    }

    return Array.from(variants);
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
        /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );

    if (!match) return null;

    const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;

    const fullYear = year.length === 2 ? `20${year}` : year;

    return new Date(
        Date.UTC(
            Number(fullYear),
            Number(month) - 1,
            Number(day),
            Number(hour) + 3,
            Number(minute),
            Number(second)
        )
    );
}

function parseDate(value: string | null | undefined) {
    if (!value) return null;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return null;

    return date;
}

function addDays(date: Date, days: number) {
    const copy = new Date(date);

    copy.setDate(copy.getDate() + days);

    return copy;
}

function emptyToNull(value: string | null | undefined) {
    if (!value) return null;

    const trimmed = String(value).trim();

    return trimmed ? trimmed : null;
}

function chunk<T>(values: T[], size: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }

    return chunks;
}

function validateEnv() {
    const missing = [
        ["SPREADSHEET_ID", SPREADSHEET_ID],
        ["SHEET_NAME", SHEET_NAME],
        ["GOOGLE_CLIENT_EMAIL", GOOGLE_CLIENT_EMAIL],
        ["GOOGLE_PRIVATE_KEY", GOOGLE_PRIVATE_KEY],
    ].filter(([, value]) => !value);

    if (missing.length > 0) {
        throw new Error(
            `Missing Google Sheets envs: ${missing
                .map(([key]) => key)
                .join(", ")}`
        );
    }
}
