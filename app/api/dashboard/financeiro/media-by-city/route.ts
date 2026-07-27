// app/api/dashboard/financeiro/media-by-city/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import {
    MEDIA_BUDGET_CITIES,
    matchMediaBudgetCity,
    normalizeCampaignMatchText,
} from "@/lib/ads/mediaBudgetByCity";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import {
    parseUuidArray,
    resolveDashboardDateRange,
} from "@/lib/dashboard/metrics";
import type {
    MediaBudgetByCityResponse,
    MediaBudgetByCityRow,
} from "@/types/media-budget-by-city";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 1_000;

type UnitRow = {
    id: string;
    name: string;
};

type AdMetricRow = {
    platform: "google_ads" | "meta_ads";
    account_id: string;
    campaign_id: string;
    campaign_name: string;
    metric_date: string;
    spend: number | string;
};

type ScheduleRow = {
    unit_name: string | null;
};

type CityAccumulator = {
    spend: number;
    googleSpend: number;
    metaSpend: number;
    campaignKeys: Set<string>;
};

export async function GET(request: Request) {
    const access = await getServerTabAccess("financeiro");

    if (access.ok === false) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status },
        );
    }

    try {
        const { searchParams } = new URL(request.url);
        const range = resolveDashboardDateRange(searchParams);
        const selectedUnitIds = parseUuidArray(searchParams.get("unit_ids"));
        const reference = resolveReferenceMonth(range.endAt);
        const units = await loadUnits();
        const unitByName = new Map(
            units.map((unit) => [normalizeCampaignMatchText(unit.name), unit]),
        );
        const selectedUnitIdSet = new Set(selectedUnitIds);
        const visibleCities = MEDIA_BUDGET_CITIES.filter((city) => {
            if (selectedUnitIds.length === 0) return true;
            const unit = unitByName.get(normalizeCampaignMatchText(city.city));
            return Boolean(unit && selectedUnitIdSet.has(unit.id));
        });
        const visibleCityKeys = new Set(visibleCities.map((city) => city.key));
        const [adMetrics, schedules] = await Promise.all([
            loadAdMetrics(reference.periodStart, reference.asOfDate),
            loadSchedules(
                reference.periodStart,
                reference.asOfDate,
                visibleCities.map((city) => city.city),
            ),
        ]);
        const accumulators = new Map<string, CityAccumulator>(
            visibleCities.map((city) => [
                city.key,
                {
                    spend: 0,
                    googleSpend: 0,
                    metaSpend: 0,
                    campaignKeys: new Set<string>(),
                },
            ]),
        );
        const unmatchedCampaignKeys = new Set<string>();
        let unmatchedSpend = 0;
        let totalSpend = 0;

        for (const metric of adMetrics) {
            const spend = numeric(metric.spend);
            const city = matchMediaBudgetCity(metric.campaign_name);
            const campaignKey = [
                metric.platform,
                metric.account_id,
                metric.campaign_id,
            ].join(":");

            if (!city) {
                if (selectedUnitIds.length === 0) {
                    totalSpend += spend;
                    unmatchedSpend += spend;
                    unmatchedCampaignKeys.add(campaignKey);
                }
                continue;
            }

            if (!visibleCityKeys.has(city.key)) continue;

            totalSpend += spend;
            const accumulator = accumulators.get(city.key);
            if (!accumulator) continue;

            accumulator.spend += spend;
            if (metric.platform === "google_ads") {
                accumulator.googleSpend += spend;
            } else {
                accumulator.metaSpend += spend;
            }
            accumulator.campaignKeys.add(campaignKey);
        }

        const scheduleCounts = new Map<string, number>();
        for (const schedule of schedules) {
            const key = normalizeCampaignMatchText(schedule.unit_name);
            if (!key) continue;
            scheduleCounts.set(key, (scheduleCounts.get(key) ?? 0) + 1);
        }

        const rows: MediaBudgetByCityRow[] = visibleCities.map((city) => {
            const accumulator = accumulators.get(city.key) ?? {
                spend: 0,
                googleSpend: 0,
                metaSpend: 0,
                campaignKeys: new Set<string>(),
            };
            const unit = unitByName.get(normalizeCampaignMatchText(city.city));
            const schedulesForCity =
                scheduleCounts.get(normalizeCampaignMatchText(city.city)) ?? 0;
            const remaining = city.monthlyBudget - accumulator.spend;
            const projection =
                reference.elapsedDays > 0
                    ? (accumulator.spend / reference.elapsedDays) *
                      reference.daysInMonth
                    : 0;

            return {
                key: city.key,
                unit_id: unit?.id ?? null,
                city: city.city,
                monthly_budget: roundMoney(city.monthlyBudget),
                spend: roundMoney(accumulator.spend),
                google_spend: roundMoney(accumulator.googleSpend),
                meta_spend: roundMoney(accumulator.metaSpend),
                remaining: roundMoney(remaining),
                daily_budget:
                    reference.remainingDays > 0
                        ? roundMoney(remaining / reference.remainingDays)
                        : null,
                projection: roundMoney(projection),
                pace_percentage:
                    city.monthlyBudget > 0
                        ? roundMetric((projection / city.monthlyBudget) * 100)
                        : null,
                schedules: schedulesForCity,
                cost_per_schedule:
                    schedulesForCity > 0
                        ? roundMoney(accumulator.spend / schedulesForCity)
                        : null,
                matched_campaigns: accumulator.campaignKeys.size,
            };
        });
        const matchedSpend = rows.reduce(
            (total, row) => total + row.spend,
            0,
        );
        const response: MediaBudgetByCityResponse = {
            reference_month: reference.referenceMonth,
            period_start: reference.periodStart,
            period_end: reference.asOfDate,
            as_of_date: reference.asOfDate,
            days_in_month: reference.daysInMonth,
            elapsed_days: reference.elapsedDays,
            remaining_days: reference.remainingDays,
            rows,
            audit: {
                total_spend: roundMoney(totalSpend),
                matched_spend: roundMoney(matchedSpend),
                unmatched_spend: roundMoney(unmatchedSpend),
                matched_campaigns: rows.reduce(
                    (total, row) => total + row.matched_campaigns,
                    0,
                ),
                unmatched_campaigns: unmatchedCampaignKeys.size,
            },
        };

        return NextResponse.json(response, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        console.error("[dashboard/financeiro/media-by-city] failed", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Falha ao carregar a verba de mídia por cidade.",
            },
            { status: 500 },
        );
    }
}

async function loadUnits() {
    const { data, error } = await supabase
        .from("units")
        .select("id, name")
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) throw error;
    return (data ?? []) as UnitRow[];
}

async function loadAdMetrics(startDate: string, endDate: string) {
    const rows: AdMetricRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("ad_daily_metrics")
            .select(
                "platform, account_id, campaign_id, campaign_name, metric_date, spend",
            )
            .gte("metric_date", startDate)
            .lte("metric_date", endDate)
            .order("metric_date", { ascending: true })
            .order("platform", { ascending: true })
            .order("account_id", { ascending: true })
            .order("campaign_id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            if (isMissingAdsTable(error)) return [];
            throw error;
        }

        const page = (data ?? []) as AdMetricRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadSchedules(
    startDate: string,
    endDate: string,
    unitNames: string[],
) {
    if (unitNames.length === 0) return [];

    const rows: ScheduleRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("schedules")
            .select("unit_name")
            .gte("scheduled_for", startDate)
            .lte("scheduled_for", endDate)
            .in("unit_name", unitNames)
            .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;

        const page = (data ?? []) as ScheduleRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

function resolveReferenceMonth(endAt: string) {
    const requestedEndDate = saoPauloDate(
        new Date(new Date(endAt).getTime() - 1).toISOString(),
    );
    const today = saoPauloDate(new Date().toISOString());
    const asOfDate = requestedEndDate > today ? today : requestedEndDate;
    const [year, month, day] = asOfDate.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const elapsedDays = Math.min(daysInMonth, Math.max(1, day));

    return {
        referenceMonth: `${year}-${String(month).padStart(2, "0")}`,
        periodStart: `${year}-${String(month).padStart(2, "0")}-01`,
        asOfDate,
        daysInMonth,
        elapsedDays,
        remainingDays: Math.max(0, daysInMonth - elapsedDays),
    };
}

function saoPauloDate(value: string) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    return `${year}-${month}-${day}`;
}

function numeric(value: number | string | null | undefined) {
    const parsed = typeof value === "number" ? value : Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundMetric(value: number) {
    return Math.round((value + Number.EPSILON) * 10) / 10;
}

function isMissingAdsTable(error: { code?: string; message?: string }) {
    return (
        error.code === "42P01" ||
        error.code === "PGRST205" ||
        Boolean(error.message?.includes("ad_daily_metrics"))
    );
}
