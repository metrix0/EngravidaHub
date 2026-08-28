import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { resolveDashboardDateRange } from "@/lib/dashboard/metrics";

const PAGE_SIZE = 1_000;
const MAX_CONVERSATIONS = 100_000;
const ID_BATCH_SIZE = 100;

type ConversationRow = {
    instagram_user_id: string | null;
};

type AttributionRow = {
    instagram_user_id: string;
    meta_ad_id: string;
    campaign_id: string | null;
    campaign_name: string | null;
    ad_name: string | null;
    referral_ad_title: string | null;
    referral_received_at: string;
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = resolveDashboardDateRange(searchParams);

    try {
        const activeClientIds = await loadInstagramClientIds(
            range.startAt,
            range.endAt,
            request.signal,
        );
        const totalClients = activeClientIds.length;

        if (totalClients === 0) {
            return NextResponse.json(emptyPayload(0), {
                headers: { "Cache-Control": "private, no-store" },
            });
        }

        const attributionResult = await loadAttributions(
            activeClientIds,
            range.startAt,
            range.endAt,
            request.signal,
        );

        if (!attributionResult.available) {
            return NextResponse.json(
                {
                    ...emptyPayload(totalClients),
                    available: false,
                },
                { headers: { "Cache-Control": "private, no-store" } },
            );
        }

        return NextResponse.json(
            buildPayload(activeClientIds, attributionResult.rows),
            { headers: { "Cache-Control": "private, no-store" } },
        );
    } catch (error) {
        if (request.signal.aborted) {
            return new NextResponse(null, { status: 499 });
        }

        console.error("[dashboard/instagram-attribution] GET failed", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar atribuição do Instagram.",
            },
            { status: 500 },
        );
    }
}

async function loadInstagramClientIds(
    startAt: string,
    endAt: string,
    signal: AbortSignal,
) {
    const ids = new Set<string>();

    for (let from = 0; from < MAX_CONVERSATIONS; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("conversations")
            .select("instagram_user_id")
            .eq("channel", "Instagram")
            .gte("started_at", startAt)
            .lt("started_at", endAt)
            .order("started_at", { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(signal);

        if (error) throw error;

        const page = (data ?? []) as ConversationRow[];
        for (const row of page) {
            if (row.instagram_user_id) ids.add(row.instagram_user_id);
        }
        if (page.length < PAGE_SIZE) break;
    }

    return [...ids];
}

async function loadAttributions(
    instagramUserIds: string[],
    startAt: string,
    endAt: string,
    signal: AbortSignal,
): Promise<{ available: boolean; rows: AttributionRow[] }> {
    const rows: AttributionRow[] = [];

    for (const ids of chunk(instagramUserIds, ID_BATCH_SIZE)) {
        const { data, error } = await supabase
            .from("conversation_ad_attributions")
            .select(
                "instagram_user_id, meta_ad_id, campaign_id, campaign_name, ad_name, referral_ad_title, referral_received_at",
            )
            .eq("channel", "Instagram")
            .in("instagram_user_id", ids)
            .gte("referral_received_at", startAt)
            .lt("referral_received_at", endAt)
            .order("referral_received_at", { ascending: false })
            .abortSignal(signal);

        if (error) {
            if (isMissingAttributionSchema(error)) {
                return { available: false, rows: [] };
            }
            throw error;
        }

        rows.push(...((data ?? []) as AttributionRow[]));
    }

    return { available: true, rows };
}

function buildPayload(
    activeClientIds: string[],
    rows: AttributionRow[],
) {
    const activeSet = new Set(activeClientIds);
    const latestByClient = new Map<string, AttributionRow>();

    for (const row of rows) {
        if (!activeSet.has(row.instagram_user_id)) continue;
        const current = latestByClient.get(row.instagram_user_id);
        if (
            !current ||
            new Date(row.referral_received_at).getTime() >
                new Date(current.referral_received_at).getTime()
        ) {
            latestByClient.set(row.instagram_user_id, row);
        }
    }

    const totalClients = activeClientIds.length;
    const attributedClients = latestByClient.size;
    const unattributedClients = Math.max(0, totalClients - attributedClients);
    const campaigns = new Map<string, { label: string; count: number }>();
    const ads = new Map<
        string,
        { label: string; campaign_name: string | null; count: number }
    >();

    for (const attribution of latestByClient.values()) {
        const campaignKey =
            attribution.campaign_id ?? attribution.campaign_name;
        if (campaignKey) {
            const campaign = campaigns.get(campaignKey) ?? {
                label: attribution.campaign_name ?? "Campanha Meta",
                count: 0,
            };
            campaign.count += 1;
            campaigns.set(campaignKey, campaign);
        }

        const adKey = attribution.meta_ad_id;
        const ad = ads.get(adKey) ?? {
            label:
                attribution.ad_name ??
                attribution.referral_ad_title ??
                `Anúncio ${attribution.meta_ad_id}`,
            campaign_name: attribution.campaign_name,
            count: 0,
        };
        ad.count += 1;
        ads.set(adKey, ad);
    }

    const campaignDistribution = [
        ...(unattributedClients > 0
            ? [
                  {
                      key: "__unattributed__",
                      label: "Não atribuído",
                      count: unattributedClients,
                      percentage: percentage(unattributedClients, totalClients),
                  },
              ]
            : []),
        ...[...campaigns.entries()]
            .map(([key, value]) => ({
                key,
                label: value.label,
                count: value.count,
                percentage: percentage(value.count, totalClients),
            }))
            .sort((a, b) => b.count - a.count),
    ];

    const topAds = [...ads.entries()]
        .map(([key, value]) => ({
            key,
            label: value.label,
            campaign_name: value.campaign_name,
            count: value.count,
            percentage: percentage(value.count, attributedClients),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

    return {
        available: true,
        total_clients: totalClients,
        attributed_clients: attributedClients,
        unattributed_clients: unattributedClients,
        attribution_rate: percentage(attributedClients, totalClients),
        campaign_distribution: campaignDistribution,
        top_ads: topAds,
    };
}

function emptyPayload(totalClients: number) {
    return {
        available: true,
        total_clients: totalClients,
        attributed_clients: 0,
        unattributed_clients: totalClients,
        attribution_rate: totalClients > 0 ? 0 : null,
        campaign_distribution:
            totalClients > 0
                ? [
                      {
                          key: "__unattributed__",
                          label: "Não atribuído",
                          count: totalClients,
                          percentage: 100,
                      },
                  ]
                : [],
        top_ads: [],
    };
}

function percentage(value: number, total: number) {
    if (total <= 0) return null;
    return Number(((value / total) * 100).toFixed(1));
}

function isMissingAttributionSchema(error: { code?: string; message?: string }) {
    const message = error.message?.toLowerCase() ?? "";
    return (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        message.includes("conversation_ad_attributions") &&
            (message.includes("does not exist") || message.includes("schema cache"))
    );
}

function chunk<T>(items: T[], size: number) {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        result.push(items.slice(index, index + size));
    }
    return result;
}
