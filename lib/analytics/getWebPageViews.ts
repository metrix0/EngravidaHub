import { GoogleAuth } from "google-auth-library";

const GOOGLE_ANALYTICS_PROPERTY_ID = "355552673";
const GOOGLE_ANALYTICS_SCOPE =
    "https://www.googleapis.com/auth/analytics.readonly";
const GA4_GOOGLE_CLIENT_EMAIL = process.env.GA4_GOOGLE_CLIENT_EMAIL;
const GA4_GOOGLE_PRIVATE_KEY = process.env.GA4_GOOGLE_PRIVATE_KEY;

const MAIN_SITE_HOSTS = new Set([
    "engravida.com.br",
    "www.engravida.com.br",
]);

const LANDING_PAGE_PATHS = new Set([
    "/problemas",
    "/problemas-nova",
    "/problemas-antiga",
    "/problemas-nova-v2",
    "/problemas-antiga-v2",
    "/problemas-v2",
    "/lgbt",
    "/congelamento",
    "/laqueadura",
    "/lgbt-v2",
    "/congelamento-v2",
    "/laqueadura-v2",
    "/problemas-v1",
    "/lgbt-v1",
    "/congelamento-v1",
    "/laqueadura-v1",
]);

type GoogleAnalyticsReport = {
    rows?: Array<{
        dimensionValues?: Array<{ value?: string }>;
        metricValues?: Array<{ value?: string }>;
    }>;
};

type ReportRequest = {
    startDate: string;
    endDate: string;
    dimensions: string[];
    metrics: string[];
    orderByMetric?: string;
    limit?: string;
};

export type WebPageViewRow = {
    host: string;
    path: string;
    title: string;
    views: number;
};

export type WebTrafficSourceRow = {
    source: string;
    medium: string;
    campaign: string;
    sessions: number;
    percentage: number;
};

export type LandingPagePerformanceRow = WebPageViewRow & {
    whatsapp_clicks: number;
    main_site_clicks: number;
    action_clicks: number;
    action_rate: number;
};

export type WebPageViewsData = {
    property_id: string;
    start_date: string;
    end_date: string;
    main_site_views: number;
    previous_main_site_views: number;
    landing_page_views: number;
    previous_landing_page_views: number;
    whatsapp_clicks: number;
    previous_whatsapp_clicks: number;
    main_site_clicks: number;
    previous_main_site_clicks: number;
    landing_page_action_rate: number;
    previous_landing_page_action_rate: number;
    main_site_pages: WebPageViewRow[];
    landing_pages: WebPageViewRow[];
    traffic_sources: WebTrafficSourceRow[];
    landing_page_performance: LandingPagePerformanceRow[];
};

export async function getWebPageViews({
    startDate,
    endDate,
    previousStartDate,
    previousEndDate,
}: {
    startDate: string;
    endDate: string;
    previousStartDate: string;
    previousEndDate: string;
}): Promise<WebPageViewsData> {
    validateEnvironment();

    const accessToken = await getGoogleAccessToken();
    const pageDimensions = ["hostName", "pagePath", "pageTitle"];
    const eventDimensions = ["eventName", "hostName", "pagePath", "linkUrl"];

    const [
        currentPageReport,
        previousPageReport,
        trafficReport,
        currentEventReport,
        previousEventReport,
    ] = await Promise.all([
        runReport(accessToken, {
            startDate,
            endDate,
            dimensions: pageDimensions,
            metrics: ["screenPageViews"],
            orderByMetric: "screenPageViews",
            limit: "10000",
        }),
        runReport(accessToken, {
            startDate: previousStartDate,
            endDate: previousEndDate,
            dimensions: pageDimensions,
            metrics: ["screenPageViews"],
            orderByMetric: "screenPageViews",
            limit: "10000",
        }),
        runReport(accessToken, {
            startDate,
            endDate,
            dimensions: [
                "sessionSource",
                "sessionMedium",
                "sessionCampaignName",
            ],
            metrics: ["sessions"],
            orderByMetric: "sessions",
            limit: "1000",
        }),
        runReport(accessToken, {
            startDate,
            endDate,
            dimensions: eventDimensions,
            metrics: ["eventCount"],
            orderByMetric: "eventCount",
            limit: "10000",
        }),
        runReport(accessToken, {
            startDate: previousStartDate,
            endDate: previousEndDate,
            dimensions: eventDimensions,
            metrics: ["eventCount"],
            orderByMetric: "eventCount",
            limit: "10000",
        }),
    ]);

    const currentPages = parsePageViews(currentPageReport);
    const previousPages = parsePageViews(previousPageReport);
    const currentActions = summarizeLandingActions(currentEventReport);
    const previousActions = summarizeLandingActions(previousEventReport);
    const landingPageViews = totalViews(currentPages.landingPages);
    const previousLandingPageViews = totalViews(previousPages.landingPages);
    const landingPageActionClicks =
        currentActions.whatsappClicks + currentActions.mainSiteClicks;
    const previousLandingPageActionClicks =
        previousActions.whatsappClicks + previousActions.mainSiteClicks;

    return {
        property_id: GOOGLE_ANALYTICS_PROPERTY_ID,
        start_date: startDate,
        end_date: endDate,
        main_site_views: totalViews(currentPages.mainSitePages),
        previous_main_site_views: totalViews(previousPages.mainSitePages),
        landing_page_views: landingPageViews,
        previous_landing_page_views: previousLandingPageViews,
        whatsapp_clicks: currentActions.whatsappClicks,
        previous_whatsapp_clicks: previousActions.whatsappClicks,
        main_site_clicks: currentActions.mainSiteClicks,
        previous_main_site_clicks: previousActions.mainSiteClicks,
        landing_page_action_rate: rate(
            landingPageActionClicks,
            landingPageViews,
        ),
        previous_landing_page_action_rate: rate(
            previousLandingPageActionClicks,
            previousLandingPageViews,
        ),
        main_site_pages: currentPages.mainSitePages,
        landing_pages: currentPages.landingPages,
        traffic_sources: parseTrafficSources(trafficReport),
        landing_page_performance: buildLandingPagePerformance(
            currentPages.landingPages,
            currentActions.byPage,
        ),
    };
}

async function runReport(
    accessToken: string,
    {
        startDate,
        endDate,
        dimensions,
        metrics,
        orderByMetric,
        limit = "10000",
    }: ReportRequest,
): Promise<GoogleAnalyticsReport> {
    const response = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${GOOGLE_ANALYTICS_PROPERTY_ID}:runReport`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                dateRanges: [{ startDate, endDate }],
                dimensions: dimensions.map((name) => ({ name })),
                metrics: metrics.map((name) => ({ name })),
                ...(orderByMetric
                    ? {
                          orderBys: [
                              {
                                  metric: { metricName: orderByMetric },
                                  desc: true,
                              },
                          ],
                      }
                    : {}),
                limit,
            }),
            cache: "no-store",
        },
    );

    const responseText = await response.text();

    if (!response.ok) {
        throw new Error(
            `Google Analytics Data API error: ${response.status} - ${responseText}`,
        );
    }

    return JSON.parse(responseText) as GoogleAnalyticsReport;
}

function parsePageViews(report: GoogleAnalyticsReport) {
    const mainSitePages = new Map<string, WebPageViewRow>();
    const landingPages = new Map<string, WebPageViewRow>();

    for (const row of report.rows ?? []) {
        const host = normalizeHost(row.dimensionValues?.[0]?.value ?? "");
        const path = normalizePath(row.dimensionValues?.[1]?.value ?? "/");
        const title = row.dimensionValues?.[2]?.value ?? "";
        const views = Number(row.metricValues?.[0]?.value ?? 0);

        if (!Number.isFinite(views) || views <= 0) continue;

        if (MAIN_SITE_HOSTS.has(host)) {
            addPageView(mainSitePages, { host, path, title, views });
            continue;
        }

        if (LANDING_PAGE_PATHS.has(path)) {
            addPageView(landingPages, { host, path, title, views });
        }
    }

    return {
        mainSitePages: sortByViews(mainSitePages),
        landingPages: sortByViews(landingPages),
    };
}

function parseTrafficSources(report: GoogleAnalyticsReport): WebTrafficSourceRow[] {
    const rows = (report.rows ?? [])
        .map((row) => ({
            source: cleanDimension(row.dimensionValues?.[0]?.value, "Direto"),
            medium: cleanDimension(row.dimensionValues?.[1]?.value, "—"),
            campaign: cleanDimension(row.dimensionValues?.[2]?.value, "—"),
            sessions: Number(row.metricValues?.[0]?.value ?? 0),
        }))
        .filter((row) => Number.isFinite(row.sessions) && row.sessions > 0);
    const totalSessions = rows.reduce((total, row) => total + row.sessions, 0);

    return rows.map((row) => ({
        ...row,
        percentage: rate(row.sessions, totalSessions),
    }));
}

type PageActions = {
    whatsappClicks: number;
    mainSiteClicks: number;
};

function summarizeLandingActions(report: GoogleAnalyticsReport) {
    const byPage = new Map<string, PageActions>();
    let whatsappClicks = 0;
    let mainSiteClicks = 0;

    for (const row of report.rows ?? []) {
        const eventName = row.dimensionValues?.[0]?.value ?? "";
        const host = normalizeHost(row.dimensionValues?.[1]?.value ?? "");
        const path = normalizePath(row.dimensionValues?.[2]?.value ?? "/");
        const linkUrl = row.dimensionValues?.[3]?.value ?? "";
        const eventCount = Number(row.metricValues?.[0]?.value ?? 0);

        if (
            !LANDING_PAGE_PATHS.has(path) ||
            !Number.isFinite(eventCount) ||
            eventCount <= 0
        ) {
            continue;
        }

        const key = pageKey(host, path);
        const pageActions = byPage.get(key) ?? {
            whatsappClicks: 0,
            mainSiteClicks: 0,
        };

        if (eventName === "cta_click") {
            pageActions.whatsappClicks += eventCount;
            whatsappClicks += eventCount;
        }

        if (
            eventName === "main_site_click" ||
            (eventName === "click" && isMainSiteUrl(linkUrl))
        ) {
            pageActions.mainSiteClicks += eventCount;
            mainSiteClicks += eventCount;
        }

        byPage.set(key, pageActions);
    }

    return { byPage, whatsappClicks, mainSiteClicks };
}

function buildLandingPagePerformance(
    pages: WebPageViewRow[],
    actionsByPage: Map<string, PageActions>,
): LandingPagePerformanceRow[] {
    return pages.map((page) => {
        const actions = actionsByPage.get(pageKey(page.host, page.path)) ?? {
            whatsappClicks: 0,
            mainSiteClicks: 0,
        };
        const actionClicks = actions.whatsappClicks + actions.mainSiteClicks;

        return {
            ...page,
            whatsapp_clicks: actions.whatsappClicks,
            main_site_clicks: actions.mainSiteClicks,
            action_clicks: actionClicks,
            action_rate: rate(actionClicks, page.views),
        };
    });
}

async function getGoogleAccessToken() {
    const auth = new GoogleAuth({
        credentials: {
            client_email: GA4_GOOGLE_CLIENT_EMAIL!,
            private_key: GA4_GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
        },
        scopes: [GOOGLE_ANALYTICS_SCOPE],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    if (!token.token) {
        throw new Error("Google Analytics access token was not returned.");
    }

    return token.token;
}

function validateEnvironment() {
    const missing = [
        ["GA4_GOOGLE_CLIENT_EMAIL", GA4_GOOGLE_CLIENT_EMAIL],
        ["GA4_GOOGLE_PRIVATE_KEY", GA4_GOOGLE_PRIVATE_KEY],
    ]
        .filter(([, value]) => !value)
        .map(([name]) => name);

    if (missing.length > 0) {
        throw new Error(
            `Missing Google Analytics environment variables: ${missing.join(", ")}`,
        );
    }
}

function addPageView(
    pages: Map<string, WebPageViewRow>,
    row: WebPageViewRow,
) {
    const key = pageKey(row.host, row.path);
    const current = pages.get(key);

    if (!current) {
        pages.set(key, row);
        return;
    }

    current.views += row.views;
}

function sortByViews(pages: Map<string, WebPageViewRow>) {
    return Array.from(pages.values()).sort((a, b) => b.views - a.views);
}

function totalViews(rows: WebPageViewRow[]) {
    return rows.reduce((total, row) => total + row.views, 0);
}

function pageKey(host: string, path: string) {
    return `${host}\u0000${path}`;
}

function rate(value: number, total: number) {
    if (total <= 0) return 0;
    return (value / total) * 100;
}

function cleanDimension(value: string | undefined, fallback: string) {
    const clean = value?.trim();
    if (!clean || clean === "(not set)" || clean === "(none)") {
        return fallback;
    }
    if (clean === "(direct)") return "Direto";
    return clean;
}

function isMainSiteUrl(value: string) {
    if (!value || value === "(not set)") return false;

    try {
        return MAIN_SITE_HOSTS.has(normalizeHost(new URL(value).hostname));
    } catch {
        return false;
    }
}

function normalizeHost(value: string) {
    return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizePath(value: string) {
    const path = value.split(/[?#]/, 1)[0]?.trim() || "/";
    const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;

    return withLeadingSlash.length > 1
        ? withLeadingSlash.replace(/\/+$/, "")
        : withLeadingSlash;
}
