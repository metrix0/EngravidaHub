// app/src/types/conversation.ts
export type ConversationSource =
    | "blip"
    | "whatsapp"
    | "manual_import"
    | "other";

export type Conversation = {
    id: string;
    client_id: string;

    source: ConversationSource;

    started_at: string;
    ended_at: string | null;

    attendant_id: string | null;
    attendant_chat_name: string | null;

    unit_id: string | null;

    service_id: string | null;

    conversation_analysis_id: string | null;

    created_at: string;
    updated_at: string;
};