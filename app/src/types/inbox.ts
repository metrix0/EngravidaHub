// app/src/types/inbox.ts
export type InboxStatus = "open" | "pending" | "closed";

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

    funnel: string;
    funnelStage: string;
    pipeline_stage_id: string | null;

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
    text: string;
    time: string;
    sent_at: string;
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