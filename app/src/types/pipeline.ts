// app/src/types/pipeline.ts
export type Pipeline = {
    id: string;
    name: string;
    active: boolean;
    created_at: string;
    updated_at: string;
};

export type PipelineStage = {
    id: string;
    pipeline_id: string;
    name: string;
    position: number;
    color: string | null;
    created_at: string;
    updated_at: string;
};