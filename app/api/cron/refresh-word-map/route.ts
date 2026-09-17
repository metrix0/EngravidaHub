import { NextResponse } from "next/server";

import { supabase } from "@/lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
    const { data, error } = await supabase.rpc(
        "refresh_dashboard_word_map_cache_v1",
    );

    if (error) {
        console.error("[cron/refresh-word-map] refresh failed", error);
        return NextResponse.json(
            { ok: false, error: error.message },
            { status: 500 },
        );
    }

    return NextResponse.json({ ok: true, cache: data });
}
