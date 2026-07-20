// app/api/(cron)/clinisys/invoices/route.ts
import { NextResponse } from "next/server";

import { syncBigqueryInvoices } from "@/lib/invoices/syncBigqueryInvoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const daysBack = clampInteger(
            searchParams.get("daysBack"),
            1,
            1,
            3_650,
        );
        const limit = clampInteger(
            searchParams.get("limit"),
            25_000,
            1,
            100_000,
        );

        console.log("[sync-bigquery-invoices] sync started", {
            days_back: daysBack,
            limit,
        });

        const result = await syncBigqueryInvoices({ daysBack, limit });

        return NextResponse.json(result, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        console.error("[sync-bigquery-invoices] sync failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to sync BigQuery invoices",
            },
            { status: 500 },
        );
    }
}

function clampInteger(
    value: string | null,
    fallback: number,
    minimum: number,
    maximum: number,
) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}
