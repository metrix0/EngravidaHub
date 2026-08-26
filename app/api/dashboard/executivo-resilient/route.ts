import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const EDGE_MAX_AGE_SECONDS = 60;
const EDGE_STALE_SECONDS = 15 * 60;
const TRANSIENT_RETRY_DELAY_MS = 120;

export async function GET(request: Request) {
    const incomingUrl = new URL(request.url);
    const targetUrl = new URL("/api/dashboard/executivo", incomingUrl.origin);
    targetUrl.search = incomingUrl.search;

    let result = await fetchExecutiveDashboard(targetUrl, request);

    if (!result.ok && isSchemaCacheFailure(result.body)) {
        await sleep(TRANSIENT_RETRY_DELAY_MS);
        result = await fetchExecutiveDashboard(targetUrl, request);
    }

    return new NextResponse(result.body, {
        status: result.status,
        headers: {
            "Content-Type": result.contentType,
            "Cache-Control": result.ok
                ? `public, s-maxage=${EDGE_MAX_AGE_SECONDS}, stale-while-revalidate=${EDGE_STALE_SECONDS}`
                : "no-store",
            "X-Dashboard-Source": "resilient",
        },
    });
}

async function fetchExecutiveDashboard(targetUrl: URL, request: Request) {
    try {
        const headers = new Headers();
        const cookie = request.headers.get("cookie");
        if (cookie) headers.set("cookie", cookie);

        const response = await fetch(targetUrl, {
            cache: "no-store",
            headers,
            signal: request.signal,
        });
        const body = await response.text();

        return {
            ok: response.ok,
            status: response.status,
            body,
            contentType:
                response.headers.get("content-type") ??
                "application/json; charset=utf-8",
        };
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Falha ao carregar dashboard.";
        return {
            ok: false,
            status: 503,
            body: JSON.stringify({ error: message }),
            contentType: "application/json; charset=utf-8",
        };
    }
}

function isSchemaCacheFailure(body: string) {
    const normalized = body.toLocaleLowerCase("en-US");
    return (
        normalized.includes("schema cache") ||
        normalized.includes("could not query the database for the schema cache")
    );
}

function sleep(milliseconds: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
