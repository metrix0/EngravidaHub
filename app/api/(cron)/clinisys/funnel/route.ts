// app/api/(cron)/clinisys/funnel/route.ts
import { NextResponse } from "next/server";

import { syncClinisysFunnelJourney } from "@/lib/funnel/syncClinisysJourney";
import { supabaseErrorText } from "@/lib/supabase/retry";

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
        const failure = serializeSyncError(error);

        return NextResponse.json(
            {
                ok: false,
                error: failure.message,
                ...(failure.code ? { code: failure.code } : {}),
                ...(failure.details ? { details: failure.details } : {}),
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

function serializeSyncError(error: unknown) {
    const record =
        error && typeof error === "object"
            ? (error as Record<string, unknown>)
            : null;
    const message =
        (typeof record?.message === "string" && record.message.trim()) ||
        supabaseErrorText(error) ||
        "Failed to sync the CliniSys funnel";

    return {
        message,
        code: typeof record?.code === "string" ? record.code : null,
        details:
            typeof record?.details === "string" ? record.details : null,
    };
}
