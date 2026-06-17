// app/src/app/api/analyze/route.ts
import { NextResponse } from "next/server";

import { messageToConversations } from "@/lib/conversations/messagesToConversations";
import { processPendingConversationsToAnalysisAndAdEvents } from "@/lib/conversations/processPendingConversationsToAnalysisAndAdEvents";
import { matchMessagesSenderName } from "@/lib/messages/matchMessagesSenderName";
import { matchConversationsSheetAttribution } from "@/lib/conversations/matchConversationsSheetAttribution";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);

        const inactivityHours = Number(searchParams.get("inactivity_hours") ?? 12);
        const limit = Number(searchParams.get("limit") ?? 9999);

        console.log("[/api/analyze] starting pipeline", {
            inactivity_hours: inactivityHours,
            limit,
        });

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

        console.log("[/api/analyze] matching spreadsheet tunnel/origin");

        const sheetAttributionMatch = await matchConversationsSheetAttribution({
            limit,
            conversationIds: senderNameMatch.ready_conversation_ids,
        });

        console.log("[/api/analyze] spreadsheet tunnel/origin matched", {
            updated_conversations: sheetAttributionMatch.updated_conversations,
            skipped_without_phone: sheetAttributionMatch.skipped_without_phone,
            skipped_without_dates: sheetAttributionMatch.skipped_without_dates,
            skipped_without_match: sheetAttributionMatch.skipped_without_match,
        });

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
            sheet_attribution_updated:
            sheetAttributionMatch.updated_conversations,
        });

        return NextResponse.json({
            ok: true,
            sender_name_match: senderNameMatch,
            sheet_attribution_match: sheetAttributionMatch,
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
            { status: 500 }
        );
    }
}