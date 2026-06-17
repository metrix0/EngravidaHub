// lib/importers/blip/parseBlipMessage.ts
import type { SenderType } from "@/types/message";

export type ParsedBlipMessage = {
    sender_type: SenderType;
    sender_name: string | null;

    text: string;

    sent_at: string;

    external_attendant_id: string | null;

    external_id: string | null;
    external_contact_id: string | null;
    external_thread_id: string | null;
    interactive_option_id: string | null;
};

type BlipPayload = {
    type?: string;
    content?: any;
    id?: string;
    from?: string;
    to?: string;
    metadata?: Record<string, any>;
};

export function parseBlipMessage(payload: BlipPayload): ParsedBlipMessage | null {
    const metadata = payload.metadata ?? {};

    const text = extractText(payload);

    if (!text) {
        return null;
    }

    return {
        sender_type: getSenderType(payload),
        sender_name: getSenderName(payload),

        text,

        sent_at: getSentAt(payload),

        external_attendant_id: getExternalAttendantId(payload),

        external_id: payload.id ?? null,
        external_contact_id: getExternalContactId(payload),
        external_thread_id: metadata["#wa.bsuid"] ?? null,
        interactive_option_id:
            metadata["#wa.interactive.list.id"] ??
            metadata["#wa.interactive.button.id"] ??
            null,
    };
}

function extractText(payload: BlipPayload): string | null {
    if (payload.type === "text/plain") {
        return typeof payload.content === "string" ? payload.content : null;
    }

    if (payload.type === "application/vnd.lime.reply+json") {
        return payload.content?.replied?.value ?? null;
    }

    if (payload.type === "application/vnd.lime.media-link+json") {
        const mediaType = payload.content?.type ?? "mídia";

        if (mediaType.startsWith("image/")) return "[Imagem enviada]";
        if (mediaType.startsWith("video/")) return "[Vídeo enviado]";
        if (mediaType.startsWith("audio/")) return "[Áudio enviado]";

        return "[Arquivo enviado]";
    }

    if (payload.type === "application/vnd.lime.select+json") {
        return payload.content?.text ?? null;
    }

    if (payload.type === "application/json") {
        return (
            payload.content?.interactive?.body?.text ??
            payload.content?.text ??
            null
        );
    }

    if (payload.type === "application/vnd.lime.reaction+json") {
        const values = payload.content?.emoji?.values;

        if (!Array.isArray(values)) return "[Reação enviada]";

        return values
            .map((value) => String.fromCodePoint(Number(value)))
            .join("");
    }

    return null;
}

function getSenderType(payload: BlipPayload): SenderType {
    const metadata = payload.metadata ?? {};

    if (isWhatsappIdentity(payload.from)) {
        return "client";
    }

    if (metadata["#messageEmitter"] === "Human") {
        return "attendant";
    }

    if (payload.from?.includes("msging.net")) {
        return "bot";
    }

    return "system";
}

function getSenderName(payload: BlipPayload): string | null {
    const externalAttendantId = getExternalAttendantId(payload);

    if (!externalAttendantId) return null;

    return decodeURIComponent(String(externalAttendantId).split("@blip.ai")[0]);
}

function getExternalAttendantId(payload: BlipPayload): string | null {
    const agentIdentity = payload.metadata?.["#message.agentIdentity"];

    if (!agentIdentity) return null;

    return decodeURIComponent(String(agentIdentity));
}

function getSentAt(payload: BlipPayload): string {
    const metadata = payload.metadata ?? {};

    if (metadata["#envelope.storageDate"]) {
        return metadata["#envelope.storageDate"];
    }

    if (metadata.date_created) {
        return new Date(Number(metadata.date_created)).toISOString();
    }

    if (metadata["#wa.timestamp"]) {
        return new Date(Number(metadata["#wa.timestamp"]) * 1000).toISOString();
    }

    return new Date().toISOString();
}

function getExternalContactId(payload: BlipPayload): string | null {
    const metadata = payload.metadata ?? {};

    if (isWhatsappIdentity(payload.from)) {
        return payload.from ?? null;
    }

    if (isWhatsappIdentity(payload.to)) {
        return payload.to ?? null;
    }

    if (metadata["#tunnel.originator"]) {
        return metadata["#tunnel.originator"];
    }

    return payload.from ?? null;
}

function isWhatsappIdentity(value: string | undefined): boolean {
    return Boolean(value?.includes("@wa.gw.msging.net"));
}
