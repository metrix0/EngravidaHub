// lib/active-messages/templateSenders.ts
import type {
    ActiveMessageTemplateSender,
    ActiveMessageTemplateSenderOption,
} from "@/types/activeMessages";

export const DEFAULT_ACTIVE_MESSAGE_TEMPLATE_SENDER: ActiveMessageTemplateSender =
    "secondary";

export function getActiveMessageTemplateSenderOptions(): ActiveMessageTemplateSenderOption[] {
    const primaryNumber =
        firstEnvironmentValue(
            "BLIP_PRIMARY_PHONE_NUMBER",
            "BLIP_PHONE_NUMBER",
            "BLIP_WHATSAPP_NUMBER",
        ) ?? "(11) 94918-0394";
    const secondaryNumber =
        firstEnvironmentValue(
            "BLIP_ACTIVE_PHONE_NUMBER",
            "BLIP_ACTIVE_ROUTER_PHONE_NUMBER",
            "BLIP_SECONDARY_PHONE_NUMBER",
        ) ?? "(11) 98269-0163";

    return [
        {
            value: "primary",
            number: primaryNumber,
            label: primaryNumber + " — Número principal",
            description: "Roteador usado nas conversas dentro de 24 horas.",
        },
        {
            value: "secondary",
            number: secondaryNumber,
            label: secondaryNumber + " — Número secundário",
            description: "Roteador atual dos envios ativos por template.",
        },
    ];
}

export function parseActiveMessageTemplateSender(
    value: unknown,
): ActiveMessageTemplateSender | null {
    return value === "primary" || value === "secondary" ? value : null;
}

function firstEnvironmentValue(...names: string[]) {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) return value;
    }
    return null;
}
