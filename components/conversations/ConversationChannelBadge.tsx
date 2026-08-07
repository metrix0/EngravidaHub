// components/conversations/ConversationChannelBadge.tsx
import { FaFacebookMessenger, FaInstagram, FaWhatsapp } from "react-icons/fa6";

import type { InboxChannel } from "@/types/inbox";

export function ConversationChannelBadge({
    channel,
    showLabel = false,
}: {
    channel: InboxChannel | string | null | undefined;
    showLabel?: boolean;
}) {
    const normalizedChannel: InboxChannel =
        channel === "Facebook"
            ? "Facebook"
            : channel === "Instagram"
              ? "Instagram"
              : "WhatsApp";
    const displayLabel =
        normalizedChannel === "Facebook" ? "Messenger" : normalizedChannel;
    const isInstagram = normalizedChannel === "Instagram";
    const isFacebook = normalizedChannel === "Facebook";

    return (
        <span
            title={displayLabel}
            aria-label={displayLabel}
            className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold ${
                isInstagram
                    ? "bg-pink-soft text-pink"
                    : isFacebook
                      ? "bg-blue-100 text-blue-700"
                      : "bg-green-soft text-green"
            }`}
        >
            {isInstagram ? (
                <FaInstagram size={14} />
            ) : isFacebook ? (
                <FaFacebookMessenger size={14} />
            ) : (
                <FaWhatsapp size={14} />
            )}
            {showLabel ? displayLabel : null}
        </span>
    );
}
