// types/internalChat.ts
export type InternalChatUser = {
    id: string;
    email: string | null;
    name: string;
    preset: string | null;
    attendant_name: string | null;
    queue_name: string | null;
    active: boolean;
    online: boolean;
    last_seen_at: string | null;
};

export type InternalConversationSummary = {
    id: string;
    peer: InternalChatUser;
    last_message_text: string | null;
    last_message_at: string | null;
    unread_count: number;
    created_at: string;
    updated_at: string;
};

export type InternalMessage = {
    id: string;
    conversation_id: string;
    sender_auth_user_id: string;
    sender_name: string;
    text: string;
    sent_at: string;
    read_at: string | null;
};

export type InternalConversationDetail = {
    conversation: {
        id: string;
        user_a_id: string;
        user_b_id: string;
        last_message_text: string | null;
        last_message_at: string | null;
        created_at: string;
        updated_at: string;
    };
    peer: InternalChatUser;
    messages: InternalMessage[];
};

export type InternalGroupSummary = {
    id: string;
    queue_id: string | null;
    name: string;
    member_count: number;
    members: Array<{
        id: string;
        name: string;
    }>;
    last_message_text: string | null;
    last_message_at: string | null;
    unread_count: number;
    created_at: string;
    updated_at: string;
};

export type InternalGroupMessage = {
    id: string;
    group_id: string;
    sender_auth_user_id: string;
    sender_name: string;
    text: string;
    sent_at: string;
};

export type InternalGroupDetail = {
    group: InternalGroupSummary;
    messages: InternalGroupMessage[];
};
