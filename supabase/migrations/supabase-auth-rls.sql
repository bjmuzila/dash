-- ============================================================================
-- Supabase Auth migration — chat_messages RLS
-- Run in the Supabase SQL editor AFTER enabling Email + Google providers.
--
-- Before (Clerk third-party auth): policies compared user_id to the Clerk
-- subject via auth.jwt()->>'sub'. Now that auth is native Supabase Auth, the
-- signed-in user is auth.uid() (a uuid). user_id stays TEXT to avoid a data
-- migration (fresh-start: existing rows are disposable), and we cast uid to text.
-- ============================================================================

-- 1) Make sure RLS is on.
alter table public.chat_messages enable row level security;

-- 2) Drop any old Clerk-era policies (names from the original setup; the
--    "if exists" guards make this safe to run even if they differ).
drop policy if exists "chat read"            on public.chat_messages;
drop policy if exists "chat insert own"      on public.chat_messages;
drop policy if exists "Authenticated read"   on public.chat_messages;
drop policy if exists "Insert own messages"  on public.chat_messages;

-- 3) Read: any authenticated user can read the global room.
create policy "chat read"
  on public.chat_messages
  for select
  to authenticated
  using (true);

-- 4) Insert: a user may only insert rows stamped with their own id.
--    user_id is TEXT, auth.uid() is uuid → cast for the comparison.
create policy "chat insert own"
  on public.chat_messages
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

-- 5) No DELETE policy by design — bulk clears run server-side with the service
--    role key (app/api/chat/clear), which bypasses RLS.

-- 6) Realtime: ensure the table is in the realtime publication so INSERT/DELETE
--    broadcast to subscribers.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end $$;
