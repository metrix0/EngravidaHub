// lib/ads/finance/syncAdsFinance.ts
import { supabase } from "@/lib";
import { matchMediaBudgetCity } from "@/lib/ads/mediaBudgetByCity";

export type AdsFinancePlatform = "google_ads" | "meta_ads";
export type AdsFinancePlatformFilter = AdsFinancePlatform | "all";

export const ADS_FINANCE_SYNC_VERSION = "meta-city-adset-v2";

type AdsFinanceMetricRow = {
    platform: AdsFinancePlatform;
    account_id: string;
    account_name: string;
    campaign_id: string;
    campaign_name: string;
    metric_date: string;
    currency_code: string;
    impressions: number;
    clicks: number;
    spend: number;
    reported_conversions: number;
    reported_conversion_value: number;
    reported_conversion_type: string | null;
    synced_at: string;
};

type AdsFinanceCityMetricRow = {
    platform: AdsFinancePlatform;
    account_id: string;
    campaign_id: string;
    campaign_name: string;
    subdivision_id: string;
    subdivision_name: string;
    city_key: string;
    metric_date: string;
    spend: number;
    synced_at: string;
};

type PlatformSyncResult = {
    platform: AdsFinancePlatform;
    ok: boolean;
    skipped: boolean;
    reason?: string;
    accounts: number;
    fetched: number;
    upserted: number;
    city_upserted: number;
    city_fetched: number;
    city_matched: number;
    city_unmatched: number;
    unmatched_subdivisions: string[];
};

type GoogleAdsRow = {
    customer?: {
        id?: string | number;
        descriptiveName?: string;
        currencyCode?: string;
    };
    campaign?: {
        id?: string | number;
        name?: string;
    };
    segments?: { date?: string };
    metrics?: {
        impressions?: string | number;
        clicks?: string | number;
        costMicros?: string | number;
        conversions?: string | number;
        conversionsValue?: string | number;
    };
};

type MetaAction = {
    action_type?: string;
    value?: string | number;
};

type MetaInsightsRow = {
    account_id?: string;
    account_name?: string;
    account_currency?: string;
    campaign_id?: string;
    campaign_name?: string;
    adset_id?: string;
    adset_name?: string;
    date_start?: string;
    impressions?: string | number;
    clicks?: string | number;
    spend?: string | number;
    actions?: MetaAction[];
    action_values?: MetaAction[];
};

type MetaInsightsResponse = {
    data?: MetaInsightsRow[];
    paging?: {
        next?: string;
        cursors?: { after?: string };
    };
    error?: {
        message?: string;
        type?: string;
        code?: number;
    };
};

const UPSERT_BATCH_SIZE = 500;
const GOOGLE_API_VERSION = normalizeGoogleApiVersion(
    process.env.GOOGLE_ADS_API_VERSION ?? "v24",
);
const META_API_VERSION = normalizeMetaApiVersion(
    process.env.META_GRAPH_API_VERSION ?? "v25.0",
);

const META_RESULT_PRIORITY = [
    "lead",
    "onsite_conversion.lead_grouped",
    "offsite_conversion.fb_pixel_lead",
    "omni_lead",
    "onsite_conversion.messaging_conversation_started_7d",
    "messaging_conversation_started_7d",
    "onsite_conversion.total_messaging_connection",
    "onsite_conversion.messaging_first_reply",
    "contact_total",
    "omni_contact",
] as const;

export async function syncAdsFinance({
                                         daysBack = 30,
                                         platform = "all",
                                     }: {
    daysBack?: number;
    platform?: AdsFinancePlatformFilter;
} = {}) {
    const startedAt = Date.now();
    const endDate = saoPauloToday();
    const startDate = addCalendarDays(endDate, -(Math.max(1, daysBack) - 1));
    const jobs: Promise<PlatformSyncResult>[] = [];

    if (platform === "all" || platform === "google_ads") {
        jobs.push(runPlatformSync("google_ads", () =>
            syncGoogleAdsFinance({ startDate, endDate }),
        ));
    }
    if (platform === "all" || platform === "meta_ads") {
        jobs.push(runPlatformSync("meta_ads", () =>
            syncMetaAdsFinance({ startDate, endDate }),
        ));
    }

    const platforms = await Promise.all(jobs);
    const attempted = platforms.filter((item) => !item.skipped);
    const result = {
        sync_version: ADS_FINANCE_SYNC_VERSION,
        ok: attempted.length > 0 && attempted.every((item) => item.ok),
        start_date: startDate,
        end_date: endDate,
        days_back: daysBack,
        platforms,
        fetched: platforms.reduce((total, item) => total + item.fetched, 0),
        upserted: platforms.reduce((total, item) => total + item.upserted, 0),
        city_upserted: platforms.reduce(
            (total, item) => total + item.city_upserted,
            0,
        ),
        city_fetched: platforms.reduce(
            (total, item) => total + item.city_fetched,
            0,
        ),
        city_matched: platforms.reduce(
            (total, item) => total + item.city_matched,
            0,
        ),
        city_unmatched: platforms.reduce(
            (total, item) => total + item.city_unmatched,
            0,
        ),
        duration_ms: Date.now() - startedAt,
    };

    console.log("[syncAdsFinance] sync completed", result);
    return result;
}

async function runPlatformSync(
    platform: AdsFinancePlatform,
    sync: () => Promise<PlatformSyncResult>,
): Promise<PlatformSyncResult> {
    try {
        return await sync();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[syncAdsFinance][${platform}] failed`, { reason });

        return {
            platform,
            ok: false,
            skipped: false,
            reason,
            accounts: 0,
            fetched: 0,
            upserted: 0,
            city_upserted: 0,
            city_fetched: 0,
            city_matched: 0,
            city_unmatched: 0,
            unmatched_subdivisions: [],
        };
    }
}

async function syncGoogleAdsFinance({
                                        startDate,
                                        endDate,
                                    }: {
    startDate: string;
    endDate: string;
}): Promise<PlatformSyncResult> {
    const config = googleAdsConfig();

    if (!config.hasAnyConfiguration) {
        return skippedResult("google_ads", "Google Ads não configurado");
    }
    if (config.missing.length > 0) {
        throw new Error(
            `Missing Google Ads envs: ${config.missing.join(", ")}`,
        );
    }

    const accessToken = await getGoogleAccessToken(config);
    const syncedAt = new Date().toISOString();
    const rowsByAccount = await Promise.all(
        config.customerIds.map((customerId) =>
            fetchGoogleAdsRows({
                customerId,
                accessToken,
                developerToken: config.developerToken!,
                loginCustomerId: config.loginCustomerId,
                startDate,
                endDate,
                syncedAt,
            }),
        ),
    );
    const rows = dedupeMetricRows(rowsByAccount.flat());
    const upserted = await upsertMetricRows(rows);
    const cityRows = rows.flatMap(toGoogleCityMetricRow);
    const cityUpserted = await upsertCityMetricRows(cityRows);
    const cityDiagnostics = summarizeCityRows(cityRows);

    return {
        platform: "google_ads",
        ok: true,
        skipped: false,
        accounts: config.customerIds.length,
        fetched: rows.length,
        upserted,
        city_upserted: cityUpserted,
        ...cityDiagnostics,
    };
}

async function getGoogleAccessToken(config: ReturnType<typeof googleAdsConfig>) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: config.clientId!,
            client_secret: config.clientSecret!,
            refresh_token: config.refreshToken!,
            grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(30_000),
    });
    const json = (await response.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
    };

    if (!response.ok || !json.access_token) {
        throw new Error(
            `Google OAuth failed (${response.status}): ${
                json.error_description ?? json.error ?? "unknown error"
            }`,
        );
    }

    return json.access_token;
}

async function fetchGoogleAdsRows({
                                      customerId,
                                      accessToken,
                                      developerToken,
                                      loginCustomerId,
                                      startDate,
                                      endDate,
                                      syncedAt,
                                  }: {
    customerId: string;
    accessToken: string;
    developerToken: string;
    loginCustomerId: string | null;
    startDate: string;
    endDate: string;
    syncedAt: string;
}) {
    const query = `
        SELECT
            customer.id,
            customer.descriptive_name,
            customer.currency_code,
            campaign.id,
            campaign.name,
            segments.date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        ORDER BY segments.date, campaign.id
    `;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
    };
    if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

    const response = await fetch(
        `https://googleads.googleapis.com/${GOOGLE_API_VERSION}/customers/${customerId}/googleAds:searchStream`,
        {
            method: "POST",
            headers,
            body: JSON.stringify({ query }),
            signal: AbortSignal.timeout(90_000),
        },
    );
    const json = (await response.json()) as
        | { results?: GoogleAdsRow[] }[]
        | { error?: { message?: string; status?: string } };

    if (!response.ok || !Array.isArray(json)) {
        const error = !Array.isArray(json) ? json.error : null;
        throw new Error(
            `Google Ads report failed for customer ${customerId} (${response.status}): ${
                error?.message ?? error?.status ?? "unknown error"
            }`,
        );
    }

    return json
        .flatMap((batch) => batch.results ?? [])
        .flatMap((row): AdsFinanceMetricRow[] => {
            const campaignId = text(row.campaign?.id);
            const metricDate = text(row.segments?.date);
            if (!campaignId || !isDate(metricDate)) return [];

            const costMicros = numberValue(row.metrics?.costMicros);
            return [
                {
                    platform: "google_ads",
                    account_id: text(row.customer?.id) ?? customerId,
                    account_name:
                        cleanText(row.customer?.descriptiveName) ??
                        `Google Ads ${customerId}`,
                    campaign_id: campaignId,
                    campaign_name:
                        cleanText(row.campaign?.name) ??
                        `Campanha ${campaignId}`,
                    metric_date: metricDate,
                    currency_code:
                        cleanText(row.customer?.currencyCode) ?? "BRL",
                    impressions: nonNegativeInteger(row.metrics?.impressions),
                    clicks: nonNegativeInteger(row.metrics?.clicks),
                    spend: roundMoney(costMicros / 1_000_000),
                    reported_conversions: roundMetric(
                        numberValue(row.metrics?.conversions),
                    ),
                    reported_conversion_value: roundMoney(
                        numberValue(row.metrics?.conversionsValue),
                    ),
                    reported_conversion_type: "conversions",
                    synced_at: syncedAt,
                },
            ];
        });
}

async function syncMetaAdsFinance({
                                      startDate,
                                      endDate,
                                  }: {
    startDate: string;
    endDate: string;
}): Promise<PlatformSyncResult> {
    const config = metaAdsConfig();

    if (!config.hasAnyConfiguration) {
        return skippedResult("meta_ads", "Meta Ads não configurado");
    }
    if (config.missing.length > 0) {
        throw new Error(`Missing Meta Ads envs: ${config.missing.join(", ")}`);
    }

    const syncedAt = new Date().toISOString();
    const rowsByAccount = await Promise.all(
        config.accountIds.map((accountId) =>
            fetchMetaAdsRows({
                accountId,
                accessToken: config.accessToken!,
                startDate,
                endDate,
                syncedAt,
            }),
        ),
    );
    const rows = dedupeMetricRows(rowsByAccount.flat());
    const upserted = await upsertMetricRows(rows);
    const cityRowsByAccount = await Promise.all(
        config.accountIds.map((accountId) =>
            fetchMetaAdsCityRows({
                accountId,
                accessToken: config.accessToken!,
                startDate,
                endDate,
                syncedAt,
            }),
        ),
    );
    const cityRows = dedupeCityMetricRows(cityRowsByAccount.flat());
    const cityUpserted = await upsertCityMetricRows(cityRows);
    const cityDiagnostics = summarizeCityRows(cityRows);

    return {
        platform: "meta_ads",
        ok: true,
        skipped: false,
        accounts: config.accountIds.length,
        fetched: rows.length,
        upserted,
        city_upserted: cityUpserted,
        ...cityDiagnostics,
    };
}

async function fetchMetaAdsCityRows({
                                        accountId,
                                        accessToken,
                                        startDate,
                                        endDate,
                                        syncedAt,
                                    }: {
    accountId: string;
    accessToken: string;
    startDate: string;
    endDate: string;
    syncedAt: string;
}) {
    const rows: AdsFinanceCityMetricRow[] = [];
    let windowStart = startDate;

    while (windowStart <= endDate) {
        const candidateEnd = addCalendarDays(windowStart, 30);
        const windowEnd = candidateEnd < endDate ? candidateEnd : endDate;
        rows.push(
            ...(await fetchMetaAdsCityWindow({
                accountId,
                accessToken,
                startDate: windowStart,
                endDate: windowEnd,
                syncedAt,
            })),
        );
        windowStart = addCalendarDays(windowEnd, 1);
    }

    return rows;
}

async function fetchMetaAdsCityWindow({
                                          accountId,
                                          accessToken,
                                          startDate,
                                          endDate,
                                          syncedAt,
                                      }: {
    accountId: string;
    accessToken: string;
    startDate: string;
    endDate: string;
    syncedAt: string;
}) {
    const endpoint = new URL(
        `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/insights`,
    );
    endpoint.searchParams.set(
        "fields",
        [
            "account_id",
            "campaign_id",
            "campaign_name",
            "adset_id",
            "adset_name",
            "date_start",
            "spend",
        ].join(","),
    );
    endpoint.searchParams.set("level", "adset");
    endpoint.searchParams.set("time_increment", "1");
    endpoint.searchParams.set("limit", "500");
    endpoint.searchParams.set(
        "time_range",
        JSON.stringify({ since: startDate, until: endDate }),
    );

    const rawRows: MetaInsightsRow[] = [];
    let after: string | null = null;

    do {
        if (after) endpoint.searchParams.set("after", after);
        else endpoint.searchParams.delete("after");

        const response = await fetch(endpoint, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(90_000),
        });
        const json = (await response.json()) as MetaInsightsResponse;

        if (!response.ok || json.error) {
            throw new Error(
                `Meta Ads ad-set report failed for account ${accountId} (${response.status}): ${
                    json.error?.message ?? json.error?.type ?? "unknown error"
                }`,
            );
        }

        rawRows.push(...(json.data ?? []));
        after = json.paging?.next
            ? cleanText(json.paging.cursors?.after)
            : null;
    } while (after);

    return rawRows.flatMap((row): AdsFinanceCityMetricRow[] => {
        const campaignId = cleanText(row.campaign_id);
        const subdivisionId = cleanText(row.adset_id);
        const metricDate = cleanText(row.date_start);
        const campaignName =
            cleanText(row.campaign_name) ??
            (campaignId ? `Campanha ${campaignId}` : null);
        const subdivisionName =
            cleanText(row.adset_name) ??
            (subdivisionId ? `Conjunto ${subdivisionId}` : null);
        const city =
            matchMediaBudgetCity(subdivisionName) ??
            matchMediaBudgetCity(campaignName);

        if (
            !campaignId ||
            !subdivisionId ||
            !campaignName ||
            !subdivisionName ||
            !isDate(metricDate)
        ) {
            return [];
        }

        return [{
            platform: "meta_ads",
            account_id: cleanText(row.account_id) ?? accountId,
            campaign_id: campaignId,
            campaign_name: campaignName,
            subdivision_id: subdivisionId,
            subdivision_name: subdivisionName,
            city_key: city?.key ?? "__unmatched__",
            metric_date: metricDate,
            spend: roundMoney(numberValue(row.spend)),
            synced_at: syncedAt,
        }];
    });
}

async function fetchMetaAdsRows({
                                    accountId,
                                    accessToken,
                                    startDate,
                                    endDate,
                                    syncedAt,
                                }: {
    accountId: string;
    accessToken: string;
    startDate: string;
    endDate: string;
    syncedAt: string;
}) {
    const endpoint = new URL(
        `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/insights`,
    );
    endpoint.searchParams.set(
        "fields",
        [
            "account_id",
            "account_name",
            "account_currency",
            "campaign_id",
            "campaign_name",
            "date_start",
            "impressions",
            "clicks",
            "spend",
            "actions",
            "action_values",
        ].join(","),
    );
    endpoint.searchParams.set("level", "campaign");
    endpoint.searchParams.set("time_increment", "1");
    endpoint.searchParams.set("limit", "500");
    endpoint.searchParams.set(
        "time_range",
        JSON.stringify({ since: startDate, until: endDate }),
    );

    const rawRows: MetaInsightsRow[] = [];
    let after: string | null = null;

    do {
        if (after) endpoint.searchParams.set("after", after);
        else endpoint.searchParams.delete("after");

        const response = await fetch(endpoint, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(90_000),
        });
        const json = (await response.json()) as MetaInsightsResponse;

        if (!response.ok || json.error) {
            throw new Error(
                `Meta Ads report failed for account ${accountId} (${response.status}): ${
                    json.error?.message ?? json.error?.type ?? "unknown error"
                }`,
            );
        }

        rawRows.push(...(json.data ?? []));
        after = json.paging?.next
            ? cleanText(json.paging.cursors?.after)
            : null;
    } while (after);

    return rawRows.flatMap((row): AdsFinanceMetricRow[] => {
        const campaignId = cleanText(row.campaign_id);
        const metricDate = cleanText(row.date_start);
        if (!campaignId || !isDate(metricDate)) return [];

        const reportedResult = selectMetaReportedResult(row.actions);
        const reportedValue = reportedResult.type
            ? actionValue(row.action_values, reportedResult.type)
            : 0;

        return [
            {
                platform: "meta_ads",
                account_id: cleanText(row.account_id) ?? accountId,
                account_name:
                    cleanText(row.account_name) ?? `Meta Ads ${accountId}`,
                campaign_id: campaignId,
                campaign_name:
                    cleanText(row.campaign_name) ?? `Campanha ${campaignId}`,
                metric_date: metricDate,
                currency_code: cleanText(row.account_currency) ?? "BRL",
                impressions: nonNegativeInteger(row.impressions),
                clicks: nonNegativeInteger(row.clicks),
                spend: roundMoney(numberValue(row.spend)),
                reported_conversions: roundMetric(reportedResult.value),
                reported_conversion_value: roundMoney(reportedValue),
                reported_conversion_type: reportedResult.type,
                synced_at: syncedAt,
            },
        ];
    });
}

function selectMetaReportedResult(actions: MetaAction[] | undefined) {
    const byType = new Map(
        (actions ?? []).flatMap((action) => {
            const type = cleanText(action.action_type);
            return type ? [[type, numberValue(action.value)] as const] : [];
        }),
    );

    for (const type of META_RESULT_PRIORITY) {
        if (byType.has(type)) return { type, value: byType.get(type) ?? 0 };
    }

    return { type: null, value: 0 };
}

function actionValue(actions: MetaAction[] | undefined, type: string) {
    const match = (actions ?? []).find(
        (action) => cleanText(action.action_type) === type,
    );
    return numberValue(match?.value);
}

async function upsertMetricRows(rows: AdsFinanceMetricRow[]) {
    let upserted = 0;

    for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
        const { error } = await supabase
            .from("ad_daily_metrics")
            .upsert(batch, {
                onConflict: "platform,account_id,campaign_id,metric_date",
            });

        if (error) {
            throw new Error(`Failed to store ad metrics: ${error.message}`);
        }
        upserted += batch.length;
    }

    return upserted;
}

async function upsertCityMetricRows(rows: AdsFinanceCityMetricRow[]) {
    let upserted = 0;

    for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
        const { error } = await supabase
            .from("ad_daily_city_metrics")
            .upsert(batch, {
                onConflict:
                    "platform,account_id,subdivision_id,metric_date",
            });

        if (error) {
            if (isMissingCityMetricsTable(error)) {
                throw new Error(
                    "ad_daily_city_metrics is not installed; run the supplied Supabase migration before syncing city detail",
                );
            }
            throw new Error(
                `Failed to store city ad metrics: ${error.message}`,
            );
        }
        upserted += batch.length;
    }

    return upserted;
}

function toGoogleCityMetricRow(
    row: AdsFinanceMetricRow,
): AdsFinanceCityMetricRow[] {
    const city = matchMediaBudgetCity(row.campaign_name);

    return [{
        platform: "google_ads",
        account_id: row.account_id,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        subdivision_id: row.campaign_id,
        subdivision_name: row.campaign_name,
        city_key: city?.key ?? "__unmatched__",
        metric_date: row.metric_date,
        spend: row.spend,
        synced_at: row.synced_at,
    }];
}

function isMissingCityMetricsTable(error: {
    code?: string;
    message?: string;
}) {
    return (
        error.code === "42P01" ||
        error.code === "PGRST205" ||
        Boolean(error.message?.includes("ad_daily_city_metrics"))
    );
}

function summarizeCityRows(rows: AdsFinanceCityMetricRow[]) {
    const cityMatched = rows.filter(
        (row) => row.city_key !== "__unmatched__",
    ).length;
    const unmatchedSubdivisions = [
        ...new Set(
            rows
                .filter((row) => row.city_key === "__unmatched__")
                .map(
                    (row) =>
                        `${row.subdivision_name} — ${row.campaign_name}`,
                ),
        ),
    ].slice(0, 12);

    return {
        city_fetched: rows.length,
        city_matched: cityMatched,
        city_unmatched: rows.length - cityMatched,
        unmatched_subdivisions: unmatchedSubdivisions,
    };
}

function googleAdsConfig() {
    const clientId = firstEnv("GOOGLE_ADS_CLIENT_ID", "GOOGLE_CLIENT_ID");
    const clientSecret = firstEnv(
        "GOOGLE_ADS_CLIENT_SECRET",
        "GOOGLE_CLIENT_SECRET",
    );
    const refreshToken = firstEnv("GOOGLE_ADS_REFRESH_TOKEN");
    const developerToken = firstEnv(
        "GOOGLE_ADS_DEVELOPER_TOKEN",
        "GOOGLE_DEVELOPER_TOKEN",
    );
    const customerIds = uniqueStrings(
        [
            ...commaSeparated(process.env.GOOGLE_ADS_CUSTOMER_IDS),
            process.env.GOOGLE_ADS_CUSTOMER_ID,
            process.env.GOOGLE_ADS_CUSTOMER_ID_2,
        ].map(normalizeAccountId),
    );
    const loginCustomerId = normalizeAccountId(
        firstEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
    );
    const hasAnyConfiguration = Boolean(
        clientId ||
        clientSecret ||
        refreshToken ||
        developerToken ||
        customerIds.length,
    );
    const missing = [
        !clientId ? "GOOGLE_ADS_CLIENT_ID (or GOOGLE_CLIENT_ID)" : null,
        !clientSecret
            ? "GOOGLE_ADS_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET)"
            : null,
        !refreshToken ? "GOOGLE_ADS_REFRESH_TOKEN" : null,
        !developerToken
            ? "GOOGLE_ADS_DEVELOPER_TOKEN (or GOOGLE_DEVELOPER_TOKEN)"
            : null,
        customerIds.length === 0 ? "GOOGLE_ADS_CUSTOMER_ID" : null,
    ].filter((value): value is string => Boolean(value));

    return {
        clientId,
        clientSecret,
        refreshToken,
        developerToken,
        customerIds,
        loginCustomerId,
        hasAnyConfiguration,
        missing,
    };
}

function metaAdsConfig() {
    const accessToken = firstEnv("META_ADS_ACCESS_TOKEN", "META_ACCESS_TOKEN");
    const accountIds = uniqueStrings(
        [
            ...commaSeparated(process.env.META_AD_ACCOUNT_IDS),
            ...commaSeparated(process.env.META_ADS_ACCOUNT_IDS),
            process.env.META_AD_ACCOUNT_ID,
            process.env.META_ADS_ACCOUNT_ID,
        ].map(normalizeAccountId),
    );
    const hasAnyConfiguration = Boolean(accessToken || accountIds.length);
    const missing = [
        !accessToken ? "META_ADS_ACCESS_TOKEN (or META_ACCESS_TOKEN)" : null,
        accountIds.length === 0 ? "META_AD_ACCOUNT_IDS" : null,
    ].filter((value): value is string => Boolean(value));

    return { accessToken, accountIds, hasAnyConfiguration, missing };
}

function skippedResult(
    platform: AdsFinancePlatform,
    reason: string,
): PlatformSyncResult {
    return {
        platform,
        ok: true,
        skipped: true,
        reason,
        accounts: 0,
        fetched: 0,
        upserted: 0,
        city_upserted: 0,
        city_fetched: 0,
        city_matched: 0,
        city_unmatched: 0,
        unmatched_subdivisions: [],
    };
}

function firstEnv(...names: string[]) {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) return value;
    }
    return null;
}

function commaSeparated(value: string | undefined) {
    return (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeAccountId(value: string | null | undefined) {
    return (value ?? "").replace(/^act_/i, "").replace(/\D/g, "");
}

function normalizeGoogleApiVersion(value: string) {
    const normalized = value.trim().replace(/^v?/i, "v");
    return /^v\d+$/.test(normalized) ? normalized : "v24";
}

function normalizeMetaApiVersion(value: string) {
    const normalized = value.trim().replace(/^v?/i, "v");
    return /^v\d+\.\d+$/.test(normalized) ? normalized : "v25.0";
}

function numberValue(value: unknown) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeInteger(value: unknown) {
    return Math.trunc(numberValue(value));
}

function roundMoney(value: number) {
    return Number(Math.max(0, value).toFixed(2));
}

function roundMetric(value: number) {
    return Number(Math.max(0, value).toFixed(4));
}

function text(value: unknown) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
}

function cleanText(value: unknown) {
    return text(value)?.replace(/\s+/g, " ").trim() || null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
    return [...new Set(values.map(cleanText).filter(Boolean))] as string[];
}

function dedupeMetricRows(rows: AdsFinanceMetricRow[]) {
    const byIdentity = new Map<string, AdsFinanceMetricRow>();

    for (const row of rows) {
        const identity = [
            row.platform,
            row.account_id,
            row.campaign_id,
            row.metric_date,
        ].join(":");
        byIdentity.set(identity, row);
    }

    return [...byIdentity.values()];
}

function dedupeCityMetricRows(rows: AdsFinanceCityMetricRow[]) {
    const byIdentity = new Map<string, AdsFinanceCityMetricRow>();

    for (const row of rows) {
        const identity = [
            row.platform,
            row.account_id,
            row.subdivision_id,
            row.metric_date,
        ].join(":");
        byIdentity.set(identity, row);
    }

    return [...byIdentity.values()];
}

function isDate(value: string | null): value is string {
    return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function saoPauloToday() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

function addCalendarDays(date: string, days: number) {
    const [year, month, day] = date.split("-").map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day + days));
    return cursor.toISOString().slice(0, 10);
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}
