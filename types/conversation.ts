// types/conversation.ts
export type ConversationSource =
    | "blip"
    | "whatsapp"
    | "manual_import"
    | "zernio"
    | "other";

export type Conversation = {
    id: string;
    client_id: string | null;
    instagram_user_id: string | null;

    source: ConversationSource;

    started_at: string;
    ended_at: string | null;

    attendant_id: string | null;
    attendant_chat_name: string | null;

    unit_id: string | null;

    service_id: string | null;

    conversation_analysis_id: string | null;

    channel: string | null;

    created_at: string;
    updated_at: string;
};
