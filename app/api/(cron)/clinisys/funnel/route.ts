// app/api/(cron)/clinisys/funnel/route.ts
import { NextResponse } from "next/server";

import { syncClinisysFunnelJourney } from "@/lib/funnel/syncClinisysJourney";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const daysBack = boundedNumber(
            searchParams.get("daysBack"),
            180,
            1,
            730,
        );
        const daysForward = boundedNumber(
            searchParams.get("daysForward"),
            365,
            0,
            730,
        );
        const limit = boundedNumber(
            searchParams.get("limit"),
            25_000,
            1,
            50_000,
        );
        const dryRun = searchParams.get("dryRun") === "true";

        const result = await syncClinisysFunnelJourney({
            daysBack,
            daysForward,
            limit,
            dryRun,
        });

        return NextResponse.json(result);
    } catch (error) {
        console.error("[sync-clinisys-funnel] failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to sync the CliniSys funnel",
            },
            { status: 500 },
        );
    }
}

function boundedNumber(
    value: string | null,
    fallback: number,
    minimum: number,
    maximum: number,
) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}
