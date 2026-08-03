// types/activeMessages.ts

import type { ActiveMessageTemplate } from "@/lib/active-messages/templates";

export type ActiveMessageClient = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    funnel_stage_id: string | null;
    last_interaction_at: string;
    last_origin: string | null;
    last_tunnel: string | null;
    last_closing_tag: string | null;
    last_client_message_at: string | null;
    whatsapp_window_open: boolean;
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

export type ActiveMessageHistoryRecipient = {
    client_id: string;
    client_name: string;
    phone: string | null;
    status: "sent" | "failed";
    responded: boolean;
    response_target_type: "thread" | "conversation" | null;
    response_target_id: string | null;
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
    schedule_count: number;
    response_count: number;
    recipients: ActiveMessageHistoryRecipient[];
    status: "processing" | "completed" | "partial" | "failed";
    created_by_name: string | null;
    created_at: string;
    completed_at: string | null;
};

export type ActiveMessageTemplateSender = "primary" | "secondary";

export type ActiveMessageTemplateSenderOption = {
    value: ActiveMessageTemplateSender;
    number: string;
    label: string;
    description: string;
};

export type ActiveMessagesPageResponse = {
    templates: ActiveMessageTemplate[];
    template_senders: ActiveMessageTemplateSenderOption[];
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
