// src/types/message.ts
export type SenderType = "client" | "attendant" | "bot" | "system";

export type Message = {
    id: string;

    client_id: string;
    conversation_id: string | null;

    sender_type: SenderType;
    sender_name: string | null;

    text: string;

    sent_at: string;
    sequence_index: number;

    external_id: string | null; // WhatsApp message id, body.id

    external_contact_id: string | null; // 1231233213120402@wa.gw.msging.net DO NOT ASSUME PHONE!
    external_thread_id: string | null; // wa.bsuid
    external_attendant_id: string | null;
    interactive_option_id: string | null; // list/button selected id


    created_at: string;
};