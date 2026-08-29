// types/assistant.ts
export type AssistantClientCardData = {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    state: string | null;
    unit_name: string | null;
    funnel_name: string | null;
    stage_name: string | null;
    first_seen_at: string | null;
    last_interaction_at: string | null;
    utm_source: string | null;
    utm_campaign: string | null;
    upcoming_appointment_count: number;
    next_appointment: {
        id: string;
        starts_at: string;
        status: string;
        procedure_name: string;
        doctor_name: string | null;
        attendant_name: string | null;
        unit_name: string | null;
    } | null;
};

export type AssistantConversationMessage = {
    sender_type: "client" | "attendant" | "bot" | "system";
    sender_name: string | null;
    text: string;
    sent_at: string;
};

export type AssistantConversationCardData = {
    id: string;
    client_id: string;
    client_name: string;
    unit_name: string | null;
    started_at: string;
    ended_at: string | null;
    attendant_name: string | null;
    short_label: string | null;
    conversation_goal: string | null;
    goal_status: string | null;
    customer_final_state: string | null;
    resolution_result: string | null;
    resolution_score?: number | null;
    dropoff_happened: boolean;
    dropoff_moment: string | null;
    satisfaction_score: number | null;
    attendant_quality_score: number | null;
    notable: boolean;
    notable_reason: string | null;
    preview: string | null;
    client_profile?: AssistantClientCardData | null;
    messages?: AssistantConversationMessage[];
    messages_truncated?: boolean;
};

export type AssistantCard =
    | {
          type: "client";
          data: AssistantClientCardData;
      }
    | {
          type: "conversation";
          data: AssistantConversationCardData;
      }
    | {
          type: "export";
          data: {
              id: string;
              file_name: string;
              row_count: number;
              expires_at: string;
          };
      };

export type AssistantChatRole = "user" | "assistant";

export type AssistantChatMessage = {
    id: string;
    role: AssistantChatRole;
    content: string;
    cards?: AssistantCard[];
    feedback?: "up" | "down" | null;
    created_at: string;
};

export type AssistantChatSession = {
    id: string;
    title: string;
    messages: AssistantChatMessage[];
    created_at: string;
    updated_at: string;
};

export type AssistantChatRequest = {
    session_id: string;
    messages: Array<{
        role: AssistantChatRole;
        content: string;
    }>;
};

export type AssistantChatResponse =
    | {
          ok: true;
          error?: never;
          message: {
              role: "assistant";
              content: string;
              cards: AssistantCard[];
          };
      }
    | {
          ok: false;
          error: string;
          message?: never;
      };
