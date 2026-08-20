create table if not exists public.conversation_ad_attributions (
    id uuid primary key default gen_random_uuid(),
    instagram_user_id uuid not null references public.instagram_users(id) on delete cascade,
    thread_id uuid references public.thread(id) on delete set null,
    message_id uuid references public.messages(id) on delete set null,
    channel text not null check (channel in ('Instagram', 'Facebook')),
    zernio_conversation_id text not null,
    zernio_account_id text not null,
    meta_ad_id text not null,
    referral_ref text,
    referral_source text,
    referral_type text,
    referral_ad_title text,
    referral_photo_url text,
    referral_video_url text,
    referral_post_id text,
    zernio_ad_id text,
    platform text,
    campaign_id text,
    campaign_name text,
    ad_set_id text,
    ad_set_name text,
    ad_name text,
    creative_image_url text,
    creative_video_url text,
    referral_received_at timestamptz not null,
    enrichment_status text not null default 'pending'
        check (enrichment_status in ('pending', 'resolved', 'unavailable', 'failed')),
    enrichment_error text,
    enriched_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists conversation_ad_attributions_message_id_uidx
    on public.conversation_ad_attributions(message_id);

create index if not exists conversation_ad_attributions_instagram_user_idx
    on public.conversation_ad_attributions(instagram_user_id, referral_received_at desc);

create index if not exists conversation_ad_attributions_thread_idx
    on public.conversation_ad_attributions(thread_id, referral_received_at desc);

create index if not exists conversation_ad_attributions_meta_ad_idx
    on public.conversation_ad_attributions(meta_ad_id);

create index if not exists conversation_ad_attributions_campaign_idx
    on public.conversation_ad_attributions(campaign_id)
    where campaign_id is not null;

alter table public.instagram_users
    add column if not exists last_meta_ad_id text,
    add column if not exists last_ad_campaign_id text,
    add column if not exists last_ad_campaign_name text,
    add column if not exists last_ad_set_id text,
    add column if not exists last_ad_set_name text,
    add column if not exists last_ad_name text,
    add column if not exists last_paid_attribution_at timestamptz;
