// app/api/inbox/threads/[threadId]/finalize/route.ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import {
    finalizeInboxThreadAndAnalyze,
    InboxFinalizeError,
} from "@/lib/inbox/finalizeInboxThreadAndAnalyze";
import { supabase } from "@/lib/supabase/client";

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ threadId: string }> },
) {
    const requestId = randomUUID();
    const { threadId } = await params;

    console.info(`[inbox-finalize:${requestId}] Starting`, {
        threadId,
        mode: "manual",
        analysis: "deferred_to_hourly_google_batch",
    });

    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.active || !attendant.is_online) {
        return NextResponse.json(
            { ok: false, error: "Not allowed", request_id: requestId },
            { status: 403 },
        );
    }

    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select("id, status, assigned_attendant_id")
        .eq("id", threadId)
        .eq("assigned_attendant_id", attendant.id)
        .maybeSingle();

    if (threadError) {
        return NextResponse.json(
            { ok: false, error: threadError.message, request_id: requestId },
            { status: 500 },
        );
    }

    if (!thread) {
        return NextResponse.json(
            {
                ok: false,
                error: "Thread not found or not assigned to this attendant",
                request_id: requestId,
            },
            { status: 404 },
        );
    }

    try {
        const result = await finalizeInboxThreadAndAnalyze({
            threadId,
            attendantId: attendant.id,
            requestId,
            mode: "manual",
            analyze: false,
        });

        return NextResponse.json({
            ...result,
            analysis_deferred: true,
            analysis_provider: "google-vertex-batch",
            request_id: requestId,
        });
    } catch (error) {
        const status = error instanceof InboxFinalizeError ? error.status : 500;

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to finalize conversation",
                code:
                    error instanceof InboxFinalizeError
                        ? error.code
                        : "inbox_finalize_failed",
                request_id: requestId,
            },
            { status },
        );
    }
}
