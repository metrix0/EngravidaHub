// types/client.ts

export type Client = {
    id: string;

    name: string | null;
    phone: string | null;
    email?: string | null;

    external_contact_id: string | null; // 1231233213120402@wa.gw.msging.net DO NOT ASSUME PHONE!

    created_at: string;
    updated_at: string;

    first_seen_at: string;
    last_interaction_at: string;
    funnel_stage_id?: string | null;

    country?: string | null;
    state?: string | null;
    street?: string | null;
    number?: string | null;
    cep?: string | null;
    cpf?: string | null;
    birth_date?: string | null;
    spouse_client_id?: string | null;
};
