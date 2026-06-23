// app/api/inbox/queue/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

export async function GET() {
    const access = await getOnlineAttendant();

    if (!access.ok) {
        return access.response;
    }

    const countResult = await getQueueCount();

    if (!countResult.ok) {
        return countResult.response;
    }

    return NextResponse.json({
        ok: true,
        count: countResult.count,
    });
}

export async function POST() {
    const access = await getOnlineAttendant();

    if (!access.ok) {
        return access.response;
    }

    const { data: threadId, error } = await supabase.rpc(
        "claim_next_inbox_thread",
        {
            p_attendant_id: access.attendant.id,
        },
    );

    if (error) {
        return NextResponse.json(
            {
                ok: false,
                error: error.message,
            },
            { status: 500 },
        );
    }

    const countResult = await getQueueCount();

    if (!countResult.ok) {
        return countResult.response;
    }

    return NextResponse.json({
        ok: true,
        thread_id: typeof threadId === "string" ? threadId : null,
        count: countResult.count,
    });
}

async function getOnlineAttendant() {
    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant) {
        return {
            ok: false as const,
            response: NextResponse.json(
                {
                    ok: false,
                    error: "Current user is not linked to an attendant",
                },
                { status: 403 },
            ),
        };
    }

    if (!attendant.active || !attendant.is_online) {
        return {
            ok: false as const,
            response: NextResponse.json(
                {
                    ok: false,
                    error: "Attendant must be active and online",
                },
                { status: 403 },
            ),
        };
    }

    return {
        ok: true as const,
        attendant,
    };
}

async function getQueueCount() {
    const { count, error } = await supabase
        .from("thread")
        .select("id", {
            count: "exact",
            head: true,
        })
        .eq("status", "open")
        .is("assigned_attendant_id", null);

    if (error) {
        return {
            ok: false as const,
            response: NextResponse.json(
                {
                    ok: false,
                    error: error.message,
                },
                { status: 500 },
            ),
        };
    }

    return {
        ok: true as const,
        count: count ?? 0,
    };
}
