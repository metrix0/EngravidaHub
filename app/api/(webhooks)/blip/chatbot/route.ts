// app/api/(webhooks)/blip/chatbot/route.ts
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
    normalizeChatbotStage,
    routeOutOfHoursChatbot,
} from "@/lib/chatbot/outOfHoursChatbot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const requestSchema = z
    .object({
        message: z.string().trim().min(1).max(2_000),
        stage: z.string().trim().max(40).optional().nullable(),
    })
    .strict();

export async function POST(request: Request) {
    const expectedSecret = process.env.BLIP_CHATBOT_WEBHOOK_SECRET?.trim();
    const receivedSecret = request.headers.get("x-chatbot-secret")?.trim();

    if (!expectedSecret) {
        return NextResponse.json(
            { ok: false, error: "Chatbot webhook is not configured" },
            { status: 503 },
        );
    }

    if (!receivedSecret || !secretsMatch(receivedSecret, expectedSecret)) {
        return NextResponse.json(
            { ok: false, error: "Invalid chatbot secret" },
            { status: 401 },
        );
    }

    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json(
            { ok: false, error: "Invalid JSON payload" },
            { status: 400 },
        );
    }

    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) {
        return NextResponse.json(
            {
                ok: false,
                error: "Invalid chatbot payload",
                issues: parsed.error.issues,
            },
            { status: 400 },
        );
    }

    const response = await routeOutOfHoursChatbot({
        message: parsed.data.message,
        stage: normalizeChatbotStage(parsed.data.stage),
        signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(25_000),
        ]),
    });

    return NextResponse.json(response, {
        headers: { "Cache-Control": "no-store" },
    });
}

function secretsMatch(received: string, expected: string) {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    return (
        receivedBuffer.length === expectedBuffer.length &&
        timingSafeEqual(receivedBuffer, expectedBuffer)
    );
}
