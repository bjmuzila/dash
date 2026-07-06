-- ============================================================================
-- TEMPORARY: log every real invocation of custom_access_token_hook so we can
-- see exactly what it sees at runtime (as supabase_auth_admin), since a manual
-- call as `postgres` returns is_paid=true for a UUID that the real minted
-- token showed is_paid=false for. DROP hook_debug_log + revert to 0005's
-- function body once this is resolved.
-- ============================================================================

create table if not exists public.hook_debug_log (
  id         bigserial primary key,
  called_at  timestamptz not null default now(),
  uid_in     text,
  is_owner   boolean,
  is_paid    boolean,
  row_found  boolean,
  err        text
);
grant select, insert on public.hook_debug_log to supabase_auth_admin;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims    jsonb;
  uid       text := event->>'user_id';
  is_owner  boolean;
  is_paid   boolean;
  err_text  text := null;
begin
  begin
    select (ao.owner_id = uid::uuid)
      into is_owner
      from public.app_owner ao
     where ao.id is true;

    select exists (
      select 1 from public.subscription_status s
       where s.user_id = uid::uuid
         and s.status in ('active', 'trialing')
    ) into is_paid;
  exception when others then
    err_text := SQLERRM;
    is_owner := coalesce(is_owner, false);
    is_paid := coalesce(is_paid, false);
  end;

  insert into public.hook_debug_log (uid_in, is_owner, is_paid, err)
  values (uid, is_owner, is_paid, err_text);

  claims := coalesce(event->'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{is_owner}', to_jsonb(coalesce(is_owner, false)));
  claims := jsonb_set(claims, '{is_paid}',  to_jsonb(coalesce(is_paid,  false)));

  return jsonb_set(event, '{claims}', claims);
end;
$$;
