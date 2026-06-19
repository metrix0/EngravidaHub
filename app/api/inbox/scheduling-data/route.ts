// app/api/inbox/scheduling-data/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import { loadSchedulingContext } from "@/lib/inbox/schedulingData";

export async function GET(request: Request) {
    try {
        const { attendant } =
            await getCurrentAttendantFromRequest();

        if (!attendant || !attendant.is_online) {
            return NextResponse.json(
                { ok: false, error: "Not allowed" },
                { status: 403 },
            );
        }

        const { searchParams } = new URL(request.url);
        const threadId = searchParams.get("thread_id");

        if (!threadId) {
            return NextResponse.json(
                { ok: false, error: "thread_id is required" },
                { status: 400 },
            );
        }

        const context = await loadSchedulingContext(
            supabase,
            threadId,
            attendant.id,
        );

        if (!context) {
            return NextResponse.json(
                { ok: false, error: "Scheduling data not found" },
                { status: 404 },
            );
        }

        return NextResponse.json({
            client: context.client,
            spouse: context.spouse,
            suggestedFormat: context.suggestedFormat,
            form: context.form,
        });
    } catch (error) {
        console.error("[scheduling-data] failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load scheduling data",
            },
            { status: 500 },
        );
    }
}
