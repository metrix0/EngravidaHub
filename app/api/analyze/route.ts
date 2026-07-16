// app/api/analyze/route.ts
import { NextResponse } from "next/server";

import { messageToConversations } from "@/lib/conversations/messagesToConversations";
import { processPendingConversationsToAnalysisAndAdEvents } from "@/lib/conversations/processPendingConversationsToAnalysisAndAdEvents";
import { matchMessagesSenderName } from "@/lib/messages/matchMessagesSenderName";
import { runClosingTagBackfillOnce } from "@/lib/conversations/matchConversationsSheetAttribution";
import { repairConversationsSheetAttribution } from "@/lib/conversations/repairConversationsSheetAttribution";

export const maxDuration = 300;

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);

        const inactivityHours = Number(searchParams.get("inactivity_hours") ?? 12);
        const limit = Number(searchParams.get("limit") ?? 9999);

        console.log("[/api/analyze] starting pipeline", {
            inactivity_hours: inactivityHours,
            limit,
        });

        let closingTagBackfill = null;

        try {
            closingTagBackfill = await runClosingTagBackfillOnce({
                rowLimit: 10_000,
            });
            console.log(
                "[/api/analyze] one-time closing tag backfill",
                closingTagBackfill,
            );
        } catch (error) {
            console.error(
                "[/api/analyze] one-time closing tag backfill failed; normal analysis will continue",
                error,
            );
        }

        console.log("[/api/analyze] converting pending messages into conversations");

        const createdConversations = await messageToConversations({
            inactivityHours,
            limit,
        });

        console.log("[/api/analyze] messages converted into conversations", {
            conversations_created: createdConversations.length,
        });

        console.log("[/api/analyze] matching sender names");

        const senderNameMatch = await matchMessagesSenderName({
            limit,
        });

        console.log("[/api/analyze] sender names matched", {
            updated_messages: senderNameMatch.updated_messages,
            ready_conversations: senderNameMatch.ready_conversation_ids.length,
            skipped_conversations: senderNameMatch.skipped_conversation_ids.length,
        });

        console.log("[/api/analyze] repairing canonical spreadsheet tunnel/origin");

        let sheetAttributionRepair:
            | Awaited<ReturnType<typeof repairConversationsSheetAttribution>>
            | { error: string }
            | null = null;

        try {
            sheetAttributionRepair = await repairConversationsSheetAttribution({
                limit: Math.min(2500, Math.max(250, limit)),
                conversationIds: createdConversations.map(
                    (conversation) => conversation.conversation_id,
                ),
            });
            console.log(
                "[/api/analyze] recurring spreadsheet attribution repair completed",
                sheetAttributionRepair,
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            sheetAttributionRepair = { error: message };
            console.error(
                "[/api/analyze] recurring spreadsheet attribution repair failed",
                error,
            );
        }

        console.log("[/api/analyze] gathering pending conversations to analysis");

        const results = await processPendingConversationsToAnalysisAndAdEvents({
            limit,
            conversationIds: senderNameMatch.ready_conversation_ids,
        });

        console.log("[/api/analyze] pipeline finished", {
            conversations_processed: results.length,
            succeeded: results.filter((item) => item.ok).length,
            failed: results.filter((item) => !item.ok).length,
            skipped_missing_sender_name:
                senderNameMatch.skipped_conversation_ids.length,
            sheet_attribution_repair: sheetAttributionRepair,
        });

        return NextResponse.json({
            ok: true,
            closing_tag_backfill: closingTagBackfill,
            sender_name_match: senderNameMatch,
            sheet_attribution_repair: sheetAttributionRepair,
            results,
        });
    } catch (error) {
        console.error("[/api/analyze] pipeline failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to process analyze pipeline",
            },
            { status: 500 },
        );
    }
}
