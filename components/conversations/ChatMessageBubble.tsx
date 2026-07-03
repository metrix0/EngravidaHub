// components/conversations/ChatMessageBubble.tsx
"use client";

import Image from "next/image";
import { Download, FileText } from "lucide-react";
import { useState } from "react";

export type SharedChatMessage = {
    id: string;
    text: string;
    from?: string | null;
    sender_type?: string | null;
    sender_name?: string | null;
    sender_label?: string | null;
    sent_at?: string | null;
    time?: string | null;
    sequence_index?: number | null;
    conversation_boundary_label?: string | null;
};

type ChatMessageBubbleProps = {
    message: SharedChatMessage;
};

type MessageAttachment = {
    path: string;
    name: string;
    mimeType: string;
    size: number | null;
};

const LEGACY_ATTACHMENT_MARKER = "\n::engravida-attachment::";
const ATTACHMENT_METADATA_PREFIX = "engravida-attachment:";
const TAG_CHARACTER_PATTERN = /[\u{E0020}-\u{E007E}]+\u{E007F}/u;

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
    const isAttendant = isAttendantMessage(message);
    const senderLabel = getSenderLabel(message, isAttendant);
    const timeLabel = getTimeLabel(message);
    const attachmentMessage = parseAttachmentMessage(message.text);

    return (
        <div className={`flex ${isAttendant ? "justify-end" : "justify-start"}`}>
            <div
                className={`max-w-[min(72%,520px)] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                    isAttendant
                        ? "rounded-br-sm bg-brand text-white"
                        : "rounded-bl-sm bg-white text-slate-800"
                }`}
            >
                <div
                    className={`mb-1 text-[11px] font-bold ${
                        isAttendant ? "text-white/75" : "text-slate-400"
                    }`}
                >
                    {senderLabel}
                </div>

                {attachmentMessage ? (
                    <AttachmentContent
                        attachment={attachmentMessage.attachment}
                        isAttendant={isAttendant}
                    />
                ) : (
                    <p className="whitespace-pre-wrap">{message.text}</p>
                )}

                <div
                    className={`mt-1 text-right text-xs ${
                        isAttendant ? "text-white/80" : "text-slate-400"
                    }`}
                >
                    {timeLabel}
                </div>
            </div>
        </div>
    );
}

function AttachmentContent({
    attachment,
    isAttendant,
}: {
    attachment: MessageAttachment;
    isAttendant: boolean;
}) {
    const [imageFailed, setImageFailed] = useState(false);
    const attachmentUrl = `/api/inbox/attachments?path=${encodeURIComponent(
        attachment.path,
    )}`;
    const isImage = attachment.mimeType.startsWith("image/");

    return (
        <div className="min-w-0">
            {isImage && !imageFailed ? (
                <a
                    href={attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Abrir imagem"
                    className="block overflow-hidden rounded-xl bg-white"
                >
                    <Image
                        src={attachmentUrl}
                        alt={attachment.name}
                        width={640}
                        height={480}
                        unoptimized
                        onError={() => setImageFailed(true)}
                        className="h-auto max-h-72 w-auto max-w-full object-contain"
                    />
                </a>
            ) : (
                <a
                    href={attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 transition ${
                        isAttendant
                            ? "border-white/20 bg-white/10 hover:bg-white/15"
                            : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                    }`}
                >
                    <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                            isAttendant
                                ? "bg-white/15 text-white"
                                : "bg-white text-slate-500"
                        }`}
                    >
                        <FileText size={19}/>
                    </span>

                    <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                            {attachment.name}
                        </span>
                        {attachment.size ? (
                            <span
                                className={`mt-0.5 block text-xs ${
                                    isAttendant ? "text-white/70" : "text-slate-400"
                                }`}
                            >
                                {formatAttachmentSize(attachment.size)}
                            </span>
                        ) : null}
                    </span>

                    <Download size={17} className="shrink-0"/>
                </a>
            )}

        </div>
    );
}

export function isAttendantMessage(message: SharedChatMessage) {
    const from = normalize(message.from ?? "");
    const senderType = normalize(message.sender_type ?? "");

    return (
        from === "attendant" ||
        senderType.includes("attendant") ||
        senderType.includes("atendente") ||
        senderType.includes("bot") ||
        senderType.includes("system") ||
        senderType.includes("sistema")
    );
}

function getSenderLabel(message: SharedChatMessage, isAttendant: boolean) {
    const explicitLabel = message.sender_label?.trim();
    if (explicitLabel) return explicitLabel;

    if (!isAttendant) return "Cliente";

    const rawName = message.sender_name?.trim();

    if (!rawName || isEmail(rawName)) {
        if (normalize(message.sender_type ?? "").includes("bot")) return "Bot";
        if (normalize(message.sender_type ?? "").includes("system")) return "Sistema";
        return "Atendente";
    }

    return rawName;
}

function getTimeLabel(message: SharedChatMessage) {
    if (message.time) return message.time;
    if (!message.sent_at) return "";

    return new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(message.sent_at));
}

function parseAttachmentMessage(text: string) {
    const metadataText = readAttachmentMetadata(text);
    if (!metadataText) return null;

    const params = new URLSearchParams(metadataText);
    const path = params.get("path")?.trim() ?? "";
    const name = params.get("name")?.trim() ?? "";
    const mimeType = params.get("mime_type")?.trim().toLowerCase() ?? "";
    const rawSize = Number(params.get("size") ?? 0);

    if (!path || !name || !mimeType) return null;

    return {
        attachment: {
            path,
            name,
            mimeType,
            size: Number.isFinite(rawSize) && rawSize > 0 ? rawSize : null,
        } satisfies MessageAttachment,
    };
}

function readAttachmentMetadata(text: string) {
    const legacyMarkerIndex = text.indexOf(LEGACY_ATTACHMENT_MARKER);

    if (legacyMarkerIndex >= 0) {
        return text.slice(legacyMarkerIndex + LEGACY_ATTACHMENT_MARKER.length);
    }

    const tagMatch = text.match(TAG_CHARACTER_PATTERN)?.[0];
    if (!tagMatch) return null;

    const decoded = [...tagMatch]
        .filter((character) => character.codePointAt(0) !== 0xe007f)
        .map((character) =>
            String.fromCharCode((character.codePointAt(0) ?? 0) - 0xe0000),
        )
        .join("");

    if (!decoded.startsWith(ATTACHMENT_METADATA_PREFIX)) return null;

    return decoded.slice(ATTACHMENT_METADATA_PREFIX.length);
}

function formatAttachmentSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalize(value: string) {
    return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
