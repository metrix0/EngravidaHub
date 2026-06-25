// lib/blip/sendBlipTemplateMessage.ts

import { randomUUID } from "crypto";

import { toBlipWhatsAppIdentity } from "@/lib/blip/sendBlipTextMessage";

const BLIP_REQUEST_TIMEOUT_MS = 20_000;

export type SentBlipTemplateMessage = {
    id: string;
    to: string;
    response_status: number;
    response_body: string | null;
};

export class BlipTemplateConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BlipTemplateConfigurationError";
    }
}

export class BlipTemplateApiError extends Error {
    readonly status: number | null;

    constructor(message: string, status: number | null = null) {
        super(message);
        this.name = "BlipTemplateApiError";
        this.status = status;
    }
}

export async function sendBlipTemplateMessage({
    recipientNumber,
    templateName,
    languageCode,
    namespace,
    bodyParameters,
}: {
    recipientNumber: string;
    templateName: string;
    languageCode: string;
    namespace?: string | null;
    bodyParameters?: string[];
}): Promise<SentBlipTemplateMessage> {
    const contractId = getBlipContractId();
    const authKey = getBlipAuthKey();
    const id = randomUUID();
    const to = toBlipWhatsAppIdentity(recipientNumber);
    const endpoint = `https://${contractId}.http.msging.net/messages`;
    const resolvedNamespace =
        namespace?.trim() ||
        process.env.BLIP_WHATSAPP_TEMPLATE_NAMESPACE?.trim() ||
        null;

    const template = {
        name: templateName,
        language: {
            code: languageCode,
            policy: "deterministic",
        },
        ...(resolvedNamespace ? { namespace: resolvedNamespace } : {}),
        ...((bodyParameters?.length ?? 0) > 0
            ? {
                  components: [
                      {
                          type: "body",
                          parameters: bodyParameters!.map((text) => ({
                              type: "text",
                              text,
                          })),
                      },
                  ],
              }
            : {}),
    };

    const body = {
        id,
        to,
        type: "application/json",
        content: {
            type: "template",
            template,
        },
    };

    let response: Response;

    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Key ${authKey}`,
            },
            body: JSON.stringify(body),
            cache: "no-store",
            signal: AbortSignal.timeout(BLIP_REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        const timedOut =
            error instanceof DOMException && error.name === "TimeoutError";

        throw new BlipTemplateApiError(
            timedOut
                ? "A Blip demorou demais para responder ao template."
                : `Não foi possível conectar à API da Blip: ${
                      error instanceof Error ? error.message : String(error)
                  }`,
        );
    }

    const responseBody = await response.text();

    if (!response.ok) {
        throw new BlipTemplateApiError(
            `A Blip recusou o template (HTTP ${response.status})${
                responseBody ? `: ${limitLength(responseBody)}` : ""
            }`,
            response.status,
        );
    }

    return {
        id,
        to,
        response_status: response.status,
        response_body: responseBody || null,
    };
}

function getBlipContractId() {
    const rawValue = process.env.BLIP_CONTRACT_ID?.trim();

    if (!rawValue) {
        throw new BlipTemplateConfigurationError(
            "BLIP_CONTRACT_ID não está configurado no servidor.",
        );
    }

    const contractId = rawValue
        .replace(/^https?:\/\//i, "")
        .replace(/\.http\.msging\.net(?:\/.*)?$/i, "")
        .replace(/\/.*$/, "")
        .trim();

    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(contractId)) {
        throw new BlipTemplateConfigurationError(
            "BLIP_CONTRACT_ID é inválido.",
        );
    }

    return contractId;
}

function getBlipAuthKey() {
    const rawValue = process.env.BLIP_AUTH_KEY?.trim();

    if (!rawValue) {
        throw new BlipTemplateConfigurationError(
            "BLIP_AUTH_KEY não está configurado no servidor.",
        );
    }

    const authKey = rawValue.replace(/^Key\s+/i, "").trim();

    if (!authKey) {
        throw new BlipTemplateConfigurationError("BLIP_AUTH_KEY é inválido.");
    }

    return authKey;
}

function limitLength(value: string) {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 1000 ? `${compact.slice(0, 997)}...` : compact;
}
