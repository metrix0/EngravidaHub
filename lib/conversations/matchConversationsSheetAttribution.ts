// lib/conversations/matchConversationsSheetAttribution.ts
import { matchConversationOriginMap } from "@/lib/conversations/matchConversationOriginMap";

type MatchInput = {
    limit?: number;
    conversationIds?: string[];
};

type RemovedBackfillInput = {
    sheetChunkSize?: number;
    rpcBatchSize?: number;
    dryRun?: boolean;
};

/**
 * Compatibility entry point for targeted conversation flows.
 *
 * The old Relatório Dados Gerais phone/date attribution and client backfills
 * were removed. This function now only checks the explicitly supplied
 * conversations against Mapa de Origens.
 */
export async function matchConversationsSheetAttribution({
    limit = 1000,
    conversationIds,
}: MatchInput = {}) {
    const ids = Array.from(
        new Set((conversationIds ?? []).filter(Boolean)),
    ).slice(0, Math.max(0, Math.floor(limit)));

    return matchConversationOriginMap({ conversationIds: ids });
}

/**
 * Kept only so the old CLI file fails clearly instead of breaking TypeScript.
 * Historical attribution backfills are intentionally disabled.
 */
export async function runFullSheetAttributionBackfill(
    _input: RemovedBackfillInput = {},
): Promise<never> {
    throw new Error(
        "The Relatório Dados Gerais attribution backfill was removed. " +
            "Only conversations being processed are matched against Mapa de Origens.",
    );
}
