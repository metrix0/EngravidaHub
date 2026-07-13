// lib/blip/sendBlipActiveTemplateMessage.ts
import { randomUUID } from "crypto";

import type { ActiveMessageTemplate } from "@/lib/active-messages/templates";

const ACTIVE_CAMPAIGN_POSTMASTER = "postmaster@activecampaign.msging.net";
const ACTIVE_CAMPAIGN_URI = "/campaign/full";
const ACTIVE_CAMPAIGN_TYPE =
    "application/vnd.iris.activecampaign.full-campaign+json";
const WHATSAPP_POSTMASTER = "postmaster@wa.gw.msging.net";
const TEMPLATE_QUERY_URI = "/message-templates-enriched";
const REQUEST_TIMEOUT_MS = 20_000;

export type SentBlipActiveTemplateMessage = {
    id: string;
    to: string;
    response_status: number;
    response_body: string | null;
};

type ActiveRouterConfig = {
    contractId: string;
    key: string;
    commandsEndpoint: string;
};

type BlipCommandResponse = {
    status?: string;
    resource?: unknown;
    reason?: unknown;
    [key: string]: unknown;
};

type DiscoveredTemplate = {
    name: string;
    status: string | null;
    language: string | null;
    parameterKeys: string[];
};

type CampaignPayload = {
    id: string;
    to: typeof ACTIVE_CAMPAIGN_POSTMASTER;
    method: "set";
    uri: typeof ACTIVE_CAMPAIGN_URI;
    type: typeof ACTIVE_CAMPAIGN_TYPE;
    resource: {
        campaign: {
            name: string;
            campaignType: "Individual";
            channelType: "WhatsApp";
            sourceApplication: string;
        };
        audience: {
            recipient: string;
            messageParams: Record<string, string>;
        };
        message: {
            messageTemplate: string;
            messageParams: string[];
            channelType: "WhatsApp";
            messageTemplateLanguage?: string;
        };
    };
};

export class BlipActiveRouterConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BlipActiveRouterConfigurationError";
    }
}

export class BlipActiveRouterApiError extends Error {
    readonly status: number | null;

    constructor(message: string, status: number | null = null) {
        super(message);
        this.name = "BlipActiveRouterApiError";
        this.status = status;
    }
}

export async function sendBlipActiveTemplateMessage({
    recipientNumber,
    template,
    messageParams,
}: {
    recipientNumber: string;
    template: ActiveMessageTemplate;
    messageParams: Record<string, string>;
}): Promise<SentBlipActiveTemplateMessage> {
    const config = getActiveRouterConfig();
    const normalizedPhone = normalizeBrazilianPhone(recipientNumber);
    const discoveredTemplate = await discoverApprovedTemplate({
        config,
        candidates: uniqueStrings([
            template.blip_template_name.trim(),
            template.id.trim(),
        ]),
    });

    validateExactParameters({
        expectedKeys: discoveredTemplate.parameterKeys,
        messageParams,
        templateName: discoveredTemplate.name,
    });

    const orderedParams = Object.fromEntries(
        discoveredTemplate.parameterKeys.map((key) => [
            key,
            messageParams[key].trim(),
        ]),
    );
    const requestId = randomUUID();
    const payload = buildCampaignPayload({
        requestId,
        normalizedPhone,
        templateName: discoveredTemplate.name,
        templateLanguage: discoveredTemplate.language,
        parameterKeys: discoveredTemplate.parameterKeys,
        orderedParams,
    });

    console.info(`[blip-active-router:${requestId}] Sending campaign`, {
        contract_id: config.contractId,
        recipient: maskPhone(normalizedPhone),
        template: {
            name: discoveredTemplate.name,
            status: discoveredTemplate.status,
            language: discoveredTemplate.language,
            parameter_keys: discoveredTemplate.parameterKeys,
        },
    });

    const response = await executeRequest({
        endpoint: config.commandsEndpoint,
        authKey: config.key,
        body: payload,
        label: "campaign/full",
    });

    if (!response.httpOk) {
        throw new BlipActiveRouterApiError(
            `A Blip recusou a campanha ativa no novo roteador (HTTP ${response.status})${
                response.text ? `: ${limitLength(response.text)}` : ""
            }`,
            response.status,
        );
    }

    const parsed = parseJsonResponse(response.text);
    const failure = getFailure(parsed);

    if (failure) {
        throw new BlipActiveRouterApiError(
            `A Blip recusou a campanha ativa no novo roteador: ${limitLength(
                JSON.stringify(failure),
            )}`,
            response.status,
        );
    }

    return {
        id: requestId,
        to: `${normalizedPhone}@wa.gw.msging.net`,
        response_status: response.status,
        response_body: response.text || null,
    };
}

async function discoverApprovedTemplate({
    config,
    candidates,
}: {
    config: ActiveRouterConfig;
    candidates: string[];
}) {
    if (candidates.length === 0) {
        throw new BlipActiveRouterConfigurationError(
            "Nenhum nome de template foi configurado para a mensagem ativa.",
        );
    }

    const seenTemplates = new Map<string, DiscoveredTemplate>();

    for (const candidate of candidates) {
        const response = await executeRequest({
            endpoint: config.commandsEndpoint,
            authKey: config.key,
            body: {
                id: randomUUID(),
                to: WHATSAPP_POSTMASTER,
                method: "get",
                uri: `${TEMPLATE_QUERY_URI}?templateName=${encodeURIComponent(candidate)}`,
            },
            label: `template query: ${candidate}`,
        });

        if (!response.httpOk) {
            throw new BlipActiveRouterApiError(
                `A consulta de templates no novo roteador falhou (HTTP ${response.status})${
                    response.text ? `: ${limitLength(response.text)}` : ""
                }`,
                response.status,
            );
        }

        const parsed = parseJsonResponse(response.text);
        const failure = getFailure(parsed);

        if (failure) {
            if (String(failure.code) === "81") {
                throw new BlipActiveRouterConfigurationError(
                    "BLIP_ACTIVE_ROUTER_KEY não pertence ao novo roteador com o número de mensagens ativas.",
                );
            }

            throw new BlipActiveRouterApiError(
                `A Blip recusou a consulta do template “${candidate}”: ${limitLength(
                    JSON.stringify(failure),
                )}`,
                response.status,
            );
        }

        for (const item of extractTemplateItems(parsed?.resource)) {
            const normalized = normalizeDiscoveredTemplate(item);
            if (!normalized) continue;
            seenTemplates.set(normalized.name.toLowerCase(), normalized);
        }

        const exact = seenTemplates.get(candidate.toLowerCase());
        if (exact && isApproved(exact.status)) {
            return exact;
        }
    }

    throw new BlipActiveRouterConfigurationError(
        `Nenhum template aprovado foi encontrado no novo roteador. Consultados: ${candidates.join(
            ", ",
        )}.`,
    );
}

function buildCampaignPayload({
    requestId,
    normalizedPhone,
    templateName,
    templateLanguage,
    parameterKeys,
    orderedParams,
}: {
    requestId: string;
    normalizedPhone: string;
    templateName: string;
    templateLanguage: string | null;
    parameterKeys: string[];
    orderedParams: Record<string, string>;
}): CampaignPayload {
    const message: CampaignPayload["resource"]["message"] = {
        messageTemplate: templateName,
        messageParams: parameterKeys,
        channelType: "WhatsApp",
    };

    if (templateLanguage && templateLanguage.toLowerCase() !== "pt_br") {
        message.messageTemplateLanguage = templateLanguage;
    }

    return {
        id: requestId,
        to: ACTIVE_CAMPAIGN_POSTMASTER,
        method: "set",
        uri: ACTIVE_CAMPAIGN_URI,
        type: ACTIVE_CAMPAIGN_TYPE,
        resource: {
            campaign: {
                name: `engravida-hub-active-${randomUUID()}`,
                campaignType: "Individual",
                channelType: "WhatsApp",
                sourceApplication: "EngravidaHub",
            },
            audience: {
                recipient: `+${normalizedPhone}`,
                messageParams: orderedParams,
            },
            message,
        },
    };
}

function getActiveRouterConfig(): ActiveRouterConfig {
    const contractId = getRequiredEnvironmentValue(
        "BLIP_ACTIVE_ROUTER_CONTRACT_ID",
    );
    const key = normalizeAuthorizationKey(
        getRequiredEnvironmentValue("BLIP_ACTIVE_ROUTER_KEY"),
    );
    const identity = decodeAuthorizationIdentity(key);

    if (identity && !authorizationMatchesContract(identity, contractId)) {
        throw new BlipActiveRouterConfigurationError(
            `BLIP_ACTIVE_ROUTER_KEY pertence a “${identity}”, mas BLIP_ACTIVE_ROUTER_CONTRACT_ID está configurado como “${contractId}”.`,
        );
    }

    return {
        contractId,
        key,
        commandsEndpoint: `https://${contractId}.http.msging.net/commands`,
    };
}

function normalizeDiscoveredTemplate(
    value: unknown,
): DiscoveredTemplate | null {
    if (!isRecord(value)) return null;

    const name = getString(value, ["name", "templateName", "template_name"]);
    if (!name) return null;

    return {
        name,
        status: getString(value, ["status"]),
        language: getString(value, ["language", "languageCode"]),
        parameterKeys: extractParameterKeys(value.components),
    };
}

function extractTemplateItems(resource: unknown): unknown[] {
    if (Array.isArray(resource)) return resource;
    if (!isRecord(resource)) return [];

    for (const key of ["items", "documents", "templates", "data"]) {
        const value = resource[key];
        if (Array.isArray(value)) return value;
    }

    return [resource];
}

function extractParameterKeys(components: unknown) {
    const serialized = JSON.stringify(components ?? []);
    const keys = new Set<string>();

    for (const match of serialized.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
        if (match[1]) keys.add(match[1]);
    }

    return [...keys].sort(compareParameterKeys);
}

function validateExactParameters({
    expectedKeys,
    messageParams,
    templateName,
}: {
    expectedKeys: string[];
    messageParams: Record<string, string>;
    templateName: string;
}) {
    const providedKeys = Object.keys(messageParams).sort(compareParameterKeys);

    if (
        expectedKeys.length !== providedKeys.length ||
        expectedKeys.some((key, index) => key !== providedKeys[index])
    ) {
        throw new BlipActiveRouterConfigurationError(
            `O template aprovado “${templateName}” espera os parâmetros [${expectedKeys.join(
                ", ",
            )}], mas o Hub forneceu [${providedKeys.join(", ")}].`,
        );
    }

    for (const key of expectedKeys) {
        if (!messageParams[key]?.trim()) {
            throw new BlipActiveRouterConfigurationError(
                `O parâmetro ${key} do template “${templateName}” está vazio.`,
            );
        }
    }
}

async function executeRequest({
    endpoint,
    authKey,
    body,
    label,
}: {
    endpoint: string;
    authKey: string;
    body: unknown;
    label: string;
}) {
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
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        const message =
            error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error);

        throw new BlipActiveRouterApiError(
            `Falha de conexão durante “${label}”: ${message}`,
        );
    }

    const text = await response.text();

    console.info(`[blip-active-router] ${label} response`, {
        status: response.status,
        status_text: response.statusText,
        body: text || null,
    });

    return {
        status: response.status,
        httpOk: response.ok,
        text,
    };
}

function getFailure(parsed: BlipCommandResponse | null) {
    if (parsed?.status !== "failure") return null;

    if (!isRecord(parsed.reason)) {
        return {
            code: null,
            description: JSON.stringify(parsed.reason ?? parsed),
        };
    }

    return {
        code:
            typeof parsed.reason.code === "number" ||
            typeof parsed.reason.code === "string"
                ? parsed.reason.code
                : null,
        description:
            typeof parsed.reason.description === "string"
                ? parsed.reason.description
                : JSON.stringify(parsed.reason),
    };
}

function parseJsonResponse(value: string): BlipCommandResponse | null {
    if (!value.trim()) return null;

    try {
        return JSON.parse(value) as BlipCommandResponse;
    } catch {
        return null;
    }
}

function getRequiredEnvironmentValue(name: string) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new BlipActiveRouterConfigurationError(
            `${name} não está configurado no servidor.`,
        );
    }
    return value;
}

function normalizeAuthorizationKey(value: string) {
    const key = value.replace(/^Key\s+/i, "").trim();
    if (!key) {
        throw new BlipActiveRouterConfigurationError(
            "BLIP_ACTIVE_ROUTER_KEY é inválida.",
        );
    }
    return key;
}

function decodeAuthorizationIdentity(key: string) {
    try {
        const decoded = Buffer.from(key, "base64").toString("utf8");
        const separator = decoded.indexOf(":");
        if (separator <= 0) return null;

        const identity = decoded.slice(0, separator).trim();
        return identity || null;
    } catch {
        return null;
    }
}

function authorizationMatchesContract(identity: string, contractId: string) {
    const localPart = identity.split("@")[0]?.toLowerCase();
    return localPart === contractId.toLowerCase();
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
        throw new BlipActiveRouterConfigurationError(
            "O telefone do cliente precisa estar no formato brasileiro com DDD.",
        );
    }

    return digits;
}

function getString(value: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const item = value[key];
        if (typeof item === "string" && item.trim()) return item.trim();
    }
    return null;
}

function isApproved(status: string | null) {
    return status?.toUpperCase() === "APPROVED";
}

function compareParameterKeys(first: string, second: string) {
    const firstNumber = Number(first);
    const secondNumber = Number(second);

    if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
        return firstNumber - secondNumber;
    }

    return first.localeCompare(second);
}

function uniqueStrings(values: Array<string | undefined>) {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }

    return result;
}

function maskPhone(value: string) {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 8) return "***";
    return `${digits.slice(0, 4)}***${digits.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function limitLength(value: string) {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 3000 ? `${compact.slice(0, 2997)}...` : compact;
}
