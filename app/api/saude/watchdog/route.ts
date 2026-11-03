// app/api/saude/watchdog/route.ts
import { NextRequest, NextResponse } from "next/server";

import { synchronizeHealthAlerts } from "@/lib/saude/alerts";
import { collectHealth } from "@/lib/saude/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
    const secret = process.env.HEALTH_MONITOR_SECRET;
    if (!secret || request.headers.get("authorization") !== "Bearer " + secret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
        const snapshot = await collectHealth();
        await synchronizeHealthAlerts(snapshot);
        return NextResponse.json({
            ok: snapshot.sources.vercel.ok && snapshot.sources.supabase.ok,
            checked_at: snapshot.checked_at,
            services: snapshot.services.length,
        });
    } catch (error) {
        console.error("[saude] watchdog failed", error);
        return NextResponse.json({ error: "Falha ao executar monitoramento" }, { status: 500 });
    }
}
