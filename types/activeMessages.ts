// types/activeMessages.ts

import type { ActiveMessageTemplate } from "@/lib/active-messages/templates";

export type ActiveMessageClient = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    funnel_stage_id: string | null;
    last_interaction_at: string;
    utm_source: string | null;
    last_client_message_at: string | null;
    last_active_message_sent_at: string | null;
};

export type ActiveMessageFunnelStage = {
    id: string;
    funnel_id: string;
    name: string;
    position: number;
    color: string | null;
    funnel_name: string | null;
};

export type ActiveMessageSendHistory = {
    id: string;
    template_id: string;
    template_name: string;
    requested_count: number;
    sent_count: number;
    failed_count: number;
    normal_message_count: number;
    template_message_count: number;
    status: "processing" | "completed" | "partial" | "failed";
    created_by_name: string | null;
    created_at: string;
    completed_at: string | null;
};

export type ActiveMessagesPageResponse = {
    templates: ActiveMessageTemplate[];
    clients: ActiveMessageClient[];
    stages: ActiveMessageFunnelStage[];
    history: ActiveMessageSendHistory[];
};

export type ActiveMessageRecipientResult = {
    client_id: string;
    client_name: string;
    phone: string | null;
    mode: "normal" | "template";
    status: "sent" | "failed";
    external_id: string | null;
    error: string | null;
    last_client_message_at: string | null;
};

export type ActiveMessageSendResponse = {
    ok: boolean;
    batch_id: string;
    status: "completed" | "partial" | "failed";
    requested_count: number;
    sent_count: number;
    failed_count: number;
    normal_message_count: number;
    template_message_count: number;
    results: ActiveMessageRecipientResult[];
};
