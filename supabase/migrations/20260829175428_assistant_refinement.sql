alter table public.assistant_chat_sessions
    add column if not exists summary text not null default '',
    add column if not exists summary_message_count integer not null default 0,
    add column if not exists summary_updated_at timestamptz;

create table if not exists public.assistant_chat_runs (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid not null,
    session_id uuid not null references public.assistant_chat_sessions(id) on delete cascade,
    model text not null,
    status text not null check (status in ('completed', 'failed', 'incomplete')),
    input_tokens integer,
    cached_input_tokens integer,
    output_tokens integer,
    reasoning_tokens integer,
    estimated_cost_usd numeric(12, 6),
    tool_names text[] not null default '{}',
    tool_rounds integer not null default 0,
    duration_ms integer not null,
    error_message text,
    created_at timestamptz not null default now(),
    constraint assistant_chat_runs_nonnegative_tokens check (
        coalesce(input_tokens, 0) >= 0
        and coalesce(cached_input_tokens, 0) >= 0
        and coalesce(output_tokens, 0) >= 0
        and coalesce(reasoning_tokens, 0) >= 0
        and tool_rounds >= 0
        and duration_ms >= 0
    )
);

create index if not exists assistant_chat_runs_user_created_idx
    on public.assistant_chat_runs (auth_user_id, created_at desc);

create index if not exists assistant_chat_runs_session_created_idx
    on public.assistant_chat_runs (session_id, created_at desc);

alter table public.assistant_chat_runs enable row level security;
revoke all on table public.assistant_chat_runs from anon, authenticated;

create table if not exists public.assistant_message_feedback (
    assistant_message_id uuid primary key references public.assistant_chat_messages(id) on delete cascade,
    auth_user_id uuid not null,
    rating text not null check (rating in ('up', 'down')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists assistant_message_feedback_user_updated_idx
    on public.assistant_message_feedback (auth_user_id, updated_at desc);

alter table public.assistant_message_feedback enable row level security;
revoke all on table public.assistant_message_feedback from anon, authenticated;

create table if not exists public.assistant_exports (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid not null,
    session_id uuid not null references public.assistant_chat_sessions(id) on delete cascade,
    file_name text not null,
    mime_type text not null default 'text/csv; charset=utf-8',
    content text not null,
    row_count integer not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '7 days'),
    constraint assistant_exports_nonnegative_row_count check (row_count >= 0)
);

create index if not exists assistant_exports_user_created_idx
    on public.assistant_exports (auth_user_id, created_at desc);

create index if not exists assistant_exports_expiry_idx
    on public.assistant_exports (expires_at);

alter table public.assistant_exports enable row level security;
revoke all on table public.assistant_exports from anon, authenticated;
