// lib/blip/sendBlipTemplateMessage.ts
import { randomUUID } from "crypto";

import type { ActiveMessageTemplate } from "@/lib/active-messages/templates";

const BLIP_REQUEST_TIMEOUT_MS = 20_000;
const ACTIVE_CAMPAIGN_POSTMASTER = "postmaster@activecampaign.msging.net";
const ACTIVE_CAMPAIGN_URI = "/campaign/full";
const ACTIVE_CAMPAIGN_TYPE =
    "application/vnd.iris.activecampaign.full-campaign+json";

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
    template,
    messageParams,
}: {
    recipientNumber: string;
    template: ActiveMessageTemplate;
    messageParams: Record<string, string>;
}): Promise<SentBlipTemplateMessage> {
    validateMessageParams(template, messageParams);

    const contractId = getBlipContractId();
    const authKey = getBlipAuthKey();
    const id = randomUUID();
    const normalizedPhone = normalizeBrazilianPhone(recipientNumber);
    const endpoint = `https://${contractId}.http.msging.net/commands`;
    const parameterKeys = template.parameters.map((parameter) => parameter.key);

    const body = {
        id,
        to: ACTIVE_CAMPAIGN_POSTMASTER,
        method: "set",
        uri: ACTIVE_CAMPAIGN_URI,
        type: ACTIVE_CAMPAIGN_TYPE,
        resource: {
            campaign: {
                name: `engravida-hub-${template.id}-${randomUUID()}`,
                campaignType: "Individual",
                flowId: template.active_campaign.flow_id,
                stateId: template.active_campaign.state_id,
                masterstate: template.active_campaign.masterstate,
                channelType: "WhatsApp",
                sourceApplication: "API",
            },
            audience: {
                recipient: `+${normalizedPhone}`,
                messageParams,
            },
            message: {
                messageTemplate: template.blip_template_name,
                messageParams: parameterKeys,
                channelType: "WhatsApp",
            },
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
                ? "A Blip demorou demais para responder à campanha ativa."
                : `Não foi possível conectar à API da Blip: ${
                      error instanceof Error ? error.message : String(error)
                  }`,
        );
    }

    const responseBody = await response.text();

    if (!response.ok) {
        throw new BlipTemplateApiError(
            `A Blip recusou a campanha ativa (HTTP ${response.status})${
                responseBody ? `: ${limitLength(responseBody)}` : ""
            }`,
            response.status,
        );
    }

    const parsedResponse = parseJsonResponse(responseBody);

    if (parsedResponse?.status === "failure") {
        throw new BlipTemplateApiError(
            `A Blip recusou a campanha ativa: ${limitLength(
                JSON.stringify(parsedResponse.reason ?? parsedResponse),
            )}`,
            response.status,
        );
    }

    return {
        id,
        to: `${normalizedPhone}@wa.gw.msging.net`,
        response_status: response.status,
        response_body: responseBody || null,
    };
}

function validateMessageParams(
    template: ActiveMessageTemplate,
    messageParams: Record<string, string>,
) {
    for (const parameter of template.parameters) {
        const value = messageParams[parameter.key]?.trim();

        if (!value) {
            throw new BlipTemplateConfigurationError(
                `O parâmetro ${parameter.key} do template ativo está vazio.`,
            );
        }
    }
}

function normalizeBrazilianPhone(value: string) {
    let digits = value.replace(/\D/g, "");

    if (
        (digits.length === 10 || digits.length === 11) &&
        !digits.startsWith("55")
    ) {
        digits = `55${digits}`;
    }

    if (
        !digits.startsWith("55") ||
        (digits.length !== 12 && digits.length !== 13)
    ) {
        throw new BlipTemplateConfigurationError(
            "O telefone do cliente precisa estar no formato brasileiro com DDD.",
        );
    }

    return digits;
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
    const rawValue =
        process.env.BLIP_AUTH_KEY?.trim() || process.env.BLIP_KEY?.trim();

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

function parseJsonResponse(value: string) {
    if (!value.trim()) return null;

    try {
        return JSON.parse(value) as {
            status?: string;
            reason?: unknown;
        };
    } catch {
        return null;
    }
}

function limitLength(value: string) {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 1000 ? `${compact.slice(0, 997)}...` : compact;
}
