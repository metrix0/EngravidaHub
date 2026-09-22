// lib/chatbot/conversationState.ts
import { supabase } from "@/lib/supabase/client";

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type ChatbotConversationState = {
    clarification_pending: boolean;
    awaiting_schedule_interest: boolean;
};

const EMPTY_STATE: ChatbotConversationState = {
    clarification_pending: false,
    awaiting_schedule_interest: false,
};

export async function loadChatbotConversationState(
    sessionKey: string | null | undefined,
): Promise<ChatbotConversationState> {
    if (!sessionKey) return EMPTY_STATE;

    const { data, error } = await supabase
        .from("chatbot_conversation_sessions")
        .select(
            "clarification_pending, awaiting_schedule_interest, updated_at",
        )
        .eq("session_key", sessionKey)
        .maybeSingle();

    if (error) throw error;
    if (!data) return EMPTY_STATE;

    const updatedAt = new Date(data.updated_at).getTime();
    if (
        Number.isFinite(updatedAt) &&
        Date.now() - updatedAt > SESSION_MAX_AGE_MS
    ) {
        await resetChatbotConversationState(sessionKey);
        return EMPTY_STATE;
    }

    return {
        clarification_pending: data.clarification_pending === true,
        awaiting_schedule_interest:
            data.awaiting_schedule_interest === true,
    };
}

export async function saveChatbotConversationState(
    sessionKey: string | null | undefined,
    state: ChatbotConversationState,
) {
    if (!sessionKey) return;

    const now = new Date().toISOString();
    const { error } = await supabase
        .from("chatbot_conversation_sessions")
        .upsert(
            {
                session_key: sessionKey,
                clarification_pending: state.clarification_pending,
                awaiting_schedule_interest:
                    state.awaiting_schedule_interest,
                updated_at: now,
            },
            { onConflict: "session_key" },
        );

    if (error) throw error;
}

export async function resetChatbotConversationState(
    sessionKey: string | null | undefined,
) {
    if (!sessionKey) return;

    const { error } = await supabase
        .from("chatbot_conversation_sessions")
        .delete()
        .eq("session_key", sessionKey);

    if (error) throw error;
}
