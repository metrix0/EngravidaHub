// lib/zernio/client.ts
const ZERNIO_API_BASE_URL = "https://zernio.com/api/v1";
const ZERNIO_REQUEST_TIMEOUT_MS = 20_000;
const ZERNIO_INBOX_WEBHOOK_NAME = "Engravida Hub Instagram Inbox";
const ZERNIO_INBOX_WEBHOOK_NAMES = new Set([
    ZERNIO_INBOX_WEBHOOK_NAME,
    "Engravida Hub Social Inbox",
]);

export type ZernioInboxPlatform = "instagram" | "facebook";

export const ZERNIO_INBOX_WEBHOOK_EVENTS = [
    "message.received",
    "message.sent",
] as const;

export type ZernioProfile = {
    _id: string;
    name: string;
    color?: string | null;
    isDefault?: boolean;
};

export type ZernioAccount = {
    _id: string;
    platform: string;
    profileId:
        | string
        | {
              _id?: string;
              name?: string;
              slug?: string;
          }
        | null;
    username: string | null;
    displayName: string | null;
    profileUrl?: string | null;
    isActive: boolean;
};

export type ZernioWebhook = {
    _id: string;
    name: string;
    url: string;
    events: string[];
    isActive: boolean;
    lastFiredAt?: string | null;
    failureCount?: number;
};

export type SentZernioMessage = {
    id: string;
    conversationId: string;
    sentAt: string;
    message: string | null;
};

export type ZernioAd = {
    id: string | null;
    name: string | null;
    platform: string | null;
    platform_ad_id: string | null;
    campaign_id: string | null;
    campaign_name: string | null;
    ad_set_id: string | null;
    ad_set_name: string | null;
    image_url: string | null;
    video_url: string | null;
};

export class ZernioConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ZernioConfigurationError";
    }
}

export class ZernioApiError extends Error {
    readonly status: number | null;
    readonly code: string | null;

    constructor(
        message: string,
        {
            status = null,
            code = null,
        }: {
            status?: number | null;
            code?: string | null;
        } = {},
    ) {
        super(message);
        this.name = "ZernioApiError";
        this.status = status;
        this.code = code;
    }
}

export async function listZernioProfiles() {
    const response = await zernioRequest<{ profiles?: ZernioProfile[] }>(
        "/profiles",
    );

    return Array.isArray(response.profiles)
        ? response.profiles.map(sanitizeProfile)
        : [];
}

export async function listZernioAccounts(platform: ZernioInboxPlatform) {
    const response = await zernioRequest<{ accounts?: ZernioAccount[] }>(
        `/accounts?platform=${platform}`,
    );

    return Array.isArray(response.accounts)
        ? response.accounts.map(sanitizeAccount)
        : [];
}

export async function listZernioWebhooks() {
    const response = await zernioRequest<{ webhooks?: ZernioWebhook[] }>(
        "/webhooks/settings",
    );

    return Array.isArray(response.webhooks)
        ? response.webhooks.map(sanitizeWebhook)
        : [];
}

export async function getZernioConnectUrl({
    platform,
    profileId,
    redirectUrl,
}: {
    platform: ZernioInboxPlatform;
    profileId: string;
    redirectUrl: string;
}) {
    const searchParams = new URLSearchParams({
        profileId,
        redirect_url: redirectUrl,
    });
    const response = await zernioRequest<{
        authUrl?: string;
        alreadyConnected?: boolean;
    }>(`/connect/${platform}?${searchParams.toString()}`);
    const authUrl =
        typeof response.authUrl === "string" ? response.authUrl.trim() : "";
    const label = platformLabel(platform);

    if (!authUrl) {
        throw new ZernioApiError(
            response.alreadyConnected
                ? `A conta do ${label} já está conectada no Zernio.`
                : `O Zernio não retornou a URL de conexão do ${label}.`,
        );
    }

    return authUrl;
}

export async function ensureZernioInboxWebhook({
    webhookUrl,
}: {
    webhookUrl: string;
}) {
    const webhooks = await listZernioWebhooks();
    const normalizedWebhookUrl = normalizeUrl(webhookUrl);
    const existing = webhooks.find(
        (webhook) => normalizeUrl(webhook.url) === normalizedWebhookUrl,
    ) ??
        webhooks.find((webhook) =>
            ZERNIO_INBOX_WEBHOOK_NAMES.has(webhook.name),
        );
    const body = {
        name: ZERNIO_INBOX_WEBHOOK_NAME,
        url: webhookUrl,
        events: [...ZERNIO_INBOX_WEBHOOK_EVENTS],
        isActive: true,
    };

    if (existing) {
        await zernioRequest("/webhooks/settings", {
            method: "PUT",
            body: JSON.stringify({
                _id: existing._id,
                ...body,
            }),
        });

        return sanitizeWebhook({
            ...existing,
            ...body,
        });
    }

    const response = await zernioRequest<
        ZernioWebhook | { webhook?: ZernioWebhook }
    >("/webhooks/settings", {
        method: "POST",
        body: JSON.stringify(body),
    });

    if ("webhook" in response && response.webhook) {
        return sanitizeWebhook(response.webhook);
    }

    return sanitizeWebhook(response as ZernioWebhook);
}

export async function sendZernioInboxMessage({
    conversationId,
    accountId,
    message,
    attachmentUrl,
    attachmentType,
}: {
    conversationId: string;
    accountId: string;
    message?: string;
    attachmentUrl?: string;
    attachmentType?: "image" | "video" | "audio" | "file";
}) {
    const normalizedConversationId = conversationId.trim();
    const normalizedAccountId = accountId.trim();
    const normalizedMessage = message?.trim() ?? "";
    const normalizedAttachmentUrl = attachmentUrl?.trim() ?? "";

    if (!normalizedConversationId || !normalizedAccountId) {
        throw new ZernioConfigurationError(
            "A conversa social não possui os identificadores do Zernio.",
        );
    }
    if (!normalizedMessage && !normalizedAttachmentUrl) {
        throw new Error("A mensagem está vazia.");
    }

    const response = await zernioRequest<{
        success?: boolean;
        data?: {
            messageId?: string;
            conversationId?: string;
            sentAt?: string;
            message?: string | null;
        };
    }>(
        `/inbox/conversations/${encodeURIComponent(
            normalizedConversationId,
        )}/messages`,
        {
            method: "POST",
            body: JSON.stringify({
                accountId: normalizedAccountId,
                ...(normalizedMessage ? { message: normalizedMessage } : {}),
                ...(normalizedAttachmentUrl
                    ? {
                          attachmentUrl: normalizedAttachmentUrl,
                          attachmentType: attachmentType ?? "file",
                      }
                    : {}),
            }),
        },
    );
    const messageId = response.data?.messageId?.trim() ?? "";

    if (!messageId) {
        throw new ZernioApiError(
            "O Zernio aceitou a requisição sem retornar o ID da mensagem.",
        );
    }

    return {
        id: messageId,
        conversationId:
            response.data?.conversationId?.trim() || normalizedConversationId,
        sentAt: normalizeDate(response.data?.sentAt),
        message: response.data?.message ?? (normalizedMessage || null),
    } satisfies SentZernioMessage;
}

export async function getZernioAd(adId: string): Promise<ZernioAd> {
    const normalizedAdId = adId.trim();
    if (!normalizedAdId) {
        throw new Error("Zernio ad ID is required.");
    }

    const response = await zernioRequest<{ ad?: unknown }>(
        `/ads/${encodeURIComponent(normalizedAdId)}`,
    );
    const ad = asRecord(response.ad);
    if (!ad) {
        throw new ZernioApiError("O Zernio não retornou os dados do anúncio.");
    }
    const creative = asRecord(ad.creative);

    return {
        id: stringValue(ad._id),
        name: stringValue(ad.name),
        platform: stringValue(ad.platform),
        platform_ad_id: stringValue(ad.platformAdId),
        campaign_id: stringValue(ad.platformCampaignId),
        campaign_name: stringValue(ad.campaignName),
        ad_set_id: stringValue(ad.platformAdSetId),
        ad_set_name: stringValue(ad.adSetName),
        image_url:
            stringValue(creative?.imageUrl) ??
            stringValue(creative?.thumbnailUrl),
        video_url: stringValue(creative?.videoUrl),
    };
}

export function zernioExternalMessageId(messageId: string) {
    return `zernio:${messageId.trim()}`;
}

export function isZernioConfigured() {
    return Boolean(process.env.ZERNIO_API_KEY?.trim());
}

function getZernioApiKey() {
    const apiKey = process.env.ZERNIO_API_KEY?.trim().replace(/^Bearer\s+/i, "");

    if (!apiKey) {
        throw new ZernioConfigurationError(
            "ZERNIO_API_KEY não está configurada.",
        );
    }

    return apiKey;
}

async function zernioRequest<T = Record<string, unknown>>(
    path: string,
    init: RequestInit = {},
): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${getZernioApiKey()}`);

    const response = await fetch(`${ZERNIO_API_BASE_URL}${path}`, {
        ...init,
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(ZERNIO_REQUEST_TIMEOUT_MS),
    }).catch((error) => {
        throw new ZernioApiError(
            error instanceof Error
                ? `Não foi possível conectar ao Zernio: ${error.message}`
                : "Não foi possível conectar ao Zernio.",
        );
    });
    const rawBody = await response.text();
    const body = parseJson(rawBody);

    if (!response.ok) {
        const record = asRecord(body);
        const message =
            stringValue(record?.error) ??
            stringValue(record?.message) ??
            `Zernio respondeu com HTTP ${response.status}.`;

        throw new ZernioApiError(message, {
            status: response.status,
            code: stringValue(record?.code),
        });
    }

    return (body ?? {}) as T;
}

function sanitizeWebhook(value: ZernioWebhook): ZernioWebhook {
    return {
        _id: value._id,
        name: value.name,
        url: value.url,
        events: Array.isArray(value.events) ? value.events : [],
        isActive: value.isActive,
        lastFiredAt: value.lastFiredAt ?? null,
        failureCount: value.failureCount ?? 0,
    };
}

function sanitizeProfile(value: ZernioProfile): ZernioProfile {
    return {
        _id: value._id,
        name: value.name,
        color: value.color ?? null,
        isDefault: Boolean(value.isDefault),
    };
}

function sanitizeAccount(value: ZernioAccount): ZernioAccount {
    const profileId =
        value.profileId && typeof value.profileId === "object"
            ? {
                  _id: value.profileId._id,
                  name: value.profileId.name,
                  slug: value.profileId.slug,
              }
            : value.profileId;

    return {
        _id: value._id,
        platform: value.platform,
        profileId,
        username: value.username ?? null,
        displayName: value.displayName ?? null,
        profileUrl: value.profileUrl ?? null,
        isActive: Boolean(value.isActive),
    };
}

function platformLabel(platform: ZernioInboxPlatform) {
    return platform === "facebook" ? "Facebook Messenger" : "Instagram";
}

function parseJson(value: string) {
    if (!value.trim()) return {};

    try {
        return JSON.parse(value) as unknown;
    } catch {
        return { message: value };
    }
}

function normalizeUrl(value: string) {
    return value.trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeDate(value: unknown) {
    const parsed = new Date(typeof value === "string" ? value : Date.now());
    return Number.isNaN(parsed.getTime())
        ? new Date().toISOString()
        : parsed.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
