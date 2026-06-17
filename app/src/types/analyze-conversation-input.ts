// app/src/types/analyze-conversation-input.ts

export type AnalyzeConversationInput = {
    conversation_id: string;
    client_id: string;

    started_at: string;
    ended_at: string;

    attendant_id: string | null;
    unit_id: string | null;
    service_id: string | null;

    conversationText: string;
};