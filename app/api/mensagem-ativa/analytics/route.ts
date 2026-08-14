import { NextResponse } from "next/server";

import { requireActiveMessageAccess } from "@/lib/active-messages/access";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 1_000;
const METRICS_CHUNK_SIZE = 500;
const NO_CACHE_HEADERS = {
    "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
};

type AnalyticsSendRow = {
    id: string;
    template_id: string;
    template_name: string;
    sent_count: number;
    created_at: string;
};

type HistoryMetricsRow = {
    send_id: string;
    schedule_count: number | string | null;
    response_count: number | string | null;
};

export async function GET(request: Request) {
    const access = await requireActiveMessageAccess();

    if (access.ok === false) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status, headers: NO_CACHE_HEADERS },
        );
    }

    const searchParams = new URL(request.url).searchParams;
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");

    if (
        !isIsoDate(startDate) ||
        !isIsoDate(endDate) ||
        endDate < startDate
    ) {
        return NextResponse.json(
            { error: "Período inválido" },
            { status: 400, headers: NO_CACHE_HEADERS },
        );
    }

    try {
        const rows = await loadSends(startDate, endDate);
        const metricsBySendId = await loadHistoryMetrics(
            rows.map((row) => row.id),
        );

        return NextResponse.json(
            {
                history: rows.map((row) => {
                    const metrics = metricsBySendId.get(row.id);

                    return {
                        id: row.id,
                        template_id: row.template_id,
                        template_name: row.template_name,
                        sent_count: row.sent_count,
                        created_at: row.created_at,
                        response_count: metrics?.response_count ?? 0,
                        schedule_count: metrics?.schedule_count ?? 0,
                    };
                }),
            },
            { headers: NO_CACHE_HEADERS },
        );
    } catch (error) {
        console.error("[mensagem-ativa/analytics] GET failed", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível carregar o desempenho dos envios",
            },
            { status: 500, headers: NO_CACHE_HEADERS },
        );
    }
}

async function loadSends(startDate: string, endDate: string) {
    const rows: AnalyticsSendRow[] = [];
    const endExclusive = addDays(endDate, 1);

    for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("active_message_sends")
            .select("id, template_id, template_name, sent_count, created_at")
            .gte("created_at", `${startDate}T00:00:00-03:00`)
            .lt("created_at", `${endExclusive}T00:00:00-03:00`)
            .order("created_at", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;

        const page = (data ?? []) as AnalyticsSendRow[];
        rows.push(...page);

        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadHistoryMetrics(sendIds: string[]) {
    const metricsBySendId = new Map<
        string,
        { schedule_count: number; response_count: number }
    >();

    for (let offset = 0; offset < sendIds.length; offset += METRICS_CHUNK_SIZE) {
        const chunk = sendIds.slice(offset, offset + METRICS_CHUNK_SIZE);
        const { data, error } = await supabase.rpc(
            "get_active_message_send_metrics",
            { p_send_ids: chunk },
        );

        if (error) {
            throw new Error(
                `Não foi possível carregar as métricas dos envios: ${error.message}`,
            );
        }

        for (const row of (data ?? []) as HistoryMetricsRow[]) {
            metricsBySendId.set(row.send_id, {
                schedule_count: toCount(row.schedule_count),
                response_count: toCount(row.response_count),
            });
        }
    }

    return metricsBySendId;
}

function isIsoDate(value: string | null): value is string {
    return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function addDays(value: string, days: number) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function toCount(value: number | string | null) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}
