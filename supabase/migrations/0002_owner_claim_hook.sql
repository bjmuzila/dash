-- ============================================================================
-- Custom access-token hook — inject `is_owner` into the JWT
-- Run in the Supabase SQL editor, THEN enable the hook:
--   Dashboard → Authentication → Hooks (Beta) → Customize Access Token (JWT)
--   → select `public.custom_access_token_hook`.
--
-- Why: owner-only route gating previously compared the live session user id to
-- the OWNER_USER_ID env var, which requires resolving the user on the server.
-- With the claim baked into the signed JWT, the middleware/server can read
-- `is_owner` straight from the token (no extra auth round-trip) for cheap,
-- spoof-resistant route gating. getUser() is still used for sensitive actions.
--
-- The owner id is stored in a one-row config table so the hook has no env
-- dependency. Set it to the same UUID as OWNER_USER_ID.
-- ============================================================================

-- 1) Owner config (single row).
create table if not exists public.app_owner (
  id        boolean primary key default true,
  owner_id  uuid not null,
  constraint app_owner_singleton check (id)
);

-- Seed / update the owner id. REPLACE the UUID below with your OWNER_USER_ID.
insert into public.app_owner (id, owner_id)
values (true, '00000000-0000-0000-0000-000000000000')
on conflict (id) do update set owner_id = excluded.owner_id;

-- 2) The hook. Receives the pending token event, returns it with claims merged.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims    jsonb;
  is_owner  boolean;
begin
  select (ao.owner_id = (event->>'user_id')::uuid)
    into is_owner
    from public.app_owner ao
   where ao.id is true;

  claims := coalesce(event->'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{is_owner}', to_jsonb(coalesce(is_owner, false)));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- 3) Grants required for the auth admin role to call the hook.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

grant select on public.app_owner to supabase_auth_admin;
revoke all on public.app_owner from authenticated, anon, public;
alter table public.app_owner enable row level security;
