// app/api/(cron)/clinisys/bigquery/route.ts
import { NextResponse } from "next/server";

import { syncBigquerySchedules } from "@/lib/schedules/cliniSysSchedulesIntoSupabaseAndAds";
import { retryMissingMetaScheduleEvents } from "@/lib/schedules/retryMissingMetaScheduleEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);

        const daysBack = Number(url.searchParams.get("daysBack") ?? 1);
        const limit = Number(url.searchParams.get("limit") ?? 9999);

        const result = await syncBigquerySchedules({
            daysBack,
            limit,
        });

        try {
            await retryMissingMetaScheduleEvents();
        } catch (error) {
            console.error("[sync-bigquery-schedules] Meta retry failed", error);
        }

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
