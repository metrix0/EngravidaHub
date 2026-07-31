// components/conversations/ConversationChannelBadge.tsx
import { FaInstagram, FaWhatsapp } from "react-icons/fa6";

import type { InboxChannel } from "@/types/inbox";

export function ConversationChannelBadge({
    channel,
    showLabel = false,
}: {
    channel: InboxChannel | string | null | undefined;
    showLabel?: boolean;
}) {
    const normalizedChannel: Extract<InboxChannel, "WhatsApp" | "Instagram"> =
        channel === "Instagram" ? "Instagram" : "WhatsApp";
    const isInstagram = normalizedChannel === "Instagram";

    return (
        <span
            title={normalizedChannel}
            aria-label={normalizedChannel}
            className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold ${
                isInstagram
                    ? "bg-pink-soft text-pink"
                    : "bg-green-soft text-green"
            }`}
        >
            {isInstagram ? (
                <FaInstagram size={14} />
            ) : (
                <FaWhatsapp size={14} />
            )}
            {showLabel ? normalizedChannel : null}
        </span>
    );
}
