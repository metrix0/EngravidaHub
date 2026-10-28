// app/api/dashboard/instagram-share/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { resolveDashboardDateRange } from "@/lib/dashboard/metrics";

type ConversationRow = {
    date_iso: string;
    channel: string;
    conversations: number;
};

type DailyAccumulator = {
    date_iso: string;
    instagram: number;
    whatsapp: number;
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);

    try {
        const conversations = await loadConversations(
            range.startAt,
            range.endAt,
            request.signal,
        );
        const payload = buildInstagramSharePayload(conversations);

        return NextResponse.json(payload, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        if (request.signal.aborted) {
            return new NextResponse(null, { status: 499 });
        }

        console.error("[dashboard/instagram-share] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar a participação do Instagram.",
            },
            { status: 500 },
        );
    }
}

async function loadConversations(
    startAt: string,
    endAt: string,
    signal: AbortSignal,
) {
    const { data, error } = await supabase.rpc("dashboard_social_share_daily_v1", {
        p_start_at: startAt,
        p_end_at: endAt,
        p_channel: "Instagram",
    }).abortSignal(signal);
    if (error) throw error;
    return (data ?? []) as ConversationRow[];
}

function buildInstagramSharePayload(conversations: ConversationRow[]) {
    const daily = new Map<string, DailyAccumulator>();
    let instagram = 0;
    let whatsapp = 0;

    for (const conversation of conversations) {
        const dateIso = conversation.date_iso;
        const count = Number(conversation.conversations);
        const point = daily.get(dateIso) ?? {
            date_iso: dateIso,
            instagram: 0,
            whatsapp: 0,
        };

        if (conversation.channel === "Instagram") {
            instagram += count;
            point.instagram += count;
        } else if (conversation.channel === "WhatsApp") {
            whatsapp += count;
            point.whatsapp += count;
        }

        daily.set(dateIso, point);
    }

    const total = instagram + whatsapp;

    return {
        scope: "global_channels",
        total_conversations: total,
        instagram_conversations: instagram,
        whatsapp_conversations: whatsapp,
        instagram_percentage: percentage(instagram, total),
        daily_evolution: [...daily.values()]
            .sort((first, second) =>
                first.date_iso.localeCompare(second.date_iso),
            )
            .map((point) => {
                const dailyTotal = point.instagram + point.whatsapp;
                return {
                    date: displayDate(point.date_iso),
                    date_iso: point.date_iso,
                    total_conversations: dailyTotal,
                    instagram_conversations: point.instagram,
                    whatsapp_conversations: point.whatsapp,
                    instagram_percentage: percentage(
                        point.instagram,
                        dailyTotal,
                    ),
                };
            }),
    };
}

function percentage(numerator: number, denominator: number) {
    if (denominator <= 0) return null;
    return Math.round(((numerator * 100) / denominator) * 10) / 10;
}

function displayDate(dateIso: string) {
    const [, month, day] = dateIso.split("-");
    return `${day}/${month}`;
}
