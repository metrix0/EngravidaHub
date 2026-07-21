// lib/conversations/matchConversationsSheetAttribution.ts
import { GoogleAuth } from "google-auth-library";

import { supabase } from "@/lib";

type MatchInput = {
    limit?: number;
    conversationIds?: string[];
};

type ConversationToMatch = {
    id: string;
    client_id: string;
    started_at: string | null;
    ended_at: string | null;
    tunnel: string | null;
    origin: string | null;
    clients:
        | {
              phone: string | null;
          }
        | {
              phone: string | null;
          }[]
        | null;
};

type SheetColumns = {
    phone: number;
    date: number;
    closingTag: number;
    tunnel: number | null;
    origin: number | null;
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

type ClientTarget = {
    clientId: string;
    phone: string;
};

type SheetAttributionSyncItem = {
    client_id: string;
    conversation_id: string | null;
    tunnel: string | null;
    origin: string | null;
    apply_to_client: boolean;
    sheet_at: string;
    sheet_row: number;
};

type AttributionBackfillClient = {
    id: string;
    phone: string | null;
    last_tunnel: string | null;
    last_origin: string | null;
};

type AttributionBackfillConversation = {
    id: string;
    client_id: string;
    started_at: string | null;
    ended_at: string | null;
    tunnel: string | null;
    origin: string | null;
};

type ClientBackfillTarget = {
    id: string;
    phone: string;
    needsTunnel: boolean;
    needsOrigin: boolean;
    latestTunnel: SheetCandidate | null;
    latestOrigin: SheetCandidate | null;
};

type ScoredSheetCandidate = {
    candidate: SheetCandidate;
    score: number;
};

type ConversationBackfillTarget = {
    id: string;
    clientId: string;
    phone: string;
    startedAt: Date;
    endedAt: Date;
    needsTunnel: boolean;
    needsOrigin: boolean;
    bestTunnel: ScoredSheetCandidate | null;
    bestOrigin: ScoredSheetCandidate | null;
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
const MAX_ROWS_PER_PHONE = 250;
// Targeted tunnel/origin matching is intentionally bounded. The client closing
// tag backfill below uses one contiguous range and does not use this path.
const MAX_MATCHED_ROWS_PER_RUN = 2500;
const BATCH_GET_RANGES_PER_REQUEST = 100;
const SHEET_INDEX_CACHE_MS = 30_000;
const CLOSING_TAG_BACKFILL_KEY = "closing_tags_recent_50000_v2";
const BACKFILL_RUNNING_STALE_MS = 30 * 60 * 1000;
const BACKFILL_COOLDOWN_MS = 60 * 1000;
const FULL_BACKFILL_SHEET_CHUNK_SIZE = 10_000;
const ATTRIBUTION_RPC_BATCH_SIZE = 500;

let sheetIndexCache:
    | {
          expiresAt: number;
          value: SheetIndex;
      }
    | null = null;
let sheetIndexPromise: Promise<SheetIndex> | null = null;


export async function runClientClosingTagBackfill({
    rowLimit = 10_000,
}: {
    rowLimit?: number;
} = {}) {
    validateEnv();

    const normalizedLimit = Math.max(1, Math.min(50_000, Math.floor(rowLimit)));
    const { data: existingState, error: stateError } = await supabase
        .from("integration_sync_state")
        .select("key, status, started_at, completed_at, details, updated_at")
        .eq("key", CLOSING_TAG_BACKFILL_KEY)
        .maybeSingle();

    if (stateError) {
        throw new Error(
            `Failed to read closing tag backfill state: ${stateError.message}`,
        );
    }

    const completedAt = existingState?.completed_at
        ? new Date(existingState.completed_at).getTime()
        : 0;
    const completedRecently =
        existingState?.status === "completed" &&
        Number.isFinite(completedAt) &&
        Date.now() - completedAt < BACKFILL_COOLDOWN_MS;

    if (completedRecently) {
        return {
            status: "completed" as const,
            skipped: true,
            reason: "cooldown" as const,
            details: existingState.details ?? {},
        };
    }

    const startedAt = existingState?.started_at
        ? new Date(existingState.started_at).getTime()
        : 0;
    const runningIsFresh =
        existingState?.status === "running" &&
        Number.isFinite(startedAt) &&
        Date.now() - startedAt < BACKFILL_RUNNING_STALE_MS;

    if (runningIsFresh) {
        return {
            status: "running" as const,
            skipped: true,
            reason: "already_running" as const,
            details: existingState.details ?? {},
        };
    }

    const now = new Date().toISOString();
    let claimed = false;

    if (!existingState) {
        const { error: insertError } = await supabase
            .from("integration_sync_state")
            .insert({
                key: CLOSING_TAG_BACKFILL_KEY,
                status: "running",
                started_at: now,
                completed_at: null,
                details: {
                    row_limit: normalizedLimit,
                },
                updated_at: now,
            });

        if (!insertError) {
            claimed = true;
        } else if (insertError.code !== "23505") {
            throw new Error(
                `Failed to claim closing tag backfill: ${insertError.message}`,
            );
        }
    } else {
        const { data: claimedRows, error: updateError } = await supabase
            .from("integration_sync_state")
            .update({
                status: "running",
                started_at: now,
                completed_at: null,
                details: {
                    row_limit: normalizedLimit,
                },
                updated_at: now,
            })
            .eq("key", CLOSING_TAG_BACKFILL_KEY)
            .eq("updated_at", existingState.updated_at)
            .select("key");

        if (updateError) {
            throw new Error(
                `Failed to claim closing tag backfill: ${updateError.message}`,
            );
        }

        claimed = (claimedRows ?? []).length === 1;
    }

    if (!claimed) {
        return {
            status: "running" as const,
            skipped: true,
            reason: "claimed_by_another_process" as const,
            details: existingState?.details ?? {},
        };
    }

    try {
        const result = await backfillClientClosingTagsFromRecentRows(
            normalizedLimit,
        );
        const completedAt = new Date().toISOString();
        const { error: completeError } = await supabase
            .from("integration_sync_state")
            .update({
                status: "completed",
                completed_at: completedAt,
                details: result,
                updated_at: completedAt,
            })
            .eq("key", CLOSING_TAG_BACKFILL_KEY);

        if (completeError) {
            throw new Error(
                `Failed to complete closing tag backfill state: ${completeError.message}`,
            );
        }

        return {
            status: "completed" as const,
            skipped: false,
            details: result,
        };
    } catch (error) {
        const failedAt = new Date().toISOString();

        await supabase
            .from("integration_sync_state")
            .update({
                status: "failed",
                details: {
                    row_limit: normalizedLimit,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown closing tag backfill error",
                },
                updated_at: failedAt,
            })
            .eq("key", CLOSING_TAG_BACKFILL_KEY);

        throw error;
    }
}

export async function runFullSheetAttributionBackfill({
    sheetChunkSize = FULL_BACKFILL_SHEET_CHUNK_SIZE,
    rpcBatchSize = ATTRIBUTION_RPC_BATCH_SIZE,
    dryRun = false,
}: {
    sheetChunkSize?: number;
    rpcBatchSize?: number;
    dryRun?: boolean;
} = {}) {
    validateEnv();

    const normalizedSheetChunkSize = Math.max(
        1_000,
        Math.min(20_000, Math.floor(sheetChunkSize)),
    );
    const normalizedRpcBatchSize = Math.max(
        50,
        Math.min(1_000, Math.floor(rpcBatchSize)),
    );
    const [clients, conversations] = await Promise.all([
        loadAttributionBackfillClients(),
        loadAttributionBackfillConversations(),
    ]);
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const clientTargets = clients.flatMap((client) => {
        const phone = normalizePhone(client.phone);
        const needsTunnel = isBlank(client.last_tunnel);
        const needsOrigin = isBlank(client.last_origin);

        if (!phone || (!needsTunnel && !needsOrigin)) return [];

        return [{
            id: client.id,
            phone,
            needsTunnel,
            needsOrigin,
            latestTunnel: null,
            latestOrigin: null,
        } satisfies ClientBackfillTarget];
    });
    const conversationTargets = conversations.flatMap((conversation) => {
        const client = clientsById.get(conversation.client_id);
        const phone = normalizePhone(client?.phone);
        const startedAt = parseDate(conversation.started_at);
        const endedAt = parseDate(
            conversation.ended_at ?? conversation.started_at,
        );
        const needsTunnel = isBlank(conversation.tunnel);
        const needsOrigin = isBlank(conversation.origin);

        if (
            !phone ||
            !startedAt ||
            !endedAt ||
            (!needsTunnel && !needsOrigin)
        ) {
            return [];
        }

        return [{
            id: conversation.id,
            clientId: conversation.client_id,
            phone,
            startedAt,
            endedAt,
            needsTunnel,
            needsOrigin,
            bestTunnel: null,
            bestOrigin: null,
        } satisfies ConversationBackfillTarget];
    });
    const clientsByPhone = indexTargetsByPhone(clientTargets);
    const conversationsByPhone = indexTargetsByPhone(conversationTargets);

    console.log("[sheet-attribution-backfill] targets loaded", {
        clients_read: clients.length,
        conversations_read: conversations.length,
        client_targets: clientTargets.length,
        conversation_targets: conversationTargets.length,
        sheet_chunk_size: normalizedSheetChunkSize,
        rpc_batch_size: normalizedRpcBatchSize,
        dry_run: dryRun,
    });

    const accessToken = await getGoogleAccessToken();
    const sheetIndex = await getSheetIndex(accessToken);
    const lastDataRow =
        DATA_START_ROW_NUMBER + sheetIndex.phoneRows.length - 1;
    let sheetRowsRead = 0;
    let usableSheetRows = 0;
    let relevantSheetRows = 0;

    if (lastDataRow >= DATA_START_ROW_NUMBER) {
        for (
            let firstRow = DATA_START_ROW_NUMBER;
            firstRow <= lastDataRow;
            firstRow += normalizedSheetChunkSize
        ) {
            const lastRow = Math.min(
                lastDataRow,
                firstRow + normalizedSheetChunkSize - 1,
            );
            const rows = await getContiguousSheetCandidateRows({
                accessToken,
                columns: sheetIndex.columns,
                firstRow,
                lastRow,
            });
            sheetRowsRead += rows.length;

            for (let index = 0; index < rows.length; index++) {
                const candidate = parseSheetCandidateRow({
                    values: rows[index] ?? [],
                    columns: sheetIndex.columns,
                    rowNumber: firstRow + index,
                });

                if (!candidate || (!candidate.tunnel && !candidate.origin)) {
                    continue;
                }

                usableSheetRows++;
                const matchingClients = targetsForPhone(
                    clientsByPhone,
                    candidate.phone,
                );
                const matchingConversations = targetsForPhone(
                    conversationsByPhone,
                    candidate.phone,
                );

                if (
                    matchingClients.length === 0 &&
                    matchingConversations.length === 0
                ) {
                    continue;
                }

                relevantSheetRows++;

                for (const client of matchingClients) {
                    if (
                        client.needsTunnel &&
                        candidate.tunnel &&
                        isLaterSheetCandidate(candidate, client.latestTunnel)
                    ) {
                        client.latestTunnel = candidate;
                    }
                    if (
                        client.needsOrigin &&
                        candidate.origin &&
                        isLaterSheetCandidate(candidate, client.latestOrigin)
                    ) {
                        client.latestOrigin = candidate;
                    }
                }

                for (const conversation of matchingConversations) {
                    considerConversationCandidate(conversation, candidate);
                }
            }

            console.log("[sheet-attribution-backfill] sheet chunk scanned", {
                first_row: firstRow,
                last_row: lastRow,
                rows_read: rows.length,
                progress_percentage: Number(
                    (((lastRow - DATA_START_ROW_NUMBER + 1) /
                        Math.max(sheetIndex.phoneRows.length, 1)) *
                        100).toFixed(1),
                ),
            });
        }
    }

    const clientItems = clientTargets.flatMap((target) => {
        const tunnel = target.latestTunnel?.tunnel ?? null;
        const origin = target.latestOrigin?.origin ?? null;

        if (!tunnel && !origin) return [];

        const newestCandidate = newestSheetCandidate([
            target.latestTunnel,
            target.latestOrigin,
        ]);

        return [createSheetAttributionSyncItem({
            clientId: target.id,
            conversationId: null,
            tunnel,
            origin,
            applyToClient: true,
            candidate: newestCandidate,
        })];
    });
    const conversationItems = conversationTargets.flatMap((target) => {
        const tunnel = target.bestTunnel?.candidate.tunnel ?? null;
        const origin = target.bestOrigin?.candidate.origin ?? null;

        if (!tunnel && !origin) return [];

        const newestCandidate = newestSheetCandidate([
            target.bestTunnel?.candidate ?? null,
            target.bestOrigin?.candidate ?? null,
        ]);

        return [createSheetAttributionSyncItem({
            clientId: target.clientId,
            conversationId: target.id,
            tunnel,
            origin,
            applyToClient: false,
            candidate: newestCandidate,
        })];
    });
    const planned = {
        client_rows: clientItems.length,
        conversation_rows: conversationItems.length,
        client_origins: clientItems.filter((item) => Boolean(item.origin))
            .length,
        client_tunnels: clientItems.filter((item) => Boolean(item.tunnel))
            .length,
        conversation_origins: conversationItems.filter((item) =>
            Boolean(item.origin),
        ).length,
        conversation_tunnels: conversationItems.filter((item) =>
            Boolean(item.tunnel),
        ).length,
    };

    const baseResult = {
        ok: true,
        dry_run: dryRun,
        sheet: {
            first_row: lastDataRow >= DATA_START_ROW_NUMBER
                ? DATA_START_ROW_NUMBER
                : null,
            last_row: lastDataRow >= DATA_START_ROW_NUMBER
                ? lastDataRow
                : null,
            rows_read: sheetRowsRead,
            usable_rows: usableSheetRows,
            relevant_rows: relevantSheetRows,
        },
        targets: {
            clients_read: clients.length,
            conversations_read: conversations.length,
            clients_missing_attribution: clientTargets.length,
            conversations_missing_attribution: conversationTargets.length,
        },
        planned,
    };

    if (dryRun) {
        console.log("[sheet-attribution-backfill] dry run finished", baseResult);
        return {
            ...baseResult,
            updated: emptyAttributionSyncResult(),
        };
    }

    // Client values are applied first. The database function and trigger are
    // non-destructive, so the later conversation batches cannot replace them.
    const clientResult = await syncSheetAttributionItems(
        clientItems,
        normalizedRpcBatchSize,
        true,
    );
    const conversationResult = await syncSheetAttributionItems(
        conversationItems,
        normalizedRpcBatchSize,
        true,
    );
    const updated = addAttributionSyncResults(
        clientResult,
        conversationResult,
    );
    const result = { ...baseResult, updated };

    console.log("[sheet-attribution-backfill] completed", result);
    return result;
}

export async function matchConversationsSheetAttribution({
    limit = 1000,
    conversationIds,
}: MatchInput) {
    validateEnv();

    const uniqueConversationIds = conversationIds
        ? Array.from(new Set(conversationIds.filter(Boolean))).slice(0, limit)
        : undefined;

    console.log("[matchConversationsSheetAttribution] started", {
        limit,
        conversation_ids_count: uniqueConversationIds?.length ?? null,
    });

    if (uniqueConversationIds && uniqueConversationIds.length === 0) {
        return emptyResult();
    }

    const conversations = await getConversationsToMatch({
        limit,
        conversationIds: uniqueConversationIds,
    });

    if (conversations.length === 0) {
        const result = emptyResult();

        console.log("[matchConversationsSheetAttribution] finished", result);
        return result;
    }

    const clientTargets = getClientTargets(conversations);

    if (clientTargets.length === 0) {
        const result = {
            ...emptyResult(),
            skipped_without_phone: conversations.length,
            checked_conversations: conversations.length,
        };

        console.log("[matchConversationsSheetAttribution] finished", result);
        return result;
    }

    const accessToken = await getGoogleAccessToken();
    const sheetIndex = await getSheetIndex(accessToken);
    const matchedRows = findMatchedSheetRows({
        phoneRows: sheetIndex.phoneRows,
        targetPhones: clientTargets.map((target) => target.phone),
    });
    const candidates = await getSheetCandidates({
        accessToken,
        columns: sheetIndex.columns,
        rowNumbers: matchedRows.rowNumbers,
    });

    console.log("[matchConversationsSheetAttribution] loaded targeted data", {
        conversations: conversations.length,
        clients: clientTargets.length,
        phone_column_rows: sheetIndex.phoneRows.length,
        matched_sheet_rows: candidates.length,
        matched_rows_truncated: matchedRows.truncated,
    });

    const syncItems: SheetAttributionSyncItem[] = [];
    let skippedWithoutPhone = 0;
    let skippedWithoutDates = 0;
    let skippedWithoutMatch = 0;

    for (const conversation of conversations) {
        const client = normalizeNested(conversation.clients);
        const phone = normalizePhone(client?.phone ?? null);

        if (!phone) {
            skippedWithoutPhone++;
            continue;
        }

        const startedAt = parseDate(conversation.started_at);
        const endedAt = parseDate(
            conversation.ended_at ?? conversation.started_at,
        );

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

        const tunnel = isBlank(conversation.tunnel) ? match.tunnel : null;
        const origin = isBlank(conversation.origin) ? match.origin : null;

        if (!tunnel && !origin) {
            continue;
        }

        syncItems.push(createSheetAttributionSyncItem({
            clientId: conversation.client_id,
            conversationId: conversation.id,
            tunnel,
            origin,
            applyToClient: true,
            candidate: match,
        }));
    }

    const syncResult = await syncSheetAttributionItems(
        syncItems,
        ATTRIBUTION_RPC_BATCH_SIZE,
        false,
    );

    const result = {
        updated_conversations: syncResult.updated_conversations,
        updated_clients: syncResult.updated_clients,
        updated_conversation_tunnels:
            syncResult.updated_conversation_tunnels,
        updated_conversation_origins:
            syncResult.updated_conversation_origins,
        updated_client_tunnels: syncResult.updated_client_tunnels,
        updated_client_origins: syncResult.updated_client_origins,
        skipped_without_phone: skippedWithoutPhone,
        skipped_without_dates: skippedWithoutDates,
        skipped_without_match: skippedWithoutMatch,
        checked_conversations: conversations.length,
        sheet_phone_rows_read: sheetIndex.phoneRows.length,
        sheet_matched_rows_read: candidates.length,
        sheet_matched_rows_truncated: matchedRows.truncated,
    };

    console.log("[matchConversationsSheetAttribution] finished", result);

    return result;
}

function emptyResult() {
    return {
        updated_conversations: 0,
        updated_clients: 0,
        updated_conversation_tunnels: 0,
        updated_conversation_origins: 0,
        updated_client_tunnels: 0,
        updated_client_origins: 0,
        skipped_without_phone: 0,
        skipped_without_dates: 0,
        skipped_without_match: 0,
        checked_conversations: 0,
        sheet_phone_rows_read: 0,
        sheet_matched_rows_read: 0,
        sheet_matched_rows_truncated: false,
    };
}

type AttributionSyncResult = {
    updated_clients: number;
    updated_client_tunnels: number;
    updated_client_origins: number;
    updated_conversations: number;
    updated_conversation_tunnels: number;
    updated_conversation_origins: number;
};

async function syncSheetAttributionItems(
    items: SheetAttributionSyncItem[],
    batchSize = ATTRIBUTION_RPC_BATCH_SIZE,
    preserveExistingClients = true,
) {
    let result = emptyAttributionSyncResult();

    for (const itemsChunk of chunk(items, batchSize)) {
        if (itemsChunk.length === 0) continue;

        const { data, error } = await supabase.rpc(
            "backfill_sheet_attribution_if_missing",
            {
                p_items: itemsChunk,
                p_preserve_existing_clients: preserveExistingClients,
            },
        );

        if (error) {
            throw new Error(
                `Failed to sync sheet tunnel/origin attribution: ${error.message}`,
            );
        }

        const row = Array.isArray(data) ? data[0] : data;
        result = addAttributionSyncResults(result, {
            updated_clients: numberOrZero(row?.updated_clients),
            updated_client_tunnels: numberOrZero(
                row?.updated_client_tunnels,
            ),
            updated_client_origins: numberOrZero(
                row?.updated_client_origins,
            ),
            updated_conversations: numberOrZero(
                row?.updated_conversations,
            ),
            updated_conversation_tunnels: numberOrZero(
                row?.updated_conversation_tunnels,
            ),
            updated_conversation_origins: numberOrZero(
                row?.updated_conversation_origins,
            ),
        });
    }

    return result;
}

function emptyAttributionSyncResult(): AttributionSyncResult {
    return {
        updated_clients: 0,
        updated_client_tunnels: 0,
        updated_client_origins: 0,
        updated_conversations: 0,
        updated_conversation_tunnels: 0,
        updated_conversation_origins: 0,
    };
}

function addAttributionSyncResults(
    first: AttributionSyncResult,
    second: AttributionSyncResult,
): AttributionSyncResult {
    return {
        updated_clients:
            first.updated_clients + second.updated_clients,
        updated_client_tunnels:
            first.updated_client_tunnels + second.updated_client_tunnels,
        updated_client_origins:
            first.updated_client_origins + second.updated_client_origins,
        updated_conversations:
            first.updated_conversations + second.updated_conversations,
        updated_conversation_tunnels:
            first.updated_conversation_tunnels +
            second.updated_conversation_tunnels,
        updated_conversation_origins:
            first.updated_conversation_origins +
            second.updated_conversation_origins,
    };
}

function numberOrZero(value: unknown) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function createSheetAttributionSyncItem({
    clientId,
    conversationId,
    tunnel,
    origin,
    applyToClient,
    candidate,
}: {
    clientId: string;
    conversationId: string | null;
    tunnel: string | null;
    origin: string | null;
    applyToClient: boolean;
    candidate: SheetCandidate | null;
}): SheetAttributionSyncItem {
    return {
        client_id: clientId,
        conversation_id: conversationId,
        tunnel,
        origin,
        apply_to_client: applyToClient,
        sheet_at: (candidate?.date ?? new Date(0)).toISOString(),
        sheet_row: candidate?.rowNumber ?? 0,
    };
}

async function loadAttributionBackfillClients() {
    const rows: AttributionBackfillClient[] = [];
    const pageSize = 1_000;

    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
            .from("clients")
            .select("id, phone, last_tunnel, last_origin")
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(
                `Failed to load clients for sheet attribution backfill: ${error.message}`,
            );
        }

        const page = (data ?? []) as AttributionBackfillClient[];
        rows.push(...page);
        if (page.length < pageSize) break;
    }

    return rows;
}

async function loadAttributionBackfillConversations() {
    const rows: AttributionBackfillConversation[] = [];
    const pageSize = 1_000;

    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
            .from("conversations")
            .select(
                "id, client_id, started_at, ended_at, tunnel, origin",
            )
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(
                `Failed to load conversations for sheet attribution backfill: ${error.message}`,
            );
        }

        const page = (data ?? []) as AttributionBackfillConversation[];
        rows.push(...page);
        if (page.length < pageSize) break;
    }

    return rows;
}

function indexTargetsByPhone<T extends { id: string; phone: string }>(
    targets: T[],
) {
    const index = new Map<string, T[]>();

    for (const target of targets) {
        for (const phone of getPhoneVariants(target.phone)) {
            const values = index.get(phone) ?? [];
            values.push(target);
            index.set(phone, values);
        }
    }

    return index;
}

function targetsForPhone<T extends { id: string }>(
    index: Map<string, T[]>,
    phone: string,
) {
    const matches = new Map<string, T>();

    for (const variant of getPhoneVariants(phone)) {
        for (const target of index.get(variant) ?? []) {
            matches.set(target.id, target);
        }
    }

    return [...matches.values()];
}

async function getContiguousSheetCandidateRows({
    accessToken,
    columns,
    firstRow,
    lastRow,
}: {
    accessToken: string;
    columns: SheetColumns;
    firstRow: number;
    lastRow: number;
}) {
    const range =
        `${quoteSheetName(SHEET_NAME)}!` +
        `${columnIndexToA1(columns.firstRequired)}${firstRow}:` +
        `${columnIndexToA1(columns.lastRequired)}${lastRow}`;
    const response = await getGoogleValues({ accessToken, range });
    return response.values ?? [];
}

function parseSheetCandidateRow({
    values,
    columns,
    rowNumber,
}: {
    values: string[];
    columns: SheetColumns;
    rowNumber: number;
}): SheetCandidate | null {
    const readColumn = (columnIndex: number | null) => {
        if (columnIndex === null) return "";
        return String(values[columnIndex - columns.firstRequired] ?? "");
    };
    const phone = normalizePhone(readColumn(columns.phone));
    const date = parseSheetDate(readColumn(columns.date));

    if (!phone || !date) return null;

    return {
        rowNumber,
        phone,
        date,
        tunnel: emptyToNull(readColumn(columns.tunnel)),
        origin: emptyToNull(readColumn(columns.origin)),
        closingTag: emptyToNull(readColumn(columns.closingTag)),
    };
}

function isLaterSheetCandidate(
    candidate: SheetCandidate,
    current: SheetCandidate | null,
) {
    return (
        !current ||
        candidate.date > current.date ||
        (candidate.date.getTime() === current.date.getTime() &&
            candidate.rowNumber > current.rowNumber)
    );
}

function newestSheetCandidate(
    candidates: Array<SheetCandidate | null | undefined>,
) {
    return candidates.reduce<SheetCandidate | null>((latest, candidate) => {
        if (!candidate) return latest;
        return isLaterSheetCandidate(candidate, latest) ? candidate : latest;
    }, null);
}

function considerConversationCandidate(
    target: ConversationBackfillTarget,
    candidate: SheetCandidate,
) {
    const windowStart = addDays(target.startedAt, -1);
    const windowEnd = addDays(target.endedAt, 1);

    if (candidate.date < windowStart || candidate.date > windowEnd) return;

    const scored = {
        candidate,
        score: getDateDistanceScore({
            candidateDate: candidate.date,
            startedAt: target.startedAt,
            endedAt: target.endedAt,
        }),
    };

    if (
        target.needsTunnel &&
        candidate.tunnel &&
        isBetterScoredCandidate(scored, target.bestTunnel)
    ) {
        target.bestTunnel = scored;
    }
    if (
        target.needsOrigin &&
        candidate.origin &&
        isBetterScoredCandidate(scored, target.bestOrigin)
    ) {
        target.bestOrigin = scored;
    }
}

function isBetterScoredCandidate(
    candidate: ScoredSheetCandidate,
    current: ScoredSheetCandidate | null,
) {
    return (
        !current ||
        candidate.score < current.score ||
        (candidate.score === current.score &&
            candidate.candidate.rowNumber > current.candidate.rowNumber)
    );
}

async function getConversationsToMatch({
    limit,
    conversationIds,
}: {
    limit: number;
    conversationIds?: string[];
}) {
    const idChunks = conversationIds?.length
        ? chunk(conversationIds, 100)
        : [null];
    const result: ConversationToMatch[] = [];

    for (const idsChunk of idChunks) {
        let query = supabase
            .from("conversations")
            .select(
                `
                id,
                client_id,
                started_at,
                ended_at,
                tunnel,
                origin,
                clients!inner (
                    phone
                )
            `,
            )
            .not("ended_at", "is", null)
            .order("ended_at", { ascending: true })
            .limit(limit);

        if (idsChunk) {
            query = query.in("id", idsChunk);
        } else {
            query = query.or("tunnel.is.null,origin.is.null");
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(
                `Failed to fetch conversations for sheet attribution: ${error.message}`,
            );
        }

        result.push(...((data ?? []) as ConversationToMatch[]));
    }

    return result.slice(0, limit);
}

function getClientTargets(conversations: ConversationToMatch[]) {
    const targetByClientId = new Map<string, ClientTarget>();

    for (const conversation of conversations) {
        const client = normalizeNested(conversation.clients);
        const phone = normalizePhone(client?.phone ?? null);

        if (!phone || targetByClientId.has(conversation.client_id)) {
            continue;
        }

        targetByClientId.set(conversation.client_id, {
            clientId: conversation.client_id,
            phone,
        });
    }

    return [...targetByClientId.values()];
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

    if (sheetIndexPromise) {
        return sheetIndexPromise;
    }

    sheetIndexPromise = (async () => {
        const headerRange = `${quoteSheetName(SHEET_NAME)}!A${HEADER_ROW_NUMBER}:Z${HEADER_ROW_NUMBER}`;
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

function resolveSheetColumns(headers: string[]): SheetColumns {
    const phone = findHeaderIndex(headers, ["Telefone", "Phone"]);
    const date = findHeaderIndex(headers, [
        "Data Fim",
        "Data Final",
        "Data Inicio",
        "Data Início",
        "Data",
        "Criado em",
        "Created At",
        "created_at",
    ]);
    const closingTagHeader = findHeaderIndex(
        headers,
        [
            "Tag de fechamento",
            "Tag De Fechamento",
            "Tag fechamento",
            "Closing Tag",
        ],
        false,
    );
    const closingTag =
        closingTagHeader === null ? 8 : closingTagHeader;
    const tunnel = findHeaderIndex(
        headers,
        ["Tunnel", "Túnel", "Funil", "Funnel"],
        false,
    );
    const origin = findHeaderIndex(
        headers,
        ["Origem", "Origin", "Fonte", "Origem do contato"],
        false,
    );
    const requiredIndexes = [
        phone,
        date,
        closingTag,
        tunnel,
        origin,
    ].filter((value): value is number => value !== null);

    return {
        phone,
        date,
        closingTag,
        tunnel,
        origin,
        firstRequired: Math.min(...requiredIndexes),
        lastRequired: Math.max(...requiredIndexes),
    };
}

function findHeaderIndex(
    headers: string[],
    candidates: string[],
): number;
function findHeaderIndex(
    headers: string[],
    candidates: string[],
    required: false,
): number | null;
function findHeaderIndex(
    headers: string[],
    candidates: string[],
    required = true,
): number | null {
    const normalizedHeaders = headers.map(normalizeHeader);

    for (const candidate of candidates) {
        const index = normalizedHeaders.indexOf(normalizeHeader(candidate));

        if (index >= 0) {
            return index;
        }
    }

    if (!required) {
        return null;
    }

    throw new Error(
        `Google Sheets column not found. Expected one of: ${candidates.join(", ")}`,
    );
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

    for (const phone of targetPhones) {
        rowsByPhone.set(phone, []);

        for (const variant of getPhoneVariants(phone)) {
            targetPhoneByVariant.set(variant, phone);
        }
    }

    let totalMatchedRows = 0;
    let truncated = false;

    for (let index = phoneRows.length - 1; index >= 0; index--) {
        const sheetPhone = normalizePhone(phoneRows[index]?.[0] ?? null);

        if (!sheetPhone) {
            continue;
        }

        const targetPhone =
            targetPhoneByVariant.get(sheetPhone) ??
            getPhoneVariants(sheetPhone)
                .map((variant) => targetPhoneByVariant.get(variant))
                .find(Boolean);

        if (!targetPhone) {
            continue;
        }

        const currentRows = rowsByPhone.get(targetPhone)!;

        if (currentRows.length >= MAX_ROWS_PER_PHONE) {
            truncated = true;
            continue;
        }

        if (totalMatchedRows >= MAX_MATCHED_ROWS_PER_RUN) {
            truncated = true;

            if (currentRows.length > 0) {
                continue;
            }
        }

        currentRows.push(DATA_START_ROW_NUMBER + index);
        totalMatchedRows++;
    }

    const rowNumbers = [
        ...new Set([...rowsByPhone.values()].flat()),
    ].sort((first, second) => first - second);

    return {
        rowNumbers,
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
        const ranges = rowNumberChunk.map(
            (rowNumber) =>
                `${quoteSheetName(SHEET_NAME)}!` +
                `${columnIndexToA1(columns.firstRequired)}${rowNumber}:` +
                `${columnIndexToA1(columns.lastRequired)}${rowNumber}`,
        );
        const params = new URLSearchParams({
            majorDimension: "ROWS",
            valueRenderOption: "FORMATTED_VALUE",
        });

        for (const range of ranges) {
            params.append("ranges", range);
        }

        const url =
            `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}` +
            `/values:batchGet?${params.toString()}`;
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            cache: "no-store",
        });

        if (!response.ok) {
            throw new Error(
                `Google Sheets batch error: ${response.status} - ${await response.text()}`,
            );
        }

        const json = (await response.json()) as GoogleBatchValuesResponse;
        const valueRanges = json.valueRanges ?? [];

        for (let index = 0; index < rowNumberChunk.length; index++) {
            const rowNumber = rowNumberChunk[index];
            const values = valueRanges[index]?.values?.[0] ?? [];
            const readColumn = (columnIndex: number | null) => {
                if (columnIndex === null) return "";
                return String(
                    values[columnIndex - columns.firstRequired] ?? "",
                );
            };
            const phone = normalizePhone(readColumn(columns.phone));
            const date = parseSheetDate(readColumn(columns.date));

            if (!phone || !date) {
                continue;
            }

            candidates.push({
                rowNumber,
                phone,
                date,
                tunnel: emptyToNull(readColumn(columns.tunnel)),
                origin: emptyToNull(readColumn(columns.origin)),
                closingTag: emptyToNull(readColumn(columns.closingTag)),
            });
        }
    }

    return candidates;
}

async function backfillClientClosingTagsFromRecentRows(rowLimit: number) {
    const accessToken = await getGoogleAccessToken();
    const sheetIndex = await getSheetIndex(accessToken);
    const lastDataRow =
        DATA_START_ROW_NUMBER + sheetIndex.phoneRows.length - 1;

    if (lastDataRow < DATA_START_ROW_NUMBER) {
        return {
            row_limit: rowLimit,
            first_sheet_row: null,
            last_sheet_row: null,
            rows_read: 0,
            candidates: 0,
            checked_clients: 0,
            matched_clients: 0,
            updated_clients: 0,
        };
    }

    const firstDataRow = Math.max(
        DATA_START_ROW_NUMBER,
        lastDataRow - rowLimit + 1,
    );
    const columns = sheetIndex.columns;
    const range =
        `${quoteSheetName(SHEET_NAME)}!` +
        `${columnIndexToA1(columns.firstRequired)}${firstDataRow}:` +
        `${columnIndexToA1(columns.lastRequired)}${lastDataRow}`;
    const response = await getGoogleValues({
        accessToken,
        range,
    });
    const rows = response.values ?? [];
    const candidates: SheetCandidate[] = [];

    for (let index = 0; index < rows.length; index++) {
        const values = rows[index] ?? [];
        const readColumn = (columnIndex: number | null) => {
            if (columnIndex === null) return "";
            return String(
                values[columnIndex - columns.firstRequired] ?? "",
            );
        };
        const phone = normalizePhone(readColumn(columns.phone));
        const date = parseSheetDate(readColumn(columns.date));

        if (!phone || !date) {
            continue;
        }

        candidates.push({
            rowNumber: firstDataRow + index,
            phone,
            date,
            tunnel: emptyToNull(readColumn(columns.tunnel)),
            origin: emptyToNull(readColumn(columns.origin)),
            closingTag: emptyToNull(readColumn(columns.closingTag)),
        });
    }

    const latestCandidateByPhone = new Map<string, SheetCandidate>();

    for (const candidate of candidates) {
        for (const phoneVariant of getPhoneVariants(candidate.phone)) {
            const current = latestCandidateByPhone.get(phoneVariant);

            if (
                !current ||
                candidate.date > current.date ||
                (candidate.date.getTime() === current.date.getTime() &&
                    candidate.rowNumber > current.rowNumber)
            ) {
                latestCandidateByPhone.set(phoneVariant, candidate);
            }
        }
    }

    let checkedClients = 0;
    let matchedClients = 0;
    let updatedClients = 0;
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
            .from("clients")
            .select("id, phone")
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(
                `Failed to load clients for closing tag backfill: ${error.message}`,
            );
        }

        const clients = (data ?? []) as Array<{
            id: string;
            phone: string | null;
        }>;
        const updates: Array<{
            client_id: string;
            closing_tag: string | null;
            closing_tag_at: string;
        }> = [];

        for (const client of clients) {
            checkedClients++;
            const phone = normalizePhone(client.phone);
            const match = phone
                ? getPhoneVariants(phone)
                      .map((variant) =>
                          latestCandidateByPhone.get(variant),
                      )
                      .find(Boolean)
                : null;

            if (!match) {
                continue;
            }

            matchedClients++;
            updates.push({
                client_id: client.id,
                closing_tag: match.closingTag,
                closing_tag_at: match.date.toISOString(),
            });
        }

        for (const updatesChunk of chunk(updates, 500)) {
            const { data: syncResult, error: syncError } =
                await supabase.rpc(
                    "sync_client_last_closing_tags",
                    {
                        p_items: updatesChunk,
                    },
                );

            if (syncError) {
                throw new Error(
                    `Failed to backfill client closing tags: ${syncError.message}`,
                );
            }

            const firstResult = Array.isArray(syncResult)
                ? syncResult[0]
                : syncResult;
            updatedClients += Number(
                firstResult?.updated_clients ?? 0,
            );
        }

        if (clients.length < pageSize) {
            break;
        }
    }

    return {
        row_limit: rowLimit,
        first_sheet_row: firstDataRow,
        last_sheet_row: lastDataRow,
        rows_read: rows.length,
        candidates: candidates.length,
        checked_clients: checkedClients,
        matched_clients: matchedClients,
        updated_clients: updatedClients,
    };
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
    const phoneVariants = new Set(getPhoneVariants(phone));

    const possibleMatches = candidates.filter((candidate) => {
        if (
            !getPhoneVariants(candidate.phone).some((variant) =>
                phoneVariants.has(variant),
            )
        ) {
            return false;
        }

        return candidate.date >= windowStart && candidate.date <= windowEnd;
    });

    if (possibleMatches.length === 0) {
        return null;
    }

    return possibleMatches.sort((first, second) => {
        const firstScore = getDateDistanceScore({
            candidateDate: first.date,
            startedAt,
            endedAt,
        });
        const secondScore = getDateDistanceScore({
            candidateDate: second.date,
            startedAt,
            endedAt,
        });

        if (firstScore !== secondScore) {
            return firstScore - secondScore;
        }

        return second.rowNumber - first.rowNumber;
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
        Math.abs(candidateMs - endMs),
    );
}

function normalizePhone(value: string | null | undefined) {
    if (!value) {
        return null;
    }

    const digits = String(value).replace(/\D/g, "");

    if (!digits) {
        return null;
    }

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

    return [...variants];
}

function normalizeHeader(value: string) {
    return String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
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

function parseSheetDate(value: string | null | undefined) {
    if (!value) {
        return null;
    }

    const trimmed = String(value).trim();

    if (!trimmed) {
        return null;
    }

    const nativeDate = new Date(trimmed);

    if (!Number.isNaN(nativeDate.getTime())) {
        return nativeDate;
    }

    const match = trimmed.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );

    if (!match) {
        return null;
    }

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

function parseDate(value: string | null | undefined) {
    if (!value) {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function addDays(date: Date, days: number) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
}

function emptyToNull(value: string | null | undefined) {
    if (!value) {
        return null;
    }

    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
}

function isBlank(value: string | null | undefined) {
    return !value?.trim();
}

function normalizeNested<T>(value: T | T[] | null | undefined) {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }

    return value ?? null;
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
                .join(", ")}`,
        );
    }
}
