// types/inbox.ts
export type InboxStatus = "open" | "closed";

export type InboxItemType = "thread" | "conversation";

export type InboxChannel = "WhatsApp" | "Instagram" | "Facebook";

export type InboxSenderType = "client" | "attendant" | "bot" | "system";

export type ClientNote = {
    id: string;
    author_name: string;
    text: string;
    created_at: string;
};

export type InboxThreadListItem = {
    id: string;
    item_type: InboxItemType;
    thread_id: string | null;
    client_id: string;
    conversation_id: string | null;
    name: string;
    initials: string;
    phone: string | null;
    channel: InboxChannel;
    preview: string;
    time: string;
    unread: number;
    status: InboxStatus;
    city: string | null;
    unit_name: string | null;
    funnel: string;
    funnelStage: string;
    funnel_stage_id: string | null;
    intent: string | null;
    origin: string | null;
    campaign: string | null;
    responsible: string | null;
    lastContact: string;
};

export type InboxMessage = {
    id: string;
    from: "client" | "attendant";
    sender_type: InboxSenderType;
    sender_name?: string | null;
    text: string;
    time: string;
    sent_at: string;
    sequence_index?: number | null;
    conversation_boundary_label?: string | null;
};

export type InboxNote = {
    id: string;
    author: string;
    time: string;
    text: string;
    created_at: string;
};

export type InboxThreadDetail = InboxThreadListItem & {
    messages: InboxMessage[];
    notes: InboxNote[];
    can_reply: boolean;
    reply_window_ends_at: string | null;
    has_older_conversations: boolean;
    history_before: string;
};

export type InboxThreadsResponse = {
    items: InboxThreadListItem[];
    total: number;
    page: number;
    page_size: number;
};

export type InboxThreadDetailResponse = {
    item: InboxThreadDetail;
};

export type InboxHistoryConversation = {
    id: string;
    started_at: string;
    ended_at: string | null;
    label: string;
    messages: InboxMessage[];
};

export type InboxHistoryResponse = {
    item: InboxHistoryConversation | null;
    has_more: boolean;
    next_before: string | null;
};
