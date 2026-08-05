// app/api/dev/zernio/route.ts
import { NextResponse } from "next/server";

import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import {
    ensureZernioInboxWebhook,
    getZernioConnectUrl,
    isZernioConfigured,
    listZernioAccounts,
    listZernioProfiles,
    listZernioWebhooks,
    type ZernioInboxPlatform,
} from "@/lib/zernio/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ZernioDevAction = {
    action?: unknown;
    profile_id?: unknown;
    platform?: unknown;
};

export async function GET(request: Request) {
    const access = await getServerTabAccess("usuarios");
    if (access.ok === false) {
        return NextResponse.json(
            { ok: false, error: access.error },
            { status: access.status },
        );
    }

    const urls = getIntegrationUrls(request);
    const configured = isZernioConfigured();

    if (!configured) {
        return NextResponse.json({
            ok: true,
            configured,
            profiles: [],
            accounts: [],
            webhook: null,
            ...urls,
        });
    }

    try {
        const [profiles, instagramAccounts, facebookAccounts, webhooks] =
            await Promise.all([
                listZernioProfiles(),
                listZernioAccounts("instagram"),
                listZernioAccounts("facebook"),
                listZernioWebhooks(),
            ]);
        const accounts = [...instagramAccounts, ...facebookAccounts];
        const webhook =
            webhooks.find(
                (candidate) =>
                    normalizeUrl(candidate.url) ===
                    normalizeUrl(urls.webhook_url),
            ) ?? null;

        return NextResponse.json({
            ok: true,
            configured,
            profiles,
            accounts,
            webhook,
            ...urls,
        });
    } catch (error) {
        console.error("[dev-zernio] Status load failed", error);
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível consultar o Zernio.",
            },
            { status: 502 },
        );
    }
}

export async function POST(request: Request) {
    const access = await getServerTabAccess("usuarios");
    if (access.ok === false) {
        return NextResponse.json(
            { ok: false, error: access.error },
            { status: access.status },
        );
    }

    let body: ZernioDevAction;

    try {
        body = (await request.json()) as ZernioDevAction;
    } catch {
        return NextResponse.json(
            { ok: false, error: "O corpo da requisição não é um JSON válido." },
            { status: 400 },
        );
    }

    const action = String(body.action ?? "").trim();
    const urls = getIntegrationUrls(request);

    try {
        if (
            action === "connect_account" ||
            action === "connect_instagram" ||
            action === "connect_facebook"
        ) {
            const profileId = String(body.profile_id ?? "").trim();
            const platform = resolveConnectPlatform(action, body.platform);

            if (!profileId) {
                return NextResponse.json(
                    { ok: false, error: "Selecione um perfil do Zernio." },
                    { status: 400 },
                );
            }

            if (!platform) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: "Selecione Instagram ou Facebook Messenger.",
                    },
                    { status: 400 },
                );
            }

            await ensureZernioInboxWebhook({
                webhookUrl: urls.webhook_url,
            });
            const authUrl = await getZernioConnectUrl({
                platform,
                profileId,
                redirectUrl: urls.redirect_url,
            });

            return NextResponse.json({
                ok: true,
                platform,
                auth_url: authUrl,
            });
        }

        if (action === "ensure_webhook") {
            const webhook = await ensureZernioInboxWebhook({
                webhookUrl: urls.webhook_url,
            });

            return NextResponse.json({
                ok: true,
                webhook,
                webhook_url: urls.webhook_url,
            });
        }

        return NextResponse.json(
            { ok: false, error: "Ação inválida." },
            { status: 400 },
        );
    } catch (error) {
        console.error("[dev-zernio] Action failed", { action, error });
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível concluir a ação no Zernio.",
            },
            { status: 502 },
        );
    }
}

function resolveConnectPlatform(
    action: string,
    rawPlatform: unknown,
): ZernioInboxPlatform | null {
    if (action === "connect_instagram") return "instagram";
    if (action === "connect_facebook") return "facebook";

    const platform = String(rawPlatform ?? "").trim().toLowerCase();
    if (platform === "instagram" || platform === "facebook") {
        return platform;
    }

    return null;
}

function getIntegrationUrls(request: Request) {
    const requestUrl = new URL(request.url);
    const origin = requestUrl.origin;

    if (
        requestUrl.protocol !== "https:" &&
        requestUrl.hostname !== "localhost" &&
        requestUrl.hostname !== "127.0.0.1"
    ) {
        throw new Error("A integração do Zernio exige uma URL HTTPS.");
    }

    return {
        redirect_url: new URL("/dev/zernio", origin).toString(),
        webhook_url: new URL("/api/zernio", origin).toString(),
    };
}

function normalizeUrl(value: string) {
    return value.trim().replace(/\/+$/, "").toLowerCase();
}
