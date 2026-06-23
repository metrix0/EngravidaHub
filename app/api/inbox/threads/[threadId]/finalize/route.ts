// app/api/inbox/threads/[threadId]/finalize/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ threadId: string }> },
) {
    const { threadId } = await params;
    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.active || !attendant.is_online) {
        return NextResponse.json(
            { ok: false, error: "Not allowed" },
            { status: 403 },
        );
    }

    const { data: conversationId, error } = await supabase.rpc(
        "finalize_inbox_thread",
        {
            p_thread_id: threadId,
            p_attendant_id: attendant.id,
        },
    );

    if (error) {
        return NextResponse.json(
            { ok: false, error: error.message },
            { status: 500 },
        );
    }

    return NextResponse.json({
        ok: true,
        conversation_id:
            typeof conversationId === "string" ? conversationId : null,
    });
}
