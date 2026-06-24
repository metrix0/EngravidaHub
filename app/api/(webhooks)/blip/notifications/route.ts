// app/api/(webhooks)/blip/notifications/route.ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BlipNotification = {
    id?: string;
    from?: string;
    to?: string;
    event?: string;
    reason?: unknown;
    metadata?: Record<string, unknown>;
};

export async function POST(request: Request) {
    const requestId = randomUUID();
    const startedAt = Date.now();

    try {
        const notification = (await request.json()) as BlipNotification;

        console.info(`[blip-notification:${requestId}] Delivery notification`, {
            request_id: requestId,
            message_id: notification.id ?? null,
            event: notification.event ?? null,
            from: notification.from ?? null,
            to: notification.to ?? null,
            reason: notification.reason ?? null,
            metadata: notification.metadata ?? null,
            raw: notification,
            duration_ms: Date.now() - startedAt,
        });

        return NextResponse.json({
            ok: true,
            received: true,
            request_id: requestId,
            message_id: notification.id ?? null,
            event: notification.event ?? null,
        });
    } catch (error) {
        console.error(
            `[blip-notification:${requestId}] Invalid notification payload`,
            error,
        );

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Invalid Blip notification payload",
                request_id: requestId,
            },
            { status: 400 },
        );
    }
}
