// lib/blip/sendBlipTextMessage.ts
import { randomUUID } from "crypto";

import { assertHubMessageAllowed } from "@/lib/messaging/messageSuppression";

const BLIP_WHATSAPP_SUFFIX = "@wa.gw.msging.net";
const BLIP_REQUEST_TIMEOUT_MS = 20_000;
const BLIP_MESSAGES_CONTRACT_ID = "engravida";

export type BlipDeliveryEvent = {
    event: string;
    id: string | null;
    from: string | null;
    to: string | null;
    reason: {
        code: number | string | null;
        description: string | null;
    } | null;
    metadata: Record<string, unknown> | null;
};

export type BlipDeliveryStatus = {
    state: "delivered" | "failed" | "pending" | "unavailable";
    final_event: string | null;
    reason: {
        code: number | string | null;
        description: string | null;
    } | null;
    events: BlipDeliveryEvent[];
    attempts: number;
    command_status: string | null;
    command_reason: unknown;
};

type BlipTextMessageBody = {
    id: string;
    to: string;
    type: "text/plain";
    content: string;
};

type BlipMediaMessageBody = {
    id: string;
    to: string;
    type: "application/vnd.lime.media-link+json";
    content: {
        title?: string;
        uri: string;
        type: string;
        size: number;
    };
};

type BlipMessageBody = BlipTextMessageBody | BlipMediaMessageBody;

export type BlipHttpDebug = {
    request_id: string;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    endpoint: string;
    method: "POST";
    headers: {
        "Content-Type": "application/json";
        Accept: "application/json";
        Authorization: "Key ***";
    };
    body: BlipMessageBody;
    response: {
        status: number | null;
        status_text: string | null;
        body: string | null;
    };
    delivery: BlipDeliveryStatus | null;
};

export class BlipConfigurationError extends Error {
    readonly debug: BlipHttpDebug | null;

    constructor(message: string, debug: BlipHttpDebug | null = null) {
        super(message);
        this.name = "BlipConfigurationError";
        this.debug = debug;
    }
}

export class BlipApiError extends Error {
    readonly status: number | null;
    readonly debug: BlipHttpDebug | null;

    constructor(
        message: string,
        status: number | null = null,
        debug: BlipHttpDebug | null = null,
    ) {
        super(message);
        this.name = "BlipApiError";
        this.status = status;
        this.debug = debug;
    }
}

export type SentBlipMessage = {
    id: string;
    from: string | null;
    to: string;
    delivery: BlipDeliveryStatus;
    debug: BlipHttpDebug;
};

export type SentBlipTextMessage = SentBlipMessage;
export type SentBlipMediaMessage = SentBlipMessage;

export async function sendBlipTextMessage({
    recipientNumber,
    text,
    requestId,
}: {
    recipientNumber: string;
    text: string;
    requestId?: string;
}): Promise<SentBlipTextMessage> {
    const normalizedText = text.trim();

    if (!normalizedText) {
        throw new Error("Blip message text is required");
    }

    const to = toBlipWhatsAppIdentity(recipientNumber);
    const id = randomUUID();

    return sendBlipEnvelope({
        requestId: requestId ?? id,
        body: {
            id,
            to,
            type: "text/plain",
            content: normalizedText,
        },
    });
}

export async function sendBlipMediaMessage({
    recipientNumber,
    title,
    uri,
    mimeType,
    size,
    requestId,
}: {
    recipientNumber: string;
    title?: string;
    uri: string;
    mimeType: string;
    size: number;
    requestId?: string;
}): Promise<SentBlipMediaMessage> {
    const normalizedTitle = title?.trim() ?? "";
    const normalizedUri = uri.trim();
    const normalizedMimeType = mimeType.trim();

    if (!normalizedUri || !normalizedMimeType || size <= 0) {
        throw new Error("Blip media data is incomplete");
    }

    const to = toBlipWhatsAppIdentity(recipientNumber);
    const id = randomUUID();

    return sendBlipEnvelope({
        requestId: requestId ?? id,
        body: {
            id,
            to,
            type: "application/vnd.lime.media-link+json",
            content: {
                ...(normalizedTitle ? { title: normalizedTitle } : {}),
                uri: normalizedUri,
                type: normalizedMimeType,
                size,
            },
        },
    });
}

async function sendBlipEnvelope({
    requestId,
    body,
}: {
    requestId: string;
    body: BlipMessageBody;
}): Promise<SentBlipMessage> {
    await assertHubMessageAllowed(body.to);

    const auth = getBlipAuth();
    const endpoint = `https://${BLIP_MESSAGES_CONTRACT_ID}.http.msging.net/messages`;
    const startedAtMs = Date.now();

    const debug: BlipHttpDebug = {
        request_id: requestId,
        started_at: new Date(startedAtMs).toISOString(),
        finished_at: null,
        duration_ms: null,
        endpoint,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: "Key ***",
        },
        body,
        response: {
            status: null,
            status_text: null,
            body: null,
        },
        delivery: null,
    };

    console.info(`[blip-send:${debug.request_id}] Preparing outbound message`, {
        endpoint: debug.endpoint,
        method: debug.method,
        headers: debug.headers,
        body: debug.body,
        messages_contract_id: BLIP_MESSAGES_CONTRACT_ID,
        auth_key_source: auth.source,
        auth_key_configured: true,
        auth_key_length: auth.key.length,
        timeout_ms: BLIP_REQUEST_TIMEOUT_MS,
    });

    let response: Response;

    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Key ${auth.key}`,
            },
            body: JSON.stringify(body),
            cache: "no-store",
            signal: AbortSignal.timeout(BLIP_REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        finishDebug(debug, startedAtMs);

        const timedOut =
            error instanceof DOMException && error.name === "TimeoutError";
        const errorMessage =
            error instanceof Error ? `${error.name}: ${error.message}` : String(error);

        debug.response.body = errorMessage;

        console.error(`[blip-send:${debug.request_id}] Network failure`, {
            error,
            debug,
        });

        throw new BlipApiError(
            timedOut
                ? "A Blip demorou demais para responder. Tente novamente."
                : `Não foi possível conectar à API da Blip: ${errorMessage}`,
            null,
            debug,
        );
    }

    const responseBody = await response.text();

    debug.response = {
        status: response.status,
        status_text: response.statusText || null,
        body: responseBody || null,
    };
    finishDebug(debug, startedAtMs);

    console.info(`[blip-send:${debug.request_id}] Blip HTTP response`, debug);

    if (!response.ok) {
        const details = extractBlipErrorDetails(responseBody);
        const suffix = details ? `: ${details}` : "";

        throw new BlipApiError(
            `A Blip recusou a mensagem (HTTP ${response.status})${suffix}`,
            response.status,
            debug,
        );
    }

    const delivery: BlipDeliveryStatus = {
        state: "pending",
        final_event: null,
        reason: null,
        events: [],
        attempts: 0,
        command_status: null,
        command_reason: null,
    };

    debug.delivery = delivery;

    return {
        id: body.id,
        from: null,
        to: body.to,
        delivery,
        debug,
    };
}

export function toBlipWhatsAppIdentity(value: string) {
    const trimmedValue = value.trim();

    if (trimmedValue.toLowerCase().endsWith(BLIP_WHATSAPP_SUFFIX)) {
        return trimmedValue;
    }

    let digits = trimmedValue.replace(/\D/g, "");

    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
        digits = `55${digits}`;
    }

    if (!digits.startsWith("55") || (digits.length !== 12 && digits.length !== 13)) {
        throw new BlipConfigurationError(
            "O número de teste da Blip precisa estar no formato brasileiro com DDD.",
        );
    }

    return `${digits}${BLIP_WHATSAPP_SUFFIX}`;
}

function getBlipAuth(): {
    key: string;
    source: "BLIP_KEY" | "BLIP_ROUTER_AUTH_KEY" | "BLIP_AUTH_KEY";
} {
    const options = [
        { source: "BLIP_KEY" as const, value: process.env.BLIP_KEY },
        {
            source: "BLIP_ROUTER_AUTH_KEY" as const,
            value: process.env.BLIP_ROUTER_AUTH_KEY,
        },
        { source: "BLIP_AUTH_KEY" as const, value: process.env.BLIP_AUTH_KEY },
    ];

    for (const option of options) {
        const rawValue = option.value?.trim();
        if (!rawValue) continue;

        const key = rawValue.replace(/^Key\s+/i, "").trim();

        if (key) {
            return { key, source: option.source };
        }
    }

    throw new BlipConfigurationError(
        "Nenhuma chave da Blip está configurada. Configure BLIP_KEY, BLIP_ROUTER_AUTH_KEY ou BLIP_AUTH_KEY.",
    );
}

function finishDebug(debug: BlipHttpDebug, startedAtMs: number) {
    const finishedAtMs = Date.now();
    debug.finished_at = new Date(finishedAtMs).toISOString();
    debug.duration_ms = finishedAtMs - startedAtMs;
}

function extractBlipErrorDetails(responseBody: string) {
    const trimmedBody = responseBody.trim();
    if (!trimmedBody) return null;

    try {
        const parsed = JSON.parse(trimmedBody) as Record<string, unknown>;
        const candidate =
            parsed.description ?? parsed.message ?? parsed.error ?? parsed.reason;

        if (typeof candidate === "string" && candidate.trim()) {
            return limitLength(candidate.trim());
        }
    } catch {
        // Some Blip errors are returned as plain text instead of JSON.
    }

    return limitLength(trimmedBody.replace(/\s+/g, " "));
}

function limitLength(value: string) {
    return value.length > 1000 ? `${value.slice(0, 997)}...` : value;
}
