// lib/ai/assistantMarkdown.ts

export function normalizeAssistantBoldWhitespace(value: string) {
    return value
        .replace(/\*\*[ \t]+([^*\n]*?\S)[ \t]*\*\*/g, "**$1**")
        .replace(/\*\*([^*\n]*?\S)[ \t]+\*\*/g, "**$1**");
}
