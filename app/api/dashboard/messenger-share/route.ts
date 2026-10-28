// app/api/dashboard/messenger-share/route.ts
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
    messenger: number;
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

        return NextResponse.json(buildMessengerSharePayload(conversations), {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        if (request.signal.aborted) {
            return new NextResponse(null, { status: 499 });
        }

        console.error("[dashboard/messenger-share] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar a participação do Messenger.",
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
        p_channel: "Facebook",
    }).abortSignal(signal);
    if (error) throw error;
    return (data ?? []) as ConversationRow[];
}

function buildMessengerSharePayload(conversations: ConversationRow[]) {
    const daily = new Map<string, DailyAccumulator>();
    let messenger = 0;
    let whatsapp = 0;

    for (const conversation of conversations) {
        const dateIso = conversation.date_iso;
        const count = Number(conversation.conversations);
        const point = daily.get(dateIso) ?? {
            date_iso: dateIso,
            messenger: 0,
            whatsapp: 0,
        };

        if (conversation.channel === "Facebook") {
            messenger += count;
            point.messenger += count;
        } else if (conversation.channel === "WhatsApp") {
            whatsapp += count;
            point.whatsapp += count;
        }

        daily.set(dateIso, point);
    }

    const total = messenger + whatsapp;

    return {
        scope: "global_channels",
        total_conversations: total,
        messenger_conversations: messenger,
        whatsapp_conversations: whatsapp,
        messenger_percentage: percentage(messenger, total),
        daily_evolution: [...daily.values()]
            .sort((first, second) =>
                first.date_iso.localeCompare(second.date_iso),
            )
            .map((point) => {
                const dailyTotal = point.messenger + point.whatsapp;
                return {
                    date: displayDate(point.date_iso),
                    date_iso: point.date_iso,
                    total_conversations: dailyTotal,
                    messenger_conversations: point.messenger,
                    whatsapp_conversations: point.whatsapp,
                    messenger_percentage: percentage(
                        point.messenger,
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
