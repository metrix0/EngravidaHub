// lib/messages/preservedMessage.ts
const PRESERVED_MESSAGE_PATTERN = /^\[Mensagem preservada:[^\]]*\]$/i;

export function isPreservedMessageText(value: string | null | undefined) {
    return PRESERVED_MESSAGE_PATTERN.test((value ?? "").trim());
}
