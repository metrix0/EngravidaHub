// app/api/dashboard/instagram-share/route.ts
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
    const rows: ConversationRow[] = [];

    for (let from = 0; from < MAX_CONVERSATIONS; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("conversations")
            .select("id, channel, started_at")
            .in("channel", ["WhatsApp", "Instagram"])
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

function buildInstagramSharePayload(conversations: ConversationRow[]) {
    const daily = new Map<string, DailyAccumulator>();
    let instagram = 0;
    let whatsapp = 0;

    for (const conversation of conversations) {
        const dateIso = saoPauloDate(conversation.started_at);
        const point = daily.get(dateIso) ?? {
            date_iso: dateIso,
            instagram: 0,
            whatsapp: 0,
        };

        if (conversation.channel === "Instagram") {
            instagram += 1;
            point.instagram += 1;
        } else if (conversation.channel === "WhatsApp") {
            whatsapp += 1;
            point.whatsapp += 1;
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
