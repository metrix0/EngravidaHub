import { NextResponse } from "next/server";

import { getWebPageViews } from "@/lib/analytics/getWebPageViews";
import { resolveDashboardDateRange } from "@/lib/dashboard/metrics";

export const runtime = "nodejs";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);
    const startDate = range.startDate ?? range.startAt.slice(0, 10);
    const endDate =
        range.endDate ??
        new Date(new Date(range.endAt).getTime() - 1).toISOString().slice(0, 10);

    try {
        const data = await getWebPageViews({ startDate, endDate });

        return NextResponse.json(data, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        console.error("[dashboard-web-pages]", error);

        return NextResponse.json(
            {
                error: "Não foi possível carregar as visualizações do Google Analytics.",
            },
            {
                status: 500,
                headers: { "Cache-Control": "private, no-store" },
            },
        );
    }
}
