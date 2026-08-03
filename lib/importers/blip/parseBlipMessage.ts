// lib/importers/blip/parseBlipMessage.ts
import type { SenderType } from "@/types/message";

export type ParsedBlipMedia = {
    uri: string;
    mime_type: string;
    size: number | null;
    name: string | null;
};

export type ParsedBlipMessage = {
    sender_type: SenderType;
    sender_name: string | null;
    text: string;
    media: ParsedBlipMedia | null;
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

export function parseBlipMessage(
    payload: BlipPayload,
): ParsedBlipMessage | null {
    if (!payload || typeof payload !== "object") return null;

    const metadata = payload.metadata ?? {};
    const extractedText = extractText(payload);

    if (!extractedText && isInvisibleControlPayload(payload)) {
        return null;
    }

    const textValue = extractedText ?? unsupportedText(payload);
    if (!textValue) return null;

    return {
        sender_type: senderType(payload),
        sender_name: senderName(payload),
        text: textValue,
        media: extractMedia(payload),
        sent_at: sentAt(payload),
        external_attendant_id: externalAttendantId(payload),
        external_id: payload.id ?? null,
        external_contact_id: externalContactId(payload),
        external_thread_id: metadata["#wa.bsuid"] ?? null,
        interactive_option_id:
            metadata["#wa.interactive.list.id"] ??
            metadata["#wa.interactive.button.id"] ??
            null,
    };
}

function isInvisibleControlPayload(payload: BlipPayload) {
    if (payload.type === "application/vnd.iris.ticket+json") return true;
    return payload.type === "application/json";
}

function extractText(payload: BlipPayload): string | null {
    if (payload.type === "text/plain") return text(payload.content);

    if (payload.type === "application/vnd.lime.reply+json") {
        return (
            text(payload.content?.replied?.value) ?? text(payload.content?.value)
        );
    }

    if (payload.type === "application/vnd.lime.select+json") {
        return (
            text(payload.content?.text) ??
            text(payload.content?.selected?.text) ??
            text(payload.content?.selected?.value)
        );
    }

    if (payload.type === "application/json") {
        return (
            text(payload.content?.interactive?.body?.text) ??
            text(payload.content?.text) ??
            text(payload.content?.body)
        );
    }

    if (payload.type === "application/vnd.lime.media-link+json") {
        const mime = normalizeMime(payload.content?.type);
        const label = mime.startsWith("image/")
            ? "Imagem"
            : mime.startsWith("video/")
              ? "Vídeo"
              : mime.startsWith("audio/")
                ? "Áudio"
                : "Arquivo";
        const caption =
            text(payload.content?.text) ?? text(payload.content?.title);

        return caption
            ? `[${label} enviado] ${caption}`
            : `[${label} enviado]`;
    }

    if (payload.type === "application/vnd.lime.reaction+json") {
        const values = payload.content?.emoji?.values;
        if (!Array.isArray(values)) return "[Reação enviada]";

        return (
            values
                .map((value) => Number(value))
                .filter(Number.isFinite)
                .map((value) => String.fromCodePoint(value))
                .join("") || "[Reação enviada]"
        );
    }

    if (payload.type === "application/vnd.lime.location+json") {
        const address = text(payload.content?.text);
        return `[Localização enviada]${address ? ` ${address}` : ""}`;
    }

    return null;
}

function unsupportedText(payload: BlipPayload) {
    if (payload.content === undefined && !payload.id) return null;
    if (typeof payload.content === "string" && payload.content.trim()) {
        return payload.content.trim();
    }

    return `[Mensagem preservada: ${String(
        payload.type ?? "tipo desconhecido",
    )}]`;
}

function text(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractMedia(payload: BlipPayload): ParsedBlipMedia | null {
    if (
        payload.type !== "application/vnd.lime.media-link+json" ||
        !payload.content ||
        typeof payload.content !== "object"
    ) {
        return null;
    }

    const uri =
        typeof payload.content.uri === "string"
            ? payload.content.uri.trim()
            : "";
    const mime = normalizeMime(payload.content.type);
    if (!uri || !mime) return null;

    const size = Number(payload.content.size ?? 0);
    const name = text(payload.content.title);

    return {
        uri,
        mime_type: mime,
        size: Number.isFinite(size) && size > 0 ? size : null,
        name,
    };
}

function normalizeMime(value: unknown) {
    let mime = String(value ?? "")
        .trim()
        .toLowerCase()
        .split(";", 1)[0]
        .trim();

    if (mime === "audio/mp3" || mime === "voice/mp3") {
        mime = "audio/mpeg";
    }
    if (mime === "audio/x-m4a" || mime === "voice/mp4") {
        mime = "audio/mp4";
    }
    if (mime === "voice/ogg" || mime === "audio/opus") {
        mime = "audio/ogg";
    }
    if (mime.startsWith("voice/")) mime = `audio/${mime.slice(6)}`;

    return mime;
}

function senderType(payload: BlipPayload): SenderType {
    if (isWhatsapp(payload.from)) return "client";
    if (payload.metadata?.["#messageEmitter"] === "Human") {
        return "attendant";
    }
    if (payload.from?.includes("msging.net")) return "bot";
    return "system";
}

function senderName(payload: BlipPayload) {
    const id = externalAttendantId(payload);
    return id ? decodeURIComponent(id.split("@blip.ai")[0]) : null;
}

function externalAttendantId(payload: BlipPayload) {
    const value = payload.metadata?.["#message.agentIdentity"];
    return value ? decodeURIComponent(String(value)) : null;
}

function sentAt(payload: BlipPayload) {
    const metadata = payload.metadata ?? {};
    const raw =
        metadata["#envelope.storageDate"] ??
        (metadata.date_created
            ? Number(metadata.date_created)
            : metadata["#wa.timestamp"]
              ? Number(metadata["#wa.timestamp"]) * 1000
              : Date.now());
    const date = new Date(raw);

    return Number.isNaN(date.getTime())
        ? new Date().toISOString()
        : date.toISOString();
}

function externalContactId(payload: BlipPayload) {
    if (isWhatsapp(payload.from)) return payload.from ?? null;
    if (isWhatsapp(payload.to)) return payload.to ?? null;

    return payload.metadata?.["#tunnel.originator"] ?? payload.from ?? null;
}

function isWhatsapp(value: string | undefined) {
    return Boolean(value?.includes("@wa.gw.msging.net"));
}
