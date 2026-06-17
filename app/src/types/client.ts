// src/types/client.ts

export type Client = {
    id: string;

    name: string | null;
    phone: string | null;

    external_contact_id: string | null; // 1231233213120402@wa.gw.msging.net DO NOT ASSUME PHONE!

    created_at: string;
    updated_at: string;

    first_seen_at: string;
    last_interaction_at: string;
    pipeline_stage_id?: string | null;
};