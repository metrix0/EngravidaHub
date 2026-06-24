// lib/blip/sendBlipTextMessage.ts
import { randomUUID } from "crypto";

const BLIP_WHATSAPP_SUFFIX = "@wa.gw.msging.net";
const BLIP_REQUEST_TIMEOUT_MS = 20_000;
const NOTIFICATION_POLL_DELAYS_MS = [350, 650, 1_000, 1_500, 2_000];

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
    body: {
        id: string;
        from: string;
        to: string;
        type: "text/plain";
        content: string;
    };
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

export type SentBlipTextMessage = {
    id: string;
    from: string;
    to: string;
    delivery: BlipDeliveryStatus;
    debug: BlipHttpDebug;
};

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

    const contractId = getBlipContractId();
    const authKey = getBlipAuthKey();
    const endpoint = `https://${contractId}.http.msging.net/messages`;
    const from = `${contractId}@msging.net`;
    const to = toBlipWhatsAppIdentity(recipientNumber);
    const id = randomUUID();
    const startedAtMs = Date.now();

    const debug: BlipHttpDebug = {
        request_id: requestId ?? id,
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
        body: {
            id,
            from,
            to,
            type: "text/plain",
            content: normalizedText,
        },
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
        auth_key_configured: true,
        auth_key_length: authKey.length,
        timeout_ms: BLIP_REQUEST_TIMEOUT_MS,
    });

    let response: Response;

    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Key ${authKey}`,
            },
            body: JSON.stringify(debug.body),
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

    const delivery = await waitForBlipDeliveryStatus({
        contractId,
        authKey,
        messageId: id,
        requestId: debug.request_id,
    });

    debug.delivery = delivery;

    console.info(`[blip-send:${debug.request_id}] Final delivery check`, delivery);

    if (delivery.state === "failed") {
        const description =
            delivery.reason?.description ?? "A Blip informou falha na entrega.";
        const code = delivery.reason?.code;
        const codeSuffix = code === null || code === undefined ? "" : ` (código ${code})`;

        throw new BlipApiError(
            `${description}${codeSuffix}`,
            502,
            debug,
        );
    }

    return { id, from, to, delivery, debug };
}

async function waitForBlipDeliveryStatus({
    contractId,
    authKey,
    messageId,
    requestId,
}: {
    contractId: string;
    authKey: string;
    messageId: string;
    requestId: string;
}): Promise<BlipDeliveryStatus> {
    let latestEvents: BlipDeliveryEvent[] = [];
    let latestCommandStatus: string | null = null;
    let latestCommandReason: unknown = null;

    for (let attempt = 0; attempt < NOTIFICATION_POLL_DELAYS_MS.length; attempt += 1) {
        await sleep(NOTIFICATION_POLL_DELAYS_MS[attempt]);

        const result = await getBlipMessageNotifications({
            contractId,
            authKey,
            messageId,
            requestId,
            attempt: attempt + 1,
        });

        latestEvents = result.events;
        latestCommandStatus = result.commandStatus;
        latestCommandReason = result.commandReason;

        const failed = [...latestEvents]
            .reverse()
            .find((event) => event.event.toLowerCase() === "failed");

        if (failed) {
            return {
                state: "failed",
                final_event: "failed",
                reason: failed.reason,
                events: latestEvents,
                attempts: attempt + 1,
                command_status: latestCommandStatus,
                command_reason: latestCommandReason,
            };
        }

        const delivered = [...latestEvents]
            .reverse()
            .find((event) =>
                ["received", "consumed"].includes(event.event.toLowerCase()),
            );

        if (delivered) {
            return {
                state: "delivered",
                final_event: delivered.event,
                reason: null,
                events: latestEvents,
                attempts: attempt + 1,
                command_status: latestCommandStatus,
                command_reason: latestCommandReason,
            };
        }
    }

    if (latestCommandStatus === "failure") {
        return {
            state: "unavailable",
            final_event: null,
            reason: null,
            events: latestEvents,
            attempts: NOTIFICATION_POLL_DELAYS_MS.length,
            command_status: latestCommandStatus,
            command_reason: latestCommandReason,
        };
    }

    return {
        state: "pending",
        final_event: latestEvents.at(-1)?.event ?? null,
        reason: null,
        events: latestEvents,
        attempts: NOTIFICATION_POLL_DELAYS_MS.length,
        command_status: latestCommandStatus,
        command_reason: latestCommandReason,
    };
}

async function getBlipMessageNotifications({
    contractId,
    authKey,
    messageId,
    requestId,
    attempt,
}: {
    contractId: string;
    authKey: string;
    messageId: string;
    requestId: string;
    attempt: number;
}) {
    const endpoint = `https://${contractId}.http.msging.net/commands`;
    const command = {
        id: randomUUID(),
        to: "postmaster@msging.net",
        method: "get",
        uri: `/notifications?id=${encodeURIComponent(messageId)}`,
    };

    console.info(`[blip-send:${requestId}] Querying message notifications`, {
        attempt,
        endpoint,
        command,
    });

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Key ${authKey}`,
            },
            body: JSON.stringify(command),
            cache: "no-store",
            signal: AbortSignal.timeout(BLIP_REQUEST_TIMEOUT_MS),
        });

        const rawBody = await response.text();
        const parsed = safeJson(rawBody);
        const commandStatus = getString(parsed, "status");
        const commandReason = getRecordValue(parsed, "reason");
        const resource = getRecordValue(parsed, "resource");
        const rawItems = Array.isArray(resource?.items) ? resource.items : [];
        const events = rawItems
            .map(parseDeliveryEvent)
            .filter((item): item is BlipDeliveryEvent => Boolean(item));

        console.info(`[blip-send:${requestId}] Notification query response`, {
            attempt,
            http_status: response.status,
            command_status: commandStatus,
            command_reason: commandReason,
            events,
            raw_body: rawBody || null,
        });

        return {
            events,
            commandStatus,
            commandReason,
        };
    } catch (error) {
        console.error(`[blip-send:${requestId}] Notification query failed`, {
            attempt,
            error,
        });

        return {
            events: [] as BlipDeliveryEvent[],
            commandStatus: "failure",
            commandReason:
                error instanceof Error
                    ? { description: `${error.name}: ${error.message}` }
                    : { description: String(error) },
        };
    }
}

function parseDeliveryEvent(value: unknown): BlipDeliveryEvent | null {
    if (!isRecord(value)) return null;

    const event = getString(value, "event");
    if (!event) return null;

    const reasonValue = getRecordValue(value, "reason");
    const codeValue = reasonValue?.code;

    return {
        event,
        id: getString(value, "id"),
        from: getString(value, "from"),
        to: getString(value, "to"),
        reason: reasonValue
            ? {
                code:
                    typeof codeValue === "number" || typeof codeValue === "string"
                        ? codeValue
                        : null,
                description: getString(reasonValue, "description"),
            }
            : null,
        metadata: getRecordValue(value, "metadata"),
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

function getBlipContractId() {
    const rawValue = process.env.BLIP_CONTRACT_ID?.trim();

    if (!rawValue) {
        throw new BlipConfigurationError(
            "BLIP_CONTRACT_ID não está configurado no servidor.",
        );
    }

    const contractId = rawValue
        .replace(/^https?:\/\//i, "")
        .replace(/\.http\.msging\.net(?:\/.*)?$/i, "")
        .replace(/\/.*$/, "")
        .trim();

    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(contractId)) {
        throw new BlipConfigurationError(
            `BLIP_CONTRACT_ID é inválido: ${maskValue(rawValue)}`,
        );
    }

    return contractId;
}

function getBlipAuthKey() {
    const rawValue = process.env.BLIP_AUTH_KEY?.trim();

    if (!rawValue) {
        throw new BlipConfigurationError(
            "BLIP_AUTH_KEY não está configurado no servidor.",
        );
    }

    const authKey = rawValue.replace(/^Key\s+/i, "").trim();

    if (!authKey) {
        throw new BlipConfigurationError("BLIP_AUTH_KEY é inválido.");
    }

    return authKey;
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
            parsed.description ??
            parsed.message ??
            parsed.error ??
            parsed.reason;

        if (typeof candidate === "string" && candidate.trim()) {
            return limitLength(candidate.trim());
        }
    } catch {
        // Some Blip errors are returned as plain text instead of JSON.
    }

    return limitLength(trimmedBody.replace(/\s+/g, " "));
}

function safeJson(value: string): Record<string, unknown> | null {
    if (!value.trim()) return null;

    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, key: string) {
    if (!isRecord(value)) return null;
    const candidate = value[key];
    return typeof candidate === "string" ? candidate : null;
}

function getRecordValue(value: unknown, key: string) {
    if (!isRecord(value)) return null;
    const candidate = value[key];
    return isRecord(candidate) ? candidate : null;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function limitLength(value: string) {
    return value.length > 1000 ? `${value.slice(0, 997)}...` : value;
}

function maskValue(value: string) {
    if (value.length <= 8) return "***";
    return `${value.slice(0, 3)}***${value.slice(-3)}`;
}
