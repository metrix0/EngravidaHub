// components/conversations/ChatMessageBubble.tsx
"use client";

export type SharedChatMessage = {
    id: string;
    text: string;
    from?: string | null;
    sender_type?: string | null;
    sender_name?: string | null;
    sent_at?: string | null;
    time?: string | null;
    sequence_index?: number | null;
    conversation_boundary_label?: string | null;
};

type ChatMessageBubbleProps = {
    message: SharedChatMessage;
};

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
    const isAttendant = isAttendantMessage(message);
    const senderLabel = getSenderLabel(message, isAttendant);
    const timeLabel = getTimeLabel(message);

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

                <p className="whitespace-pre-wrap">{message.text}</p>

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

function isEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalize(value: string) {
    return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
