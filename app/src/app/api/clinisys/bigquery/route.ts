// app/src/app/api/clinisys/bigquery/route.ts
import { NextResponse } from "next/server";

import { syncBigquerySchedules } from "@/lib/schedules/cliniSysSchedulesIntoSupabaseAndAds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get("authorization");

        if (
            process.env.CRON_SECRET &&
            authHeader !== `Bearer ${process.env.CRON_SECRET}`
        ) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Unauthorized",
                },
                { status: 401 }
            );
        }

        const url = new URL(request.url);

        const daysBack = Number(url.searchParams.get("daysBack") ?? 1);
        const limit = Number(url.searchParams.get("limit") ?? 9999);

        const result = await syncBigquerySchedules({
            daysBack,
            limit,
        });

        return NextResponse.json(result);
    } catch (error) {
        console.error("[sync-bigquery-schedules] failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to sync BigQuery schedules",
            },
            { status: 500 }
        );
    }
}