// types/analyze-conversation-input.ts
import type { SenderType } from "./message";

export type AnalyzeConversationMessage = {
    id: string;
    sender_type: SenderType;
    sender_name: string | null;
    text: string;
    sent_at: string;
    sequence_index: number;
};

export type AnalyzeConversationInput = {
    conversation_id: string;
    client_id: string | null;
    instagram_user_id: string | null;
    started_at: string;
    ended_at: string;
    attendant_id: string | null;
    unit_id: string | null;
    service_id: string | null;
    conversationText: string;
    messages: AnalyzeConversationMessage[];
};
