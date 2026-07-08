// components/assistant/AssistantClientCard.tsx
"use client";

import { ChevronRight } from "lucide-react";

import ClientDetailsHeader from "@/components/clientes/ClientDetailsHeader";
import type { AssistantClientCardData } from "@/types/assistant";

export default function AssistantClientCard({
    client,
    onOpen,
    embedded = false,
}: {
    client: AssistantClientCardData;
    onOpen: () => void;
    embedded?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`group relative w-full cursor-pointer bg-white text-left transition hover:bg-slate-50/70 ${
                embedded
                    ? "px-5 py-5"
                    : "rounded-2xl border border-slate-200 p-5 shadow-sm"
            }`}
        >
            <ClientDetailsHeader
                client={{
                    name: client.name,
                    phone: client.phone,
                    first_seen_at: client.first_seen_at,
                    last_interaction_at: client.last_interaction_at,
                    utm_source: client.utm_source,
                    utm_campaign: client.utm_campaign,
                    unit: client.unit_name
                        ? { name: client.unit_name }
                        : null,
                    funnel: client.funnel_name
                        ? { name: client.funnel_name }
                        : null,
                    stage: client.stage_name
                        ? { name: client.stage_name }
                        : null,
                }}
            />

            <ChevronRight
                size={18}
                className="absolute right-5 top-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700"
            />
        </button>
    );
}
