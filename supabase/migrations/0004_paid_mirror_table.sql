-- ============================================================================
-- Mirror table for paid status, living IN Supabase's own Postgres.
--
-- Why: subscriptions (written by the Stripe webhook) lives on Render Postgres
-- (DATABASE_URL), a separate DB from this Supabase project. custom_access_token_hook
-- runs inside Supabase's Postgres and cannot see Render — so the is_paid check in
-- 0003 always returned false. This table is the Supabase-side copy the hook reads.
-- Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.subscription_status (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  status     text not null,
  updated_at timestamptz not null default now()
);

grant select on public.subscription_status to supabase_auth_admin;
