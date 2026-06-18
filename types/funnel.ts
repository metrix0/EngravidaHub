// types/funnel.ts
export type Funnel = {
    id: string;
    name: string;
    active: boolean;
    created_at: string;
    updated_at: string;
};

export type FunnelStage = {
    id: string;
    funnel_id: string;
    name: string;
    position: number;
    color: string | null;
    created_at: string;
    updated_at: string;
};
