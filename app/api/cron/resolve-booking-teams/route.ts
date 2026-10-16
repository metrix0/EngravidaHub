import { NextResponse } from "next/server";
import { processPendingBookingTeams } from "@/lib/scheduling/bookingTeamProcessor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== "Bearer " + secret) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const result = await processPendingBookingTeams();
        return NextResponse.json({ ok: true, ...result });
    } catch (error) {
        console.error("[cron/resolve-booking-teams] failed", error);
        return NextResponse.json({ ok: false, error: "Booking-team resolution failed" }, { status: 500 });
    }
}
