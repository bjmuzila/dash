-- Subscriber chat: single global room.
-- All signed-in users are paid, so RLS == "is the request authenticated".
-- Auth comes from a Clerk JWT (template name "supabase"); Clerk sets `sub`
-- to the Clerk user id, which we trust as the message author.

create table if not exists public.chat_messages (
  id          bigint generated always as identity primary key,
  user_id     text        not null,            -- Clerk user id (jwt.sub)
  display_name text       not null default '',  -- denormalized for fast render
  body        text        not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at);

alter table public.chat_messages enable row level security;

-- Helper: the Clerk user id from the verified JWT.
create or replace function public.clerk_user_id() returns text
  language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
$$;

-- Any authenticated subscriber can read the room.
drop policy if exists chat_read on public.chat_messages;
create policy chat_read on public.chat_messages
  for select to authenticated
  using (true);

-- A user may only insert rows authored by themselves.
drop policy if exists chat_insert_own on public.chat_messages;
create policy chat_insert_own on public.chat_messages
  for insert to authenticated
  with check (user_id = public.clerk_user_id());

-- No updates/deletes from clients (omit those policies => denied under RLS).

-- Realtime: broadcast inserts on this table.
alter publication supabase_realtime add table public.chat_messages;
