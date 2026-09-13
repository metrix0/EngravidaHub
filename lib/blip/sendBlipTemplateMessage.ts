// lib/blip/sendBlipTemplateMessage.ts
import { randomUUID } from "crypto";

import type { ActiveMessageTemplate } from "@/lib/active-messages/templates";

const ACTIVE_CAMPAIGN_POSTMASTER = "postmaster@activecampaign.msging.net";
const ACTIVE_CAMPAIGN_URI = "/campaign/full";
const ACTIVE_CAMPAIGN_TYPE =
    "application/vnd.iris.activecampaign.full-campaign+json";
const WHATSAPP_POSTMASTER = "postmaster@wa.gw.msging.net";
const TEMPLATE_QUERY_URI = "/message-templates-enriched";
const DEFAULT_ACTIVE_MASTERSTATE = "fluxocampanhaativa@msging.net";
const REQUEST_TIMEOUT_MS = 20_000;

export type SentBlipTemplateMessage = {
    id: string;
    to: string;
    response_status: number;
    response_body: string | null;
};

type RouterAuth = {
    key: string;
    source: "BLIP_KEY" | "BLIP_ROUTER_AUTH_KEY" | "BLIP_AUTH_KEY";
    identity: string | null;
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
    raw: Record<string, unknown>;
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
            flowId?: string;
            stateId?: string;
            masterstate?: string;
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

type DebugState = {
    strategy: "router-key-template-discovery";
    contract_id: string;
    commands_endpoint: string;
    recipient: string;
    authorization_source: RouterAuth["source"];
    authorization_identity: string | null;
    requested_template_candidates: string[];
    discovered_template: {
        name: string;
        status: string | null;
        language: string | null;
        parameter_keys: string[];
    } | null;
    provided_parameter_keys: string[];
    flow_redirect: {
        enabled: boolean;
        flow_id: string | null;
        state_id: string | null;
        masterstate: string | null;
    };
    template_queries: Array<{
        candidate: string;
        status: number | null;
        response: string | null;
    }>;
    campaign_response: {
        status: number | null;
        response: string | null;
    };
};

export class BlipTemplateConfigurationError extends Error {
    readonly debug: DebugState | null;

    constructor(message: string, debug: DebugState | null = null) {
        super(message);
        this.name = "BlipTemplateConfigurationError";
        this.debug = debug;
    }
}

export class BlipTemplateApiError extends Error {
    readonly status: number | null;
    readonly debug: DebugState | null;

    constructor(
        message: string,
        status: number | null = null,
        debug: DebugState | null = null,
    ) {
        super(message);
        this.name = "BlipTemplateApiError";
        this.status = status;
        this.debug = debug;
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
    const contractId = getRequiredEnvironmentValue("BLIP_CONTRACT_ID");
    const commandsEndpoint = `https://${contractId}.http.msging.net/commands`;
    const routerAuth = getRouterAuthorization(contractId);
    const normalizedPhone = normalizeBrazilianPhone(recipientNumber);
    const requestedTemplateCandidates = getTemplateCandidates(template);
    const providedParameterKeys = Object.keys(messageParams).sort(compareParameterKeys);
    const redirect = getOptionalRedirectConfiguration();

    const debug: DebugState = {
        strategy: "router-key-template-discovery",
        contract_id: contractId,
        commands_endpoint: commandsEndpoint,
        recipient: maskWhatsAppRecipient(normalizedPhone),
        authorization_source: routerAuth.source,
        authorization_identity: routerAuth.identity,
        requested_template_candidates: requestedTemplateCandidates,
        discovered_template: null,
        provided_parameter_keys: providedParameterKeys,
        flow_redirect: redirect,
        template_queries: [],
        campaign_response: {
            status: null,
            response: null,
        },
    };

    console.info("[blip-active] Starting router-authenticated template discovery", {
        strategy: debug.strategy,
        contract_id: debug.contract_id,
        commands_endpoint: debug.commands_endpoint,
        recipient: debug.recipient,
        authorization_source: debug.authorization_source,
        authorization_identity: debug.authorization_identity,
        requested_template_candidates: debug.requested_template_candidates,
        provided_parameter_keys: debug.provided_parameter_keys,
        flow_redirect: debug.flow_redirect,
    });

    const discoveredTemplate = await discoverApprovedTemplate({
        endpoint: commandsEndpoint,
        auth: routerAuth,
        candidates: requestedTemplateCandidates,
        debug,
    });

    debug.discovered_template = {
        name: discoveredTemplate.name,
        status: discoveredTemplate.status,
        language: discoveredTemplate.language,
        parameter_keys: discoveredTemplate.parameterKeys,
    };

    const expectedParameterKeys = discoveredTemplate.parameterKeys;
    validateExactParameters({
        expectedKeys: expectedParameterKeys,
        messageParams,
        templateName: discoveredTemplate.name,
        debug,
    });

    const orderedParams = Object.fromEntries(
        expectedParameterKeys.map((key) => [key, messageParams[key].trim()]),
    );
    const requestId = randomUUID();
    const payload = buildCampaignPayload({
        requestId,
        normalizedPhone,
        templateName: discoveredTemplate.name,
        templateLanguage: discoveredTemplate.language,
        parameterKeys: expectedParameterKeys,
        orderedParams,
        redirect,
    });

    console.info(`[blip-active:${requestId}] Sending verified campaign`, {
        template: debug.discovered_template,
        flow_redirect: debug.flow_redirect,
        payload: sanitizeCampaignPayload(payload),
    });

    const response = await executeRequest({
        endpoint: commandsEndpoint,
        authKey: routerAuth.key,
        body: payload,
        label: "campaign/full",
        debug,
    });

    debug.campaign_response = {
        status: response.status,
        response: response.text || null,
    };

    if (!response.httpOk) {
        throw new BlipTemplateApiError(
            `A Blip recusou a campanha ativa (HTTP ${response.status})${
                response.text ? `: ${limitLength(response.text)}` : ""
            }`,
            response.status,
            debug,
        );
    }

    const parsed = parseJsonResponse(response.text);
    const failure = getFailure(parsed);

    if (failure) {
        throw new BlipTemplateApiError(
            `A Blip recusou a campanha ativa: ${limitLength(
                JSON.stringify(failure),
            )}`,
            response.status,
            debug,
        );
    }

    console.info(`[blip-active:${requestId}] Campaign accepted`, {
        recipient: debug.recipient,
        template: debug.discovered_template,
        response: parsed,
    });

    return {
        id: requestId,
        to: `${normalizedPhone}@wa.gw.msging.net`,
        response_status: response.status,
        response_body: response.text || null,
    };
}

async function discoverApprovedTemplate({
    endpoint,
    auth,
    candidates,
    debug,
}: {
    endpoint: string;
    auth: RouterAuth;
    candidates: string[];
    debug: DebugState;
}) {
    const seenTemplates = new Map<string, DiscoveredTemplate>();

    for (const candidate of candidates) {
        const request = {
            id: randomUUID(),
            to: WHATSAPP_POSTMASTER,
            method: "get",
            uri: `${TEMPLATE_QUERY_URI}?templateName=${encodeURIComponent(candidate)}`,
        } as const;

        const response = await executeRequest({
            endpoint,
            authKey: auth.key,
            body: request,
            label: `template query: ${candidate}`,
            debug,
        });

        debug.template_queries.push({
            candidate,
            status: response.status,
            response: response.text || null,
        });

        if (!response.httpOk) {
            throw new BlipTemplateApiError(
                `A consulta de templates da Blip falhou (HTTP ${response.status})${
                    response.text ? `: ${limitLength(response.text)}` : ""
                }`,
                response.status,
                debug,
            );
        }

        const parsed = parseJsonResponse(response.text);
        const failure = getFailure(parsed);

        if (failure) {
            if (String(failure.code) === "81") {
                throw new BlipTemplateConfigurationError(
                    "A chave configurada não pertence ao bot roteador com a WABA conectada. Use no Hub a mesma BLIP_KEY do deployment EngravidaFollowUpBlipIntegration.",
                    debug,
                );
            }

            throw new BlipTemplateApiError(
                `A Blip recusou a consulta do template “${candidate}”: ${limitLength(
                    JSON.stringify(failure),
                )}`,
                response.status,
                debug,
            );
        }

        for (const item of extractTemplateItems(parsed?.resource)) {
            const normalized = normalizeDiscoveredTemplate(item);
            if (!normalized) continue;
            seenTemplates.set(normalized.name.toLowerCase(), normalized);
        }

        const exact = seenTemplates.get(candidate.toLowerCase());
        if (exact && isApproved(exact.status)) {
            console.info("[blip-active] Approved template found", {
                requested_candidate: candidate,
                discovered_template: {
                    name: exact.name,
                    status: exact.status,
                    language: exact.language,
                    parameter_keys: exact.parameterKeys,
                },
            });
            return exact;
        }
    }

    const availableTemplates = [...seenTemplates.values()].map((item) => ({
        name: item.name,
        status: item.status,
        language: item.language,
        parameter_keys: item.parameterKeys,
    }));

    throw new BlipTemplateConfigurationError(
        `Nenhum dos templates configurados foi encontrado como APPROVED na WABA do roteador. Consultados: ${candidates.join(
            ", ",
        )}. Retornados: ${JSON.stringify(availableTemplates)}.`,
        debug,
    );
}

function buildCampaignPayload({
    requestId,
    normalizedPhone,
    templateName,
    templateLanguage,
    parameterKeys,
    orderedParams,
    redirect,
}: {
    requestId: string;
    normalizedPhone: string;
    templateName: string;
    templateLanguage: string | null;
    parameterKeys: string[];
    orderedParams: Record<string, string>;
    redirect: DebugState["flow_redirect"];
}): CampaignPayload {
    const campaign: CampaignPayload["resource"]["campaign"] = {
        name: `engravida-hub-${randomUUID()}`,
        campaignType: "Individual",
        channelType: "WhatsApp",
        sourceApplication: "EngravidaHub",
    };

    if (redirect.enabled && redirect.flow_id && redirect.state_id) {
        campaign.flowId = redirect.flow_id;
        campaign.stateId = redirect.state_id;
        if (redirect.masterstate) campaign.masterstate = redirect.masterstate;
    }

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
            campaign,
            audience: {
                recipient: `+${normalizedPhone}`,
                messageParams: orderedParams,
            },
            message,
        },
    };
}

function getOptionalRedirectConfiguration(): DebugState["flow_redirect"] {
    const flowId = process.env.BLIP_ACTIVE_FLOW_ID?.trim() || null;
    const stateId = process.env.BLIP_ACTIVE_STATE_ID?.trim() || null;
    const masterstate =
        process.env.BLIP_ACTIVE_MASTERSTATE?.trim() ||
        DEFAULT_ACTIVE_MASTERSTATE;

    if (!flowId && !stateId) {
        return {
            enabled: false,
            flow_id: null,
            state_id: null,
            masterstate: null,
        };
    }

    if (!flowId || !stateId) {
        throw new BlipTemplateConfigurationError(
            "BLIP_ACTIVE_FLOW_ID e BLIP_ACTIVE_STATE_ID devem ser configurados juntos. Remova ambos para enviar sem redirecionamento, ou informe os dois valores reais do Builder.",
        );
    }

    if (!isUuid(flowId) || !isUuid(stateId)) {
        throw new BlipTemplateConfigurationError(
            "BLIP_ACTIVE_FLOW_ID e BLIP_ACTIVE_STATE_ID precisam ser UUIDs reais obtidos no Builder. Identificadores de bot e nomes de bloco não são válidos.",
        );
    }

    return {
        enabled: true,
        flow_id: flowId,
        state_id: stateId,
        masterstate,
    };
}

function getRouterAuthorization(contractId: string): RouterAuth {
    const options: Array<{
        name: RouterAuth["source"];
        value: string | undefined;
    }> = [
        { name: "BLIP_KEY", value: process.env.BLIP_KEY },
        {
            name: "BLIP_ROUTER_AUTH_KEY",
            value: process.env.BLIP_ROUTER_AUTH_KEY,
        },
        { name: "BLIP_AUTH_KEY", value: process.env.BLIP_AUTH_KEY },
    ];

    const mismatches: string[] = [];

    for (const option of options) {
        const rawValue = option.value?.trim();
        if (!rawValue) continue;

        const key = normalizeAuthorizationKey(rawValue);
        const identity = decodeAuthorizationIdentity(key);

        if (identity && !authorizationMatchesContract(identity, contractId)) {
            mismatches.push(`${option.name}=${identity}`);
            continue;
        }

        return {
            key,
            source: option.name,
            identity,
        };
    }

    if (mismatches.length > 0) {
        throw new BlipTemplateConfigurationError(
            `Nenhuma chave do roteador foi encontrada. As chaves disponíveis pertencem a outro bot (${mismatches.join(
                ", ",
            )}). Configure no Hub a mesma BLIP_KEY usada pelo EngravidaFollowUpBlipIntegration para o roteador “${contractId}”.`,
        );
    }

    throw new BlipTemplateConfigurationError(
        `BLIP_KEY do roteador “${contractId}” não está configurada no servidor.`,
    );
}

function authorizationMatchesContract(identity: string, contractId: string) {
    const localPart = identity.split("@")[0]?.toLowerCase();
    return localPart === contractId.toLowerCase();
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

function getTemplateCandidates(template: ActiveMessageTemplate) {
    return uniqueStrings([
        process.env.BLIP_ACTIVE_TEMPLATE?.trim(),
        template.blip_template_name.trim(),
        template.id.trim(),
    ]);
}

function normalizeDiscoveredTemplate(
    value: unknown,
): DiscoveredTemplate | null {
    if (!isRecord(value)) return null;

    const name = getString(value, ["name", "templateName", "template_name"]);
    if (!name) return null;

    const status = getString(value, ["status"]);
    const language = getString(value, ["language", "languageCode"]);
    const components = value.components;

    return {
        name,
        status,
        language,
        parameterKeys: extractParameterKeys(components),
        raw: value,
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
    debug,
}: {
    expectedKeys: string[];
    messageParams: Record<string, string>;
    templateName: string;
    debug: DebugState;
}) {
    const providedKeys = Object.keys(messageParams).sort(compareParameterKeys);

    if (
        expectedKeys.length !== providedKeys.length ||
        expectedKeys.some((key, index) => key !== providedKeys[index])
    ) {
        throw new BlipTemplateConfigurationError(
            `O template aprovado “${templateName}” espera os parâmetros [${expectedKeys.join(
                ", ",
            )}], mas o Hub forneceu [${providedKeys.join(", ")}].`,
            debug,
        );
    }

    for (const key of expectedKeys) {
        if (!messageParams[key]?.trim()) {
            throw new BlipTemplateConfigurationError(
                `O parâmetro ${key} do template “${templateName}” está vazio.`,
                debug,
            );
        }
    }
}

async function executeRequest({
    endpoint,
    authKey,
    body,
    label,
    debug,
}: {
    endpoint: string;
    authKey: string;
    body: unknown;
    label: string;
    debug: DebugState;
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
            error instanceof Error ? `${error.name}: ${error.message}` : String(error);

        throw new BlipTemplateApiError(
            `Falha de conexão durante “${label}”: ${message}`,
            null,
            debug,
        );
    }

    const text = await response.text();

    console.info(`[blip-active] ${label} response`, {
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

function sanitizeCampaignPayload(payload: CampaignPayload) {
    return {
        ...payload,
        resource: {
            ...payload.resource,
            audience: {
                ...payload.resource.audience,
                recipient: maskPhone(payload.resource.audience.recipient),
            },
        },
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
        throw new BlipTemplateConfigurationError(
            `${name} não está configurado no servidor.`,
        );
    }
    return value;
}

function normalizeAuthorizationKey(value: string) {
    const key = value.replace(/^Key\s+/i, "").trim();
    if (!key) {
        throw new BlipTemplateConfigurationError(
            "A chave de autenticação da Blip é inválida.",
        );
    }
    return key;
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

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}

function maskWhatsAppRecipient(phone: string) {
    return `${maskPhone(phone)}@wa.gw.msging.net`;
}

function maskPhone(value: string) {
    const prefix = value.startsWith("+") ? "+" : "";
    const digits = value.replace(/\D/g, "");

    if (digits.length <= 8) return `${prefix}***`;
    return `${prefix}${digits.slice(0, 4)}***${digits.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function limitLength(value: string) {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 3000 ? `${compact.slice(0, 2997)}...` : compact;
}
