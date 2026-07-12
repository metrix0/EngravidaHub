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
    add column if not exists dropoff_evidence_message_ids uuid[] not null default '{}'::uuid[],
    add column if not exists sentiment_evidence_message_ids uuid[] not null default '{}'::uuid[],
    add column if not exists attendant_quality_evidence_message_ids uuid[] not null default '{}'::uuid[],
    add column if not exists resolution_evidence_message_ids uuid[] not null default '{}'::uuid[],
    add column if not exists analysis_provider text,
    add column if not exists analysis_model text,
    add column if not exists analysis_prompt_version text,
    add column if not exists analysis_message_count integer,
    add column if not exists analysis_completed_at timestamptz;

alter table public.conversations
    add column if not exists analysis_status text not null default 'pending',
    add column if not exists analysis_claimed_at timestamptz,
    add column if not exists analysis_failed_at timestamptz,
    add column if not exists analysis_error text;

update public.conversations
set analysis_status = case
    when conversation_analysis_id is not null then 'completed'
    else 'pending'
end
where analysis_status is distinct from case
    when conversation_analysis_id is not null then 'completed'
    else 'pending'
end;

alter table public.conversations
    drop constraint if exists conversations_analysis_status_check;

alter table public.conversations
    add constraint conversations_analysis_status_check
    check (analysis_status in ('pending', 'processing', 'completed', 'failed'));

create index if not exists conversations_analysis_status_idx
    on public.conversations (analysis_status, updated_at)
    where conversation_analysis_id is null;

create or replace function public.claim_conversation_for_analysis(p_conversation_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
    update public.conversations
    set analysis_status = 'processing',
        analysis_claimed_at = now(),
        analysis_failed_at = null,
        analysis_error = null
    where id = p_conversation_id
      and conversation_analysis_id is null
      and analysis_status = 'pending';

    return found;
end;
$$;

revoke all on function public.claim_conversation_for_analysis(uuid) from public, anon, authenticated;
grant execute on function public.claim_conversation_for_analysis(uuid) to service_role;

create or replace function public.complete_conversation_analysis(
    p_conversation_id uuid,
    p_analysis_id uuid,
    p_started_at timestamptz,
    p_ended_at timestamptz,
    p_last_message_text text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
    update public.conversations
    set conversation_analysis_id = p_analysis_id,
        started_at = p_started_at,
        ended_at = p_ended_at,
        last_message_at = p_ended_at,
        last_message_text = p_last_message_text,
        analysis_status = 'completed',
        analysis_claimed_at = null,
        analysis_failed_at = null,
        analysis_error = null
    where id = p_conversation_id
      and conversation_analysis_id is null
      and analysis_status = 'processing';

    return found;
end;
$$;

revoke all on function public.complete_conversation_analysis(uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.complete_conversation_analysis(uuid, uuid, timestamptz, timestamptz, text) to service_role;

create or replace function public.fail_conversation_analysis(
    p_conversation_id uuid,
    p_error text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
    update public.conversations
    set analysis_status = 'failed',
        analysis_failed_at = now(),
        analysis_claimed_at = null,
        analysis_error = left(coalesce(p_error, 'Unknown analysis failure'), 2000)
    where id = p_conversation_id
      and conversation_analysis_id is null
      and analysis_status = 'processing';

    return found;
end;
$$;

revoke all on function public.fail_conversation_analysis(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_conversation_analysis(uuid, text) to service_role;
