// app/api/inbox/queue/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

export async function GET() {
    const access = await getOnlineAttendant();

    if (!access.ok) {
        return access.response;
    }

    const [countResult, socialCountResult] = await Promise.all([
        getQueueCount(),
        getQueueCount(["Instagram", "Facebook"]),
    ]);

    if (!countResult.ok) {
        return countResult.response;
    }
    if (!socialCountResult.ok) {
        return socialCountResult.response;
    }

    return NextResponse.json({
        ok: true,
        count: countResult.count,
        social_count: socialCountResult.count,
    });
}

export async function POST(request: Request) {
    const access = await getOnlineAttendant();

    if (!access.ok) {
        return access.response;
    }

    const scope = new URL(request.url).searchParams.get("scope");
    const rpcName =
        scope === "social"
            ? "claim_next_social_inbox_thread"
            : "claim_next_inbox_thread";
    const { data: threadId, error } = await supabase.rpc(rpcName, {
        p_attendant_id: access.attendant.id,
    });

    if (error) {
        return NextResponse.json(
            {
                ok: false,
                error: error.message,
            },
            { status: 500 },
        );
    }

    const [countResult, socialCountResult] = await Promise.all([
        getQueueCount(),
        getQueueCount(["Instagram", "Facebook"]),
    ]);

    if (!countResult.ok) {
        return countResult.response;
    }
    if (!socialCountResult.ok) {
        return socialCountResult.response;
    }

    return NextResponse.json({
        ok: true,
        thread_id: typeof threadId === "string" ? threadId : null,
        count: countResult.count,
        social_count: socialCountResult.count,
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

async function getQueueCount(channels?: string[]) {
    let query = supabase
        .from("thread")
        .select("id", {
            count: "exact",
            head: true,
        })
        .eq("status", "open")
        .is("assigned_attendant_id", null);

    if (channels?.length) {
        query = query.in("channel", channels);
    }

    const { count, error } = await query;

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
