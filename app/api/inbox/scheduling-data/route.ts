// app/api/inbox/scheduling-data/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";
import {
    loadSchedulingClientContext,
    loadSchedulingContext,
} from "@/lib/inbox/schedulingData";

export async function GET(request: Request) {
    try {
        const { user, attendant } = await getCurrentAttendantFromRequest();

        if (!user) {
            return NextResponse.json(
                { ok: false, error: "Not authenticated" },
                { status: 401 },
            );
        }

        const { searchParams } = new URL(request.url);
        const threadId = searchParams.get("thread_id");
        const clientId = searchParams.get("client_id");

        if (!threadId && !clientId) {
            return NextResponse.json(
                { ok: false, error: "thread_id or client_id is required" },
                { status: 400 },
            );
        }

        const context = threadId
            ? attendant?.is_online
                ? await loadSchedulingContext(
                      supabase,
                      threadId,
                      attendant.id,
                  )
                : null
            : await loadSchedulingClientContext(supabase, clientId!);

        if (threadId && (!attendant || !attendant.is_online)) {
            return NextResponse.json(
                { ok: false, error: "Not allowed" },
                { status: 403 },
            );
        }

        if (!context) {
            return NextResponse.json(
                { ok: false, error: "Scheduling data not found" },
                { status: 404 },
            );
        }

        const selectedUnit =
            context.units.find((unit) => unit.id === context.form.unitId) ?? null;
        const resolvedClientCity =
            context.client.city?.trim() ||
            context.form.address.city?.trim() ||
            selectedUnit?.city?.trim() ||
            null;

        return NextResponse.json({
            client: {
                ...context.client,
                city: resolvedClientCity,
            },
            spouse: context.spouse,
            units: context.units,
            doctors: context.doctors,
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
