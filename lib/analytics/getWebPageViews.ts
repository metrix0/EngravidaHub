import { GoogleAuth } from "google-auth-library";

const GOOGLE_ANALYTICS_PROPERTY_ID = "355552673";
const GOOGLE_ANALYTICS_SCOPE =
    "https://www.googleapis.com/auth/analytics.readonly";
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

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

export type WebPageViewRow = {
    host: string;
    path: string;
    title: string;
    views: number;
};

export type WebPageViewsData = {
    property_id: string;
    start_date: string;
    end_date: string;
    main_site_views: number;
    landing_page_views: number;
    main_site_pages: WebPageViewRow[];
    landing_pages: WebPageViewRow[];
};

export async function getWebPageViews({
    startDate,
    endDate,
}: {
    startDate: string;
    endDate: string;
}): Promise<WebPageViewsData> {
    validateEnvironment();

    const accessToken = await getGoogleAccessToken();
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
                dimensions: [
                    { name: "hostName" },
                    { name: "pagePath" },
                    { name: "pageTitle" },
                ],
                metrics: [{ name: "screenPageViews" }],
                orderBys: [
                    {
                        metric: { metricName: "screenPageViews" },
                        desc: true,
                    },
                ],
                limit: "10000",
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

    const report = JSON.parse(responseText) as GoogleAnalyticsReport;
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

    const mainSiteRows = sortByViews(mainSitePages);
    const landingPageRows = sortByViews(landingPages);

    return {
        property_id: GOOGLE_ANALYTICS_PROPERTY_ID,
        start_date: startDate,
        end_date: endDate,
        main_site_views: totalViews(mainSiteRows),
        landing_page_views: totalViews(landingPageRows),
        main_site_pages: mainSiteRows,
        landing_pages: landingPageRows,
    };
}

async function getGoogleAccessToken() {
    const auth = new GoogleAuth({
        credentials: {
            client_email: GOOGLE_CLIENT_EMAIL!,
            private_key: GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
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
        ["GOOGLE_CLIENT_EMAIL", GOOGLE_CLIENT_EMAIL],
        ["GOOGLE_PRIVATE_KEY", GOOGLE_PRIVATE_KEY],
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
    const key = `${row.host}\u0000${row.path}`;
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
