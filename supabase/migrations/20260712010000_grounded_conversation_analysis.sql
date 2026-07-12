begin;

alter table public.conversation_analysis
    alter column satisfaction_score drop not null,
    alter column clarity_score drop not null,
    alter column empathy_score drop not null,
    alter column proactivity_score drop not null,
    alter column objection_handling_score drop not null,
    alter column response_speed_score drop not null,
    alter column attendant_quality_score drop not null,
    alter column resolution_score drop not null;

alter table public.conversation_analysis
    add column if not exists dropoff_evidence_message_ids uuid[] not null default '{}',
    add column if not exists sentiment_evidence_message_ids uuid[] not null default '{}',
    add column if not exists attendant_quality_evidence_message_ids uuid[] not null default '{}',
    add column if not exists resolution_evidence_message_ids uuid[] not null default '{}',
    add column if not exists analysis_provider text,
    add column if not exists analysis_model text,
    add column if not exists analysis_prompt_version text,
    add column if not exists analysis_message_count integer,
    add column if not exists analysis_completed_at timestamptz;

alter table public.conversation_analysis
    drop constraint if exists conversation_analysis_analysis_provider_check;

alter table public.conversation_analysis
    add constraint conversation_analysis_analysis_provider_check
    check (analysis_provider is null or analysis_provider in ('openai', 'groq'));

alter table public.conversation_analysis
    drop constraint if exists conversation_analysis_analysis_message_count_check;

alter table public.conversation_analysis
    add constraint conversation_analysis_analysis_message_count_check
    check (analysis_message_count is null or analysis_message_count >= 0);

commit;
