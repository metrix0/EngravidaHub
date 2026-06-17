// src/types/attendant.ts
export type Attendant = {
    id: string;

    name: string;
    email: string | null;

    unit_id: string | null;

    external_attendant_id: string | null; // nome@engravida.com.br@blip.ai


    active: boolean;

    created_at: string;
    updated_at: string;
};