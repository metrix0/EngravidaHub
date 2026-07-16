// app/api/analyze/route.ts
import { NextResponse } from "next/server";

import { runBedrockBatchAnalysis } from "@/lib/ai/bedrockBatchAnalysis";
import { messageToConversations } from "@/lib/conversations/messagesToConversations";
import { matchMessagesSenderName } from "@/lib/messages/matchMessagesSenderName";
import { runClosingTagBackfillOnce } from "@/lib/conversations/matchConversationsSheetAttribution";
import { repairConversationsSheetAttribution } from "@/lib/conversations/repairConversationsSheetAttribution";

export const maxDuration = 300;

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const inactivityHours = Number(searchParams.get("inactivity_hours") ?? 12);
        const limit = Number(searchParams.get("limit") ?? 100000);

        console.log("[/api/analyze] starting hourly Bedrock batch pipeline", {
            inactivity_hours: inactivityHours,
            limit,
        });

        let closingTagBackfill = null;
        try {
            closingTagBackfill = await runClosingTagBackfillOnce({ rowLimit: 10_000 });
        } catch (error) {
            console.error(
                "[/api/analyze] one-time closing tag backfill failed; analysis will continue",
                error,
            );
        }

        const createdConversations = await messageToConversations({
            inactivityHours,
            limit,
        });

        const senderNameMatch = await matchMessagesSenderName({ limit });

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
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sheetAttributionRepair = { error: message };
            console.error(
                "[/api/analyze] recurring spreadsheet attribution repair failed",
                error,
            );
        }

        const bedrockBatch = await runBedrockBatchAnalysis({ limit });

        console.log("[/api/analyze] hourly Bedrock batch pipeline finished", {
            conversations_created: createdConversations.length,
            sender_names_ready: senderNameMatch.ready_conversation_ids.length,
            bedrock_batch: bedrockBatch,
        });

        return NextResponse.json({
            ok: true,
            closing_tag_backfill: closingTagBackfill,
            sender_name_match: senderNameMatch,
            sheet_attribution_repair: sheetAttributionRepair,
            bedrock_batch: bedrockBatch,
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
