type EvidenceMessage = { id: string; conversation_id: string; text: string | null };

// Keep a valid JSON envelope and conversation identity in every model input.
// Long messages are split without discarding text; persisted examples still use the original message.
export function partitionEvidence<T extends EvidenceMessage>(batch: {
    messages: T[];
    [key: string]: unknown;
}, maxChars = 45_000) {
    const { messages, ...metadata } = batch;
    const parts: string[] = [];
    let page: T[] = [];
    for (const message of messages) {
        const text = message.text ?? "";
        const fragments = text.length ? text.match(/[\s\S]{1,12000}/gu)! : [text];
        for (const text of fragments) {
            const fragment = { ...message, text };
            if (page.length && JSON.stringify({ ...metadata, messages: [...page, fragment] }).length > maxChars) {
                parts.push(JSON.stringify({ ...metadata, messages: page }));
                page = [];
            }
            page.push(fragment);
        }
    }
    if (page.length || !parts.length) parts.push(JSON.stringify({ ...metadata, messages: page }));
    return parts;
}

export function verifiedEvidence<T extends EvidenceMessage>(messages: T[], finding: {
    conversation: string;
    evidence: string;
    quote: string;
}) {
    return messages.some(message => message.id === finding.evidence && message.conversation_id === finding.conversation && Boolean(finding.quote.trim()) && Boolean(message.text?.includes(finding.quote)));
}
