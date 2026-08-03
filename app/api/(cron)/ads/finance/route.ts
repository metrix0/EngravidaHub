// app/api/(cron)/ads/finance/route.ts
import { NextResponse } from "next/server";

import {
    ADS_FINANCE_SYNC_VERSION,
    syncAdsFinance,
    type AdsFinancePlatformFilter,
} from "@/lib/ads/finance/syncAdsFinance";
import { clampInteger } from "@/lib/dashboard/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
    if (!isAuthorizedCronRequest(request)) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, {
            status: 401,
        });
    }

    try {
        const { searchParams } = new URL(request.url);
        const daysBack = clampInteger(
            searchParams.get("daysBack"),
            30,
            1,
            730,
        );
        const platform = readPlatform(searchParams.get("platform"));
        const result = await syncAdsFinance({ daysBack, platform });

        return NextResponse.json(result, {
            status: result.ok ? 200 : 500,
            headers: {
                "Cache-Control": "private, no-store",
                "X-Ads-Finance-Sync-Version": ADS_FINANCE_SYNC_VERSION,
            },
        });
    } catch (error) {
        console.error("[sync-ads-finance] failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to sync ads finance data",
            },
            { status: 500 },
        );
    }
}

function readPlatform(value: string | null): AdsFinancePlatformFilter {
    if (value === "google_ads" || value === "meta_ads") return value;
    return "all";
}

function isAuthorizedCronRequest(request: Request) {
    const secret = process.env.ADS_FINANCE_CRON_SECRET?.trim();
    if (!secret) return true;
    return request.headers.get("authorization") === `Bearer ${secret}`;
}
