// app/api/dashboard/messenger-share/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { resolveDashboardDateRange } from "@/lib/dashboard/metrics";

const PAGE_SIZE = 1_000;
const MAX_CONVERSATIONS = 100_000;

type ConversationRow = {
    id: string;
    channel: string | null;
    started_at: string;
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
    const rows: ConversationRow[] = [];

    for (let from = 0; from < MAX_CONVERSATIONS; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("conversations")
            .select("id, channel, started_at")
            .in("channel", ["WhatsApp", "Facebook"])
            .gte("started_at", startAt)
            .lt("started_at", endAt)
            .order("started_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);

        if (error) throw error;

        const page = (data ?? []) as ConversationRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

function buildMessengerSharePayload(conversations: ConversationRow[]) {
    const daily = new Map<string, DailyAccumulator>();
    let messenger = 0;
    let whatsapp = 0;

    for (const conversation of conversations) {
        const dateIso = saoPauloDate(conversation.started_at);
        const point = daily.get(dateIso) ?? {
            date_iso: dateIso,
            messenger: 0,
            whatsapp: 0,
        };

        if (conversation.channel === "Facebook") {
            messenger += 1;
            point.messenger += 1;
        } else if (conversation.channel === "WhatsApp") {
            whatsapp += 1;
            point.whatsapp += 1;
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

function saoPauloDate(value: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const month = parts.find((part) => part.type === "month")?.value ?? "00";
    const day = parts.find((part) => part.type === "day")?.value ?? "00";
    return `${year}-${month}-${day}`;
}

function displayDate(dateIso: string) {
    const [, month, day] = dateIso.split("-");
    return `${day}/${month}`;
}
